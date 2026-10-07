"""Approval transaction tests against real JSONL files and OS locks."""

import gc
import json
import multiprocessing
import os
import stat
import threading
import weakref
from copy import deepcopy
from pathlib import Path

import pytest

from app import event_store
from app.approval import (
    ApprovalAlreadyCommittedError,
    ApprovalAuditConflictError,
    ApprovalEscalatedError,
    IdempotencyConflictError,
    commit_approval,
)
from app.event_store import EventPersistenceError, append_event, read_events
from app.replay import replay_run

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
MOCK_RUN_PATH = REPO_ROOT / "data" / "cases" / "case-002" / "mock_run.json"


def _pending_events(run_id: str) -> list[dict]:
    mock = json.loads(MOCK_RUN_PATH.read_text(encoding="utf-8"))
    events = deepcopy(mock["events"])
    events[0]["payload"]["run_id"] = run_id
    return events


def _escalated_events(run_id: str, *, legacy_marker: bool) -> list[dict]:
    path = REPO_ROOT / "data" / "cases" / "case-003" / "mock_run.json"
    events = deepcopy(json.loads(path.read_text(encoding="utf-8"))["events"])
    events[0]["payload"]["run_id"] = run_id
    if legacy_marker:
        findings = events[-1]["payload"]["findings"]
        events.append(
            {
                "type": "run_escalated",
                "timestamp": "2026-04-11T15:00:06Z",
                "payload": {
                    "reason": "should_escalate flag set by analysis",
                    "conflict_count": len(findings["conflicts"]),
                },
            }
        )
    return events


def _write_events(run_id: str, events: list[dict]) -> None:
    for event in events:
        append_event(
            run_id,
            event["type"],
            event["payload"],
            timestamp=event["timestamp"],
        )


def _write_raw(path: Path, events: list[dict], suffix: bytes = b"") -> None:
    encoded = b"".join(
        json.dumps(event, separators=(",", ":")).encode("utf-8") + b"\n"
        for event in events
    )
    path.write_bytes(encoded + suffix)


def _process_commit(data_dir: str, run_id: str, key: str, queue) -> None:
    from app import event_store as child_event_store
    from app.approval import commit_approval as child_commit

    child_event_store.DATA_DIR = Path(data_dir)
    try:
        result = child_commit(
            run_id,
            draft_text="Reviewed text.",
            approved_by="reviewer-1",
            idempotency_key=key,
        )
        queue.put(("ok", result.replayed, result.run.model_dump(mode="json")))
    except Exception as exc:
        queue.put(("error", type(exc).__name__, str(exc)))


