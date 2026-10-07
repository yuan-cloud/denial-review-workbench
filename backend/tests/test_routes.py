"""Tests for API routes in app.main — FastAPI TestClient coverage."""

import json
import os
import stat
import threading
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from pathlib import Path

import pytest

from app import event_store, main, state
from app.event_store import EventPersistenceError, append_event
from app.replay import replay_run
from app.schemas import RunStatus

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
DATA_DIR = REPO_ROOT / "data"
APPROVAL_HEADERS = {"Idempotency-Key": "route-test-key"}


def _load_mock_run(case_id: str) -> dict:
    """Load real mock_run.json from data/cases/."""
    path = DATA_DIR / "cases" / case_id / "mock_run.json"
    with open(path) as f:
        return json.load(f)


def _pending_events(run_id: str) -> list[dict]:
    pending = deepcopy(_load_mock_run("case-002"))
    events = pending["events"]
    events[0]["payload"]["run_id"] = run_id
    return events


def _write_raw_events(path: Path, events: list[dict], suffix: bytes = b"") -> bytes:
    raw = b"".join(
        json.dumps(event, separators=(",", ":")).encode("utf-8") + b"\n"
        for event in events
    ) + suffix
    path.write_bytes(raw)
    return raw


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
        assert all("facility_id" in c for c in data)
        assert all("scenario_title" in c for c in data)
        assert all("expected_path_type" in c for c in data)
        assert all("summary" in c for c in data)

    def test_cases_includes_expected_ids(self, client):
        resp = client.get("/cases")
        ids = [c["case_id"] for c in resp.json()]
        assert "case-001" in ids
        assert "case-002" in ids
        assert "case-003" in ids

    def test_cases_returns_operator_metadata(self, client):
        resp = client.get("/cases")
        assert resp.status_code == 200
        items = {item["case_id"]: item for item in resp.json()}

        assert items["case-001"]["facility_id"] == "facility-a"
        assert items["case-001"]["expected_path_type"] == "approval"
        assert "approved" in items["case-001"]["scenario_title"].lower()

        assert items["case-002"]["expected_path_type"] == "missing_documents"
        assert "physician order" in items["case-002"]["summary"].lower()

        assert items["case-003"]["expected_path_type"] == "escalation"
        assert "conflicting" in items["case-003"]["scenario_title"].lower()


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
        assert "no persisted event log exists" in resp.json()["detail"].lower()

    def test_get_run_not_found_with_empty_jsonl_explains_reconstruction_failure(
        self, client, tmp_runs
    ):
        (tmp_runs / "empty-run.jsonl").write_text("", encoding="utf-8")

        resp = client.get("/runs/empty-run")
        assert resp.status_code == 409
        assert "contains no reconstructible events" in resp.json()["detail"].lower()

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


