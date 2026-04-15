"""Tests for app.state — in-memory run state owner."""

from app import state


def test_seed_creates_entry():
    state.seed("run-1", {"run_id": "run-1", "status": "approval_requested"})
    assert state.get("run-1") is not None
    assert state.get("run-1")["run_id"] == "run-1"


def test_get_returns_none_for_missing():
    assert state.get("nonexistent") is None


def test_update_overwrites():
    state.seed("run-1", {"run_id": "run-1", "status": "approval_requested"})
    state.update("run-1", {"run_id": "run-1", "status": "approved"})
    assert state.get("run-1")["status"] == "approved"


def test_seed_overwrites_on_reseed():
    state.seed("run-1", {"run_id": "run-1", "v": 1})
    state.seed("run-1", {"run_id": "run-1", "v": 2})
    assert state.get("run-1")["v"] == 2


def test_overwrite_is_full_replacement():
    state.seed("run-1", {"run_id": "run-1", "extra": "field"})
    state.update("run-1", {"run_id": "run-1"})
    assert "extra" not in state.get("run-1")


def test_independent_run_ids():
    state.seed("a", {"run_id": "a"})
    state.seed("b", {"run_id": "b"})
    assert state.get("a")["run_id"] == "a"
    assert state.get("b")["run_id"] == "b"