class TestApprovalValidation:
    @pytest.mark.parametrize("legacy_marker", [False, True])
    def test_valid_persisted_escalation_is_rejected_explicitly(
        self,
        tmp_runs,
        legacy_marker,
    ):
        run_id = f"run-escalated-{legacy_marker}"
        _write_events(run_id, _escalated_events(run_id, legacy_marker=legacy_marker))

        with pytest.raises(ApprovalEscalatedError):
            commit_approval(
                run_id,
                draft_text=None,
                approved_by="reviewer-1",
                idempotency_key="escalated-key",
            )

        assert [event["type"] for event in read_events(run_id)].count("approved") == 0

    @pytest.mark.parametrize(
        "mutate",
        [
            lambda events: events.append(
                {
                    "type": "run_escalated",
                    "timestamp": "2026-04-11T15:00:09Z",
                    "payload": {"reason": "unexpected"},
                }
            ),
            lambda events: events.append(
                {
                    "type": "approved",
                    "timestamp": "2026-04-11T15:00:09Z",
                    "payload": {},
                }
            ),
            lambda events: events[4]["payload"].update({"findings": {}}),
            lambda events: events[4]["payload"]["findings"].update(
                {"should_escalate": "false"}
            ),
            lambda events: events[2].update({"timestamp": "not-a-timestamp"}),
            lambda events: events[2]["payload"].pop("facts"),
            lambda events: events[5]["payload"].update(
                {"recommendation": {"action_type": "request", "rationale": "x"}}
            ),
        ],
        ids=[
            "extra-run-escalated",
            "invalid-approved",
            "empty-findings",
            "non-boolean-escalation",
            "invalid-timestamp",
            "missing-facts-payload",
            "invalid-recommendation",
        ],
    )
    def test_invalid_history_is_rejected_without_append(
        self,
        tmp_runs,
        mutate,
    ):
        run_id = "run-invalid-history"
        events = _pending_events(run_id)
        mutate(events)
        path = tmp_runs / f"{run_id}.jsonl"
        _write_raw(path, events)
        before = path.read_bytes()

        with pytest.raises(ApprovalAuditConflictError):
            commit_approval(
                run_id,
                draft_text=None,
                approved_by="reviewer-1",
                idempotency_key="invalid-history-key",
            )

        assert path.read_bytes() == before

    def test_semantically_invalid_facts_payload_is_rejected_without_append(
        self,
        tmp_runs,
    ):
        run_id = "run-invalid-facts-confidence"
        events = _pending_events(run_id)
        events[2]["payload"]["facts"]["confidence"] = True
        path = tmp_runs / f"{run_id}.jsonl"
        _write_raw(path, events)
        before = path.read_bytes()

        with pytest.raises(ApprovalAuditConflictError):
            commit_approval(
                run_id,
                draft_text=None,
                approved_by="reviewer-1",
                idempotency_key="invalid-facts-key",
            )

        assert path.read_bytes() == before

    def test_malformed_tail_is_rejected_and_diagnostic_is_content_free(
        self,
        tmp_runs,
        caplog,
    ):
        run_id = "run-malformed-tail"
        path = tmp_runs / f"{run_id}.jsonl"
        sentinel = b'SENTINEL_SECRET_{"type":"approved"'
        _write_raw(path, _pending_events(run_id), suffix=sentinel)
        before = path.read_bytes()

        with pytest.raises(ApprovalAuditConflictError):
            commit_approval(
                run_id,
                draft_text=None,
                approved_by="reviewer-1",
                idempotency_key="malformed-tail-key",
            )

        assert path.read_bytes() == before
        assert "SENTINEL_SECRET" not in caplog.text
        assert "category=json" in caplog.text

    @pytest.mark.parametrize(
        "suffix",
        [b"", b'{"type":"documents_loaded"'],
        ids=["complete-prefix", "partial-next-record"],
    )
    def test_interrupted_bootstrap_fails_closed(self, tmp_runs, suffix):
        run_id = "run-interrupted-bootstrap"
        path = tmp_runs / f"{run_id}.jsonl"
        _write_raw(path, _pending_events(run_id)[:1], suffix=suffix)
        before = path.read_bytes()

        with pytest.raises(ApprovalAuditConflictError):
            commit_approval(
                run_id,
                draft_text=None,
                approved_by="reviewer-1",
                idempotency_key="bootstrap-key",
                bootstrap_events=_pending_events(run_id),
            )

        assert path.read_bytes() == before

    def test_preexisting_empty_bootstrap_file_fails_closed(self, tmp_runs):
        run_id = "run-empty-bootstrap"
        path = tmp_runs / f"{run_id}.jsonl"
        path.write_bytes(b"")

        with pytest.raises(ApprovalAuditConflictError) as raised:
            commit_approval(
                run_id,
                draft_text=None,
                approved_by="reviewer-1",
                idempotency_key="empty-bootstrap-key",
                bootstrap_events=_pending_events(run_id),
            )

        assert raised.value.reason == "bootstrap_interrupted"
        assert path.read_bytes() == b""

    def test_matching_retry_rejects_invalid_authoritative_approval(self, tmp_runs):
        run_id = "run-invalid-committed"
        result = commit_approval(
            run_id,
            draft_text="Reviewed text.",
            approved_by="reviewer-1",
            idempotency_key="same-key",
            bootstrap_events=_pending_events(run_id),
        )
        assert result.run.status == "approved"

        path = tmp_runs / f"{run_id}.jsonl"
        events = read_events(run_id)
        events[-1]["payload"].pop("final_recommendation")
        _write_raw(path, events)

        with pytest.raises(ApprovalAuditConflictError):
            commit_approval(
                run_id,
                draft_text="Reviewed text.",
                approved_by="reviewer-1",
                idempotency_key="same-key",
            )

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
    def test_matching_retry_rejects_malformed_present_idempotency(
        self,
        tmp_runs,
        metadata,
    ):
        run_id = "run-invalid-committed-idempotency"
        commit_approval(
            run_id,
            draft_text="Reviewed text.",
            approved_by="reviewer-1",
            idempotency_key="same-key",
            bootstrap_events=_pending_events(run_id),
        )
        path = tmp_runs / f"{run_id}.jsonl"
        events = read_events(run_id)
        events[-1]["payload"]["idempotency"] = metadata
        _write_raw(path, events)
        before = path.read_bytes()

        with pytest.raises(ApprovalAuditConflictError) as raised:
            commit_approval(
                run_id,
                draft_text="Reviewed text.",
                approved_by="reviewer-1",
                idempotency_key="same-key",
            )

        assert raised.value.reason == "invalid_approved_idempotency"
        assert path.read_bytes() == before

    @pytest.mark.parametrize(
        ("field", "tampered_value"),
        [
            ("action_type", "tampered_action"),
            ("rationale", "tampered rationale"),
            ("draft_text", "tampered draft"),
            ("approved_by", "tampered-reviewer"),
        ],
    )
    def test_matching_retry_rejects_tampered_original_result(
        self,
        tmp_runs,
        field,
        tampered_value,
    ):
        run_id = f"run-tampered-{field}"
        commit_approval(
            run_id,
            draft_text="Reviewed text.",
            approved_by="reviewer-1",
            idempotency_key="same-key",
            bootstrap_events=_pending_events(run_id),
        )
        path = tmp_runs / f"{run_id}.jsonl"
        events = read_events(run_id)
        if field == "approved_by":
            events[-1]["payload"][field] = tampered_value
        else:
            events[-1]["payload"]["final_recommendation"][field] = tampered_value
        _write_raw(path, events)

        with pytest.raises(ApprovalAuditConflictError):
            commit_approval(
                run_id,
                draft_text="Reviewed text.",
                approved_by="reviewer-1",
                idempotency_key="same-key",
            )

    def test_invalid_candidate_timestamp_is_rejected_before_append(
        self,
        tmp_runs,
        monkeypatch,
    ):
        run_id = "run-invalid-candidate"
        _write_events(run_id, _pending_events(run_id))
        path = tmp_runs / f"{run_id}.jsonl"
        before = path.read_bytes()
        monkeypatch.setattr("app.approval._utc_timestamp", lambda: "invalid")

        with pytest.raises(ApprovalAuditConflictError):
            commit_approval(
                run_id,
                draft_text="Reviewed text.",
                approved_by="reviewer-1",
                idempotency_key="candidate-key",
            )

        assert path.read_bytes() == before


