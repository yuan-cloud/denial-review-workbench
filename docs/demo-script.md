# Demo Script

Operator walkthrough for the Denial Review Workbench. Covers the full
arc from startup through pipeline, approval, replay, and evidence export.

---

## Prerequisites

- Python 3.11+, Bun, Anthropic API key
- Backend running:
  ```bash
  cd backend
  source .env
  uvicorn app.main:app --port 8000
  ```
- Frontend running (for UI walkthrough):
  ```bash
  cd frontend && bun install && bun run dev
  ```
- Verify: `curl http://localhost:8000/health` returns `{"status":"ok","phase":"3"}`

---

## Automated Arc

`demo.sh` composes all proof scripts into a single run:

```bash
./demo.sh              # default: case-002
./demo.sh case-001     # specify a case
```

Five stages run in sequence:
1. Backend health check
2. Pipeline run (`POST /runs`)
3. Approval (skipped if escalated)
4. Replay integrity (10 replays, zero JSONL growth)
5. Vifei share-safe export (degrades gracefully if `vifei` binary is absent)

The script stops on first failure and prints which stage failed.

---

## Manual Arc (7 minutes)

For a manual walkthrough, use the steps below. Each step states what
it proves and what must work for the step to succeed.

### 1. Case queue (0:00)

Open the frontend at `http://localhost:5274`. The case list shows three
cases with facility, scenario, path, and summary columns.

**Proves:** Backend is serving case metadata. UI renders the triage queue.

### 2. Load case packet (0:30)

Select case-002. The left panel loads the denial letter, authorization
request, clinical notes, and the matching policy excerpt.

**Proves:** Documents load from `data/cases/case-002/`. Policy matched
by facility ID.

### 3. Run pipeline (1:20)

Click **Run Review**. The pipeline calls the model three times (extract
facts, analyze gap, draft action). Extracted facts appear as cards with
confidence percentage and clickable evidence references.

**Proves:** Three bounded model calls complete. Facts are structured,
not raw JSON. Evidence refs link back to source quotes.

### 4. Gap analysis (2:10)

The gap analysis table shows required documents, two missing items, and
source evidence. Click an evidence reference to highlight the source
quote in the document panel.

**Proves:** Gap analysis identifies specific documentation deficiencies.
Evidence highlighting works end-to-end.

### 5. Approve (3:00)

The recommendation shows an action type, rationale, and editable draft
text. Edit one line. Click **Approve**. The button becomes an
"Approved" badge. The `approved` event carries `final_recommendation`:
the exact text the reviewer signed off on.

**Proves:** Human is in the loop. The reviewer edits and approves
explicitly. The approved artifact records the human-reviewed text.

### 6. Replay (5:00)

Open Run History. Click **Replay**. The full run state reconstructs
from the JSONL log. An amber **REPLAY** badge confirms read-only
reconstruction. No model call is made.

**Proves:** Deterministic replay from the audit log. Same facts, same
findings, same recommendation, same approval.

### 7. Escalation (6:00)

Navigate back to the case list. Run case-003. Conflicting denial
reasons trigger `should_escalate: true`. The center panel shows an
escalation notice. No draft is generated. No Approve button is shown.
`POST /runs/{run_id}/approve` returns 409.

**Proves:** Escalation is enforced at the API layer, not just the UI.

---

## Evidence Export

After approval, export the run as a Vifei share-safe bundle:

```bash
./scripts/export_to_vifei.sh {run_id}
```

The script normalizes workbench events into Vifei's `CommittedEvent`
schema, verifies the source JSONL is unmodified, and runs
`vifei export --share-safe` to produce a deterministic `tar.zst`
bundle with BLAKE3 manifests.

If the `vifei` binary is not installed, the script still produces the
normalized JSONL and exits with instructions to build from the local
Vifei repo.

---

## Fallback

If the live pipeline fails, use the demo fallback endpoint:

```
GET /demo-fallback/case-002
```

Returns the saved mock run for case-002 with all panels populated.
The UI can render the full three-panel layout from this response.

If `saved_demo_run.json` is missing, the endpoint returns 404 with the
exact `cp` command to create it from `mock_run.json`.

---

## Verification Checklist

- [ ] `curl /health` returns `{"status":"ok","phase":"3"}`
- [ ] case-002 runs end-to-end with live model calls
- [ ] Evidence ref click highlights source quote in document panel
- [ ] Reviewer edits draft text, approves, badge appears
- [ ] GET /runs after approve returns approved state
- [ ] Replay reconstructs same result, REPLAY badge visible
- [ ] case-003 shows escalation notice, no draft, no approve button
- [ ] POST approve on escalated run returns 409
- [ ] `scripts/replay_integrity.sh` passes 10/10
- [ ] Security grep returns empty:
  ```bash
  /usr/bin/grep -rE "PHI|patient_name|ssn|date_of_birth" \
      data/ backend/ frontend/src/ \
      --include="*.py" --include="*.tsx" \
      --include="*.json" --include="*.md"
  ```
