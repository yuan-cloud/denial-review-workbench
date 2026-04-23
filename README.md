# Denial Review Workbench

**Auditable human-in-the-loop denial review for document-heavy healthcare ops**

🔗 Live demo: https://workbench.yuanliu.dev
Try `case-002` for the main demo arc (missing documents path and approval flow).

Denial review pipelines process a full case — extraction, gap analysis, draft — typically in under 15 seconds. Replay any approved run: status is preserved, no model call is made, and the JSONL log is unchanged. Verify it yourself: `./bench.sh` (pipeline), `./scripts/replay_integrity.sh` (replay invariant), and `./scripts/export_to_vifei.sh` (share-safe Vifei export)

---

## Overview

Denial Review Workbench is a thin, operator-ready workflow tool for reviewing insurance authorization denials. It ingests a case packet — denial letter, auth request, clinical notes — runs a structured AI pipeline to extract facts, identify missing documentation, and draft a next action, then routes the result to a human reviewer for approval or escalation. Every decision is logged to an append-only JSONL event store and can be replayed deterministically without touching the model.

---

## Demo Arc

A caseworker opens case-002 — a skilled nursing authorization denied for insufficient documentation. The left panel loads the denial letter, auth request, clinical notes, and the matching policy excerpt. They click **Run Review**.

The pipeline extracts facts from the denial packet, retrieves the relevant policy sections by keyword match, identifies two missing items — signed physician order and progress notes within 30 days — and drafts a next action. Confidence renders as a color-banded percentage. Each evidence reference is clickable and highlights the source quote in the document panel.

The reviewer edits one line of the draft, clicks **Approve**, and the run transitions to `approved`. The approved event carries `final_recommendation` — exactly what the human signed off on — as a first-class audit artifact.

Opening Run History shows the full event timeline. Clicking **Replay** reconstructs the complete run state from the JSONL log without calling the model. An amber **REPLAY** badge confirms the reconstruction is read-only.

case-003 demonstrates the escalation branch: conflicting denial reasons trigger `should_escalate: true`, the draft and approve UI are suppressed, and the center panel shows an escalation notice. The server returns 409 on any approve attempt — the guard is enforced at the API layer, not just the UI.

---

## Screenshots

### Case Queue
The triage queue lists all cases with facility, scenario, expected path, and summary columns. Reviewers pick a case and click **Run Review** to start the pipeline.

![Triage queue showing three synthetic cases — case-001 (approval path), case-002 (missing documents), case-003 (escalation) — with facility, scenario, path, and summary columns](docs/screenshots/01-case-list.png)

### Run Results — Three-Panel Layout
A persistent summary header shows status, facility, confidence, missing-item count, and start time. Left panel: denial letter, auth request, clinical notes, and retrieved policy excerpts. Center panel: extracted facts with color-banded confidence, gap analysis table, and editable recommendation. Right panel: event timeline.

![Three-panel run results for case-002 showing Approval Requested status at 95% confidence, documents with policy excerpts on the left, extracted facts and gap analysis in the center, and the full event timeline on the right](docs/screenshots/02-run-results.png)

### Evidence Highlight
Clicking an evidence reference scrolls to the cited document and highlights the source quote with a yellow marker. An "Evidence focus" badge on the document confirms which source is active.

![Evidence highlight view with the Denial Letter section active, showing a yellow-highlighted quote and an Evidence Focus badge on the document card](docs/screenshots/03-evidence-highlight.png)

### After Approve
The reviewer edits the draft text and clicks **Approve**. The status transitions to `approved`, the textarea locks into a read-only "Final Text" display, and the event timeline gains an "Approved" entry.

![Approved state for case-002 with green Approved badge, locked final recommendation text, and the complete event timeline showing all pipeline stages through approval](docs/screenshots/04-after-approve.png)

### Replay
Clicking **Replay** reconstructs the full run state from the JSONL event log — no model call is made. An amber REPLAY badge confirms the view is a read-only reconstruction.

![Replay mode for case-002 showing the same approved state reconstructed from the JSONL audit log, with an amber REPLAY badge in the run history panel](docs/screenshots/05-replay.png)

### Escalation (case-003)
Conflicting denial reasons trigger `should_escalate: true`. A red banner blocks the workflow — no draft is generated, no Approve button is shown. The server enforces this with a 409 guard on the approve endpoint.

![Escalation view for case-003 with a red Case Escalated — Workflow Blocked banner, suppressed approval controls, 72% confidence, and 1 conflict flagged in the gap analysis](docs/screenshots/06-escalation.png)

---

## Architecture

```mermaid
flowchart TD
    UI["Three-Panel UI<br/>Documents + Policy · Facts + Gap + Draft · History"]
    POST["POST /runs (sync)"]

    subgraph BACKEND["FastAPI Backend<br/>At most 3 model calls per run"]
        EF["extract_facts<br/>model call 1"]
        PS["policy_search"]
        AG["analyze_gap<br/>model call 2"]
        DN["draft_next_action<br/>model call 3<br/>(if not escalated)"]
        AC["anthropic_client.py<br/>single entry for model calls"]
        EF --> PS --> AG --> DN
        AC -.-> EF
        AC -.-> AG
        AC -.-> DN
    end

    subgraph STORE["JSONL Event Store"]
        JSONL["data/runs/{run_id}.jsonl<br/>Append-only. Never rewritten.<br/>Full payloads for replay."]
    end

    subgraph REPLAY["replay.py"]
        R["Read-only JSONL reconstruction<br/>Never calls model providers<br/>Never writes new events"]
    end

    UI --> POST --> EF
    EF --> JSONL
    AG --> JSONL
    DN --> JSONL
    JSONL --> R
```

