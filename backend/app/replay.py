# Replay is read-only reconstruction from persisted events.
# It must never call model providers or produce new side effects.

import logging
from typing import Sequence

from pydantic import ValidationError

from app.schemas import (
    ApprovedIdempotencyMetadata,
    CaseDocument,
    CaseFacts,
    CaseFindings,
    Recommendation,
    RunEvent,
    RunStatus,
)

logger = logging.getLogger(__name__)

PENDING_EVENT_TYPES = (
    "run_started",
    "documents_loaded",
    "facts_extracted",
    "policy_retrieved",
    "analysis_completed",
    "draft_generated",
    "approval_requested",
)
APPROVED_EVENT_TYPES = (*PENDING_EVENT_TYPES, "approved")
ESCALATED_EVENT_TYPES = PENDING_EVENT_TYPES[:5]
LEGACY_ESCALATED_EVENT_TYPES = (*ESCALATED_EVENT_TYPES, "run_escalated")
SUPPORTED_EVENT_TYPES = frozenset((*APPROVED_EVENT_TYPES, "run_escalated"))


class ReplayValidationError(ValueError):
    """Persisted events cannot produce a trustworthy run projection."""

    def __init__(self, reason: str):
        self.reason = reason
        super().__init__(reason)


def resolve_status(state: dict) -> str:
    """Resolve final status from reconstructed state.
    state is a plain Python dict during reconstruction.
    All values come from json.loads() — plain types, not Pydantic objects.
    state["findings"] is normally a dict. Persisted input is untrusted, so
    projection must not assume that before schema validation."""
    findings = state.get("findings")
    if isinstance(findings, dict) and findings.get("should_escalate"):
        return "escalated"
    if state.get("status") == "approved":
        return "approved"
    return "approval_requested"


def _validated_events(events: Sequence[dict]) -> list[dict]:
    validated: list[dict] = []
    for event in events:
        if not isinstance(event, dict):
            raise ReplayValidationError("invalid_event_record")
        timestamp = event.get("timestamp")
        if not isinstance(timestamp, str):
            raise ReplayValidationError("invalid_event_timestamp")
        try:
            parsed = RunEvent.model_validate(event)
        except ValidationError as exc:
            raise ReplayValidationError("invalid_event_schema") from exc
        if parsed.timestamp.tzinfo is None or parsed.timestamp.utcoffset() is None:
            raise ReplayValidationError("invalid_event_timestamp")
        validated.append(parsed.model_dump(mode="json"))
    return validated


def _strict_model(value: object, model: type, reason: str) -> None:
    if not isinstance(value, dict):
        raise ReplayValidationError(reason)
    try:
        model.model_validate(value, strict=True)
    except ValidationError as exc:
        raise ReplayValidationError(reason) from exc


def _strict_documents(value: object) -> None:
    if not isinstance(value, list):
        raise ReplayValidationError("invalid_documents_payload")
    for document in value:
        _strict_model(document, CaseDocument, "invalid_documents_payload")


def _strict_policy_sections(value: object) -> None:
    if not isinstance(value, list) or any(
        not isinstance(section, str) for section in value
    ):
        raise ReplayValidationError("invalid_policy_payload")


