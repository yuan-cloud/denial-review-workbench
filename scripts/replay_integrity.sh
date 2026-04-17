#!/bin/sh
# replay_integrity.sh — verify that replaying an approved run is read-only.
#
# Usage:
#   ./scripts/replay_integrity.sh
#   BACKEND_URL=http://localhost:8000 ./scripts/replay_integrity.sh

set -eu

BACKEND_URL="${BACKEND_URL:-http://localhost:8000}"
RUN_ID="run-case-002-mock"
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
RUN_LOG="$REPO_ROOT/data/runs/$RUN_ID.jsonl"
TMPDIR_PATH="${TMPDIR:-/tmp}"

fail() {
    printf '%s\n' "ERROR: $*" >&2
    exit 1
}

require_cmd() {
    command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

count_lines() {
    wc -l < "$1" | tr -d ' '
}

require_cmd curl
require_cmd jq
require_cmd python3

[ -f "$RUN_LOG" ] || fail "Missing JSONL audit log: $RUN_LOG"

health_file=$(mktemp "$TMPDIR_PATH/replay-integrity-health.XXXXXX")
run_file=$(mktemp "$TMPDIR_PATH/replay-integrity-run.XXXXXX")
replay_file=$(mktemp "$TMPDIR_PATH/replay-integrity-replay.XXXXXX")
baseline_file=$(mktemp "$TMPDIR_PATH/replay-integrity-baseline.XXXXXX")
sorted_file=$(mktemp "$TMPDIR_PATH/replay-integrity-sorted.XXXXXX")

cleanup() {
    rm -f "$health_file" "$run_file" "$replay_file" "$baseline_file" "$sorted_file"
}
trap cleanup EXIT INT TERM

health_code=$(curl -sS -o "$health_file" -w "%{http_code}" "$BACKEND_URL/health")
[ "$health_code" = "200" ] || fail "Health endpoint returned HTTP $health_code"
jq -e '.status == "ok"' "$health_file" >/dev/null \
    || fail "Health endpoint did not return status=ok"

run_code=$(curl -sS -o "$run_file" -w "%{http_code}" "$BACKEND_URL/runs/$RUN_ID")
[ "$run_code" = "200" ] || fail "GET /runs/$RUN_ID returned HTTP $run_code"
jq -e --arg run_id "$RUN_ID" '.run_id == $run_id' "$run_file" >/dev/null \
    || fail "GET /runs/$RUN_ID returned unexpected run_id"

replay_code=$(curl -sS -o "$replay_file" -w "%{http_code}" "$BACKEND_URL/runs/$RUN_ID/replay")
[ "$replay_code" = "200" ] || fail "GET /runs/$RUN_ID/replay returned HTTP $replay_code"

replay_status=$(jq -r '.status' "$replay_file")
if [ "$replay_status" != "approved" ]; then
    approve_code=$(curl -sS -o "$replay_file" -w "%{http_code}" \
        -X POST \
        -H "Content-Type: application/json" \
        -d '{}' \
        "$BACKEND_URL/runs/$RUN_ID/approve")
    [ "$approve_code" = "200" ] || fail "POST /runs/$RUN_ID/approve returned HTTP $approve_code"

    replay_code=$(curl -sS -o "$replay_file" -w "%{http_code}" "$BACKEND_URL/runs/$RUN_ID/replay")
    [ "$replay_code" = "200" ] || fail "GET /runs/$RUN_ID/replay after approve returned HTTP $replay_code"
    replay_status=$(jq -r '.status' "$replay_file")
fi

[ "$replay_status" = "approved" ] || fail "Replay state is not approved"

baseline_lines=$(count_lines "$RUN_LOG")

i=1
while [ "$i" -le 10 ]; do
    start_ts=$(python3 -c "import time; print(int(time.time() * 1000))")
    http_code=$(curl -sS -o "$replay_file" -w "%{http_code}" "$BACKEND_URL/runs/$RUN_ID/replay")
    end_ts=$(python3 -c "import time; print(int(time.time() * 1000))")

    [ "$http_code" = "200" ] || fail "Replay $i returned HTTP $http_code"

    jq -e --arg run_id "$RUN_ID" '
        .run_id == $run_id and
        .status == "approved" and
        .is_replay_response == true and
        (.case_id | type == "string") and
        (.facility_id | type == "string") and
        (.documents | type == "array") and
        (.retrieved_policy_sections | type == "array") and
        (.events | type == "array") and
        (.recommendation | type == "object")
    ' "$replay_file" >/dev/null || fail "Replay $i returned an invalid RunStatus payload"

    jq -S . "$replay_file" > "$sorted_file"
    if [ "$i" -eq 1 ]; then
        cp "$sorted_file" "$baseline_file"
    else
        cmp -s "$baseline_file" "$sorted_file" \
            || fail "Replay $i response differed from the baseline replay response"
    fi

    current_lines=$(count_lines "$RUN_LOG")
    [ "$current_lines" = "$baseline_lines" ] \
        || fail "Replay $i changed JSONL line count: expected $baseline_lines, got $current_lines"

    elapsed_ms=$((end_ts - start_ts))
    printf 'Replay %d: completed in %dms, JSONL lines: %s (unchanged) ✓\n' \
        "$i" "$elapsed_ms" "$baseline_lines"
    i=$((i + 1))
done

printf '%s\n' "10/10 replays verified. Zero events written during replay."
