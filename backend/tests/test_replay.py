"""Tests for app.replay — read-only JSONL reconstruction."""

import json
from copy import deepcopy
from pathlib import Path

import pytest

from app.event_store import append_event, read_events
from app.replay import ReplayValidationError, replay_events, replay_run, resolve_status

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
DATA_DIR = REPO_ROOT / "data"


def _load_mock_run(case_id: str) -> dict:
    """Load real mock_run.json from data/cases/."""
    path = DATA_DIR / "cases" / case_id / "mock_run.json"
    with open(path) as f:
        return json.load(f)


def _events_for_case(case_id: str, run_id: str) -> list[dict]:
    events = deepcopy(_load_mock_run(case_id)["events"])
    events[0]["payload"]["run_id"] = run_id
    return events


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


@pytest.mark.parametrize(
    ("case_id", "mutate", "reason"),
    [
        (
            "case-002",
            lambda events: events[2]["payload"]["facts"].update(confidence=True),
            "invalid_facts_payload",
        ),
        (
            "case-002",
            lambda events: events[4]["payload"]["findings"].update(
                should_escalate=1
            ),
            "invalid_findings_decision",
        ),
        (
            "case-003",
            lambda events: events.append(
                {
                    "type": "run_escalated",
                    "timestamp": "2026-04-11T15:00:06Z",
                    "payload": {"reason": "escalated", "conflict_count": True},
                }
            ),
            "invalid_escalation_payload",
        ),
    ],
    ids=["boolean-confidence", "integer-escalation", "invalid-escalation-marker"],
)
def test_replay_rejects_semantically_invalid_events_without_strict_sequence(
    case_id,
    mutate,
    reason,
):
    run_id = f"run-semantic-validation-{case_id}"
    events = _events_for_case(case_id, run_id)
    mutate(events)

    with pytest.raises(ReplayValidationError) as raised:
        replay_events(run_id, events)

    assert raised.value.reason == reason


def test_replay_rejects_unknown_event_type_without_strict_sequence():
    run_id = "run-unknown-event"
    events = _events_for_case("case-002", run_id)
    events.append(
        {
            "type": "unknown_event",
            "timestamp": "2026-04-11T15:00:09Z",
            "payload": {},
        }
    )

    with pytest.raises(ReplayValidationError) as raised:
        replay_events(run_id, events)

    assert raised.value.reason == "invalid_event_type"


@pytest.mark.parametrize(
    "metadata",
    [
        {
            "version": "1",
            "key_sha256": "a" * 64,
            "request_sha256": "b" * 64,
        },
        {
            "version": True,
            "key_sha256": "a" * 64,
            "request_sha256": "b" * 64,
        },
        None,
    ],
    ids=["string-version", "boolean-version", "present-null"],
)
def test_replay_rejects_malformed_present_approved_idempotency(metadata):
    run_id = "run-invalid-approved-idempotency"
    events = _events_for_case("case-002", run_id)
    events.append(
        {
            "type": "approved",
            "timestamp": "2026-04-11T15:00:09Z",
            "payload": {
                "final_recommendation": deepcopy(
                    events[5]["payload"]["recommendation"]
                ),
                "idempotency": metadata,
            },
        }
    )

    with pytest.raises(ReplayValidationError) as raised:
        replay_events(run_id, events)

    assert raised.value.reason == "invalid_approved_idempotency"


@pytest.mark.parametrize(
    "include_marker",
    [False, True],
    ids=["legacy-analysis-terminal", "marked-escalation"],
)
def test_replay_reads_legacy_and_marked_escalated_histories(include_marker):
    run_id = f"run-escalation-{include_marker}"
    events = _events_for_case("case-003", run_id)
    if include_marker:
        events.append(
            {
                "type": "run_escalated",
                "timestamp": "2026-04-11T15:00:06Z",
                "payload": {"reason": "escalated", "conflict_count": 1},
            }
        )

    result = replay_events(run_id, events)

    assert result is not None
    assert result.status == "escalated"
    assert result.recommendation is None


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


