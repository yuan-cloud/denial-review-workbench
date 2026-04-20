# Case Study: Denial Review Workbench

## Problem

Denial review is document-heavy, inconsistent, and produces no verifiable audit trail. A caseworker receives a denial letter, an authorization request, and clinical notes. They must cross-reference these against payer policy, identify missing documentation, decide whether to appeal or escalate, and draft a response. The output is typically an email or a fax with no structured record of the reasoning behind it.

When reviews are audited months later, nothing reconstructs what the reviewer saw, what the model produced, or whether the human changed the draft before sending it.

## Solution

Three bounded model calls, an append-only JSONL event store, a human approval gate, and deterministic replay.

**Three model calls, strict order:**

1. **Extract facts** — payer, service requested, denial reason, required documents, confidence score, and evidence references linked back to source quotes in the case packet.
2. **Analyze gap** — missing items, conflicts between documents, escalation decision. If conflicting denial reasons are detected, the case is escalated immediately. No draft is generated.
3. **Draft next action** — runs only when escalation is not triggered. Produces an action type, rationale, and editable draft text for the reviewer.

**Append-only JSONL event log:**

Every pipeline stage emits a typed, timestamped event to `data/runs/{run_id}.jsonl`. Events are never rewritten. The log is the single source of truth; the UI is a projection of it.

**Human approval gate:**

The reviewer sees extracted facts, gap analysis, source documents with evidence highlighting, and the draft. They can edit the draft text before approving. The `approved` event carries `final_recommendation`: the exact text the human signed off on, stored as a first-class audit artifact. Escalated cases block the approval flow entirely; the server returns 409 on any approve attempt.

**Deterministic replay:**

`replay.py` reconstructs any prior run from the JSONL log without calling the model. Replay produces identical state: same facts, same findings, same recommendation, same approval decision. An amber REPLAY badge confirms the view is read-only reconstruction, not a live run.

Note: the backend seeds `mock_run.json` snapshots into memory on startup for offline exploration (IDs like `run-case-002-mock`). These are fixed snapshots, not replays of persisted JSONL. Live demo runs produce fresh timestamped IDs with complete audit trails.

## Results

Full pipeline (extraction, gap analysis, draft) completes in under 15 seconds (measured with `./bench.sh` against claude-sonnet-4-6). Escalation cases complete in under 10 seconds (2 model calls instead of 3).

Replay reconstructs any approved run in milliseconds. No model call, no network dependency. The JSONL log gains exactly one event per pipeline stage.

## Evidence Export

The workbench JSONL log and replay system prove what happened within the workbench. `scripts/export_to_vifei.sh` produces a secondary proof artifact for external consumption.

**What it consumes.** A completed workbench run file (`data/runs/{run_id}.jsonl`). The script validates that the run is complete (approved or escalated) and rejects mock runs, partial runs, and pending-approval runs with specific error messages.

**What it emits.** A deterministic `tar.zst` bundle produced by `vifei export --share-safe`. The bundle contains the normalized event log, a manifest with BLAKE3 digests, and a share-safe scanner report confirming no secrets were included. The bundle hash is deterministic: the same input always produces the same hash.

**What the bundle proves.** The workbench's own JSONL log records domain workflow truth (what the model extracted, what the reviewer approved). The Vifei bundle adds a share-safe packaging layer: it normalizes workbench events into Vifei's `CommittedEvent` schema, applies a secret scanner, and produces a sealed archive with cryptographic digests. The bundle can be shared or archived independently of the workbench backend.

**Boundary.** The Vifei bridge is export-only. The workbench never imports from Vifei. The original JSONL is never modified during export (the script verifies source line counts before and after normalization). The bridge was not part of the original frozen sprint plan; it was added as a post-sprint proof-packaging layer.

**Verify it:**

```bash
git clone https://github.com/yuan-cloud/denial-review-workbench
cd denial-review-workbench

# Start the backend
export ANTHROPIC_API_KEY=sk-ant-...
cd backend && uvicorn app.main:app --port 8000 &

# Run a case
cd .. && ./bench.sh case-002

# Approve it
# **Note:** Replace `{run_id}` with the run ID printed
# by bench.sh (e.g. `run-case-002-20260416081820`).
curl -X POST http://localhost:8000/runs/{run_id}/approve \
  -H "Content-Type: application/json" \
  -d '{"draft_text": "Approved as drafted."}'

# Replay it
curl http://localhost:8000/runs/{run_id}/replay

# Count the JSONL lines yourself
wc -l data/runs/{run_id}.jsonl
```
