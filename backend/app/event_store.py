import errno
import json
import logging
import os
import threading
import time
import weakref
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Iterator, Literal, Sequence

import fcntl

logger = logging.getLogger(__name__)

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
DATA_DIR = REPO_ROOT / "data"

LOCK_TIMEOUT_SECONDS = 5.0
LOCK_POLL_SECONDS = 0.01
WriteOutcome = Literal["definitely_not_committed", "unknown"]


class EventPersistenceError(RuntimeError):
    """A durable append failed, with an explicit retry-safety classification."""

    def __init__(self, outcome: WriteOutcome, cause: BaseException):
        self.outcome = outcome
        self.cause = cause
        super().__init__(f"event persistence failed ({outcome})")


class RunLogNotFoundError(FileNotFoundError):
    """The requested run log does not exist."""


@dataclass(frozen=True)
class LogSnapshot:
    events: list[dict]
    malformed_lines: tuple[int, ...]
    byte_count: int


_thread_locks_guard = threading.Lock()
_thread_locks: weakref.WeakValueDictionary[str, threading.Lock] = (
    weakref.WeakValueDictionary()
)


def _run_path(run_id: str) -> Path:
    return DATA_DIR / "runs" / f"{run_id}.jsonl"


def _thread_lock(path: Path) -> threading.Lock:
    key = str(path.resolve())
    with _thread_locks_guard:
        return _thread_locks.setdefault(key, threading.Lock())


def _fsync_directory(path: Path, outcome: WriteOutcome) -> None:
    try:
        fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    except OSError as exc:
        raise EventPersistenceError(outcome, exc) from exc


def _ensure_directory_durable(path: Path) -> None:
    missing: list[Path] = []
    cursor = path
    while not cursor.exists() and cursor.parent != cursor:
        missing.append(cursor)
        cursor = cursor.parent

    try:
        path.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise EventPersistenceError("definitely_not_committed", exc) from exc

    for created in reversed(missing):
        if created.exists():
            _fsync_directory(created.parent, "definitely_not_committed")


def _acquire_flock(fd: int, operation: int) -> None:
    deadline = time.monotonic() + LOCK_TIMEOUT_SECONDS
    while True:
        try:
            fcntl.flock(fd, operation | fcntl.LOCK_NB)
            return
        except OSError as exc:
            if exc.errno not in (errno.EACCES, errno.EAGAIN):
                raise EventPersistenceError(
                    "definitely_not_committed", exc
                ) from exc
            if time.monotonic() >= deadline:
                timeout = TimeoutError("timed out waiting for run-log lock")
                raise EventPersistenceError(
                    "definitely_not_committed", timeout
                ) from exc
            time.sleep(LOCK_POLL_SECONDS)


def _open_run_log(
    path: Path,
    *,
    create: bool,
    writable: bool,
) -> tuple[int, bool]:
    if create:
        _ensure_directory_durable(path.parent)
        try:
            return os.open(
                path,
                os.O_RDWR | os.O_APPEND | os.O_CREAT | os.O_EXCL,
                0o600,
            ), True
        except FileExistsError:
            pass
        except OSError as exc:
            raise EventPersistenceError("definitely_not_committed", exc) from exc

    try:
        flags = os.O_RDWR | os.O_APPEND if writable else os.O_RDONLY
        return os.open(path, flags), False
    except FileNotFoundError as exc:
        raise RunLogNotFoundError(str(path)) from exc
    except OSError as exc:
        raise EventPersistenceError("definitely_not_committed", exc) from exc


def _encode_events(events: Sequence[dict]) -> bytes:
    try:
        return b"".join(
            json.dumps(
                event,
                ensure_ascii=False,
                separators=(",", ":"),
            ).encode("utf-8") + b"\n"
            for event in events
        )
    except (TypeError, ValueError) as exc:
        raise EventPersistenceError("definitely_not_committed", exc) from exc


def _append_bytes(fd: int, data: bytes) -> None:
    """Append all bytes; every failure after the first write attempt is unknown."""
    written = 0
    while written < len(data):
        try:
            count = os.write(fd, data[written:])
        except OSError as exc:
            raise EventPersistenceError("unknown", exc) from exc
        if count <= 0:
            error = OSError("append returned without writing data")
            raise EventPersistenceError("unknown", error)
        written += count


