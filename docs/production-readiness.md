# Production Readiness

Boundary document separating what is real now, what is not yet
production-ready, and what each next tier of readiness requires.

---

## Current State: Functional Prototype

The workbench is a working end-to-end prototype with synthetic data.
It demonstrates the full workflow (extract, analyze, draft, approve,
replay, export) and passes its own test and proof suites. It is not
production software.

### What is real

**Human-in-the-loop approval gate.** Every recommendation requires
explicit human approval. The `approved` event records the exact text
the reviewer signed off on. Escalated cases block the approval flow
at the API layer (409 on approve attempts).

**Append-only audit trail.** Every pipeline stage emits a typed,
timestamped event to a JSONL file. Events are never rewritten. The
log is the authoritative source of truth for what happened in a run.

**Deterministic replay.** Any completed run can be reconstructed from
its JSONL log without calling the model. `replay_integrity.sh`
verifies this with 10 sequential replays (identical output, zero JSONL
growth).

**Share-safe evidence export.** `export_to_vifei.sh` normalizes
workbench events into Vifei's CommittedEvent schema and produces a
deterministic tar.zst bundle with BLAKE3 manifests and secret scanning.

**Test coverage.** 124 backend tests (routes, pipeline, replay, event
store, policy search, export normalization). 99 frontend tests (pages,
components, API client). CI runs backend unit, frontend unit/typecheck/
build, live integration, Playwright e2e, and security grep.

**Containerized backend.** Dockerfile builds and passes health check,
case listing, and mock run verification locally.

### What is not production-ready

**Single-worker in-memory state.** `state.py` stores run state in a
module-level Python dict. This is not thread-safe, not shared across
workers, and not persisted. A server restart loses all in-memory state
(the GET /runs fallback reconstructs from JSONL, but this is a
recovery path, not a design choice for production traffic).

**No authentication or authorization.** The backend has no auth layer.
Anyone who can reach the URL can run pipelines, approve runs, and
read case data. Preview deployments rely on platform-level access
controls.

**No production observability.** Logging is structured (`logging`
module, no `print()`), but there is no log aggregation, no metrics,
no alerting, no distributed tracing, and no model evaluation pipeline.
Errors are visible only in uvicorn stdout.

**No deployment hardening.** The Dockerfile exists but there is no
health-check-based restart policy, no graceful shutdown handling, no
rate limiting, and no request size limits. The backend trusts all
input from the frontend without application-level validation beyond
Pydantic schema checks.

**CI signal depends on external API.** The integration test and
Playwright jobs require `ANTHROPIC_API_KEY` as a GitHub secret. If
the secret is unavailable or the Anthropic API is down, those jobs
are skipped. The CI pipeline does not currently achieve a fully green
signal without the external dependency.

**Synthetic data only.** All case packets are fabricated. The pipeline
has not been tested against real denial letters, real clinical notes,
or real payer policies. Model prompts are tuned for the synthetic
cases and may need adjustment for real-world variation.

---

## Pilot-Ready Next Steps

What would be required before a controlled pilot with real operators
and non-production data.

| Gap | Required Change | Effort |
|-----|----------------|--------|
| Authentication | Add API key or session-based auth to all routes | Small |
| Persistent state | Replace `state.py` with SQLite or Postgres for run state | Medium |
| CORS hardening | Restrict to specific origin instead of single env var | Small |
| Rate limiting | Add per-IP or per-key rate limits on POST /runs | Small |
| Health monitoring | Health check polling + alerting on failure | Small |
| Log aggregation | Route uvicorn logs to external service | Small |
| Real case data | Test with redacted real-world denial packets | Medium |
| Prompt tuning | Validate model accuracy against real case variation | Medium |

---

## Enterprise-Ready Next Steps

What would be required for production deployment in a regulated
healthcare environment.

| Gap | Required Change | Effort |
|-----|----------------|--------|
| RBAC | Role-based access: reviewer, supervisor, auditor | Large |
| Multi-worker | Replace in-memory state with shared persistence | Medium |
| Audit compliance | Map JSONL events to regulatory audit requirements | Large |
| PHI handling | Define data classification, encryption at rest, access logging | Large |
| Model evaluation | Build eval suite against labeled case outcomes | Large |
| SLA monitoring | Latency, error rate, and availability dashboards | Medium |
| Disaster recovery | Backup/restore for JSONL event store and run state | Medium |
| Pen testing | Third-party security assessment of deployed system | Large |
| Compliance review | Legal review of HIPAA/HITECH applicability | Large |

---

## What This Document Is Not

This is not a roadmap or a product plan. It is a boundary statement
that says: the prototype works for what it demonstrates, and here are
the specific gaps between "works in demo" and "works in production."
The gaps are real and deliberately unsolved. Solving them is a
different project with different constraints.
