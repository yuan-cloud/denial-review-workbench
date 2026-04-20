#!/bin/sh
# demo.sh — run the full workbench → replay → Vifei proof arc.
#
# Composes the existing proof scripts into a single operator-friendly
# walkthrough. Each stage prints a header and stops on failure.
#
# Prerequisites:
#   - Backend running: cd backend && uvicorn app.main:app --port 8000
#   - ANTHROPIC_API_KEY set in the backend process environment
#   - vifei binary in PATH or built at the local repo path (optional;
#     stage 5 degrades gracefully if missing)
#
# Usage:
#   ./demo.sh              # default: case-002
#   ./demo.sh case-001     # specify a case
#
# Bead: bd-ky8.5

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
BACKEND="${BACKEND_URL:-http://localhost:8000}"
CASE_ID="${1:-case-002}"

# ── helpers ────────────────────────────────────────────────────────────

stage() {
    printf '\n══════════════════════════════════════════════════════════\n'
    printf '  Stage %s: %s\n' "$1" "$2"
    printf '══════════════════════════════════════════════════════════\n\n'
}

fail() {
    printf '\n✗ Stage %s failed: %s\n' "$1" "$2" >&2
    exit 1
}

# ── stage 1: health check ─────────────────────────────────────────────

stage 1 "Backend health check"

HEALTH=$(curl -sf "$BACKEND/health" 2>/dev/null) \
    || fail 1 "Backend not reachable at $BACKEND"
printf 'Backend: %s\nHealth:  %s\n' "$BACKEND" "$HEALTH"

# ── stage 2: run pipeline ─────────────────────────────────────────────

stage 2 "Run pipeline ($CASE_ID)"

RESPONSE=$(curl -sf -X POST "$BACKEND/runs" \
    -H "Content-Type: application/json" \
    -d "{\"case_id\": \"$CASE_ID\"}") \
    || fail 2 "POST /runs failed for $CASE_ID"

RUN_ID=$(printf '%s' "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['run_id'])")
STATUS=$(printf '%s' "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])")

printf 'Run ID:  %s\nStatus:  %s\n' "$RUN_ID" "$STATUS"

# ── stage 3: approve (if applicable) ──────────────────────────────────

stage 3 "Approve run"

if [ "$STATUS" = "escalated" ]; then
    printf 'Run is escalated — skipping approval (expected for case-003).\n'
elif [ "$STATUS" = "approved" ]; then
    printf 'Run is already approved.\n'
elif [ "$STATUS" = "approval_requested" ]; then
    APPROVE_RESPONSE=$(curl -sf -X POST "$BACKEND/runs/$RUN_ID/approve" \
        -H "Content-Type: application/json" \
        -d '{}') \
        || fail 3 "POST /runs/$RUN_ID/approve failed"
    APPROVE_STATUS=$(printf '%s' "$APPROVE_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])")
    printf 'Approved: %s → %s\n' "$RUN_ID" "$APPROVE_STATUS"
else
    fail 3 "Unexpected status after pipeline: $STATUS"
fi

# ── stage 4: replay integrity ─────────────────────────────────────────

stage 4 "Replay integrity check"

"$SCRIPT_DIR/scripts/replay_integrity.sh" \
    || fail 4 "Replay integrity check failed"

# ── stage 5: vifei export ─────────────────────────────────────────────

stage 5 "Vifei share-safe export ($RUN_ID)"

EXPORT_EXIT=0
"$SCRIPT_DIR/scripts/export_to_vifei.sh" "$RUN_ID" || EXPORT_EXIT=$?

if [ "$EXPORT_EXIT" -eq 0 ]; then
    printf '\nVifei export succeeded.\n'
elif [ "$EXPORT_EXIT" -eq 1 ]; then
    # Exit 1 from export script = vifei binary missing (graceful degradation)
    # or an expected rejection (mock/partial). Treat as a non-fatal warning
    # since the normalized JSONL was still produced.
    printf '\nVifei export completed with warning (exit %d).\n' "$EXPORT_EXIT"
    printf 'Check output above for details (binary missing or run class deferred).\n'
else
    fail 5 "Vifei export failed with exit code $EXPORT_EXIT"
fi

# ── summary ────────────────────────────────────────────────────────────

printf '\n══════════════════════════════════════════════════════════\n'
printf '  Demo complete\n'
printf '══════════════════════════════════════════════════════════\n\n'
printf 'Case:     %s\n' "$CASE_ID"
printf 'Run ID:   %s\n' "$RUN_ID"
printf 'Pipeline: %s\n' "$STATUS"
if [ "$EXPORT_EXIT" -eq 0 ]; then
    printf 'Export:   succeeded\n'
else
    printf 'Export:   warning (exit %d)\n' "$EXPORT_EXIT"
fi
