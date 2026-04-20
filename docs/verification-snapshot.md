# Verification Snapshot

**Date:** 2026-04-20
**Commit:** `35db02f` (main)
**Environment:** Ubuntu Linux 6.17, Python 3.13.7, Bun 1.2.x, Docker available
**Verified by:** VioletStone (automated agent)

---

## Test Suites

| Suite | Result | Detail |
|-------|--------|--------|
| Backend unit + routes | 140 passed | `python3 -m pytest backend/tests/ --ignore=test_integration.py` |
| Frontend unit | 99 passed (10 files) | `bun x vitest run` |
| Frontend typecheck | PASS | `bun run typecheck` (tsc --noEmit) |
| Frontend build | PASS | `bun run build` (5.77s, 180.93 KB gzipped JS) |

### Skipped / External Dependencies

- **Integration tests** (13 skipped): `test_integration.py` requires
  `ANTHROPIC_API_KEY` and a running backend. These tests call the live
  Anthropic API and are skipped when the key is unavailable.
- **Playwright e2e**: Requires both backend and frontend running with
  a live API key. Not run in this snapshot.
- **GitHub Actions CI**: Not running due to account billing issue
  (documented in `docs/ci-status.md`). The workflow YAML is valid;
  the jobs are blocked by GitHub's spending limit check, not by code
  failures.

---

## Health Check

```
$ curl http://localhost:8000/health
{"status":"ok","phase":"3"}
```

(Verified via Docker container `denial-review-workbench-test` on
port 8001. Same result from local uvicorn.)

---

## Security Grep

```
$ /usr/bin/grep -rE "PHI|patient_name|ssn|date_of_birth" \
    data/ backend/ frontend/src/ \
    --include="*.py" --include="*.tsx" --include="*.json" --include="*.md"
(empty — exit code 1, no matches)
```

No patient identifiers in any source file or synthetic case data.

---

## Replay Integrity

`scripts/replay_integrity.sh` replays `run-case-002-mock` 10 times:
- All 10 responses are byte-identical.
- `is_replay_response` is `true` on every response.
- JSONL line count is unchanged after all 10 replays.
- Zero events written during replay.

(Requires a running backend. Last verified during bd-2a5.7 landing.
Output format: `Replay N: completed in Xms, JSONL lines: 3 (unchanged)`.)

---

## Vifei Export

`scripts/export_to_vifei.sh` normalizes workbench JSONL into Vifei
CommittedEvent format and produces a share-safe bundle via
`vifei export --share-safe`.

Proven bundle hashes (from bd-ky8.7):
- Approved run (case-002): `20f96940ae97c23ad7b74f2f3793c0c775bb58ca29af7c418399d49ebfa3d569`
- Escalated run (case-003): `84e3417f93b43f149703e9f675f7b2315e06196820d524558a06730c53446a17`

(Requires `vifei` binary built from local repo.)

---

## Docker Container

```
$ docker build -t denial-review-workbench .
Successfully built (python:3.13-slim)

$ docker run -p 8001:8000 denial-review-workbench
$ curl http://localhost:8001/health
{"status":"ok","phase":"3"}

$ curl http://localhost:8001/cases
[{"case_id":"case-001",...},{"case_id":"case-002",...},{"case_id":"case-003",...}]
```

Container builds, starts, and serves health, cases, and seeded mock
runs correctly.

---

## Reproduction

To reproduce this snapshot:

```bash
git checkout 35db02f

# Backend tests
cd backend && python3 -m pytest tests/ --ignore=tests/test_integration.py -q

# Frontend tests
cd ../frontend && bun install && bun x vitest run && bun run typecheck && bun run build

# Security grep
/usr/bin/grep -rE "PHI|patient_name|ssn|date_of_birth" \
    data/ backend/ frontend/src/ \
    --include="*.py" --include="*.tsx" --include="*.json" --include="*.md"

# Docker
cd .. && docker build -t denial-review-workbench . && \
docker run -d -p 8001:8000 denial-review-workbench && \
sleep 3 && curl http://localhost:8001/health
```

---

## What This Snapshot Does Not Cover

- Live pipeline execution with real Anthropic API calls (requires key).
- Hosted deployment verification (not yet deployed).
- Browser-based e2e testing (requires Playwright + both services).
- Real-world case data accuracy (synthetic data only).

These gaps are documented in `docs/production-readiness.md`.
