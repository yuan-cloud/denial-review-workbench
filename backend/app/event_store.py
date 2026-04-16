import json
import logging
from datetime import UTC, datetime
from pathlib import Path

logger = logging.getLogger(__name__)

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
DATA_DIR = REPO_ROOT / "data"
(DATA_DIR / "runs").mkdir(parents=True, exist_ok=True)


def _run_path(run_id: str) -> Path:
    return DATA_DIR / "runs" / f"{run_id}.jsonl"


def append_event(run_id: str, event_type: str, payload: dict,
                 timestamp: str | None = None) -> None:
    """Append a single event to the run's JSONL log."""
    event = {
        "type": event_type,
        "timestamp": timestamp or datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "payload": payload,
    }
    path = _run_path(run_id)
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(event) + "\n")
    logger.info("event appended: %s to %s", event_type, run_id)


def read_events(run_id: str) -> list[dict]:
    """Read all events from a run's JSONL log. Skips malformed lines."""
    path = _run_path(run_id)
    if not path.exists():
        return []

    events = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                logger.warning("malformed JSONL line skipped: %s", line[:100])
    return events


def run_exists(run_id: str) -> bool:
    """Check if a JSONL log exists for this run."""
    return _run_path(run_id).exists()