class TestPersistedHistoryValidation:
    @pytest.mark.parametrize(
        ("event_index", "payload_key", "field", "invalid_value"),
        [
            (2, "facts", "confidence", True),
            (4, "findings", "should_escalate", 1),
        ],
        ids=["boolean-confidence", "integer-escalation"],
    )
    @pytest.mark.parametrize("suffix", ["", "/replay"])
    def test_semantically_invalid_persisted_values_return_controlled_conflict_without_mutation(
        self,
        client,
        tmp_runs,
        event_index,
        payload_key,
        field,
        invalid_value,
        suffix,
    ):
        run_id = f"run-invalid-stored-{field}"
        events = _pending_events(run_id)
        events[event_index]["payload"][payload_key][field] = invalid_value
        path = tmp_runs / f"{run_id}.jsonl"
        before = _write_raw_events(path, events)

        response = client.get(f"/runs/{run_id}{suffix}")

        assert response.status_code == 409
        assert "cannot be reconstructed safely" in response.json()["detail"].lower()
        assert path.read_bytes() == before

    @pytest.mark.parametrize("suffix", ["", "/replay"])
    def test_unknown_event_type_returns_controlled_conflict_without_mutation(
        self,
        client,
        tmp_runs,
        suffix,
    ):
        run_id = "run-unknown-stored-event"
        events = _pending_events(run_id)
        events.append(
            {
                "type": "unknown_event",
                "timestamp": "2026-04-11T15:00:09Z",
                "payload": {},
            }
        )
        path = tmp_runs / f"{run_id}.jsonl"
        before = _write_raw_events(path, events)

        response = client.get(f"/runs/{run_id}{suffix}")

        assert response.status_code == 409
        assert "cannot be reconstructed safely" in response.json()["detail"].lower()
        assert path.read_bytes() == before

    @pytest.mark.parametrize(
        ("suffix", "is_replay_response"),
        [("", False), ("/replay", True)],
    )
    def test_invalid_findings_payload_returns_controlled_conflict_without_mutation(
        self,
        client,
        tmp_runs,
        suffix,
        is_replay_response,
    ):
        run_id = "run-invalid-stored-findings"
        events = _pending_events(run_id)
        events[4]["payload"]["findings"] = []
        path = tmp_runs / f"{run_id}.jsonl"
        before = _write_raw_events(path, events)

        response = client.get(f"/runs/{run_id}{suffix}")

        assert response.status_code == 409
        assert "cannot be reconstructed safely" in response.json()["detail"].lower()
        assert path.read_bytes() == before

    @pytest.mark.parametrize("suffix", ["", "/replay"])
    def test_lone_approved_record_is_rejected_without_mutation(
        self,
        client,
        tmp_runs,
        suffix,
    ):
        run_id = "run-lone-approved"
        path = tmp_runs / f"{run_id}.jsonl"
        before = _write_raw_events(
            path,
            [
                {
                    "type": "approved",
                    "timestamp": "2026-04-11T15:00:09Z",
                    "payload": {
                        "final_recommendation": {
                            "action_type": "request_missing_documents",
                            "rationale": "Missing order.",
                            "draft_text": "Please provide the order.",
                        }
                    },
                }
            ],
        )

        response = client.get(f"/runs/{run_id}{suffix}")

        assert response.status_code == 409
        assert "cannot be reconstructed safely" in response.json()["detail"].lower()
        assert path.read_bytes() == before

    @pytest.mark.parametrize(
        "metadata",
        [
            {
                "version": True,
                "key_sha256": "a" * 64,
                "request_sha256": "b" * 64,
            },
            None,
        ],
        ids=["boolean-version", "present-null"],
    )
    @pytest.mark.parametrize("suffix", ["", "/replay"])
    def test_malformed_approved_idempotency_returns_controlled_conflict_without_mutation(
        self,
        client,
        tmp_runs,
        metadata,
        suffix,
    ):
        run_id = "run-invalid-approved-idempotency"
        events = _pending_events(run_id)
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
        path = tmp_runs / f"{run_id}.jsonl"
        before = _write_raw_events(path, events)

        response = client.get(f"/runs/{run_id}{suffix}")

        assert response.status_code == 409
        assert "cannot be reconstructed safely" in response.json()["detail"].lower()
        assert path.read_bytes() == before

    @pytest.mark.parametrize(
        ("suffix", "is_replay_response"),
        [("", False), ("/replay", True)],
    )
    def test_physical_malformed_tail_is_read_only_tolerated(
        self,
        client,
        tmp_runs,
        suffix,
        is_replay_response,
    ):
        run_id = "run-malformed-tail-read-only"
        path = tmp_runs / f"{run_id}.jsonl"
        before = _write_raw_events(
            path,
            _pending_events(run_id),
            suffix=b'{"type":"interrupted',
        )

        response = client.get(f"/runs/{run_id}{suffix}")

        assert response.status_code == 200
        assert response.json()["status"] == "approval_requested"
        assert response.json()["is_replay_response"] is is_replay_response
        assert path.read_bytes() == before

    def test_legacy_approved_history_remains_readable_and_blocks_approval(
        self,
        client,
        tmp_runs,
    ):
        run_id = "run-legacy-approved"
        events = [
            {
                "type": "run_started",
                "timestamp": "2026-04-11T15:00:00Z",
                "payload": {
                    "run_id": run_id,
                    "case_id": "case-002",
                    "facility_id": "facility-a",
                },
            },
            {
                "type": "analysis_completed",
                "timestamp": "2026-04-11T15:00:05Z",
                "payload": {
                    "findings": {
                        "missing_items": [],
                        "conflicts": [],
                        "appeal_basis": None,
                        "should_escalate": False,
                        "evidence_refs": [],
                    }
                },
            },
            {
                "type": "approved",
                "timestamp": "2026-04-11T15:00:09Z",
                "payload": {
                    "final_recommendation": {
                        "action_type": "approve_or_proceed",
                        "rationale": "Legacy approval.",
                        "draft_text": "Proceed.",
                    }
                },
            },
        ]
        path = tmp_runs / f"{run_id}.jsonl"
        before = _write_raw_events(path, events)

        readable = client.get(f"/runs/{run_id}")
        replayed = client.get(f"/runs/{run_id}/replay")
        approval = client.post(
            f"/runs/{run_id}/approve",
            json={},
            headers={"Idempotency-Key": "legacy-approved-key"},
        )

        assert readable.status_code == 200
        assert readable.json()["status"] == "approved"
        assert readable.json()["is_replay_response"] is False
        assert replayed.status_code == 200
        assert replayed.json()["status"] == "approved"
        assert replayed.json()["is_replay_response"] is True
        assert approval.status_code == 409
        assert path.read_bytes() == before


