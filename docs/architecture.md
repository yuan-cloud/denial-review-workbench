# Architecture

Technical architecture of the Denial Review Workbench as implemented.
Grounded in the current codebase, not aspirational planning documents.

---

## System Boundaries

```
┌─────────────────────────────────────────────────────────────┐
│  Frontend (React 18 + TypeScript + Vite)                    │
│  Bun package manager · port 5274 (strictPort)               │
│                                                              │
│  App.tsx ── CaseListPage ── RunPage                          │
│             └ POST /runs     └ 3-panel layout                │
│                               ├ DocumentPanel                │
│                               ├ FactCards + GapAnalysis      │
│                               │   + RecommendationEditor     │
│                               └ RunHistoryPanel              │
└───────────────────────────────┬─────────────────────────────┘
                                │ HTTP (JSON)
┌───────────────────────────────┴─────────────────────────────┐
│  Backend (FastAPI + uvicorn, single worker)                  │
│  Python 3.11+ · port 8000                                    │
│                                                              │
│  main.py ── pipeline.py ── providers/anthropic_client.py     │
│  │           │                └ Anthropic SDK (claude-sonnet-4-6)
│  │           ├ policy_search.py (keyword match, no model)    │
│  │           └ event_store.py (JSONL append)                 │
│  ├ replay.py (read-only JSONL reconstruction)                │
│  └ state.py (in-memory dict, not thread-safe)                │
└───────────────────────────────┬─────────────────────────────┘
                                │
┌───────────────────────────────┴─────────────────────────────┐
│  JSONL Event Store                                           │
│  data/runs/{run_id}.jsonl                                    │
│  Append-only. Never rewritten. One JSON object per line.     │
│  Full payloads for replay. Authoritative source of truth.    │
└─────────────────────────────────────────────────────────────┘
```

The frontend communicates with the backend via JSON over HTTP. There is no
WebSocket, SSE, or polling. Every pipeline run is synchronous: POST /runs
blocks until all model calls complete and returns the full RunStatus.

---

## Request and Data Flow

### Forward path: case selection through approval

```
CaseListPage                  Backend                          Storage
─────────────                 ───────                          ───────
GET /cases              →  main.py:109                         (in-memory)
  ← CaseListItem[]

POST /runs {case_id}    →  main.py:114
                           pipeline.run_pipeline()
                             1. load documents from data/cases/{case_id}/
                             2. extract_facts(documents)         → call_model
                                append "facts_extracted" event    → JSONL
                             3. policy_search(facility_id)       → filesystem
                                append "policy_retrieved" event   → JSONL
                             4. analyze_gap(facts, policy, docs) → call_model
                                append "analysis_completed" event → JSONL
                             5. if NOT escalated:
                                  draft_next_action(findings)    → call_model
                                  append "draft_generated" event → JSONL
                                  status = "approval_requested"
                                else:
                                  status = "escalated"
                           state.update(run_id, result)
  ← RunStatus (201)

RunPage renders 3-panel UI:
  DocumentPanel ← documents + retrieved_policy_sections
  FactCards     ← facts
  GapAnalysis   ← findings
  RecEditor     ← recommendation (null if escalated)
  RunHistory    ← events

POST /runs/{id}/approve →  main.py:142
  {draft_text}              guards: 404 if missing, 409 if escalated/approved
                            JSONL guard: checks persisted events (survives restart)
                            append "approved" event with final_recommendation
                            state.update(run_id, ...)
  ← RunStatus
```

### Replay path: deterministic reconstruction

```
GET /runs/{id}/replay   →  main.py:207
                            replay.replay_run(run_id)
                              read data/runs/{run_id}.jsonl
                              iterate events, rebuild RunStatus fields
                              resolve_status() from reconstructed state
                              set is_replay_response = True
  ← RunStatus (identical to live, except is_replay_response=True)
```

Replay reads the JSONL log. It never calls the Anthropic API, never writes
events, and never modifies in-memory state. The `is_replay_response` flag
is response metadata only; it is never persisted to JSONL or stored in
state.py.

### GET /runs/{id} fallback