def replay_events(
    run_id: str,
    events: Sequence[dict],
    *,
    strict: bool = False,
) -> RunStatus | None:
    """Purely project already-read events into a RunStatus."""
    if not events:
        return None

    validated_events = _validated_events(events)
    event_types = tuple(event["type"] for event in validated_events)
    if strict and event_types not in (
        PENDING_EVENT_TYPES,
        APPROVED_EVENT_TYPES,
        ESCALATED_EVENT_TYPES,
        LEGACY_ESCALATED_EVENT_TYPES,
    ):
        raise ReplayValidationError("invalid_event_sequence")

    state: dict = {
        "run_id": run_id,
        "case_id": "",
        "facility_id": "",
        "status": "approval_requested",
        "documents": [],
        "retrieved_policy_sections": [],
        "facts": None,
        "findings": None,
        "recommendation": None,
        "approved_by": None,
        "events": validated_events,
    }

    for event in validated_events:
        event_type = event.get("type", "")
        payload = event.get("payload", {})

        if event_type not in SUPPORTED_EVENT_TYPES:
            raise ReplayValidationError("invalid_event_type")

        if event_type == "run_started":
            if (
                payload.get("run_id") != run_id
                or not isinstance(payload.get("case_id"), str)
                or not payload.get("case_id")
                or not isinstance(payload.get("facility_id"), str)
                or not payload.get("facility_id")
            ):
                raise ReplayValidationError("invalid_run_identity")
            state["run_id"] = payload.get("run_id", run_id)
            state["case_id"] = payload.get("case_id", "")
            state["facility_id"] = payload.get("facility_id", "")

        elif event_type == "documents_loaded":
            _strict_documents(payload.get("documents"))
            state["documents"] = payload.get("documents", [])

        elif event_type == "facts_extracted":
            _strict_model(
                payload.get("facts"), CaseFacts, "invalid_facts_payload"
            )
            state["facts"] = payload.get("facts")

        elif event_type == "policy_retrieved":
            _strict_policy_sections(payload.get("retrieved_policy_sections"))
            state["retrieved_policy_sections"] = payload.get(
                "retrieved_policy_sections", []
            )

        elif event_type == "analysis_completed":
            findings = payload.get("findings")
            _strict_model(findings, CaseFindings, "invalid_findings_decision")
            state["findings"] = payload.get("findings")

        elif event_type == "draft_generated":
            _strict_model(
                payload.get("recommendation"),
                Recommendation,
                "invalid_recommendation_payload",
            )
            state["recommendation"] = payload.get("recommendation")

        elif event_type == "approved":
            final_recommendation = payload.get("final_recommendation")
            _strict_model(
                final_recommendation,
                Recommendation,
                "invalid_approved_payload",
            )
            if "approved_by" in payload and not isinstance(
                payload["approved_by"], str
            ):
                raise ReplayValidationError("invalid_approved_reviewer")
            if "idempotency" in payload:
                _strict_model(
                    payload["idempotency"],
                    ApprovedIdempotencyMetadata,
                    "invalid_approved_idempotency",
                )
            state["recommendation"] = payload.get("final_recommendation")
            state["approved_by"] = payload.get("approved_by")
            state["status"] = "approved"

        elif event_type == "run_escalated":
            reason = payload.get("reason")
            conflict_count = payload.get("conflict_count")
            if (
                not isinstance(reason, str)
                or not reason
                or isinstance(conflict_count, bool)
                or not isinstance(conflict_count, int)
                or conflict_count < 0
            ):
                raise ReplayValidationError("invalid_escalation_payload")

        if event_type == "approval_requested" and payload:
            raise ReplayValidationError("invalid_approval_request_event")

    state["status"] = resolve_status(state)
    state["is_replay_response"] = True

    if state["status"] == "approved" and (
        "run_started" not in event_types
        or state["run_id"] != run_id
        or not state["case_id"]
        or not state["facility_id"]
    ):
        raise ReplayValidationError("invalid_approved_identity")

    try:
        result = RunStatus.model_validate(state)
    except ValidationError as exc:
        raise ReplayValidationError("invalid_run_projection") from exc

    if strict:
        is_escalated = event_types in (
            ESCALATED_EVENT_TYPES,
            LEGACY_ESCALATED_EVENT_TYPES,
        )
        expected_status = (
            "approved"
            if event_types == APPROVED_EVENT_TYPES
            else "escalated"
            if is_escalated
            else "approval_requested"
        )
        if (
            result.run_id != run_id
            or result.status != expected_status
            or result.findings is None
            or result.findings.should_escalate != is_escalated
            or (result.recommendation is None) != is_escalated
        ):
            raise ReplayValidationError("invalid_run_projection")
    return result


def replay_run(run_id: str) -> RunStatus | None:
    """Reconstruct RunStatus from JSONL events. Returns None if no events."""
    from app.event_store import read_events

    return replay_events(run_id, read_events(run_id))