class TestPostRunsEndpoint:
    def test_post_runs_unknown_case(self, client):
        resp = client.post("/runs", json={"case_id": "case-999"})
        assert resp.status_code == 404

    def test_post_runs_missing_body(self, client):
        resp = client.post("/runs")
        assert resp.status_code == 422  # Pydantic validation error


class TestPostRunsPipelineFailure:
    def test_pipeline_error_returns_422(self, client, monkeypatch):
        """POST /runs returns 422 with detail when pipeline raises PipelineError."""
        from app.errors import PipelineError

        def failing_pipeline(case_id, facility_id):
            raise PipelineError(
                stage="extract_facts",
                raw_response="",
                cause=ValueError("model returned unparseable JSON"),
            )

        monkeypatch.setattr("app.main.run_pipeline", failing_pipeline)
        resp = client.post("/runs", json={"case_id": "case-002"})
        assert resp.status_code == 422
        detail = resp.json()["detail"]
        assert "extract_facts" in detail
        assert "unparseable JSON" in detail

    @pytest.mark.parametrize(
        ("outcome", "expected"),
        [
            ("definitely_not_committed", "was not committed"),
            ("unknown", "outcome is unknown"),
        ],
    )
    def test_persistence_error_returns_classified_503(
        self,
        client,
        monkeypatch,
        outcome,
        expected,
    ):
        def failing_pipeline(case_id, facility_id):
            raise EventPersistenceError(outcome, OSError("sentinel secret"))

        monkeypatch.setattr("app.main.run_pipeline", failing_pipeline)
        resp = client.post("/runs", json={"case_id": "case-002"})

        assert resp.status_code == 503
        assert expected in resp.json()["detail"]
        assert "sentinel secret" not in resp.text


