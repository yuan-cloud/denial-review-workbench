import json
import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import state
from app.main import DATA_DIR, app


@pytest.fixture(autouse=True)
def reset_state():
    """Clear in-memory run state before each test."""
    state.run_states.clear()
    yield
    state.run_states.clear()


@pytest.fixture()
def tmp_runs(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Redirect JSONL writes to a temp directory so tests don't pollute real data."""
    runs_dir = tmp_path / "runs"
    runs_dir.mkdir()
    monkeypatch.setattr("app.event_store.DATA_DIR", tmp_path)
    return runs_dir


@pytest.fixture()
def client():
    """FastAPI TestClient — does NOT run the lifespan (no mock seeding)."""
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture()
def seeded_client():
    """FastAPI TestClient with lifespan (seeds mock runs from mock_run.json files)."""
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def mock_run_data() -> dict:
    """Load case-002 mock_run.json as a dict."""
    path = DATA_DIR / "cases" / "case-002" / "mock_run.json"
    with open(path) as f:
        return json.load(f)


@pytest.fixture()
def case_dir() -> Path:
    """Path to the case-002 data directory."""
    return DATA_DIR / "cases" / "case-002"
