import json
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError

from app import state
from app.approval import (
    ApprovalAlreadyCommittedError,
    ApprovalAuditConflictError,
    ApprovalEscalatedError,
    ApprovalRunNotFoundError,
    IdempotencyConflictError,
    InvalidIdempotencyKeyError,
    commit_approval,
)
from app.errors import PipelineError
from app.event_store import EventPersistenceError, run_exists
from app.pipeline import run_pipeline
from app.replay import ReplayValidationError, replay_run
from app.schemas import CaseListItem, ApproveRequest, RunCreateRequest, RunStatus

logger = logging.getLogger(__name__)

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
DATA_DIR = REPO_ROOT / "data"

CURRENT_PHASE = "3"

FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:5274")

VALID_CASE_IDS = ["case-001", "case-002", "case-003"]

REQUIRED_META_FIELDS = ["facility_id", "scenario_title", "expected_path_type", "summary"]


def _load_case_meta(case_id: str) -> dict:
    meta_path = DATA_DIR / "cases" / case_id / "meta.json"
    if not meta_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Case metadata missing for {case_id}: meta.json not found.",
        )
    try:
        with open(meta_path, encoding="utf-8") as f:
            meta = json.load(f)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Case metadata for {case_id} is invalid JSON.",
        ) from exc

    for field in REQUIRED_META_FIELDS:
        value = meta.get(field)
        if not isinstance(value, str) or not value.strip():
            raise HTTPException(
                status_code=500,
                detail=f"Case metadata for {case_id} is missing {field}.",
            )
    return meta


def _build_case_list_item(case_id: str) -> CaseListItem:
    meta = _load_case_meta(case_id)
    return CaseListItem(
        case_id=case_id,
        facility_id=meta["facility_id"],
        scenario_title=meta["scenario_title"],
        expected_path_type=meta["expected_path_type"],
        summary=meta["summary"],
    )


def _missing_run_detail(run_id: str) -> str:
    if run_exists(run_id):
        return (
            f"Run {run_id} has a persisted event log, but it contains no "
            "reconstructible events and no in-memory state is loaded."
        )
    return (
        f"Run {run_id} was not found in memory and no persisted event log "
        "exists for reconstruction."
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    for case_id in VALID_CASE_IDS:
        mock_path = DATA_DIR / "cases" / case_id / "mock_run.json"
        if mock_path.exists():
            with open(mock_path, encoding="utf-8") as f:
                mock_data = json.load(f)
            state.seed(mock_data["run_id"], mock_data)
            logger.info("seeded mock run %s for %s", mock_data["run_id"], case_id)
    yield


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_URL],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def get_health():
    return {"status": "ok", "phase": CURRENT_PHASE}


@app.get("/cases", response_model=list[CaseListItem])
def get_cases():
    return [_build_case_list_item(case_id) for case_id in VALID_CASE_IDS]


@app.post("/runs", status_code=201)
def post_runs(body: RunCreateRequest):
    if body.case_id not in VALID_CASE_IDS:
        raise HTTPException(status_code=404, detail=f"Unknown case_id: {body.case_id}")

    facility_id = _load_case_meta(body.case_id)["facility_id"]

    try:
        result = run_pipeline(body.case_id, facility_id)
    except PipelineError as e:
        logger.error("pipeline failed: %s", e, exc_info=True)
        raise HTTPException(status_code=422, detail=str(e))
    except EventPersistenceError as exc:
        logger.error("run persistence failed: outcome=%s", exc.outcome)
        detail = (
            "Run audit persistence outcome is unknown; do not retry automatically. "
            "Operator inspection is required."
            if exc.outcome == "unknown"
            else "The current run audit append was not committed; do not retry "
            "automatically. Operator inspection is required."
        )
        raise HTTPException(status_code=503, detail=detail) from exc

    state.seed(result.run_id, result.model_dump())
    return result


@app.get("/runs/{run_id}")
def get_run(run_id: str):
    if run_exists(run_id):
        try:
            result = replay_run(run_id)
        except ReplayValidationError as exc:
            raise HTTPException(
                status_code=409,
                detail="Persisted audit log cannot be reconstructed safely.",
            ) from exc
        except EventPersistenceError as exc:
            raise HTTPException(
                status_code=503,
                detail="Persisted audit log is temporarily unavailable.",
            ) from exc
        if result is None:
            raise HTTPException(status_code=409, detail=_missing_run_detail(run_id))
        return result.model_copy(update={"is_replay_response": False})

    state_dict = state.get(run_id)
    if state_dict is not None:
        return RunStatus.model_validate(state_dict)
    raise HTTPException(status_code=404, detail=_missing_run_detail(run_id))


