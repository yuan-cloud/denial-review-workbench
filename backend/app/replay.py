# Replay is read-only reconstruction from persisted events.
# It must never call model providers or produce new side effects.

import logging

from app.event_store import read_events
from app.schemas import RunStatus

logger = logging.getLogger(__name__)


def resolve_status(state: dict) -> str:
    """Resolve final status from reconstructed state.
    state is a plain Python dict during reconstruction.
    All values come from json.loads() — plain types, not Pydantic objects.
    state["findings"] is a dict, so .get() works on it."""
    findings = state.get("findings")
    if findings is not None and findings.get("should_escalate"):
        return "escalated"
    if state.get("status") == "approved":
        return "approved"
    return "approval_requested"


def replay_run(run_id: str) -> RunStatus | None:
    """Reconstruct RunStatus from JSONL events. Returns None if no events."""
    events = read_events(run_id)
    if not events:
        return None

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
        "events": events,
    }

    for event in events:
        event_type = event.get("type", "")
        payload = event.get("payload", {})

        if event_type == "run_started":
            state["run_id"] = payload.get("run_id", run_id)
            state["case_id"] = payload.get("case_id", "")
            state["facility_id"] = payload.get("facility_id", "")

        elif event_type == "documents_loaded":
            state["documents"] = payload.get("documents", [])

        elif event_type == "facts_extracted":
            state["facts"] = payload.get("facts")

        elif event_type == "policy_retrieved":
            state["retrieved_policy_sections"] = payload.get(
                "retrieved_policy_sections", []
            )

        elif event_type == "analysis_completed":
            state["findings"] = payload.get("findings")

        elif event_type == "draft_generated":
            state["recommendation"] = payload.get("recommendation")

        elif event_type == "approved":
            state["recommendation"] = payload.get("final_recommendation")
            state["status"] = "approved"

    state["status"] = resolve_status(state)
    state["is_replay_response"] = True

    return RunStatus.model_validate(state)
