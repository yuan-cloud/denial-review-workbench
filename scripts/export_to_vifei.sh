#!/bin/sh
# export_to_vifei.sh — normalize a workbench run JSONL and export as a
# Vifei share-safe bundle.
#
# Contract: docs/vifei-bridge-contract.md (bd-ky8.1)
# Bead:     bd-ky8.2
#
# Usage:
#   ./scripts/export_to_vifei.sh <run_id>
#   ./scripts/export_to_vifei.sh run-case-002-20260416075553

set -eu

# ── paths ──────────────────────────────────────────────────────────────
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
DATA_DIR="$REPO_ROOT/data"
OUT_DIR="$REPO_ROOT/out"
SOURCE_ID="denial-review-workbench"

# ── arg validation ─────────────────────────────────────────────────────
if [ $# -lt 1 ] || [ -z "$1" ]; then
    printf 'Error: missing run_id argument.\n' >&2
    printf 'Usage: %s <run_id>\n' "$0" >&2
    printf 'Example: %s run-case-002-20260416075553\n' "$0" >&2
    exit 2
fi

RUN_ID="$1"
RUN_FILE="$DATA_DIR/runs/$RUN_ID.jsonl"

if [ ! -f "$RUN_FILE" ]; then
    printf 'Error: run file not found: %s\n' "$RUN_FILE" >&2
    printf 'Check that the run_id is correct and the run exists.\n' >&2
    exit 1
fi

LINES_BEFORE=$(wc -l < "$RUN_FILE" | tr -d ' ')

# ── normalize ──────────────────────────────────────────────────────────
mkdir -p "$OUT_DIR"
NORMALIZED_FILE="$OUT_DIR/$RUN_ID.vifei.jsonl"

python3 - "$RUN_FILE" "$NORMALIZED_FILE" "$RUN_ID" "$SOURCE_ID" << 'NORMALIZE_EOF'
import json
import sys
from collections import OrderedDict
from datetime import datetime

run_file   = sys.argv[1]
out_file   = sys.argv[2]
run_id_arg = sys.argv[3]
source_id  = sys.argv[4]

# ── read source events ─────────────────────────────────────────────────
with open(run_file, "r", encoding="utf-8") as f:
    events = []
    for line in f:
        line = line.strip()
        if line:
            events.append(json.loads(line))

if not events:
    print(f"Error: {run_id_arg} has an empty JSONL file.", file=sys.stderr)
    sys.exit(1)

# ── validate: first event must be run_started ──────────────────────────
first_type = events[0].get("type", "")
if first_type != "run_started":
    print(
        f"Error: {run_id_arg} appears to be a mock run (missing run_started event).\n"
        f"Mock runs contain only terminal events and cannot produce a valid Vifei export.\n"
        f"Use a live pipeline run instead: ./bench.sh {run_id_arg.split('-')[1] + '-' + run_id_arg.split('-')[2] if len(run_id_arg.split('-')) >= 3 else run_id_arg}",
        file=sys.stderr,
    )
    sys.exit(1)

# ── validate: terminal event ───────────────────────────────────────────
terminal_type = events[-1].get("type", "")
terminal_payload = events[-1].get("payload", {})

is_approved = terminal_type == "approved"
is_escalated_explicit = terminal_type == "run_escalated"
is_escalated_legacy = (
    terminal_type == "analysis_completed"
    and terminal_payload.get("findings", {}).get("should_escalate") is True
)

if terminal_type == "approval_requested":
    print(
        f"Error: {run_id_arg} is pending approval (terminal: approval_requested).\n"
        f"Approve the run first, then re-export.",
        file=sys.stderr,
    )
    sys.exit(1)

if not (is_approved or is_escalated_explicit or is_escalated_legacy):
    print(
        f"Error: {run_id_arg} is a partial run ({len(events)} events, terminal: {terminal_type}).\n"
        f"Only complete runs (approved or escalated) can be exported.\n"
        f"Re-run the pipeline: ./bench.sh {run_id_arg.split('-')[1] + '-' + run_id_arg.split('-')[2] if len(run_id_arg.split('-')) >= 3 else run_id_arg}",
        file=sys.stderr,
    )
    sys.exit(1)

# ── extract run_id from run_started payload ────────────────────────────
run_id = events[0]["payload"].get("run_id", run_id_arg)

# ── timestamp conversion ───────────────────────────────────────────────
def ts_to_ns(ts_str: str) -> int:
    dt = datetime.fromisoformat(ts_str)
    epoch_s = int(dt.timestamp())
    epoch_us = dt.microsecond
    return epoch_s * 10**9 + epoch_us * 10**3

# ── event mapping ──────────────────────────────────────────────────────
def map_event(event: dict, index: int) -> dict:
    """Map a workbench event to a Vifei CommittedEvent dict."""
    etype = event["type"]
    payload_data = event.get("payload", {})
    timestamp_ns = ts_to_ns(event["timestamp"])

    # Determine payload variant and tier per contract section 4.6/4.7
    if etype == "run_started":
        case_id = payload_data.get("case_id", "")
        facility_id = payload_data.get("facility_id", "")
        payload = OrderedDict([
            ("type", "RunStart"),
            ("agent", source_id),
            ("args", f"{case_id} {facility_id}"),
        ])
        tier = "A"
    elif etype == "approved":
        payload = OrderedDict([
            ("type", "RunEnd"),
            ("exit_code", 0),
            ("reason", "approved"),
        ])
        tier = "A"
    elif etype == "run_escalated":
        reason = payload_data.get("reason", "escalated")
        payload = OrderedDict([
            ("type", "RunEnd"),
            ("reason", f"escalated: {reason}"),
        ])
        tier = "A"
    else:
        # Generic variant — Tier B per importer convention
        payload = OrderedDict([
            ("type", "Generic"),
            ("event_type", etype),
            ("data", OrderedDict([
                ("payload_json", json.dumps(payload_data, separators=(",", ":"))),
            ])),
        ])
        tier = "B"

    # Construct CommittedEvent in canonical field order
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

# ── normalize all events ───────────────────────────────────────────────
normalized = []
for i, event in enumerate(events):
    normalized.append(map_event(event, i))

# Append synthetic RunEnd for legacy escalated runs (contract section 4.7)
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
    synth["payload"] = OrderedDict([
        ("type", "RunEnd"),
        ("reason", "escalated: detected from analysis_completed"),
    ])
    synth["synthesized"] = True
    normalized.append(synth)

# ── write normalized JSONL ─────────────────────────────────────────────
with open(out_file, "w", encoding="utf-8") as f:
    for record in normalized:
        f.write(json.dumps(record, separators=(",", ":")) + "\n")

print(f"Normalized {len(normalized)} events → {out_file}")
NORMALIZE_EOF

# ── verify source JSONL unchanged ──────────────────────────────────────
LINES_AFTER=$(wc -l < "$RUN_FILE" | tr -d ' ')
if [ "$LINES_BEFORE" != "$LINES_AFTER" ]; then
    printf 'FATAL: source JSONL was modified during normalization!\n' >&2
    printf '  before: %s lines\n  after:  %s lines\n' "$LINES_BEFORE" "$LINES_AFTER" >&2
    exit 4
fi

# ── detect vifei binary ───────────────────────────────────────────────
VIFEI_BIN=""
if command -v vifei >/dev/null 2>&1; then
    VIFEI_BIN="vifei"
elif [ -x "/data/projects/PanopticonAliveca2.5/target/release/vifei" ]; then
    VIFEI_BIN="/data/projects/PanopticonAliveca2.5/target/release/vifei"
fi

if [ -z "$VIFEI_BIN" ]; then
    printf '\n'
    printf 'Warning: vifei binary not found in PATH or local build.\n'
    printf '\n'
    printf 'Build from the local Vifei repo:\n'
    printf '  cd /data/projects/PanopticonAliveca2.5\n'
    printf '  cargo build --release -p vifei-tui\n'
    printf '  cp target/release/vifei ~/.local/bin/\n'
    printf '\n'
    printf 'The normalized JSONL has been written to: %s\n' "$NORMALIZED_FILE"
    printf 'You can run the export manually once built:\n'
    printf '  vifei export %s --share-safe --output %s/%s.tar.zst\n' \
        "$NORMALIZED_FILE" "$OUT_DIR" "$RUN_ID"
    exit 1
fi

# ── run vifei export ───────────────────────────────────────────────────
BUNDLE_FILE="$OUT_DIR/$RUN_ID.tar.zst"
REFUSAL_FILE="$OUT_DIR/$RUN_ID.refusal.json"

printf 'Running: %s export %s --share-safe --output %s\n' \
    "$VIFEI_BIN" "$NORMALIZED_FILE" "$BUNDLE_FILE"

EXPORT_EXIT=0
"$VIFEI_BIN" export "$NORMALIZED_FILE" \
    --share-safe \
    --output "$BUNDLE_FILE" \
    --refusal-report "$REFUSAL_FILE" \
    || EXPORT_EXIT=$?

case $EXPORT_EXIT in
    0)
        printf '\nExport succeeded.\n'
        printf '  Bundle:     %s\n' "$BUNDLE_FILE"
        if [ -f "$BUNDLE_FILE" ]; then
            BUNDLE_SIZE=$(wc -c < "$BUNDLE_FILE" | tr -d ' ')
            printf '  Bundle size: %s bytes\n' "$BUNDLE_SIZE"
        fi
        printf '  Normalized: %s\n' "$NORMALIZED_FILE"
        # Clean up normalized file since bundle contains it
        rm -f "$NORMALIZED_FILE"
        ;;
    3)
        printf '\nExport refused — secrets detected.\n' >&2
        if [ -f "$REFUSAL_FILE" ]; then
            printf 'Refusal report: %s\n' "$REFUSAL_FILE" >&2
        fi
        printf 'Normalized JSONL retained: %s\n' "$NORMALIZED_FILE" >&2
        exit 3
        ;;
    *)
        printf '\nvifei export failed with exit code %d.\n' "$EXPORT_EXIT" >&2
        printf 'Normalized JSONL retained: %s\n' "$NORMALIZED_FILE" >&2
        exit "$EXPORT_EXIT"
        ;;
esac
