# Brief

## What it is

Denial Review Workbench is a single-flow workflow tool for reviewing
insurance authorization denials in document-heavy healthcare operations.

A caseworker receives a case packet (denial letter, authorization request,
clinical notes), runs a structured AI pipeline that extracts facts,
identifies documentation gaps, and drafts a next action, then reviews and
approves the result. Every pipeline stage is logged to an append-only JSONL
event store. The human reviewer is always in the loop: no recommendation
ships without explicit approval.

## What it proves

**Auditable AI-assisted decisions.** The JSONL event log records every
pipeline stage with full payloads. The `approved` event carries
`final_recommendation`: the exact text the human signed off on. This is
the audit artifact. It answers the question "what did the reviewer see,
and what did they approve?" months after the fact.

**Deterministic replay.** Any approved run can be reconstructed from the
JSONL log without calling the model. Replay produces identical state:
same facts, same findings, same recommendation, same approval decision.
`scripts/replay_integrity.sh` verifies this by replaying an approved run
10 times and confirming zero JSONL growth and identical responses.

**Regulated-workflow guardrails.** Escalation is enforced at the API
layer, not just the UI. When conflicting denial reasons are detected,
the pipeline sets `should_escalate: true`, suppresses draft generation,
and the server returns 409 on any approve attempt. The guard survives
server restart because it checks the persisted JSONL log, not just
in-memory state.

**Schema-first pipeline with bounded model calls.** At most three model
calls per run, in strict order: extract facts, analyze gaps, draft
action. The third call is skipped entirely on escalation. All model
interaction goes through a single entry point
(`providers/anthropic_client.py`), and the pipeline never imports the
Anthropic SDK directly.

## What it is not

- Not a platform. One workflow, one case type, one approval gate.
- Not an agent control room or a devtools product.
- Not HIPAA compliant. This is a prototype with synthetic case data.
  No patient identifiers exist in any case packet.
- Not a denial management system. It reviews individual denials; it does
  not route queues, track SLAs, or manage caseloads.

The scope is deliberately narrow. The value is in the orchestration spine:
the same pipeline structure (extract, analyze, draft, approve, audit)
can serve different facilities by swapping policy packs and approval
rules. The workbench proves the pattern works end-to-end.

## Technical identity

| | |
|-|-|
| **Product title** | Denial Review Workbench |
| **Subtitle** | Auditable human-in-the-loop denial review for document-heavy healthcare ops |
| **Stack** | FastAPI + React 18 + TypeScript, Anthropic claude-sonnet-4-6, JSONL event store |
| **Pipeline** | 3 bounded model calls (extract, analyze, draft), deterministic replay |
| **Storage** | Append-only JSONL. One file per run. Never rewritten. |
| **Human gate** | Reviewer edits draft and approves. `approved` event is the audit artifact. |
