"""Live integration tests — httpx against the real running backend.

These tests require:
  - Backend running on localhost:8000
  - ANTHROPIC_API_KEY set in the backend process

Run with: pytest tests/test_integration.py -v --timeout=120
Skip with: pytest -k "not integration"
"""

import json
import os
from pathlib import Path

import httpx
import pytest

BASE = "http://localhost:8000"
TIMEOUT = 90.0  # pipeline calls take 10-20s per case


def _backend_reachable() -> bool:
    try:
        r = httpx.get(f"{BASE}/health", timeout=5.0)
        return r.status_code == 200
    except Exception:
        return False


# Skip all tests if backend is not reachable
pytestmark = pytest.mark.skipif(
    not _backend_reachable(),
    reason="Backend not running on localhost:8000",
)


def _load_expected(case_id: str) -> dict:
    path = Path(__file__).resolve().parent.parent.parent / "data" / "cases" / case_id / "expected.json"
    with open(path) as f:
        return json.load(f)


class TestIntegrationHarness:
    """bd-38p.5.1: Verify the integration test harness can reach the backend."""

    def test_health(self):
        r = httpx.get(f"{BASE}/health", timeout=5.0)
        assert r.status_code == 200
        assert r.json()["status"] == "ok"

    def test_cases_list(self):
        r = httpx.get(f"{BASE}/cases", timeout=5.0)
        assert r.status_code == 200
        ids = [c["case_id"] for c in r.json()]
        assert "case-001" in ids
        assert "case-002" in ids
        assert "case-003" in ids


class TestCase002LivePipeline:
    """bd-38p.5.2: case-002 live output matches expected.json + approve/replay arc."""

    @pytest.fixture(scope="class")
    def run_result(self):
        r = httpx.post(
            f"{BASE}/runs",
            json={"case_id": "case-002"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 201, f"POST /runs failed: {r.status_code} {r.text}"
        return r.json()

    def test_status_approval_requested(self, run_result):
        assert run_result["status"] == "approval_requested"

    def test_action_type_matches_expected(self, run_result):
        expected = _load_expected("case-002")
        assert run_result["recommendation"]["action_type"] == expected["expected_action_type"]

    def test_missing_items_match_expected(self, run_result):
        expected = _load_expected("case-002")
        actual = run_result["findings"]["missing_items"]
        for item in expected["expected_missing_items"]:
            assert item in actual, f"Expected missing item '{item}' not found in {actual}"

    def test_confidence_above_minimum(self, run_result):
        expected = _load_expected("case-002")
        assert run_result["facts"]["confidence"] >= expected["expected_confidence_min"]

    def test_not_escalated(self, run_result):
        expected = _load_expected("case-002")
        assert run_result["findings"]["should_escalate"] == expected["expected_should_escalate"]

    def test_events_complete(self, run_result):
        event_types = [e["type"] for e in run_result["events"]]
        assert "run_started" in event_types
        assert "documents_loaded" in event_types
        assert "facts_extracted" in event_types
        assert "approval_requested" in event_types

    def test_approve_then_replay(self, run_result):
        run_id = run_result["run_id"]

        # Approve
        r = httpx.post(
            f"{BASE}/runs/{run_id}/approve",
            json={"draft_text": "Integration test approved."},
            timeout=10.0,
        )
        assert r.status_code == 200
        approved = r.json()
        assert approved["status"] == "approved"
        assert approved["recommendation"]["draft_text"] == "Integration test approved."

        # Double-approve should 409
        r2 = httpx.post(
            f"{BASE}/runs/{run_id}/approve",
            json={},
            timeout=10.0,
        )
        assert r2.status_code == 409

        # Replay
        r3 = httpx.get(f"{BASE}/runs/{run_id}/replay", timeout=10.0)
        assert r3.status_code == 200
        replayed = r3.json()
        assert replayed["is_replay_response"] is True
        assert replayed["run_id"] == run_id


class TestCase003LiveEscalation:
    """bd-38p.5.3: case-003 escalation path and approve 409."""

    @pytest.fixture(scope="class")
    def run_result(self):
        r = httpx.post(
            f"{BASE}/runs",
            json={"case_id": "case-003"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 201, f"POST /runs failed: {r.status_code} {r.text}"
        return r.json()

    def test_status_escalated(self, run_result):
        assert run_result["status"] == "escalated"

    def test_should_escalate_true(self, run_result):
        assert run_result["findings"]["should_escalate"] is True

    def test_recommendation_absent(self, run_result):
        assert run_result["recommendation"] is None

    def test_missing_items_match_expected(self, run_result):
        expected = _load_expected("case-003")
        actual = run_result["findings"]["missing_items"]
        for item in expected["expected_missing_items"]:
            assert item in actual, f"Expected '{item}' not in {actual}"

    def test_no_draft_or_approval_events(self, run_result):
        event_types = [e["type"] for e in run_result["events"]]
        assert "draft_generated" not in event_types
        assert "approval_requested" not in event_types

    def test_approve_returns_409(self, run_result):
        run_id = run_result["run_id"]
        r = httpx.post(
            f"{BASE}/runs/{run_id}/approve",
            json={},
            timeout=10.0,
        )
        assert r.status_code == 409
        assert "escalated" in r.json()["detail"].lower()
