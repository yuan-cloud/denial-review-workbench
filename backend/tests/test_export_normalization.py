"""
Tests for scripts/export_to_vifei.sh normalization logic.

Uses frozen synthetic-case JSONL fixtures copied from data/runs/ for
case-001, case-002, and case-003 only. The normalization Python block is
invoked via subprocess. Error-path tests call the full shell script against
the same frozen fixtures.

Bead: bd-7io
"""

import json
import os
import subprocess
import tempfile
from datetime import datetime
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
SCRIPT = REPO_ROOT / "scripts" / "export_to_vifei.sh"
RUNS_DIR = REPO_ROOT / "backend" / "tests" / "fixtures" / "export_runs"

# Fixtures — frozen synthetic-case files copied from data/runs/
APPROVED_RUN = "run-case-002-20260416075553"
ESCALATED_LEGACY_RUN = "run-case-003-20260416085208"
MOCK_RUN = "run-case-002-mock"
PARTIAL_RUN = "run-case-001-20260415104157"
PENDING_RUN = "run-case-001-20260415111641"

# Vifei CommittedEvent canonical field order (from event.rs doc comment)
CANONICAL_FIELDS = [
    "commit_index", "run_id", "event_id", "source_id", "source_seq",
    "timestamp_ns", "tier", "payload",
]
OPTIONAL_FIELDS = {"payload_ref", "synthesized"}
SOURCE_ID = "denial-review-workbench"

# ── The normalizer Python code (extracted from the heredoc in export_to_vifei.sh)
# This is invoked via subprocess so it runs identically to the shell script.
NORMALIZER = '''
import json
import sys
from collections import OrderedDict
from datetime import datetime

run_file   = sys.argv[1]
out_file   = sys.argv[2]
run_id_arg = sys.argv[3]
source_id  = sys.argv[4]

with open(run_file, "r", encoding="utf-8") as f:
    events = []
    for line in f:
        line = line.strip()
        if line:
            events.append(json.loads(line))

if not events:
    print(f"Error: {run_id_arg} has an empty JSONL file.", file=sys.stderr)
    sys.exit(1)

first_type = events[0].get("type", "")
if first_type != "run_started":
    print(f"Error: {run_id_arg} appears to be a mock run (missing run_started event).", file=sys.stderr)
    sys.exit(1)

terminal_type = events[-1].get("type", "")
terminal_payload = events[-1].get("payload", {})
is_approved = terminal_type == "approved"
is_escalated_explicit = terminal_type == "run_escalated"
is_escalated_legacy = (
    terminal_type == "analysis_completed"
    and terminal_payload.get("findings", {}).get("should_escalate") is True
)

if terminal_type == "approval_requested":
    print(f"Error: {run_id_arg} is pending approval (terminal: approval_requested).", file=sys.stderr)
    sys.exit(1)

if not (is_approved or is_escalated_explicit or is_escalated_legacy):
    print(f"Error: {run_id_arg} is a partial run ({len(events)} events, terminal: {terminal_type}).", file=sys.stderr)
    sys.exit(1)

run_id = events[0]["payload"].get("run_id", run_id_arg)

def ts_to_ns(ts_str):
    dt = datetime.fromisoformat(ts_str)
    epoch_s = int(dt.timestamp())
    epoch_us = dt.microsecond
    return epoch_s * 10**9 + epoch_us * 10**3

def map_event(event, index):
    etype = event["type"]
    payload_data = event.get("payload", {})
    timestamp_ns = ts_to_ns(event["timestamp"])
    if etype == "run_started":
        case_id = payload_data.get("case_id", "")
        facility_id = payload_data.get("facility_id", "")
        payload = OrderedDict([("type", "RunStart"), ("agent", source_id), ("args", f"{case_id} {facility_id}")])
        tier = "A"
    elif etype == "approved":
        payload = OrderedDict([("type", "RunEnd"), ("exit_code", 0), ("reason", "approved")])
        tier = "A"
    elif etype == "run_escalated":
        reason = payload_data.get("reason", "escalated")
        payload = OrderedDict([("type", "RunEnd"), ("reason", f"escalated: {reason}")])
        tier = "A"
    else:
        payload = OrderedDict([("type", "Generic"), ("event_type", etype),
            ("data", OrderedDict([("payload_json", json.dumps(payload_data, separators=(",", ":")))]))])
        tier = "B"
    committed = OrderedDict()
    committed["commit_index"] = index
    committed["run_id"] = run_id
    committed["event_id"] = f"{source_id}:{index}"
    committed["source_id"] = source_id
    committed["source_seq"] = index
    committed["timestamp_ns"] = timestamp_ns
    committed["tier"] = tier
    committed["payload"] = payload
    return committed

normalized = [map_event(event, i) for i, event in enumerate(events)]

if is_escalated_legacy:
    last_ts = ts_to_ns(events[-1]["timestamp"])
    synth_index = len(events)
    synth = OrderedDict()
    synth["commit_index"] = synth_index
    synth["run_id"] = run_id
    synth["event_id"] = f"{source_id}:{synth_index}"
    synth["source_id"] = source_id
    synth["source_seq"] = synth_index
    synth["timestamp_ns"] = last_ts
    synth["tier"] = "A"
    synth["payload"] = OrderedDict([("type", "RunEnd"), ("reason", "escalated: detected from analysis_completed")])
    synth["synthesized"] = True
    normalized.append(synth)

with open(out_file, "w", encoding="utf-8") as f:
    for record in normalized:
        f.write(json.dumps(record, separators=(",", ":")) + "\\n")

print(f"Normalized {len(normalized)} events")
'''


