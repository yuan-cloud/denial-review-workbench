"""Tests for app.replay — read-only JSONL reconstruction."""

from app.event_store import append_event
from app.replay import replay_run, resolve_status


def test_replay_returns_none_for_missing(tmp_runs):
    assert replay_run("nonexistent") is None


def test_replay_reconstructs_run_started(tmp_runs):
    append_event("run-1", "run_started", {
        "run_id": "run-1", "case_id": "case-001", "facility_id": "facility-a",
    })
    result = replay_run("run-1")
    assert result is not None
    assert result.run_id == "run-1"
    assert result.case_id == "case-001"
    assert result.facility_id == "facility-a"
    assert result.is_replay_response is True


def test_replay_reconstructs_full_pipeline(tmp_runs):
    append_event("run-1", "run_started", {
        "run_id": "run-1", "case_id": "case-002", "facility_id": "facility-a",
    })
    append_event("run-1", "documents_loaded", {
        "documents": [{"doc_id": "denial-letter", "type": "denial_letter", "text": "denied"}],
    })
    append_event("run-1", "facts_extracted", {
        "facts": {
            "payer": "Acme", "service_requested": "PT",
            "denial_reason": "not medically necessary",
            "required_documents": [], "confidence": 0.9,
            "evidence_refs": [],
        },
    })
    append_event("run-1", "policy_retrieved", {
        "retrieved_policy_sections": ["Section 1"],
    })
    append_event("run-1", "analysis_completed", {
        "findings": {
            "missing_items": [], "conflicts": [],
            "appeal_basis": None, "should_escalate": False,
            "evidence_refs": [],
        },
    })
    append_event("run-1", "draft_generated", {
        "recommendation": {
            "action_type": "approve_or_proceed",
            "rationale": "All docs present",
            "draft_text": "Approve this case.",
        },
    })
    append_event("run-1", "approval_requested", {})

    result = replay_run("run-1")
    assert result.status == "approval_requested"
    assert result.facts is not None
    assert result.facts.payer == "Acme"
    assert result.findings is not None
    assert result.recommendation is not None
    assert result.recommendation.action_type == "approve_or_proceed"
    assert len(result.documents) == 1
    assert len(result.events) == 7


def test_replay_approved_state(tmp_runs):
    append_event("run-1", "run_started", {
        "run_id": "run-1", "case_id": "c", "facility_id": "f",
    })
    append_event("run-1", "analysis_completed", {
        "findings": {
            "missing_items": [], "conflicts": [],
            "appeal_basis": None, "should_escalate": False,
            "evidence_refs": [],
        },
    })
    append_event("run-1", "approved", {
        "final_recommendation": {
            "action_type": "approve_or_proceed",
            "rationale": "ok",
            "draft_text": "approved text",
        },
    })
    result = replay_run("run-1")
    assert result.status == "approved"
    assert result.recommendation.draft_text == "approved text"


def test_replay_escalated_state(tmp_runs):
    append_event("run-1", "run_started", {
        "run_id": "run-1", "case_id": "c", "facility_id": "f",
    })
    append_event("run-1", "analysis_completed", {
        "findings": {
            "missing_items": [], "conflicts": ["conflict"],
            "appeal_basis": None, "should_escalate": True,
            "evidence_refs": [],
        },
    })
    result = replay_run("run-1")
    assert result.status == "escalated"
    assert result.recommendation is None


def test_resolve_status_none_findings():
    assert resolve_status({"findings": None, "status": "approval_requested"}) == "approval_requested"


def test_resolve_status_escalated():
    assert resolve_status({"findings": {"should_escalate": True}}) == "escalated"


def test_resolve_status_approved():
    assert resolve_status({"findings": {"should_escalate": False}, "status": "approved"}) == "approved"


def test_resolve_status_default():
    assert resolve_status({"findings": {"should_escalate": False}}) == "approval_requested"
