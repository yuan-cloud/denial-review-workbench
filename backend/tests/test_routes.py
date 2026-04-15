"""Tests for API routes in app.main — FastAPI TestClient coverage."""

import json
from pathlib import Path
from unittest.mock import patch

import pytest

from app import state
from app.event_store import append_event
from app.replay import replay_run
from app.schemas import RunStatus

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
DATA_DIR = REPO_ROOT / "data"


def _load_mock_run(case_id: str) -> dict:
    """Load real mock_run.json from data/cases/."""
    path = DATA_DIR / "cases" / case_id / "mock_run.json"
    with open(path) as f:
        return json.load(f)


class TestHealthEndpoint:
    def test_health_returns_ok(self, client):
        resp = client.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert "phase" in data


class TestCasesEndpoint:
    def test_cases_returns_list(self, client):
        resp = client.get("/cases")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) == 3
        assert all("case_id" in c for c in data)

    def test_cases_includes_expected_ids(self, client):
        resp = client.get("/cases")
        ids = [c["case_id"] for c in resp.json()]
        assert "case-001" in ids
        assert "case-002" in ids
        assert "case-003" in ids


class TestGetRunEndpoint:
    def test_get_run_returns_seeded_data(self, seeded_client):
        # mock_run.json uses run_id "run-case-002-mock"
        resp = seeded_client.get("/runs/run-case-002-mock")
        assert resp.status_code == 200
        data = resp.json()
        assert data["run_id"] == "run-case-002-mock"
        assert data["case_id"] == "case-002"
        assert data["status"] in ("approval_requested", "approved", "escalated")

    def test_get_run_not_found(self, client):
        resp = client.get("/runs/nonexistent-run-id")
        assert resp.status_code == 404

    def test_get_run_from_state(self, client):
        state.seed("test-run-1", {
            "run_id": "test-run-1",
            "case_id": "case-001",
            "facility_id": "fac-1",
            "status": "approval_requested",
            "documents": [],
            "retrieved_policy_sections": [],
            "facts": None,
            "findings": None,
            "recommendation": None,
            "events": [],
        })
        resp = client.get("/runs/test-run-1")
        assert resp.status_code == 200
        data = resp.json()
        assert data["run_id"] == "test-run-1"
        assert data["status"] == "approval_requested"


class TestPostRunsEndpoint:
    def test_post_runs_unknown_case(self, client):
        resp = client.post("/runs", json={"case_id": "case-999"})
        assert resp.status_code == 404

    def test_post_runs_missing_body(self, client):
        resp = client.post("/runs")
        assert resp.status_code == 422  # Pydantic validation error


class TestApproveEndpoint:
    def _seed_approval_ready(self):
        state.seed("run-approve-test", {
            "run_id": "run-approve-test",
            "case_id": "case-001",
            "facility_id": "fac-1",
            "status": "approval_requested",
            "documents": [],
            "retrieved_policy_sections": [],
            "facts": None,
            "findings": {"missing_items": [], "conflicts": [], "appeal_basis": None,
                         "should_escalate": False, "evidence_refs": []},
            "recommendation": {
                "action_type": "approve_or_proceed",
                "rationale": "All clear",
                "draft_text": "Original draft text.",
            },
            "events": [],
        })

    def test_approve_success(self, client, tmp_runs):
        self._seed_approval_ready()
        resp = client.post("/runs/run-approve-test/approve", json={})
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "approved"
        assert data["recommendation"]["draft_text"] == "Original draft text."

    def test_approve_with_edited_text(self, client, tmp_runs):
        self._seed_approval_ready()
        resp = client.post("/runs/run-approve-test/approve",
                           json={"draft_text": "Edited draft."})
        assert resp.status_code == 200
        data = resp.json()
        assert data["recommendation"]["draft_text"] == "Edited draft."

    def test_approve_not_found(self, client):
        resp = client.post("/runs/nonexistent/approve", json={})
        assert resp.status_code == 404

    def test_approve_escalated_409(self, client):
        state.seed("run-esc", {
            "run_id": "run-esc",
            "case_id": "case-001",
            "facility_id": "fac-1",
            "status": "escalated",
            "documents": [],
            "retrieved_policy_sections": [],
            "facts": None,
            "findings": {"missing_items": [], "conflicts": [], "appeal_basis": None,
                         "should_escalate": True, "evidence_refs": []},
            "recommendation": None,
            "events": [],
        })
        resp = client.post("/runs/run-esc/approve", json={})
        assert resp.status_code == 409
        assert "escalated" in resp.json()["detail"].lower()

    def test_approve_already_approved_409(self, client, tmp_runs):
        self._seed_approval_ready()
        # Approve once
        client.post("/runs/run-approve-test/approve", json={})
        # Try again
        resp = client.post("/runs/run-approve-test/approve", json={})
        assert resp.status_code == 409
        assert "already approved" in resp.json()["detail"].lower()