class TestApprovalIdempotencyAndDurability:
    def test_identical_retry_returns_original_and_conflicting_reuse_fails(
        self,
        tmp_runs,
    ):
        run_id = "run-idempotent"
        first = commit_approval(
            run_id,
            draft_text="Reviewed text.",
            approved_by="reviewer-1",
            idempotency_key="stable-key",
            bootstrap_events=_pending_events(run_id),
        )
        retry = commit_approval(
            run_id,
            draft_text="Reviewed text.",
            approved_by="reviewer-1",
            idempotency_key="stable-key",
        )

        assert first.replayed is False
        assert retry.replayed is True
        assert retry.run == first.run
        assert first.run.approved_by == "reviewer-1"
        assert retry.run.approved_by == "reviewer-1"
        assert [event["type"] for event in read_events(run_id)].count("approved") == 1

        with pytest.raises(IdempotencyConflictError):
            commit_approval(
                run_id,
                draft_text="Different text.",
                approved_by="reviewer-1",
                idempotency_key="stable-key",
            )
        with pytest.raises(IdempotencyConflictError):
            commit_approval(
                run_id,
                draft_text="Reviewed text.",
                approved_by="reviewer-2",
                idempotency_key="stable-key",
            )
        with pytest.raises(ApprovalAlreadyCommittedError):
            commit_approval(
                run_id,
                draft_text="Reviewed text.",
                approved_by="reviewer-1",
                idempotency_key="different-key",
            )

    def test_readable_approval_after_fsync_failure_requires_same_key_reconfirm(
        self,
        tmp_runs,
        monkeypatch,
    ):
        run_id = "run-fsync-unknown"
        real_fsync = event_store.os.fsync

        def fail_file_fsync(fd):
            if stat.S_ISREG(os.fstat(fd).st_mode):
                raise OSError("injected file fsync failure")
            return real_fsync(fd)

        monkeypatch.setattr(event_store.os, "fsync", fail_file_fsync)
        with pytest.raises(EventPersistenceError) as raised:
            commit_approval(
                run_id,
                draft_text="Reviewed text.",
                approved_by="reviewer-1",
                idempotency_key="fsync-key",
                bootstrap_events=_pending_events(run_id),
            )
        assert raised.value.outcome == "unknown"
        assert [event["type"] for event in read_events(run_id)].count("approved") == 1
        assert replay_run(run_id).status == "approved"

        monkeypatch.setattr(event_store.os, "fsync", real_fsync)
        retry = commit_approval(
            run_id,
            draft_text="Reviewed text.",
            approved_by="reviewer-1",
            idempotency_key="fsync-key",
        )
        assert retry.replayed is True
        assert [event["type"] for event in read_events(run_id)].count("approved") == 1

    def test_partial_write_retry_fails_closed(self, tmp_runs, monkeypatch):
        run_id = "run-partial-write"
        real_write = event_store.os.write
        write_calls = 0

        def partial_then_fail(fd, data):
            nonlocal write_calls
            write_calls += 1
            if write_calls == 1:
                return real_write(fd, data[: max(1, len(data) // 2)])
            raise OSError("injected partial write failure")

        monkeypatch.setattr(event_store.os, "write", partial_then_fail)
        with pytest.raises(EventPersistenceError) as raised:
            commit_approval(
                run_id,
                draft_text="Reviewed text.",
                approved_by="reviewer-1",
                idempotency_key="partial-key",
                bootstrap_events=_pending_events(run_id),
            )
        assert raised.value.outcome == "unknown"

        monkeypatch.setattr(event_store.os, "write", real_write)
        path = tmp_runs / f"{run_id}.jsonl"
        before_retry = path.read_bytes()
        with pytest.raises(ApprovalAuditConflictError):
            commit_approval(
                run_id,
                draft_text="Reviewed text.",
                approved_by="reviewer-1",
                idempotency_key="partial-key",
                bootstrap_events=_pending_events(run_id),
            )
        assert path.read_bytes() == before_retry


class TestEventStoreBoundaries:
    def test_serialization_failure_is_definitely_pre_write(self, tmp_runs):
        run_id = "run-unserializable"

        with pytest.raises(EventPersistenceError) as raised:
            append_event(run_id, "run_started", {"invalid": object()})

        assert raised.value.outcome == "definitely_not_committed"
        assert (tmp_runs / f"{run_id}.jsonl").read_bytes() == b""

    def test_first_write_call_failure_is_unknown(self, tmp_runs, monkeypatch):
        run_id = "run-first-write-error"

        def fail_write(fd, data):
            raise OSError("injected first write failure")

        monkeypatch.setattr(event_store.os, "write", fail_write)
        with pytest.raises(EventPersistenceError) as raised:
            append_event(run_id, "run_started", {
                "run_id": run_id,
                "case_id": "case-002",
                "facility_id": "facility-a",
            })

        assert raised.value.outcome == "unknown"
        assert (tmp_runs / f"{run_id}.jsonl").read_bytes() == b""

    def test_missing_read_and_replay_do_not_create_directories(
        self,
        tmp_path,
        monkeypatch,
    ):
        data_dir = tmp_path / "absent-data"
        monkeypatch.setattr(event_store, "DATA_DIR", data_dir)

        assert read_events("missing") == []
        assert replay_run("missing") is None
        assert not data_dir.exists()

    def test_first_write_fsyncs_file_and_directory_entries(
        self,
        tmp_path,
        monkeypatch,
    ):
        data_dir = tmp_path / "new-data"
        monkeypatch.setattr(event_store, "DATA_DIR", data_dir)
        real_fsync = event_store.os.fsync
        synced_modes: list[int] = []

        def record_fsync(fd):
            synced_modes.append(os.fstat(fd).st_mode)
            return real_fsync(fd)

        monkeypatch.setattr(event_store.os, "fsync", record_fsync)
        append_event("run-new-dir", "run_started", {
            "run_id": "run-new-dir",
            "case_id": "case-002",
            "facility_id": "facility-a",
        })

        assert (data_dir / "runs" / "run-new-dir.jsonl").is_file()
        assert any(stat.S_ISREG(mode) for mode in synced_modes)
        assert sum(stat.S_ISDIR(mode) for mode in synced_modes) >= 3

    def test_local_lock_is_released_when_unlock_cleanup_raises(
        self,
        tmp_runs,
        monkeypatch,
    ):
        run_id = "run-unlock-cleanup"
        _write_events(run_id, _pending_events(run_id))
        real_flock = event_store.fcntl.flock
        failed = False

        def fail_first_unlock(fd, operation):
            nonlocal failed
            if operation == event_store.fcntl.LOCK_UN and not failed:
                failed = True
                raise OSError("injected unlock failure")
            return real_flock(fd, operation)

        monkeypatch.setattr(event_store.fcntl, "flock", fail_first_unlock)
        with pytest.raises(EventPersistenceError) as raised:
            with event_store.locked_run_log(run_id, create=False):
                pass
        assert raised.value.outcome == "unknown"
        assert str(raised.value.cause) == "injected unlock failure"

        with event_store.locked_run_log(run_id, create=False) as log:
            assert len(log.snapshot().events) == len(_pending_events(run_id))

    @pytest.mark.parametrize("cleanup_step", ["unlock", "close", "local-release"])
    def test_descriptor_cleanup_failure_preserves_primary_persistence_outcome(
        self,
        tmp_runs,
        monkeypatch,
        cleanup_step,
    ):
        run_id = f"run-cleanup-primary-{cleanup_step}"
        _write_events(run_id, _pending_events(run_id))
        primary = EventPersistenceError("unknown", OSError("primary failure"))
        failed = False

        if cleanup_step == "unlock":
            real_cleanup = event_store.fcntl.flock

            def fail_cleanup(fd, operation):
                nonlocal failed
                if operation == event_store.fcntl.LOCK_UN and not failed:
                    failed = True
                    raise OSError("injected unlock failure")
                return real_cleanup(fd, operation)

            monkeypatch.setattr(event_store.fcntl, "flock", fail_cleanup)
        elif cleanup_step == "close":
            real_cleanup = event_store.os.close

            def fail_cleanup(fd):
                nonlocal failed
                if not failed:
                    failed = True
                    real_cleanup(fd)
                    raise OSError("injected close failure")
                return real_cleanup(fd)

            monkeypatch.setattr(event_store.os, "close", fail_cleanup)
        else:
            real_lock = event_store._thread_lock(event_store._run_path(run_id))

            class FailingReleaseLock:
                def acquire(self, timeout):
                    return real_lock.acquire(timeout=timeout)

                def release(self):
                    nonlocal failed
                    real_lock.release()
                    if not failed:
                        failed = True
                        raise RuntimeError("injected local release failure")

            monkeypatch.setattr(
                event_store,
                "_thread_lock",
                lambda path: FailingReleaseLock(),
            )

        with pytest.raises(EventPersistenceError) as raised:
            with event_store.locked_run_log(run_id, create=False):
                raise primary

        assert raised.value is primary
        assert raised.value.outcome == "unknown"
        with event_store.locked_run_log(run_id, create=False) as log:
            assert len(log.snapshot().events) == len(_pending_events(run_id))

    def test_all_cleanup_steps_run_and_confirmed_work_is_never_prewrite(
        self,
        tmp_runs,
        monkeypatch,
    ):
        run_id = "run-all-cleanup-steps"
        _write_events(run_id, _pending_events(run_id))
        calls: list[str] = []
        real_flock = event_store.fcntl.flock
        real_close = event_store.os.close
        real_lock = event_store._thread_lock(event_store._run_path(run_id))
        run_fd: int | None = None

        def fail_unlock(fd, operation):
            if operation == event_store.fcntl.LOCK_UN:
                calls.append("unlock")
                raise OSError("injected unlock failure")
            return real_flock(fd, operation)

        def fail_close(fd):
            if fd != run_fd:
                return real_close(fd)
            calls.append("close")
            real_close(fd)
            raise OSError("injected close failure")

        class RecordingReleaseLock:
            def acquire(self, timeout):
                return real_lock.acquire(timeout=timeout)

            def release(self):
                calls.append("local-release")
                real_lock.release()

        monkeypatch.setattr(event_store.fcntl, "flock", fail_unlock)
        monkeypatch.setattr(event_store.os, "close", fail_close)
        monkeypatch.setattr(
            event_store,
            "_thread_lock",
            lambda path: RecordingReleaseLock(),
        )

        with pytest.raises(EventPersistenceError) as raised:
            with event_store.locked_run_log(run_id, create=False) as log:
                run_fd = log._fd
                log.confirm_durable()

        assert calls == ["unlock", "close", "local-release"]
        assert raised.value.outcome == "unknown"

    def test_close_cleanup_failure_is_observed_and_releases_local_lock(
        self,
        tmp_runs,
        monkeypatch,
    ):
        run_id = "run-close-cleanup"
        _write_events(run_id, _pending_events(run_id))
        real_close = event_store.os.close
        real_lock = event_store._thread_lock(event_store._run_path(run_id))
        close_failure = OSError("injected run-log close failure")
        calls: list[str] = []
        run_fd: int | None = None
        failed = False

        def fail_run_log_close(fd):
            nonlocal failed
            if fd != run_fd or failed:
                return real_close(fd)
            calls.append("close")
            failed = True
            real_close(fd)
            raise close_failure

        class RecordingReleaseLock:
            def acquire(self, timeout):
                return real_lock.acquire(timeout=timeout)

            def release(self):
                calls.append("local-release")
                real_lock.release()

        monkeypatch.setattr(event_store.os, "close", fail_run_log_close)
        monkeypatch.setattr(
            event_store,
            "_thread_lock",
            lambda path: RecordingReleaseLock(),
        )

        with pytest.raises(EventPersistenceError) as raised:
            with event_store.locked_run_log(run_id, create=False) as log:
                run_fd = log._fd
                log.confirm_durable()

        assert failed is True
        assert calls == ["close", "local-release"]
        assert raised.value.outcome == "unknown"
        assert raised.value.cause is close_failure
        with event_store.locked_run_log(run_id, create=False) as log:
            assert len(log.snapshot().events) == len(_pending_events(run_id))

    @pytest.mark.parametrize("control_type", [KeyboardInterrupt, SystemExit])
    def test_cleanup_control_exception_outweighs_ordinary_failures(
        self,
        tmp_runs,
        monkeypatch,
        control_type,
    ):
        run_id = f"run-cleanup-control-{control_type.__name__}"
        _write_events(run_id, _pending_events(run_id))
        calls: list[str] = []
        real_flock = event_store.fcntl.flock
        real_close = event_store.os.close
        real_lock = event_store._thread_lock(event_store._run_path(run_id))
        failed_close = False

        def fail_unlock(fd, operation):
            if operation == event_store.fcntl.LOCK_UN:
                calls.append("unlock")
                raise OSError("injected unlock failure")
            return real_flock(fd, operation)

        def interrupt_close(fd):
            nonlocal failed_close
            calls.append("close")
            real_close(fd)
            if not failed_close:
                failed_close = True
                raise control_type

        class RecordingReleaseLock:
            def acquire(self, timeout):
                return real_lock.acquire(timeout=timeout)

            def release(self):
                calls.append("local-release")
                real_lock.release()

        monkeypatch.setattr(event_store.fcntl, "flock", fail_unlock)
        monkeypatch.setattr(event_store.os, "close", interrupt_close)
        monkeypatch.setattr(
            event_store,
            "_thread_lock",
            lambda path: RecordingReleaseLock(),
        )

        primary = EventPersistenceError("unknown", OSError("primary failure"))
        with pytest.raises(control_type) as raised:
            with event_store.locked_run_log(run_id, create=False):
                raise primary

        assert calls == ["unlock", "close", "local-release"]
        assert raised.value.__context__ is primary

    def test_thread_lock_registry_keeps_waiters_safe_then_reclaims_path(
        self,
        tmp_runs,
    ):
        path = event_store._run_path("run-weak-lock")
        key = str(path.resolve())
        owner = event_store._thread_lock(path)
        owner_ref = weakref.ref(owner)
        owner.acquire()
        ready = threading.Event()
        acquired = threading.Event()
        waiter_ids: list[int] = []

        def wait_for_lock():
            waiter = event_store._thread_lock(path)
            waiter_ids.append(id(waiter))
            ready.set()
            with waiter:
                acquired.set()

        thread = threading.Thread(target=wait_for_lock)
        thread.start()
        assert ready.wait(timeout=2)
        gc.collect()
        assert event_store._thread_locks[key] is owner
        assert waiter_ids == [id(owner)]

        owner.release()
        assert acquired.wait(timeout=2)
        thread.join(timeout=2)
        assert not thread.is_alive()
        del owner
        gc.collect()
        assert owner_ref() is None
        assert key not in event_store._thread_locks

    def test_interrupt_is_preserved_when_cleanup_fails(
        self,
        tmp_runs,
        monkeypatch,
    ):
        run_id = "run-cleanup-interrupt"
        _write_events(run_id, _pending_events(run_id))
        real_flock = event_store.fcntl.flock
        failed = False

        def fail_first_unlock(fd, operation):
            nonlocal failed
            if operation == event_store.fcntl.LOCK_UN and not failed:
                failed = True
                raise OSError("injected unlock failure")
            return real_flock(fd, operation)

        monkeypatch.setattr(event_store.fcntl, "flock", fail_first_unlock)
        with pytest.raises(KeyboardInterrupt):
            with event_store.locked_run_log(run_id, create=False):
                raise KeyboardInterrupt

        with event_store.locked_run_log(run_id, create=False) as log:
            assert len(log.snapshot().events) == len(_pending_events(run_id))


class TestApprovalProcesses:
    @pytest.mark.parametrize(
        ("keys", "expected"),
        [
            (("key-a", "key-b"), {"ok", "ApprovalAlreadyCommittedError"}),
            (("shared-key", "shared-key"), {"committed", "replayed"}),
        ],
        ids=["distinct-keys", "same-key"],
    )
    def test_concurrent_processes_commit_once(self, tmp_runs, keys, expected):
        run_id = f"run-process-{keys[0]}"
        _write_events(run_id, _pending_events(run_id))
        context = multiprocessing.get_context("spawn")
        queue = context.Queue()
        processes = [
            context.Process(
                target=_process_commit,
                args=(str(tmp_runs.parent), run_id, key, queue),
            )
            for key in keys
        ]

        for process in processes:
            process.start()
        for process in processes:
            process.join(timeout=10)
            assert not process.is_alive()
            assert process.exitcode == 0

        results = [queue.get(timeout=2) for _ in processes]
        if keys[0] == keys[1]:
            outcomes = {
                "replayed" if result[1] else "committed"
                for result in results
                if result[0] == "ok"
            }
        else:
            outcomes = {
                "ok" if result[0] == "ok" else result[1]
                for result in results
            }
        assert outcomes == expected
        assert [event["type"] for event in read_events(run_id)].count("approved") == 1


def test_persisted_pending_run_can_be_approved_after_restart_without_provider(
    tmp_runs,
    monkeypatch,
):
    run_id = "run-after-restart"
    _write_events(run_id, _pending_events(run_id))

    def provider_trap(*args, **kwargs):
        raise AssertionError("provider must not be called")

    monkeypatch.setattr("app.providers.anthropic_client.call_model", provider_trap)
    monkeypatch.setattr("app.pipeline.call_model", provider_trap)
    result = commit_approval(
        run_id,
        draft_text=None,
        approved_by="reviewer-1",
        idempotency_key="restart-key",
    )
    path = tmp_runs / f"{run_id}.jsonl"
    before_replay = path.read_bytes()
    replayed = replay_run(run_id)

    assert result.run.status == "approved"
    assert replayed.status == "approved"
    assert replayed.is_replay_response is True
    assert path.read_bytes() == before_replay