class TestIsReplayResponseAbsentFromJSONL:
    """bd-22t: is_replay_response must never be persisted to the JSONL event log."""

    def test_pipeline_events_never_contain_is_replay_response(self, tmp_runs):
        """Write real case-002 events to JSONL, replay, then verify the field is absent."""
        mock = _load_mock_run("case-002")
        run_id = mock["run_id"]

        # Write every event from the real mock_run.json via append_event
        for event in mock["events"]:
            append_event(run_id, event["type"], event["payload"])

        # Replay — sets is_replay_response=True on the returned RunStatus
        result = replay_run(run_id)
        assert result is not None
        assert result.is_replay_response is True

        # Read raw JSONL and assert is_replay_response never appears in any line
        jsonl_path = tmp_runs / f"{run_id}.jsonl"
        assert jsonl_path.exists()
        for i, line in enumerate(jsonl_path.read_text().splitlines()):
            if not line.strip():
                continue
            parsed = json.loads(line)
            assert "is_replay_response" not in parsed, (
                f"JSONL line {i} contains is_replay_response: {line[:120]}"
            )
            assert "is_replay_response" not in json.dumps(parsed["payload"]), (
                f"JSONL line {i} payload contains is_replay_response"
            )

    def test_approved_event_never_contains_is_replay_response(self, tmp_runs):
        """After appending an approved event (as the approve route does), JSONL stays clean."""
        mock = _load_mock_run("case-002")
        run_id = mock["run_id"]

        # Write pipeline events
        for event in mock["events"]:
            append_event(run_id, event["type"], event["payload"])

        # Simulate what the approve route writes (main.py:123)
        final_recommendation = {
            "action_type": mock["recommendation"]["action_type"],
            "rationale": mock["recommendation"]["rationale"],
            "draft_text": "Reviewer-approved text.",
        }
        append_event(run_id, "approved", {"final_recommendation": final_recommendation})

        # Replay the approved run
        result = replay_run(run_id)
        assert result.status == "approved"
        assert result.is_replay_response is True

        # Every JSONL line must be free of is_replay_response
        jsonl_path = tmp_runs / f"{run_id}.jsonl"
        raw = jsonl_path.read_text()
        assert "is_replay_response" not in raw, (
            "is_replay_response found in raw JSONL content"
        )


class TestMalformedJSONLResilience:
    """bd-3pw: replay_run must reconstruct valid events from JSONL with corrupted lines."""

    def test_replay_skips_corrupted_lines_and_reconstructs_valid_events(self, tmp_runs):
        """Write a valid JSONL sequence with a corrupted line mid-stream.

        Verifies replay_run still produces a valid RunStatus from the
        surrounding valid events.
        """
        run_id = "run-corrupted"
        jsonl_path = tmp_runs / f"{run_id}.jsonl"

        # Write events manually with a corrupted line between events 2 and 3
        valid_events = [
            {"type": "run_started", "timestamp": "2026-04-16T10:00:00Z",
             "payload": {"run_id": run_id, "case_id": "case-001", "facility_id": "fac-a"}},
            {"type": "documents_loaded", "timestamp": "2026-04-16T10:00:01Z",
             "payload": {"documents": [{"doc_id": "d1", "type": "denial_letter", "text": "denied"}]}},
            {"type": "facts_extracted", "timestamp": "2026-04-16T10:00:02Z",
             "payload": {"facts": {"payer": "Acme", "service_requested": "PT",
                                   "denial_reason": "not necessary",
                                   "required_documents": [], "confidence": 0.9,
                                   "evidence_refs": []}}},
            {"type": "analysis_completed", "timestamp": "2026-04-16T10:00:03Z",
             "payload": {"findings": {"missing_items": [], "conflicts": [],
                                      "appeal_basis": None, "should_escalate": False,
                                      "evidence_refs": []}}},
        ]

        lines = []
        lines.append(json.dumps(valid_events[0]))
        lines.append(json.dumps(valid_events[1]))
        lines.append('{"type": "truncated_by_crash')  # corrupted mid-append
        lines.append("")  # blank line (also malformed)
        lines.append(json.dumps(valid_events[2]))
        lines.append(json.dumps(valid_events[3]))

        jsonl_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

        result = replay_run(run_id)
        assert result is not None
        assert result.run_id == run_id
        assert result.case_id == "case-001"
        assert result.facts is not None
        assert result.facts.payer == "Acme"
        assert result.findings is not None
        assert result.findings.should_escalate is False
        # 4 valid events reconstructed (2 corrupted lines skipped)
        assert len(result.events) == 4