def _read_snapshot(fd: int, run_id: str) -> LogSnapshot:
    try:
        byte_count = os.fstat(fd).st_size
        with os.fdopen(os.dup(fd), "rb") as stream:
            stream.seek(0)
            raw_lines = stream.readlines()
    except OSError as exc:
        raise EventPersistenceError("definitely_not_committed", exc) from exc

    events: list[dict] = []
    malformed_lines: list[int] = []
    for line_number, raw_line in enumerate(raw_lines, start=1):
        line = raw_line.strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except (json.JSONDecodeError, UnicodeDecodeError):
            malformed_lines.append(line_number)
            logger.warning(
                "malformed JSONL record skipped: run_id=%s line=%d category=json",
                run_id,
                line_number,
            )
            continue
        if not isinstance(event, dict):
            malformed_lines.append(line_number)
            logger.warning(
                "malformed JSONL record skipped: run_id=%s line=%d category=non_object",
                run_id,
                line_number,
            )
            continue
        events.append(event)

    return LogSnapshot(
        events=events,
        malformed_lines=tuple(malformed_lines),
        byte_count=byte_count,
    )


class LockedRunLog:
    """A run log held under one process and OS-level file lock."""

    def __init__(self, fd: int, path: Path, run_id: str, created: bool):
        self._fd = fd
        self.path = path
        self.run_id = run_id
        self.created = created

    def snapshot(self) -> LogSnapshot:
        return _read_snapshot(self._fd, self.run_id)

    def append_events(self, events: Sequence[dict]) -> None:
        data = _encode_events(events)
        if not data:
            return
        try:
            size = os.fstat(self._fd).st_size
            if size and os.pread(self._fd, 1, size - 1) != b"\n":
                data = b"\n" + data
        except OSError as exc:
            raise EventPersistenceError("definitely_not_committed", exc) from exc

        _append_bytes(self._fd, data)
        self.confirm_durable()

    def confirm_durable(self) -> None:
        try:
            os.fsync(self._fd)
        except OSError as exc:
            raise EventPersistenceError("unknown", exc) from exc
        _fsync_directory(self.path.parent, "unknown")


@contextmanager
def locked_run_log(
    run_id: str,
    *,
    create: bool,
    exclusive: bool = True,
) -> Iterator[LockedRunLog]:
    """Hold a bounded run-log lock across validation and durable append."""
    path = _run_path(run_id)
    thread_lock = _thread_lock(path)
    if not thread_lock.acquire(timeout=LOCK_TIMEOUT_SECONDS):
        timeout = TimeoutError("timed out waiting for local run-log lock")
        raise EventPersistenceError("definitely_not_committed", timeout)

    fd: int | None = None
    primary_error: BaseException | None = None
    try:
        fd, created = _open_run_log(
            path,
            create=create,
            writable=exclusive,
        )
        operation = fcntl.LOCK_EX if exclusive else fcntl.LOCK_SH
        _acquire_flock(fd, operation)
        yield LockedRunLog(fd, path, run_id, created)
    except BaseException as exc:
        primary_error = exc
        raise
    finally:
        cleanup_error: Exception | None = None
        cleanup_control: BaseException | None = None
        if fd is not None:
            try:
                fcntl.flock(fd, fcntl.LOCK_UN)
            except BaseException as exc:
                if isinstance(exc, Exception):
                    cleanup_error = exc
                else:
                    cleanup_control = exc
            try:
                os.close(fd)
            except BaseException as exc:
                if not isinstance(exc, Exception) and cleanup_control is None:
                    cleanup_control = exc
                elif isinstance(exc, Exception) and cleanup_error is None:
                    cleanup_error = exc
        try:
            thread_lock.release()
        except BaseException as exc:
            if not isinstance(exc, Exception) and cleanup_control is None:
                cleanup_control = exc
            elif isinstance(exc, Exception) and cleanup_error is None:
                cleanup_error = exc
        primary_is_control = primary_error is not None and not isinstance(
            primary_error, Exception
        )
        if cleanup_control is not None and not primary_is_control:
            raise cleanup_control
        if cleanup_error is not None and primary_error is None:
            raise EventPersistenceError("unknown", cleanup_error) from cleanup_error


def _new_event(event_type: str, payload: dict, timestamp: str | None) -> dict:
    return {
        "type": event_type,
        "timestamp": timestamp or datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "payload": payload,
    }


def append_event(run_id: str, event_type: str, payload: dict,
                 timestamp: str | None = None) -> dict:
    """Durably append one event and return the exact persisted representation."""
    event = _new_event(event_type, payload, timestamp)
    with locked_run_log(run_id, create=True) as log:
        log.append_events([event])
    logger.info("event appended: %s to %s", event_type, run_id)
    return event


def read_events(run_id: str) -> list[dict]:
    """Read valid JSON-object records; malformed records are skipped read-only."""
    try:
        with locked_run_log(run_id, create=False, exclusive=False) as log:
            return log.snapshot().events
    except RunLogNotFoundError:
        return []


def run_exists(run_id: str) -> bool:
    """Check if a JSONL log exists for this run without creating anything."""
    return _run_path(run_id).is_file()