@app.post("/runs/{run_id}/approve")
def post_approve(
    run_id: str,
    response: Response,
    body: ApproveRequest = None,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
):
    if body is None:
        body = ApproveRequest()
    if idempotency_key is None:
        raise HTTPException(
            status_code=400,
            detail="Idempotency-Key header is required for approval.",
        )

    cached = state.get(run_id)
    has_log = run_exists(run_id)
    if not has_log and cached is None:
        raise HTTPException(status_code=404, detail=_missing_run_detail(run_id))
    if not has_log and cached is not None and cached.get("status") == "escalated":
        raise HTTPException(status_code=409, detail="Cannot approve an escalated run")
    bootstrap_events = None if has_log else cached.get("events")

    try:
        committed = commit_approval(
            run_id,
            draft_text=body.draft_text,
            approved_by=body.approved_by,
            idempotency_key=idempotency_key,
            bootstrap_events=bootstrap_events,
        )
    except InvalidIdempotencyKeyError as exc:
        raise HTTPException(
            status_code=400,
            detail="Idempotency-Key must contain 1-128 printable ASCII characters.",
        ) from exc
    except ApprovalRunNotFoundError as exc:
        raise HTTPException(status_code=404, detail=_missing_run_detail(run_id)) from exc
    except IdempotencyConflictError as exc:
        raise HTTPException(
            status_code=409,
            detail="Idempotency-Key was already used for a different approval request.",
        ) from exc
    except ApprovalAlreadyCommittedError as exc:
        raise HTTPException(status_code=409, detail="Run already approved") from exc
    except ApprovalEscalatedError as exc:
        raise HTTPException(
            status_code=409,
            detail="Cannot approve an escalated run",
        ) from exc
    except ApprovalAuditConflictError as exc:
        logger.warning(
            "approval rejected by audit validation: run_id=%s reason=%s",
            run_id,
            exc.reason,
        )
        raise HTTPException(
            status_code=409,
            detail=(
                "Persisted audit history is not safe to approve; "
                "operator recovery is required."
            ),
        ) from exc
    except EventPersistenceError as exc:
        logger.error(
            "approval persistence failed: run_id=%s outcome=%s",
            run_id,
            exc.outcome,
        )
        detail = (
            "Approval durability is unknown; retry once with the same "
            "Idempotency-Key to reconfirm. If that retry reports unsafe audit "
            "history, stop and follow interrupted-bootstrap operator recovery."
            if exc.outcome == "unknown"
            else (
                "Approval was not persisted; do not retry automatically. "
                "Preserve the audit bytes and follow interrupted-bootstrap "
                "operator recovery."
                if not has_log and run_exists(run_id)
                else "Approval was not persisted; retry with the same Idempotency-Key."
            )
        )
        raise HTTPException(status_code=503, detail=detail) from exc

    published = committed.run.model_dump(mode="json")
    try:
        state.update(run_id, published)
    except Exception:
        logger.error("approved state cache update failed: run_id=%s", run_id)
    response.headers["Idempotency-Replayed"] = str(committed.replayed).lower()
    return committed.run


@app.get("/runs/{run_id}/replay")
def get_replay(run_id: str):
    try:
        result = replay_run(run_id)
    except ReplayValidationError as exc:
        raise HTTPException(
            status_code=409,
            detail="Persisted audit log cannot be reconstructed safely.",
        ) from exc
    except EventPersistenceError as exc:
        raise HTTPException(
            status_code=503,
            detail="Persisted audit log is temporarily unavailable.",
        ) from exc
    if result is None:
        raise HTTPException(
            status_code=404,
            detail=f"Replay unavailable for {run_id}. {_missing_run_detail(run_id)}",
        )
    return result


@app.get("/demo-fallback/{case_id}", response_model=RunStatus)
def get_demo_fallback(case_id: str):
    if case_id not in VALID_CASE_IDS:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown fallback case_id: {case_id}",
        )
    path = DATA_DIR / "cases" / case_id / "saved_demo_run.json"
    if not path.exists():
        raise HTTPException(
            status_code=404,
            detail=(
                f"Saved fallback run is missing for {case_id}. Run: cp "
                "data/cases/case-002/mock_run.json "
                "data/cases/case-002/saved_demo_run.json"
            ),
        )
    try:
        with open(path, encoding="utf-8") as f:
            payload = json.load(f)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=500,
            detail=(
                f"Saved fallback run for {case_id} is invalid JSON. Recopy "
                "saved_demo_run.json from mock_run.json before using this route."
            ),
        ) from exc
    try:
        return RunStatus.model_validate(payload)
    except ValidationError as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Saved fallback run for {case_id} does not match RunStatus schema.",
        ) from exc