When in-memory state is missing (after server restart), GET /runs/{id}
falls back to `replay_run(run_id)` but returns the result with
`is_replay_response: False`. This is because a GET /runs request is not
a user-initiated replay.

---

## Event Model

Each pipeline stage appends one event to `data/runs/{run_id}.jsonl`.
Events are never rewritten or deleted.

### Event structure

```json
{"type": "facts_extracted", "timestamp": "2026-04-16T08:18:23Z", "payload": {...}}
```

Every event carries the full domain object in its payload. This makes each
JSONL file self-contained: replay reconstructs complete UI state from the
log alone, with no external lookups.

### Event types (v1)

| Type | Payload | When |
|------|---------|------|
| `run_started` | run_id, case_id, facility_id | Always first |
| `documents_loaded` | documents[] (full text) | After document read |
| `facts_extracted` | facts (CaseFacts) | After model call 1 |
| `policy_retrieved` | retrieved_policy_sections[] | After policy search |
| `analysis_completed` | findings (CaseFindings) | After model call 2 |
| `draft_generated` | recommendation (Recommendation) | After model call 3 (non-escalation only) |
| `approval_requested` | {} | End of pipeline, awaiting human approval |
| `approved` | final_recommendation | After human approval |

The `approved` event carries `final_recommendation`: the human-reviewed,
potentially edited draft text. This is the audit artifact proving what the
human signed off on.

`is_replay_response` is never an event type and is never persisted. It is
set on response objects only.

---

## Module Inventory

### Backend (`backend/app/`)

| Module | Lines | Responsibility |
|--------|-------|---------------|
| `main.py` | 259 | FastAPI app, routes, lifespan hook, CORS |
| `pipeline.py` | 282 | Three-stage model orchestration, event emission |
| `schemas.py` | 75 | Pydantic models (RunStatus, CaseFacts, etc.) |
| `event_store.py` | 52 | JSONL append/read, directory bootstrap |
| `replay.py` | 79 | Read-only JSONL reconstruction |
| `policy_search.py` | 71 | Keyword-based policy retrieval from markdown |
| `state.py` | 18 | In-memory run state dict (seed/get/update) |
| `errors.py` | 6 | PipelineError exception |
| `providers/anthropic_client.py` | 58 | Anthropic SDK wrapper, error translation |

### Frontend (`frontend/src/`)

| Module | Lines | Responsibility |
|--------|-------|---------------|
| `App.tsx` | 29 | View union navigation (no React Router) |
| `api.ts` | 138 | Typed HTTP client, ApiError, VITE_API_BASE resolution |
| `types.ts` | 62 | TypeScript interfaces mirroring Pydantic models |
| `pages/CaseListPage.tsx` | 193 | Case queue table, run initiation |
| `pages/RunPage.tsx` | 544 | Three-panel review workspace |
| `components/DocumentPanel.tsx` | 244 | Document viewer with evidence highlighting |
| `components/FactCards.tsx` | 127 | Extracted facts display |
| `components/GapAnalysisTable.tsx` | 181 | Missing items and conflicts table |
| `components/RecommendationEditor.tsx` | 184 | Draft editor and approval controls |
| `components/RunHistoryPanel.tsx` | 266 | Event timeline and replay trigger |
| `ui/workbench.tsx` | 655 | UI primitive library (palette, buttons, panels, notices) |

---

## API Routes

| Method | Path | Status | Purpose |
|--------|------|--------|---------|
| GET | `/health` | 200 | Returns `{"status":"ok","phase":"3"}` |
| GET | `/cases` | 200 | Lists 3 synthetic cases with metadata |
| POST | `/runs` | 201 | Runs full pipeline for a case_id |
| GET | `/runs/{run_id}` | 200 | Returns run state (falls back to replay after restart) |
| POST | `/runs/{run_id}/approve` | 200 | Approves a run with optional edited draft_text |
| GET | `/runs/{run_id}/replay` | 200 | Forces JSONL-based reconstruction |
| GET | `/demo-fallback/{case_id}` | 200 | Returns saved mock run for offline inspection |

---

## Schema Mirroring

Backend Pydantic models in `schemas.py` are manually mirrored to TypeScript
interfaces in `types.ts`. There is no code generation; changes to one side
require manual updates to the other.