class TestApproveEndpoint:
    def _seed_approval_ready(self, run_id="run-approve-test"):
        pending = deepcopy(_load_mock_run("case-002"))
        pending["run_id"] = run_id
        pending["events"][0]["payload"]["run_id"] = run_id
        state.seed(run_id, pending)
        return pending

    def test_approve_success(self, client, tmp_runs):
        self._seed_approval_ready()
        resp = client.post(
            "/runs/run-approve-test/approve",
            json={},
            headers=APPROVAL_HEADERS,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "approved"
        assert data["recommendation"]["draft_text"].startswith("Please provide")

    def test_approve_requires_idempotency_key(self, client, tmp_runs):
        self._seed_approval_ready()

        resp = client.post("/runs/run-approve-test/approve", json={})

        assert resp.status_code == 400
        assert "idempotency-key" in resp.json()["detail"].lower()

    def test_approve_with_edited_text(self, client, tmp_runs):
        self._seed_approval_ready()
        resp = client.post(
            "/runs/run-approve-test/approve",
            json={"draft_text": "Edited draft."},
            headers=APPROVAL_HEADERS,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["recommendation"]["draft_text"] == "Edited draft."

    def test_approve_preserves_empty_string_edit(self, client, tmp_runs):
        self._seed_approval_ready()
        resp = client.post(
            "/runs/run-approve-test/approve",
            json={"draft_text": ""},
            headers=APPROVAL_HEADERS,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["recommendation"]["draft_text"] == ""

    def test_approve_not_found(self, client):
        resp = client.post(
            "/runs/nonexistent/approve",
            json={},
            headers=APPROVAL_HEADERS,
        )
        assert resp.status_code == 404
        assert "no persisted event log" in resp.json()["detail"].lower()

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
        resp = client.post(
            "/runs/run-esc/approve",
            json={},
            headers=APPROVAL_HEADERS,
        )
        assert resp.status_code == 409
        assert "escalated" in resp.json()["detail"].lower()

    def test_persisted_escalated_run_returns_explicit_409(self, client, tmp_runs):
        run_id = "run-persisted-escalated"
        escalated = _load_mock_run("case-003")
        for event in escalated["events"]:
            payload = deepcopy(event["payload"])
            if event["type"] == "run_started":
                payload["run_id"] = run_id
            append_event(run_id, event["type"], payload, event["timestamp"])
        append_event(
            run_id,
            "run_escalated",
            {
                "reason": "should_escalate flag set by analysis",
                "conflict_count": len(escalated["findings"]["conflicts"]),
            },
            "2026-04-11T15:00:06Z",
        )

        resp = client.post(
            f"/runs/{run_id}/approve",
            json={},
            headers=APPROVAL_HEADERS,
        )

        assert resp.status_code == 409
        assert resp.json()["detail"] == "Cannot approve an escalated run"
        assert [event["type"] for event in event_store.read_events(run_id)].count(
            "approved"
        ) == 0

    def test_interrupted_bootstrap_retry_fails_closed_without_rewriting(
        self,
        client,
        tmp_runs,
        monkeypatch,
    ):
        run_id = "run-route-interrupted-bootstrap"
        self._seed_approval_ready(run_id)
        real_write = event_store.os.write
        failed = False

        def fail_first_write(fd, data):
            nonlocal failed
            if not failed:
                failed = True
                raise OSError("injected first write failure")
            return real_write(fd, data)

        monkeypatch.setattr(event_store.os, "write", fail_first_write)
        first = client.post(
            f"/runs/{run_id}/approve",
            json={},
            headers={"Idempotency-Key": "bootstrap-route-key"},
        )
        path = tmp_runs / f"{run_id}.jsonl"

        assert first.status_code == 503
        assert "retry once with the same idempotency-key" in first.json()[
            "detail"
        ].lower()
        assert path.read_bytes() == b""

        monkeypatch.setattr(event_store.os, "write", real_write)
        retry = client.post(
            f"/runs/{run_id}/approve",
            json={},
            headers={"Idempotency-Key": "bootstrap-route-key"},
        )

        assert retry.status_code == 409
        assert "operator recovery" in retry.json()["detail"].lower()
        assert path.read_bytes() == b""

    def test_definite_prewrite_bootstrap_failure_requires_operator_recovery(
        self,
        client,
        tmp_runs,
        monkeypatch,
    ):
        run_id = "run-route-definite-bootstrap"
        self._seed_approval_ready(run_id)
        real_encode_events = event_store._encode_events

        def fail_before_write(events):
            raise EventPersistenceError(
                "definitely_not_committed",
                OSError("injected pre-write failure"),
            )

        monkeypatch.setattr(event_store, "_encode_events", fail_before_write)
        first = client.post(
            f"/runs/{run_id}/approve",
            json={},
            headers={"Idempotency-Key": "definite-bootstrap-key"},
        )
        path = tmp_runs / f"{run_id}.jsonl"

        assert first.status_code == 503
        assert "do not retry automatically" in first.json()["detail"].lower()
        assert "operator recovery" in first.json()["detail"].lower()
        assert path.read_bytes() == b""

        monkeypatch.setattr(event_store, "_encode_events", real_encode_events)
        retry = client.post(
            f"/runs/{run_id}/approve",
            json={},
            headers={"Idempotency-Key": "definite-bootstrap-key"},
        )

        assert retry.status_code == 409
        assert "operator recovery" in retry.json()["detail"].lower()
        assert path.read_bytes() == b""

    def test_identical_approval_retry_returns_original(self, client, tmp_runs):
        self._seed_approval_ready()
        first = client.post(
            "/runs/run-approve-test/approve",
            json={},
            headers=APPROVAL_HEADERS,
        )
        resp = client.post(
            "/runs/run-approve-test/approve",
            json={},
            headers=APPROVAL_HEADERS,
        )
        assert first.status_code == 200
        assert resp.status_code == 200
        assert resp.json() == first.json()
        assert resp.headers["Idempotency-Replayed"] == "true"

    def test_different_key_after_approval_returns_409(self, client, tmp_runs):
        self._seed_approval_ready()
        client.post(
            "/runs/run-approve-test/approve",
            json={},
            headers=APPROVAL_HEADERS,
        )
        resp = client.post(
            "/runs/run-approve-test/approve",
            json={},
            headers={"Idempotency-Key": "other-route-key"},
        )
        assert resp.status_code == 409
        assert "already approved" in resp.json()["detail"].lower()

    def test_concurrent_request_threads_commit_one_decision(
        self,
        client,
        tmp_runs,
        monkeypatch,
    ):
        run_id = "run-route-thread-race"
        pending = self._seed_approval_ready(run_id)
        for event in pending["events"]:
            append_event(
                run_id,
                event["type"],
                deepcopy(event["payload"]),
                event["timestamp"],
            )

        real_commit = main.commit_approval
        ready = threading.Barrier(2)

        def synchronized_commit(*args, **kwargs):
            ready.wait(timeout=5)
            return real_commit(*args, **kwargs)

        monkeypatch.setattr(main, "commit_approval", synchronized_commit)

        def approve(key):
            return client.post(
                f"/runs/{run_id}/approve",
                json={"approved_by": "reviewer-1"},
                headers={"Idempotency-Key": key},
            )

        with ThreadPoolExecutor(max_workers=2) as pool:
            responses = list(pool.map(approve, ["thread-key-a", "thread-key-b"]))

        assert sorted(response.status_code for response in responses) == [200, 409]
        assert [event["type"] for event in event_store.read_events(run_id)].count(
            "approved"
        ) == 1

    def test_unknown_fsync_keeps_cache_pending_until_same_key_retry(
        self,
        client,
        tmp_runs,
        monkeypatch,
    ):
        run_id = "run-fsync-route"
        self._seed_approval_ready(run_id)
        cached_before = deepcopy(state.get(run_id))
        real_fsync = event_store.os.fsync

        def fail_file_fsync(fd):
            if stat.S_ISREG(os.fstat(fd).st_mode):
                raise OSError("injected file fsync failure")
            return real_fsync(fd)

        monkeypatch.setattr(event_store.os, "fsync", fail_file_fsync)
        first = client.post(
            f"/runs/{run_id}/approve",
            json={},
            headers={"Idempotency-Key": "fsync-route-key"},
        )

        assert first.status_code == 503
        assert "durability is unknown" in first.json()["detail"].lower()
        assert state.get(run_id) == cached_before

        readable = client.get(f"/runs/{run_id}")
        replayed = client.get(f"/runs/{run_id}/replay")
        assert readable.status_code == 200
        assert readable.json()["status"] == "approved"
        assert readable.json()["is_replay_response"] is False
        assert replayed.status_code == 200
        assert replayed.json()["status"] == "approved"
        assert replayed.json()["is_replay_response"] is True
        assert state.get(run_id) == cached_before

        monkeypatch.setattr(event_store.os, "fsync", real_fsync)
        retry = client.post(
            f"/runs/{run_id}/approve",
            json={},
            headers={"Idempotency-Key": "fsync-route-key"},
        )
        assert retry.status_code == 200
        assert retry.headers["Idempotency-Replayed"] == "true"
        assert state.get(run_id)["status"] == "approved"

    def test_approve_jsonl_guard_catches_stale_memory(self, client, tmp_runs):
        """JSONL guard returns 409 even when in-memory state says approval_requested.

        Simulates a scenario where in-memory state was reset (e.g., by restart)
        and re-seeded as approval_requested, but the JSONL log already contains
        an approved event from a prior session.
        """
        run_id = "run-jsonl-guard-test"
        # Seed in-memory state as approval_requested (stale after restart)
        state.seed(run_id, {
            "run_id": run_id,
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
                "draft_text": "Original draft.",
            },
            "events": [],
        })
        mock = _load_mock_run("case-002")
        for event in mock["events"]:
            payload = deepcopy(event["payload"])
            if event["type"] == "run_started":
                payload["run_id"] = run_id
            append_event(run_id, event["type"], payload, event["timestamp"])
        final_recommendation = deepcopy(
            mock["events"][5]["payload"]["recommendation"]
        )
        final_recommendation["draft_text"] = "Previously approved."
        append_event(run_id, "approved", {
            "final_recommendation": final_recommendation,
        })
        # In-memory guard at line 161 passes (status != "approved"),
        # but JSONL guard at line 163 should catch it.
        resp = client.post(
            f"/runs/{run_id}/approve",
            json={},
            headers=APPROVAL_HEADERS,
        )
        assert resp.status_code == 409
        assert "already approved" in resp.json()["detail"].lower()

    def test_approve_without_draft_recommendation_returns_explicit_409(self, client):
        pending = self._seed_approval_ready("run-no-draft")
        pending["recommendation"] = None
        pending["events"][5]["payload"]["recommendation"] = None

        resp = client.post(
            "/runs/run-no-draft/approve",
            json={},
            headers=APPROVAL_HEADERS,
        )
        assert resp.status_code == 409
        assert "operator recovery" in resp.json()["detail"].lower()


class TestReplayEndpoint:
    def test_replay_not_found(self, client):
        resp = client.get("/runs/nonexistent/replay")
        assert resp.status_code == 404
        assert "replay unavailable" in resp.json()["detail"].lower()
        assert "no persisted event log exists" in resp.json()["detail"].lower()

    def test_replay_not_found_with_empty_jsonl_mentions_reconstruction(self, client, tmp_runs):
        (tmp_runs / "empty-replay.jsonl").write_text("", encoding="utf-8")

        resp = client.get("/runs/empty-replay/replay")
        assert resp.status_code == 404
        assert "contains no reconstructible events" in resp.json()["detail"].lower()

    def test_replay_does_not_treat_memory_as_persisted_history(self, client):
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
        assert resp.status_code == 404
        assert "replay unavailable" in resp.json()["detail"].lower()


class TestDemoFallbackEndpoint:
    def test_demo_fallback_case_002(self, client):
        resp = client.get("/demo-fallback/case-002")
        assert resp.status_code == 200
        data = resp.json()
        assert "run_id" in data

    def test_demo_fallback_missing_case(self, client):
        resp = client.get("/demo-fallback/case-999")
        assert resp.status_code == 404
        assert "unknown fallback case_id" in resp.json()["detail"].lower()

    def test_demo_fallback_invalid_shape(self, client, tmp_path, monkeypatch):
        case_dir = tmp_path / "cases" / "case-001"
        case_dir.mkdir(parents=True)
        (case_dir / "saved_demo_run.json").write_text(
            json.dumps({"run_id": "broken"}),
            encoding="utf-8",
        )
        monkeypatch.setattr("app.main.DATA_DIR", tmp_path)

        resp = client.get("/demo-fallback/case-001")
        assert resp.status_code == 500
        assert "does not match runstatus schema" in resp.json()["detail"].lower()


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
            headers=APPROVAL_HEADERS,
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
