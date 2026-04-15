# Denial Review Workbench

**Auditable human-in-the-loop denial review for document-heavy healthcare ops**

---

## Overview

Denial Review Workbench is a thin, operator-ready workflow tool for reviewing insurance authorization denials. It ingests a case packet — denial letter, auth request, clinical notes — runs a structured AI pipeline to extract facts, identify missing documentation, and draft a next action, then routes the result to a human reviewer for approval or escalation. Every decision is logged to an append-only JSONL event store and can be replayed deterministically without touching the model.

Built as a 48-hour sprint prototype demonstrating production-grade agentic workflow architecture: structured evidence extraction, policy-grounded gap analysis, auditable approval chain, and read-only replay.

---

## Demo Arc

A caseworker opens case-002 — a skilled nursing authorization denied for insufficient documentation. The left panel loads the denial letter, auth request, clinical notes, and the matching policy excerpt. They click **Run Review**.

The pipeline extracts facts from the denial packet, retrieves the relevant policy sections by keyword match, identifies two missing items — signed physician order and progress notes within 30 days — and drafts a next action. Confidence renders as a color-banded percentage. Each evidence reference is clickable and highlights the source quote in the document panel.

The reviewer edits one line of the draft, clicks **Approve**, and the run transitions to `approved`. The approved event carries `final_recommendation` — exactly what the human signed off on — as a first-class audit artifact.

Opening Run History shows the full event timeline. Clicking **Replay** reconstructs the complete run state from the JSONL log without calling the model. An amber **REPLAY** badge confirms the reconstruction is read-only.

case-003 demonstrates the escalation branch: conflicting denial reasons trigger `should_escalate: true`, the draft and approve UI are suppressed, and the center panel shows an escalation notice. The server returns 409 on any approve attempt — the guard is enforced at the API layer, not just the UI.

---

## Screenshots

| Panel | Description |
|-------|-------------|
| **Case List** | Three synthetic cases with distinct paths: happy path, missing docs, escalation |
| **Left Panel** | Denial letter, auth request, clinical notes, policy excerpt, policy pack label |
| **Fact Cards** | Extracted payer, service, denial reason, confidence band, clickable evidence refs |
| **Gap Analysis** | Requirement / Present or Missing / Evidence — rendered from `required_documents`, not `missing_items` |
| **Recommendation** | Editable draft text, Approve button, escalation notice branch |
| **Run History** | Event timeline with REPLAY badge on reconstruction |

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Three-Panel UI                        │
│  Documents + Policy  │  Facts + Gap + Draft  │  History  │
└──────────────────────┴───────────────────────┴───────────┘
                              │
                    POST /runs (sync)
                              │
┌─────────────────────────────────────────────────────────┐
│                   FastAPI Backend                        │
│                                                          │
│  extract_facts → policy_search → analyze_gap →          │
│  draft_next_action (if not escalated)                    │
│                                                          │
│  All calls through anthropic_client.py (single entry)   │
│  At most 3 model calls per run                           │
└──────────────────────────────┬──────────────────────────┘
                               │
              ┌────────────────┴────────────────┐
              │         JSONL Event Store        │
              │  data/runs/{run_id}.jsonl        │
              │  Append-only. Never rewritten.   │
              │  Full payloads for replay.       │
              └────────────────┬────────────────┘
                               │
              ┌────────────────┴────────────────┐
              │            replay.py             │
              │  Read-only JSONL reconstruction  │
              │  Never calls model providers     │
              │  Never writes new events         │
              └─────────────────────────────────┘
```

**Three model calls, strict order:**
1. `extract_facts` — payer, service, denial reason, confidence, evidence refs
2. `analyze_gap` — missing items, conflicts, escalation decision
3. `draft_next_action` — only when `should_escalate` is false

**V1 run statuses:** `approval_requested` → `approved` or `escalated`

**Replay invariant:** The `approved` event carries `final_recommendation` — exactly what the human signed off on. Replay reconstructs this from the JSONL log without any model call.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | FastAPI, Python 3.11+, Pydantic v2, uvicorn |
| Frontend | React 18, TypeScript, Vite, Bun |
| Model | Anthropic claude-sonnet-4-6 |
| Storage | Append-only JSONL event log |
| Schemas | Pydantic (backend) mirrored to TypeScript interfaces (frontend) |

---

## Running Locally

**Prerequisites:** Python 3.11+, Bun, Anthropic API key

```bash
git clone https://github.com/yuan-cloud/denial-review-workbench
cd denial-review-workbench
```

**Backend:**

```bash
export ANTHROPIC_API_KEY=sk-ant-...
cd backend
pip install fastapi uvicorn anthropic pydantic
uvicorn app.main:app --reload --port 8000
```

Verify: `curl http://localhost:8000/health`
Expected: `{"status":"ok","phase":"3"}`

**Frontend:**

```bash
cd frontend
bun install
bun run dev
```

Opens at `http://localhost:5274`

**Environment variables:**

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | — | Required for live pipeline |
| `VITE_PORT` | `5274` | Frontend port |
| `FRONTEND_URL` | `http://localhost:5274` | CORS allowed origin |
| `VITE_API_BASE` | `http://localhost:8000` | Backend URL for frontend |

---

## Case Structure

Three synthetic cases cover the full decision space:

| Case | Path | Expected outcome |
|------|------|-----------------|
| `case-001` | Happy path — all docs present | `approve_or_proceed`, confidence ≥ 0.85 |
| `case-002` | Missing docs — main demo case | `request_missing_documents`, 2 missing items |
| `case-003` | Conflicting denial reasons | `escalated`, recommendation null |

Policy files live in `data/policies/`. Swapping policy packs and approval rules is how this scales across facilities — the orchestration spine stays the same.

---

## Demo Fallback

If anything breaks during a live demo:

```
GET /demo-fallback/case-002
```

Returns the saved mock run from `data/cases/case-002/saved_demo_run.json`. Continue the demo from the Recommendation or Run History panel.

---

## What This Is Not

- Not a platform
- Not an agent control room
- Not HIPAA compliant
- Not "denial management" (implies broader product scope)
- Not the Agent Flywheel product

One thin, legible, operator-ready workflow artifact. One flow. One knife.

---

## Build Methodology

Built using the [Agent Flywheel](https://agent-flywheel.com) multi-agent development environment: NTM for agent orchestration, Agent Mail for coordination, Beads for task tracking, CASS for session search, and named Claude Code + Codex agents working in parallel from a shared AGENTS.md operating contract on a Contabo VPS.

The build demonstrates that a production-grade agentic workflow with full audit trail, human-in-the-loop approval, and deterministic replay can be specified, scaffolded, and verified in a 48-hour sprint when the agent operating environment is right.

---

## Security

```bash
grep -r "PHI\|patient_name\|ssn\|date_of_birth" \
  data/ backend/ frontend/src/ \
  --include="*.py" --include="*.tsx" \
  --include="*.json" --include="*.md"
```

Returns empty. No patient identifiers in any synthetic case data.