class TestReplayEndpoint:
    def test_replay_not_found(self, client):
        resp = client.get("/runs/nonexistent/replay")
        assert resp.status_code == 404

    def test_replay_falls_back_to_state(self, client):
        state.seed("run-replay-test", {
            "run_id": "run-replay-test",
            "case_id": "case-001",
            "facility_id": "fac-1",
            "status": "approval_requested",
            "documents": [],
            "retrieved_policy_sections": [],
            "facts": None,
            "findings": None,
            "recommendation": None,
            "events": [],
        })
        resp = client.get("/runs/run-replay-test/replay")
        assert resp.status_code == 200
        data = resp.json()
        assert data["run_id"] == "run-replay-test"
        assert data["is_replay_response"] is True


class TestDemoFallbackEndpoint:
    def test_demo_fallback_case_002(self, client):
        resp = client.get("/demo-fallback/case-002")
        assert resp.status_code == 200
        data = resp.json()
        assert "run_id" in data

    def test_demo_fallback_missing_case(self, client):
        resp = client.get("/demo-fallback/case-999")
        assert resp.status_code == 404


class TestLifespan:
    def test_seeded_client_populates_state(self, seeded_client):
        """The lifespan should seed mock run data for all known cases."""
        # Verify all three mock runs are accessible via GET /runs/{run_id}
        for case_num in ("001", "002", "003"):
            run_id = f"run-case-{case_num}-mock"
            resp = seeded_client.get(f"/runs/{run_id}")
            assert resp.status_code == 200, f"Seeded run {run_id} not found"
            data = resp.json()
            assert data["run_id"] == run_id
            assert data["case_id"] == f"case-{case_num}"


class TestApproveReplayRoundTrip:
    """bd-2mu: approve via route → JSONL written → replay from JSONL → status stays approved."""

    def test_approve_then_replay_from_jsonl(self, seeded_client, tmp_runs):
        """Full round-trip using real case-002 mock data, real JSONL, real replay."""
        mock = _load_mock_run("case-002")
        run_id = mock["run_id"]

        # Pre-populate JSONL with the real pipeline events from mock_run.json
        # so replay_run() has a complete event history to reconstruct from.
        for event in mock["events"]:
            append_event(run_id, event["type"], event["payload"])

        # Verify JSONL has the pipeline events before approve
        jsonl_path = tmp_runs / f"{run_id}.jsonl"
        assert jsonl_path.exists()
        lines_before = [l for l in jsonl_path.read_text().splitlines() if l.strip()]
        assert len(lines_before) == len(mock["events"])

        # Approve via the route — this appends an "approved" event to JSONL
        resp = seeded_client.post(
            f"/runs/{run_id}/approve",
            json={"draft_text": "Round-trip test approved."},
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "approved"

        # Verify the approved event was appended to JSONL
        lines_after = [l for l in jsonl_path.read_text().splitlines() if l.strip()]
        assert len(lines_after) == len(lines_before) + 1
        last_event = json.loads(lines_after[-1])
        assert last_event["type"] == "approved"
        assert last_event["payload"]["final_recommendation"]["draft_text"] == "Round-trip test approved."

        # Replay via the route — should reconstruct the full approved state from JSONL
        resp = seeded_client.get(f"/runs/{run_id}/replay")
        assert resp.status_code == 200
        replayed = RunStatus.model_validate(resp.json())
        assert replayed.status == "approved"
        assert replayed.is_replay_response is True
        assert replayed.recommendation is not None
        assert replayed.recommendation.draft_text == "Round-trip test approved."

        # Verify replayed run preserves key facts from the original
        assert replayed.case_id == "case-002"
        assert replayed.facility_id == "facility-a"
        assert replayed.facts is not None
        assert replayed.facts.payer == "Example Health Plan"

    def test_replay_preserves_approved_status_not_downgrade(self, seeded_client, tmp_runs):
        """An approved run replayed must stay approved — never revert to approval_requested."""
        mock = _load_mock_run("case-002")
        run_id = mock["run_id"]

        # Write pipeline events + approved event to JSONL
        for event in mock["events"]:
            append_event(run_id, event["type"], event["payload"])
        append_event(run_id, "approved", {
            "final_recommendation": {
                "action_type": mock["recommendation"]["action_type"],
                "rationale": mock["recommendation"]["rationale"],
                "draft_text": "Approved by reviewer.",
            },
        })

        # Replay must yield approved, not approval_requested
        replayed = replay_run(run_id)
        assert replayed.status == "approved", (
            f"Expected 'approved' but got '{replayed.status}' — "
            "replay must not downgrade approved runs"
        )
        assert replayed.is_replay_response is True
        assert replayed.recommendation.draft_text == "Approved by reviewer."