**Three model calls, strict order:**
1. `extract_facts` — payer, service, denial reason, confidence, evidence refs
2. `analyze_gap` — missing items, conflicts, escalation decision
3. `draft_next_action` — only when `should_escalate` is false

**V1 run statuses:** `approval_requested` → `approved` or `escalated`

**Replay invariant:** The `approved` event carries `final_recommendation` — exactly what the human signed off on. Replay reconstructs this from the JSONL log without any model call.

**Run logs** are append-only JSONL. Each event carries a type, ISO 8601 timestamp, and full payload sufficient for deterministic replay.

**Replay integrity proof:** `scripts/replay_integrity.sh` replays an approved run 10 times and verifies that every response is identical, `is_replay_response` is true, and the JSONL log gains zero lines. Run it against a live backend:

```bash
./scripts/replay_integrity.sh
```

```
Replay 1: completed in 48ms, JSONL lines: 3 (unchanged) ✓
Replay 2: completed in 50ms, JSONL lines: 3 (unchanged) ✓
Replay 3: completed in 46ms, JSONL lines: 3 (unchanged) ✓
Replay 4: completed in 42ms, JSONL lines: 3 (unchanged) ✓
Replay 5: completed in 46ms, JSONL lines: 3 (unchanged) ✓
Replay 6: completed in 51ms, JSONL lines: 3 (unchanged) ✓
Replay 7: completed in 48ms, JSONL lines: 3 (unchanged) ✓
Replay 8: completed in 43ms, JSONL lines: 3 (unchanged) ✓
Replay 9: completed in 58ms, JSONL lines: 3 (unchanged) ✓
Replay 10: completed in 46ms, JSONL lines: 3 (unchanged) ✓
10/10 replays verified. Zero events written during replay.
```

**[Vifei](https://github.com/yuan-cloud/vifei-suite-public) export proof:** `scripts/export_to_vifei.sh` normalizes a workbench run into Vifei's `CommittedEvent` format and produces a share-safe bundle via `vifei export`. The workbench JSONL is not Vifei EventLog — the script bridges the two schemas without modifying the source log. The bridge contract is documented in `docs/vifei-bridge-contract.md`.

```bash
./scripts/export_to_vifei.sh run-case-002-20260416075553
```

```
Normalized 8 events → out/run-case-002-20260416075553.vifei.jsonl
Running: vifei export out/run-case-002-20260416075553.vifei.jsonl --share-safe --output out/run-case-002-20260416075553.tar.zst
{"code":"OK","data":{"blob_count":0,"bundle_hash":"20f96940ae97c23ad7b74f2f3793c0c775bb58ca29af7c418399d49ebfa3d569","event_count":8},"exit_code":0,"message":"Export completed successfully.","ok":true,"schema_version":"vifei-cli-robot-v1.1"}

Export succeeded.
  Bundle:     out/run-case-002-20260416075553.tar.zst
  Bundle size: 2131 bytes
```

The bundle is a deterministic `tar.zst` archive with a BLAKE3 hash. Escalated runs also export (5 source events normalize to 6 with a synthetic `RunEnd`). Mock and partial runs are rejected with explicit messages. If the `vifei` binary is not installed, the script still produces the normalized JSONL and prints build instructions.

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
cp backend/.env.example backend/.env
# add your Anthropic API key to backend/.env
cd backend
# Load .env: bash/zsh: source .env
# fish: export (cat .env | psub)
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

**Seeded mock runs vs. live runs:** On startup, the backend loads `mock_run.json` from each case directory into in-memory state (IDs like `run-case-002-mock`). These are fixed snapshots for offline exploration. A live demo run (`./bench.sh case-002`) produces a fresh timestamped run ID with a complete JSONL audit trail.

---

## Troubleshooting

If a run fails, use the case-002 fallback endpoint:

```
GET /demo-fallback/case-002
```

Returns the saved mock run for case-002 so you can inspect the Recommendation or Run History panel state.

---

## Build Methodology

Built with multiple AI coding agents (Claude Code, Codex) working in parallel from a shared operating contract (`AGENTS.md`). Agents coordinate through message passing and file reservations, commit independently to `main`, and run automated bug scanning before every commit. Task graph, session search, and orchestration are scripted — no manual dispatch.

---

## Security

```bash
# Use absolute path — some environments alias grep to
# ripgrep (rg), which uses different flag syntax and
# silently fails with --include flags
/usr/bin/grep -rE "PHI|patient_name|ssn|date_of_birth" \
    data/ backend/ frontend/src/ \
    --include="*.py" --include="*.tsx" \
    --include="*.json" --include="*.md"
```

Returns empty. No patient identifiers in any synthetic case data.
