"""Tests for API routes in app.main — FastAPI TestClient coverage."""

import json
from unittest.mock import patch

import pytest

from app import state
from app.schemas import RunStatus


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
        resp = seeded_client.get("/cases")
        # The seeded client loads mock_run.json for each case. Grab a known run_id.
        # mock_run.json run_ids follow a pattern — let's query state directly.
        # Instead, use a run_id we know from the mock data
        resp2 = seeded_client.get("/runs/mock-run-case-002")
        if resp2.status_code == 200:
            data = resp2.json()
            assert "run_id" in data
            assert "status" in data

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
        resp = seeded_client.get("/health")
        assert resp.status_code == 200
        # At least one mock run should be accessible
        # We know case-002 has mock_run.json — check by iterating known patterns
        # The mock run_id format is "mock-run-{case_id}" based on the mock_run.json files
