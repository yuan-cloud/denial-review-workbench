#!/usr/bin/env bash
# bench.sh — Time a full denial review pipeline run (3 model calls).
#
# Prerequisites:
#   - Backend running: cd backend && uvicorn app.main:app --port 8000
#   - ANTHROPIC_API_KEY set in the backend process environment
#
# Usage:
#   ./bench.sh              # default: case-002
#   ./bench.sh case-001     # specify a case

set -euo pipefail

BACKEND="${BACKEND_URL:-http://localhost:8000}"
CASE_ID="${1:-case-002}"

# Verify backend is reachable
if ! curl -sf "$BACKEND/health" > /dev/null 2>&1; then
  echo "ERROR: Backend not reachable at $BACKEND" >&2
  exit 1
fi

echo "Benchmarking full pipeline for $CASE_ID ..."
echo "Backend: $BACKEND"
echo ""

START=$(date +%s%N)

RESPONSE=$(curl -sf -X POST "$BACKEND/runs" \
  -H "Content-Type: application/json" \
  -d "{\"case_id\": \"$CASE_ID\"}")

END=$(date +%s%N)

ELAPSED_MS=$(( (END - START) / 1000000 ))
ELAPSED_S=$(awk "BEGIN {printf \"%.1f\", $ELAPSED_MS / 1000}")

STATUS=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])")
EVENTS=$(echo "$RESPONSE" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['events']))")

echo "Status:   $STATUS"
echo "Events:   $EVENTS"
echo "Wall time: ${ELAPSED_S}s"