def normalize(run_id: str, out_path: str) -> list[dict]:
    """Run the normalizer Python code and return parsed events."""
    run_file = str(RUNS_DIR / f"{run_id}.jsonl")
    result = subprocess.run(
        ["python3", "-c", NORMALIZER, run_file, out_path, run_id, SOURCE_ID],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"Normalizer failed: {result.stderr}")
    if not Path(out_path).exists():
        return []
    with open(out_path) as f:
        return [json.loads(line) for line in f if line.strip()]


def run_shell_script(args: list[str]) -> subprocess.CompletedProcess:
    """Run the full shell script for error-path testing."""
    env = os.environ.copy()
    env["RUNS_DIR"] = str(RUNS_DIR)
    return subprocess.run(
        ["sh", str(SCRIPT)] + args,
        capture_output=True, text=True,
        cwd=str(REPO_ROOT),
        env=env,
    )


# ── 1. Timestamp conversion ──────────────────────────────────────────

class TestTimestampConversion:
    def test_known_timestamp(self, tmp_path):
        """Verify timestamp_ns for a known ISO 8601 value."""
        out = str(tmp_path / "out.jsonl")
        events = normalize(APPROVED_RUN, out)
        assert len(events) > 0

        with open(RUNS_DIR / f"{APPROVED_RUN}.jsonl") as f:
            source_event = json.loads(f.readline())
        source_ts = source_event["timestamp"]

        dt = datetime.fromisoformat(source_ts)
        expected_ns = int(dt.timestamp()) * 10**9 + dt.microsecond * 10**3

        assert events[0]["timestamp_ns"] == expected_ns

    def test_timestamps_monotonic(self, tmp_path):
        """All timestamps must be monotonically non-decreasing."""
        events = normalize(APPROVED_RUN, str(tmp_path / "out.jsonl"))
        for i in range(1, len(events)):
            assert events[i]["timestamp_ns"] >= events[i - 1]["timestamp_ns"], (
                f"Timestamp regression at index {i}"
            )


# ── 2. Terminal states ────────────────────────────────────────────────

class TestTerminalStates:
    def test_approved_run(self, tmp_path):
        """Approved run: 8 events, terminal is RunEnd with reason=approved."""
        events = normalize(APPROVED_RUN, str(tmp_path / "out.jsonl"))
        assert len(events) == 8
        assert events[0]["payload"]["type"] == "RunStart"
        assert events[-1]["payload"]["type"] == "RunEnd"
        assert events[-1]["payload"]["exit_code"] == 0
        assert events[-1]["payload"]["reason"] == "approved"

    def test_escalated_legacy_run(self, tmp_path):
        """Legacy escalated: 5 source → 6 normalized (synthetic RunEnd)."""
        events = normalize(ESCALATED_LEGACY_RUN, str(tmp_path / "out.jsonl"))

        with open(RUNS_DIR / f"{ESCALATED_LEGACY_RUN}.jsonl") as f:
            source_count = sum(1 for line in f if line.strip())
        assert source_count == 5
        assert len(events) == 6

        last = events[-1]
        assert last["payload"]["type"] == "RunEnd"
        assert "escalated" in last["payload"]["reason"]
        assert last.get("synthesized") is True
        assert last["tier"] == "A"

    def test_escalated_legacy_synthetic_commit_index(self, tmp_path):
        """Synthetic RunEnd gets commit_index = N (one past last source)."""
        events = normalize(ESCALATED_LEGACY_RUN, str(tmp_path / "out.jsonl"))
        assert events[-1]["commit_index"] == 5  # 0-based, 6th event


