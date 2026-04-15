import json
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app import state
from app.errors import PipelineError
from app.event_store import append_event
from app.pipeline import run_pipeline
from app.replay import replay_run
from app.schemas import ApproveRequest, RunCreateRequest, RunStatus

logger = logging.getLogger(__name__)

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
DATA_DIR = REPO_ROOT / "data"

CURRENT_PHASE = "3"

FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:5274")

VALID_CASE_IDS = ["case-001", "case-002", "case-003"]


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


@app.get("/cases")
def get_cases():
    return [{"case_id": cid} for cid in VALID_CASE_IDS]


@app.post("/runs", status_code=201)
def post_runs(body: RunCreateRequest):
    if body.case_id not in VALID_CASE_IDS:
        raise HTTPException(status_code=404, detail=f"Unknown case_id: {body.case_id}")

    meta_path = DATA_DIR / "cases" / body.case_id / "meta.json"
    if not meta_path.exists():
        raise HTTPException(status_code=404, detail="meta.json not found")

    with open(meta_path, encoding="utf-8") as f:
        facility_id = json.load(f)["facility_id"]

    try:
        result = run_pipeline(body.case_id, facility_id)
    except PipelineError as e:
        logger.error("pipeline failed: %s", e, exc_info=True)
        raise HTTPException(status_code=422, detail=str(e))

    state.seed(result.run_id, result.model_dump())
    return result


@app.get("/runs/{run_id}")
def get_run(run_id: str):
    state_dict = state.get(run_id)
    if state_dict is not None:
        return RunStatus.model_validate(state_dict)
    result = replay_run(run_id)
    if result is None:
        raise HTTPException(status_code=404)
    return result


@app.post("/runs/{run_id}/approve")
def post_approve(run_id: str, body: ApproveRequest = None):
    state_dict = state.get(run_id)
    if state_dict is None:
        raise HTTPException(status_code=404)
    if state_dict["status"] == "escalated":
        raise HTTPException(status_code=409, detail="Cannot approve an escalated run")
    if state_dict["status"] == "approved":
        raise HTTPException(status_code=409, detail="Run already approved")

    existing = state_dict["recommendation"]
    final_recommendation = {
        "action_type": existing["action_type"],
        "rationale": existing["rationale"],
        "draft_text": (body.draft_text if body and body.draft_text
                       else existing["draft_text"]),
    }

    approved_event = {
        "type": "approved",
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "payload": {"final_recommendation": final_recommendation},
    }
    state_dict["events"].append(approved_event)
    state_dict["status"] = "approved"
    state_dict["recommendation"] = final_recommendation
    state.update(run_id, state_dict)

    append_event(run_id, "approved", {"final_recommendation": final_recommendation})

    result = RunStatus.model_validate(state_dict)
    result.is_replay_response = False
    return result


@app.get("/runs/{run_id}/replay")
def get_replay(run_id: str):
    result = replay_run(run_id)
    if result is not None:
        return result
    state_dict = state.get(run_id)
    if state_dict is None:
        raise HTTPException(status_code=404)
    result = RunStatus.model_validate(state_dict)
    result.is_replay_response = True
    return result


@app.get("/demo-fallback/{case_id}")
def get_demo_fallback(case_id: str):
    path = DATA_DIR / "cases" / case_id / "saved_demo_run.json"
    if not path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"saved_demo_run.json missing for {case_id}. "
                   "Run: cp data/cases/case-002/mock_run.json "
                   "data/cases/case-002/saved_demo_run.json",
        )
    with open(path, encoding="utf-8") as f:
        return json.load(f)
