# Observability and Evaluations: Next-Step Design

What the workbench would need for trace capture, evaluation loops,
and safe iteration from real failures. This is a design document, not
an implementation commitment.

---

## Current State

The workbench already captures structured per-run data:

- **JSONL event log:** Every pipeline stage is logged with full
  payloads (facts, findings, recommendation, approval decision).
- **Replay:** Any run can be reconstructed from its log without
  calling the model.
- **Vifei export:** Normalized event bundles with BLAKE3 manifests
  for share-safe archival.

What is missing: these artifacts exist per-run but are not connected
to a feedback loop. There is no way to label a run as correct or
incorrect, no way to build a dataset from failures, and no way to
gate prompt changes against a regression suite.

---

## Design: Three Layers

### 1. Trace Capture

Each pipeline run already produces a trace (the JSONL event sequence).
The gap is exporting traces to an observability backend where they can
be searched, filtered, and correlated.

**Integration point:** `event_store.append_event()` is the single
write path. A trace exporter would hook here (or read the JSONL after
the run completes) and forward events to a trace backend.

**Candidate tooling:**
- Langfuse: open-source LLM observability. Native Python SDK. Traces
  model calls with latency, token counts, and cost.
- Braintrust: evaluation-first platform. Traces feed directly into
  scoring and dataset management.
- Azure AI Foundry / Prompt Flow: enterprise trace and eval pipeline.
  Stronger compliance posture but heavier integration.

**Current architecture fit:** The pipeline already isolates model
calls in `providers/anthropic_client.py:call_model()`. Wrapping this
function with trace instrumentation (span start/end, input/output
capture) would cover all three model calls without touching pipeline
logic.

### 2. Run Labeling and Dataset Creation

After a run completes and is approved (or escalated), an operator or
evaluator should be able to label the run outcome:

- Were the extracted facts correct?
- Were the missing items correctly identified?
- Was the draft recommendation appropriate?
- Was escalation correctly triggered (or correctly not triggered)?

**Integration point:** Labels would be stored alongside the JSONL
event log, either as additional events (label type) or in a separate
evaluation store. The key constraint is that labels must not modify
the original event log (append-only invariant).

**Dataset creation:** Labeled runs become evaluation datasets. A
dataset is a collection of (input, expected output) pairs where:
- Input = case packet (documents + policy)
- Expected output = labeled facts, findings, and recommendation

This is how prompt changes get regression-gated: run the new prompt
against the dataset and compare outputs to labeled expectations.

### 3. Evaluation Loop and Regression Gates

The feedback loop:

```
Run pipeline → Label outcome → Build dataset → Change prompt →
Re-run against dataset → Compare to labels → Gate or reject
```

**Evaluation types:**
- **Factual accuracy:** Do extracted facts match labeled ground truth?
  (Exact match on payer, service, denial reason. Threshold on
  confidence score.)
- **Gap completeness:** Are all labeled missing items found? Are
  false positives flagged?
- **Escalation correctness:** Does `should_escalate` match the
  labeled decision?
- **Draft quality:** Is the recommendation actionable and specific?
  (Requires human scoring or LLM-as-judge with calibrated rubric.)

**Regression gate:** A prompt change is safe to deploy when evaluation
scores on the labeled dataset do not regress below a defined threshold.
This replaces manual re-testing of all three case paths.

---

## How Current Artifacts Feed the Loop

| Current Artifact | Evaluation Use |
|-----------------|---------------|
| JSONL event log | Source of model inputs/outputs for trace capture |
| `expected.json` per case | Seed evaluation dataset (3 cases) |
| `replay_integrity.sh` | Replay invariant proof (not an eval, but a safety check) |
| `export_to_vifei.sh` | Share-safe archival of run evidence for external review |
| `mock_run.json` per case | Baseline expected output shape |

The `expected.json` files already contain expected outcomes for each
synthetic case. These are the first three entries in an evaluation
dataset. Real-world evaluation requires real case packets and
human-labeled expected outcomes.

---

## Rollout Strategy

1. **Instrument first.** Add trace capture to `call_model()` via the
   chosen platform's SDK. This is the lowest-risk change: it adds
   telemetry without changing pipeline behavior.

2. **Label existing runs.** Add a labeling mechanism (even a manual
   JSON file per run) for the three synthetic cases. This creates the
   seed dataset.

3. **Build eval harness.** Script that runs the pipeline against all
   labeled cases and scores outputs against expectations. Report
   pass/fail per case, per metric.

4. **Gate prompt changes.** Before changing any model prompt in
   `pipeline.py`, run the eval harness. If scores regress, the change
   does not land.

5. **Scale with real data.** Once real case packets are available,
   label outcomes from pilot runs and grow the dataset organically.

---

## What This Document Is Not

This is not a request to add Langfuse, Braintrust, or any other
dependency to the current repo. It describes the architecture that
would connect the workbench's existing per-run artifacts to a
continuous improvement loop. Implementation is a separate decision
with separate beads.