# ── 3. CommittedEvent schema compliance ───────────────────────────────

class TestSchemaCompliance:
    def test_canonical_field_order(self, tmp_path):
        """Fields must appear in Vifei canonical order."""
        events = normalize(APPROVED_RUN, str(tmp_path / "out.jsonl"))
        for i, event in enumerate(events):
            keys = list(event.keys())
            required = [k for k in keys if k not in OPTIONAL_FIELDS]
            assert required == CANONICAL_FIELDS, (
                f"Event {i}: expected {CANONICAL_FIELDS}, got {required}"
            )

    def test_tier_a_for_typed_variants(self, tmp_path):
        """RunStart and RunEnd must be Tier A."""
        events = normalize(APPROVED_RUN, str(tmp_path / "out.jsonl"))
        for event in events:
            ptype = event["payload"]["type"]
            if ptype in ("RunStart", "RunEnd"):
                assert event["tier"] == "A", f"Tier A expected for {ptype}"

    def test_tier_b_for_generic(self, tmp_path):
        """Generic payload events must be Tier B."""
        events = normalize(APPROVED_RUN, str(tmp_path / "out.jsonl"))
        for event in events:
            if event["payload"]["type"] == "Generic":
                assert event["tier"] == "B", (
                    f"Tier B expected at commit_index {event['commit_index']}"
                )

    def test_event_ids_unique(self, tmp_path):
        """All event_ids must be unique within a run."""
        events = normalize(APPROVED_RUN, str(tmp_path / "out.jsonl"))
        ids = [e["event_id"] for e in events]
        assert len(ids) == len(set(ids))

    def test_commit_index_sequential(self, tmp_path):
        """commit_index must be 0-based sequential."""
        events = normalize(APPROVED_RUN, str(tmp_path / "out.jsonl"))
        for i, event in enumerate(events):
            assert event["commit_index"] == i

    def test_source_id_constant(self, tmp_path):
        """All events must have source_id = 'denial-review-workbench'."""
        events = normalize(APPROVED_RUN, str(tmp_path / "out.jsonl"))
        for event in events:
            assert event["source_id"] == SOURCE_ID

    def test_generic_payload_json_valid(self, tmp_path):
        """Generic events must have valid JSON in data.payload_json."""
        events = normalize(APPROVED_RUN, str(tmp_path / "out.jsonl"))
        for event in events:
            if event["payload"]["type"] == "Generic":
                pj = event["payload"]["data"]["payload_json"]
                parsed = json.loads(pj)
                assert isinstance(parsed, dict)


# ── 4. Rejection messages (full shell script) ────────────────────────

class TestRejection:
    def test_mock_run_rejected(self):
        """Mock runs must be rejected with the correct error message."""
        result = run_shell_script([MOCK_RUN])
        assert result.returncode != 0
        combined = (result.stderr + result.stdout).lower()
        assert "mock run" in combined

    def test_partial_run_rejected(self):
        """Partial runs must be rejected with the correct error message."""
        result = run_shell_script([PARTIAL_RUN])
        assert result.returncode != 0
        combined = (result.stderr + result.stdout).lower()
        assert "partial run" in combined

    def test_pending_approval_rejected(self):
        """Pending approval runs must be rejected."""
        result = run_shell_script([PENDING_RUN])
        assert result.returncode != 0
        combined = (result.stderr + result.stdout).lower()
        assert "pending approval" in combined

    def test_missing_run_rejected(self):
        """Missing run file must produce exit code 1."""
        result = run_shell_script(["nonexistent-run-id"])
        assert result.returncode == 1
        assert "not found" in result.stderr.lower()

    def test_missing_arg_rejected(self):
        """Missing argument must produce exit code 2."""
        result = run_shell_script([])
        assert result.returncode == 2


# ── 5. Source JSONL immutability ──────────────────────────────────────

class TestSourceImmutability:
    def test_source_unchanged_approved(self, tmp_path):
        """Source JSONL must not be modified during normalization."""
        source = RUNS_DIR / f"{APPROVED_RUN}.jsonl"
        before = source.read_bytes()
        normalize(APPROVED_RUN, str(tmp_path / "out.jsonl"))
        after = source.read_bytes()
        assert before == after

    def test_source_unchanged_escalated(self, tmp_path):
        """Source JSONL must not be modified for escalated runs."""
        source = RUNS_DIR / f"{ESCALATED_LEGACY_RUN}.jsonl"
        before = source.read_bytes()
        normalize(ESCALATED_LEGACY_RUN, str(tmp_path / "out.jsonl"))
        after = source.read_bytes()
        assert before == after