Key types shared across the boundary:

| Type | Backend | Frontend |
|------|---------|----------|
| Run state | `RunStatus` | `RunStatus` |
| Extracted facts | `CaseFacts` | `CaseFacts` |
| Gap analysis | `CaseFindings` | `CaseFindings` |
| Draft action | `Recommendation` | `Recommendation` |
| Source reference | `EvidenceRef` | `EvidenceRef` |
| Audit event | `RunEvent` | `RunEvent` |
| Case metadata | `CaseListItem` | `CaseListItem` |

`RunStatus` is the primary response type. It carries the full run state:
documents, facts, findings, recommendation, events, and status. The
frontend renders all panels from a single RunStatus object.

---

## Operational Constraints

### Single-worker uvicorn

`state.py` stores run state in a module-level Python dict. This dict is
not thread-safe and not shared across workers. The backend must run as a
single uvicorn worker. `uvicorn --reload` is used during development;
each reload wipes in-memory state.

### Lifespan hook

To survive reloads, the FastAPI lifespan hook seeds in-memory state from
`mock_run.json` files on every startup (`main.py:82-91`). These seeded
mock runs (IDs like `run-case-002-mock`) are fixed snapshots for offline
exploration, not live pipeline output.

### Path resolution

All backend modules that touch the filesystem compute `DATA_DIR` from
the module's own path:

```python
REPO_ROOT = Path(__file__).resolve().parent.parent.parent
DATA_DIR = REPO_ROOT / "data"
```

This is required because uvicorn runs from `backend/`, so bare relative
paths resolve incorrectly. `DATA_DIR` is used consistently in main.py,
pipeline.py, policy_search.py, and event_store.py.

### CORS and port binding

The frontend port (`VITE_PORT`, default 5274) and the CORS origin
(`FRONTEND_URL`, default `http://localhost:5274`) must agree. If they
diverge, every browser API call fails silently with a CORS error.
`vite.config.ts` uses `strictPort: true` to fail loudly rather than
incrementing the port.

---

## Test Infrastructure

| Suite | Location | Count | Coverage |
|-------|----------|-------|----------|
| Backend unit | `backend/tests/test_pipeline.py` | 45 | Document loading, fact extraction, recommendation logic |
| Backend routes | `backend/tests/test_routes.py` | 26 | All API endpoints, guards, error responses |
| Backend replay | `backend/tests/test_replay.py` | 11 | Read-only reconstruction integrity |
| Backend integration | `backend/tests/test_integration.py` | 15 | End-to-end pipeline flows (live API skipped in CI) |
| Backend policy | `backend/tests/test_policy_search.py` | 15 | Policy retrieval and matching |
| Backend event store | `backend/tests/test_harness.py` + `test_state.py` | 12 | JSONL persistence, state transitions |
| Frontend unit | `frontend/src/**/*.test.tsx` | 96 | All pages, components, API client |

Scripts:
- `bench.sh`: Times full pipeline for a specified case
- `scripts/replay_integrity.sh`: Verifies 10 sequential replays produce identical output with zero JSONL growth

---

## Data Layout

```
data/
  cases/
    case-001/           # Happy path: all docs present
    case-002/           # Missing docs: main demo case
    case-003/           # Conflicting denial reasons: escalation
      denial-letter.md  # Payer's denial letter
      auth-request.md   # Provider's authorization request
      notes.md          # Clinical notes
      meta.json         # {facility_id, scenario_title, expected_path_type}
      expected.json     # Expected analysis outcome
      mock_run.json     # Seeded mock run for offline exploration
  policies/
    facility-a.md       # Required docs, denial basis, approval threshold
    facility-b.md
  runs/
    {run_id}.jsonl      # One file per run, append-only
```

Each case packet contains three clinical documents (denial letter,
authorization request, clinical notes), case metadata, expected outcome,
and a mock run snapshot. Policy files are matched to cases by `facility_id`
from `meta.json`.

The filename-to-document-type mapping in `pipeline.py` includes one
semantic rename: `"notes"` maps to `"clinical_notes"`. This is not
derivable by pattern; it is a hardcoded constant (`FILENAME_TO_TYPE`).
