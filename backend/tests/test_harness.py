"""Smoke test to prove the backend test harness works."""

from app import state


def test_state_reset_fixture(reset_state):
    """Verify the reset_state fixture clears run_states."""
    state.seed("test-run", {"run_id": "test-run", "status": "approval_requested"})
    assert state.get("test-run") is not None


def test_state_is_clean_between_tests():
    """Previous test's seeded data should not leak here."""
    assert state.get("test-run") is None


def test_client_responds(client):
    """TestClient can hit the health endpoint."""
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


def test_seeded_client_has_mock_data(seeded_client):
    """Seeded client loads mock_run.json via lifespan."""
    res = seeded_client.get("/runs/run-case-002-mock")
    assert res.status_code == 200
    assert res.json()["case_id"] == "case-002"


def test_mock_run_data_fixture(mock_run_data):
    """mock_run_data fixture loads case-002 mock JSON."""
    assert mock_run_data["case_id"] == "case-002"
    assert "run_id" in mock_run_data


def test_tmp_runs_isolation(tmp_runs):
    """tmp_runs fixture provides an isolated directory."""
    assert tmp_runs.exists()
    assert tmp_runs.name == "runs"
