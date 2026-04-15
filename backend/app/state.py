from typing import Optional

run_states: dict[str, dict] = {}


def seed(run_id: str, data: dict) -> None:
    """First write for a run_id. Overwrites if called again."""
    run_states[run_id] = data


def get(run_id: str) -> Optional[dict]:
    return run_states.get(run_id)


def update(run_id: str, data: dict) -> None:
    """Subsequent writes (e.g. after approve). Same as seed but
    semantically signals mutation of existing state."""
    run_states[run_id] = data
