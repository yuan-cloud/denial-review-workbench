# Vifei Bridge Contract

**Bead:** bd-ky8.1
**Status:** Defines the normalization contract from denial-review workbench JSONL to Vifei ingest format.
**Date:** 2026-04-19 (revised)

---

## 1. Purpose

This document is the single reference for implementing `export_to_vifei.sh` (bd-ky8.2).
After reading this document and the bead definition, an implementation agent should be
able to build the export script without reopening earlier research threads.

**Vifei source of truth:** `/data/projects/PanopticonAliveca2.5` on this VPS.
The public mirror (`yuan-cloud/vifei-suite-public`) is secondary. If the two
diverge, the local repo wins and this document should note the divergence.

---

## 2. Source Schema (Workbench JSONL) — verified

Source: `data/runs/{run_id}.jsonl`
Format: one JSON object per line, newline-delimited.

```
{"type": "<event_type>", "timestamp": "<ISO8601Z>", "payload": {<event-specific>}}
```

### 2.1 Event types in pipeline order

| Seq | Event Type           | Payload Shape                                                      | When Emitted                     |
|-----|----------------------|--------------------------------------------------------------------|----------------------------------|
| 0   | `run_started`        | `{run_id, case_id, facility_id}`                                   | Always first                     |
| 1   | `documents_loaded`   | `{documents: [{doc_id, type, text}]}`                              | Always second                    |
| 2   | `facts_extracted`    | `{facts: {payer, service_requested, denial_reason, ...}}`          | After model call 1               |
| 3   | `policy_retrieved`   | `{retrieved_policy_sections: [string]}`                            | After keyword policy search      |
| 4   | `analysis_completed` | `{findings: {missing_items, conflicts, should_escalate, ...}}`     | After model call 2               |
| 5a  | `run_escalated`      | `{reason, conflict_count}`                                         | Only if `should_escalate: true`  |
| 5b  | `draft_generated`    | `{recommendation: {action_type, rationale, draft_text}}`           | Only if `should_escalate: false` |
| 6   | `approval_requested` | `{}`                                                               | Only if `should_escalate: false` |
| 7   | `approved`           | `{final_recommendation: {action_type, rationale, draft_text}}`     | After human approval             |

### 2.2 Historical note on `run_escalated`

The `run_escalated` event was added in commit `abf174e` (2026-04-16 13:08). All existing
escalated run files predate this commit and contain only 5 events ending at
`analysis_completed`. The normalizer **must** handle both shapes:

- **Post-abf174e escalated runs:** 6 events, terminal event is `run_escalated`.
- **Pre-abf174e escalated runs:** 5 events, terminal event is `analysis_completed` with
  `payload.findings.should_escalate: true`.

Detection logic: if the last event is `analysis_completed` and
`payload.findings.should_escalate` is `true`, treat it as an escalated run even without
an explicit `run_escalated` event.

### 2.3 Run lifecycles

**Approved run (case-001, case-002 pattern):**
```
run_started → documents_loaded → facts_extracted → policy_retrieved →
analysis_completed → draft_generated → approval_requested → approved
```
8 events. Terminal event: `approved`.

**Escalated run (case-003 pattern):**
```
run_started → documents_loaded → facts_extracted → policy_retrieved →
analysis_completed [→ run_escalated]
```
5-6 events. Terminal event: `run_escalated` or `analysis_completed` (see 2.2).

**Mock runs (seeding artifacts):**
Mock JSONL files (`run-case-*-mock.jsonl`) contain only terminal events — typically one
or more `approved` entries without the preceding lifecycle events. These are seeding
snapshots, not complete audit trails.

### 2.4 Timestamp format

ISO 8601 with explicit `Z` suffix. Microsecond precision.
Example: `"2026-04-16T07:55:53.828240Z"`

### 2.5 Source code references

| File | Purpose |
|------|---------|
| `backend/app/event_store.py` | `append_event()` and `read_events()` — JSONL I/O |
| `backend/app/pipeline.py` | `run_pipeline()` — event emission sequence |
| `backend/app/schemas.py` | Pydantic models (`RunEvent`, `RunStatus`, etc.) |

---

## 3. Target Schema (Vifei CommittedEvent) — verified against local repo

**Verified against:** `/data/projects/PanopticonAliveca2.5/crates/vifei-core/src/event.rs`

Vifei uses a **two-type pattern** enforced at compile time:
- `ImportEvent` — produced by importers; has all fields except `commit_index`.
- `CommittedEvent` — produced exclusively by the append writer; wraps `ImportEvent`
  with `commit_index: u64`.

The normalizer produces an EventLog JSONL file of `CommittedEvent` records. In
practice, this means the normalizer takes on both the importer role (constructing
the payload) and the commit role (assigning `commit_index`), since we are producing
a standalone JSONL file rather than feeding a live Vifei append writer.

### 3.1 CommittedEvent record shape

Canonical JSONL field order (from `event.rs` doc comment):
```text
commit_index, run_id, event_id, source_id, [source_seq], timestamp_ns,
tier, payload, [payload_ref], [synthesized]
```

Fields in brackets are omitted when `None` / `false`.

| Field           | Type        | Required | Description                                              |
|-----------------|-------------|----------|----------------------------------------------------------|
| `commit_index`  | `u64`       | yes      | 0-based monotonic canonical replay order                 |
| `run_id`        | `String`    | yes      | Identity of the run; scopes `event_id` uniqueness        |
| `event_id`      | `String`    | yes      | Unique event identifier within `run_id`                  |
| `source_id`     | `String`    | yes      | Identifies the source/importer                           |
| `source_seq`    | `Option<u64>` | no     | Monotonic sequence per source; omitted when `None`       |
| `timestamp_ns`  | `u64`       | yes      | Nanoseconds since epoch; metadata only, never used for ordering |
| `tier`          | `Tier`      | yes      | One of `"A"`, `"B"`, `"C"` (see 4.5)                    |
| `payload`       | `EventPayload` | yes   | Internally tagged enum with `#[serde(tag = "type")]`     |
| `payload_ref`   | `Option<String>` | no  | BLAKE3 hex digest of blobbed payload; omitted when `None` |
| `synthesized`   | `bool`      | no       | True if fields were inferred; omitted when `false`       |

### 3.2 Tier enum (from `event.rs`)

Vifei's tier model is a three-tier backpressure classification:

| Tier | Meaning | Serialized as |
|------|---------|---------------|
| `A`  | Never dropped, never reordered. Forensic truth. | `"A"` |
| `B`  | May be sampled, aggregated, or collapsed under load. | `"B"` |
| `C`  | Best-effort telemetry. Can be dropped under stress. | `"C"` |

See `docs/BACKPRESSURE_POLICY.md` in the Vifei repo for full policy.

### 3.3 EventPayload (internally tagged enum)

`EventPayload` uses `#[serde(tag = "type")]`. The `type` field appears first
inside the payload object. Variants from `event.rs`:

| Variant             | Fields                                             | Use for workbench?   |
|---------------------|----------------------------------------------------|----------------------|
| `RunStart`          | `agent: String`, `args: Option<String>`            | **Yes** — `run_started` |
| `RunEnd`            | `exit_code: Option<i32>`, `reason: Option<String>` | **Yes** — `approved`, `run_escalated` |
| `ToolCall`          | `tool: String`, `args: Option<String>`             | No                   |
| `ToolResult`        | `tool: String`, `result: Option<String>`, `status: Option<String>` | No |
| `PolicyDecision`    | `from_level`, `to_level`, `trigger`, `queue_pressure: f64` | No |
| `RedactionApplied`  | `target_event_id`, `field_path`, `reason`          | No                   |
| `Error`             | `kind`, `message`, `severity: Option<String>`      | No                   |
| `ClockSkewDetected` | `expected_ns`, `actual_ns`, `delta_ns`             | No                   |
| `Generic`           | `event_type: String`, `data: BTreeMap<String, String>` | **Yes** — all other events |

**Important:** `Generic.data` is `BTreeMap<String, String>` — flat string-to-string
pairs only, NOT arbitrary nested JSON. This is a deterministic serialization
constraint. For complex payloads, the Vifei convention is to use `payload_ref`
to reference a blobbed payload, or serialize the payload JSON as a single string
value under a key in `data`.

### 3.4 Vifei CLI commands (verified from `cli_contract.rs`)

| Command             | Purpose                              | Input Count | Bridge Target? |
|---------------------|--------------------------------------|-------------|----------------|
| `vifei export`      | Share-safe bundle with secret scan   | 1           | **Yes (v1)**   |
| `vifei incident-pack` | Two-input comparison evidence pack | 2           | No (future)    |
| `vifei compare`     | Deterministic diff of two runs       | 2           | No             |
| `vifei view`        | Interactive TUI viewer               | 1           | No             |
| `vifei tour`        | Stress harness / proof artifacts     | 1           | No             |
| `vifei verify`      | Trust verification checks            | 0-1         | No             |

---

## 4. Field Mapping

### 4.1 `commit_index`

0-based `u64`, assigned in the order events appear in the source JSONL file.
The first event (`run_started`) gets `commit_index: 0`, the second
(`documents_loaded`) gets `commit_index: 1`, and so on.

### 4.2 `run_id`

Passed through verbatim from `payload.run_id` of the `run_started` event.
Example: `"run-case-002-20260416075553"`.

Note: mock runs are deferred in v1 (see section 7.1) and will not reach
this field mapping.

### 4.3 `event_id`

Deterministic, constructed as: `"{source_id}:{source_seq}"` per the `ImportEvent`
doc comment recommendation. Example: `"denial-review-workbench:0"`.

This is deterministic — replaying the same JSONL produces the same event IDs.
No UUIDs, no randomness.

### 4.4 `source_seq`

0-based `u64`, equal to `commit_index`. Since the normalizer is the sole source,
every event gets a `source_seq` and `synthesized` stays `false` for this field.

### 4.5 `timestamp_ns`

Convert the ISO 8601 timestamp to `u64` nanoseconds since Unix epoch.

```
"2026-04-16T07:55:53.828240Z"
→ parse as UTC datetime
→ epoch seconds: 1776326153 + 828240 microseconds
→ nanoseconds: 1776326153828240000
```

Implementation note: Python's `datetime.fromisoformat()` handles the `Z` suffix
in Python 3.11+. For precision, extract seconds and microseconds separately
rather than multiplying a float:

```python
dt = datetime.fromisoformat(ts_str)
epoch_s = int(dt.timestamp())
epoch_us = dt.microsecond
timestamp_ns = epoch_s * 10**9 + epoch_us * 10**3
```

### 4.6 `tier`

Tier assignment follows Vifei's existing importer conventions, not the
workbench's own forensic semantics:

- **Typed payload variants** (`RunStart`, `RunEnd`) → **Tier A**. These are in
  the projection's hardcoded Tier A allowlist (`projection.rs:550-558`) and
  appear in `tier_a_summaries`.
- **`Generic` payload variant** → **Tier B**. All existing Vifei importers map
  Generic fallback events to Tier B (`cassette.rs:260`, `anthropic_messages.rs:184`,
  `openai_responses.rs`). The projection explicitly excludes Generic from Tier A
  summaries by type name (`projection.rs:1193-1203`). The `event.rs:282` doc
  comment frames Generic as "future Tier B/C extension."

This is the correct mapping because the normalizer is structurally an importer:
it brings external domain data into Vifei's model. The workbench's own JSONL
and replay system protects forensic truth for the domain events; the Vifei
export is a secondary proof artifact that follows Vifei's conventions.

| Workbench Event Type   | Payload Variant | Vifei Tier | Rationale                        |
|------------------------|-----------------|------------|----------------------------------|
| `run_started`          | `RunStart`      | `A`        | Typed variant; Tier A allowlist  |
| `documents_loaded`     | `Generic`       | `B`        | Generic; importer convention     |
| `facts_extracted`      | `Generic`       | `B`        | Generic; importer convention     |
| `policy_retrieved`     | `Generic`       | `B`        | Generic; importer convention     |
| `analysis_completed`   | `Generic`       | `B`        | Generic; importer convention     |
| `run_escalated`        | `RunEnd`        | `A`        | Typed variant; Tier A allowlist  |
| `draft_generated`      | `Generic`       | `B`        | Generic; importer convention     |
| `approval_requested`   | `Generic`       | `B`        | Generic; importer convention     |
| `approved`             | `RunEnd`        | `A`        | Typed variant; Tier A allowlist  |

**Consequence for bd-ky8.2:** The implementation must set tier per event type
(A for RunStart/RunEnd, B for Generic), not uniformly A. The tier column in
the table above is the authoritative mapping.

### 4.7 `payload` — event type mapping

The normalizer maps workbench events to Vifei `EventPayload` variants:

**Boundary events → typed variants:**

| Workbench Event    | Vifei Payload Variant | Mapping                                           |
|--------------------|-----------------------|---------------------------------------------------|
| `run_started`      | `RunStart`            | `agent: "denial-review-workbench"`, `args: "{case_id} {facility_id}"` |
| `approved`         | `RunEnd`              | `exit_code: 0`, `reason: "approved"` |
| `run_escalated`    | `RunEnd`              | `reason: "escalated: {payload.reason}"` |

For legacy escalated runs where the terminal event is `analysis_completed` with
`should_escalate: true`, the normalizer emits an additional synthetic `RunEnd`
event at `commit_index: N` (one past the last source event):
`exit_code: None`, `reason: "escalated: detected from analysis_completed"`,
`synthesized: true`.

**Domain events → `Generic` variant:**

All other workbench events use the `Generic` payload variant. Since `Generic.data`
is `BTreeMap<String, String>` (flat string-to-string only), the workbench payload
is serialized as a JSON string under the key `"payload_json"`:

```json
{"type":"Generic","event_type":"facts_extracted","data":{"payload_json":"{...}"}}
```

| Workbench Event      | `event_type` value     | `data` key          |
|----------------------|------------------------|---------------------|
| `documents_loaded`   | `"documents_loaded"`   | `"payload_json"`    |
| `facts_extracted`    | `"facts_extracted"`    | `"payload_json"`    |
| `policy_retrieved`   | `"policy_retrieved"`   | `"payload_json"`    |
| `analysis_completed` | `"analysis_completed"` | `"payload_json"`    |
| `draft_generated`    | `"draft_generated"`    | `"payload_json"`    |
| `approval_requested` | `"approval_requested"` | `"payload_json"`    |

The `payload_json` value is the `JSON.stringify()` of the original workbench
event's `payload` object. This preserves the full workbench payload without
loss, while respecting `BTreeMap<String, String>`.

### 4.8 `payload_ref`

Omitted (`None`) for v1. Workbench event payloads are small enough to inline.
If a future workbench event exceeds the Vifei inline payload threshold
(see `docs/CAPACITY_ENVELOPE.md` in the Vifei repo), the normalizer should
blob the content and set `payload_ref` to the BLAKE3 hex digest.

### 4.9 `synthesized`

Set to `true` only on the synthetic `RunEnd` event emitted for legacy escalated
runs (see 4.7). All other events are `false` (omitted in JSONL output per
`#[serde(skip_serializing_if = "is_false")]`).

### 4.10 `source_id`

Constant string: `"denial-review-workbench"`.

---

## 5. CLI Decision: `vifei export`

### 5.1 Rationale

| Factor                              | `vifei export`       | `vifei incident-pack`    |
|--------------------------------------|----------------------|--------------------------|
| Input count                          | 1 event log          | 2 event logs             |
| Purpose                              | Share-safe proof     | Comparative evidence     |
| Workbench use case                   | Export one run        | Compare two runs         |
| First bridge target?                 | **Yes**              | No                       |

### 5.2 Invocation (verified from `cli_contract.rs`)

```bash
vifei export "$NORMALIZED_JSONL" \
  --share-safe \
  --output "$OUTPUT_BUNDLE" \
  --refusal-report "$REFUSAL_REPORT"
```

Key details from the clap definition:
- First argument is **positional** (`eventlog: PathBuf`), not `--input`
- `--output` (`-o`) is required; expected filename: `*.tar.zst`
- `--share-safe` is a boolean flag; required in v0.1
- `--refusal-report` is optional; path for refusal report if secrets are found

### 5.3 Output (verified from export implementation)

**Bundle:** A deterministic `tar.zst` archive containing:
- `eventlog.jsonl` — the normalized event log
- `blobs/{ref}` — any referenced blob files (sorted alphabetically)
- `manifest.json` — BLAKE3 digests for each file in the bundle

**Bundle determinism guarantees:**
- Zstd compression level 3 (pinned)
- All tar entry mtimes: 0 (Unix epoch)
- All uid/gid: 0
- Entries alphabetically sorted
- Bundle hash: BLAKE3 of final `.tar.zst` bytes

**Export result fields:** `bundle_path`, `bundle_hash`, `event_count`, `blob_count`.

**Refusal (exit code 3):** If the share-safe scanner detects secrets (API keys,
JWTs, private keys, PII), no bundle is written. A refusal report (JSON, schema
`refusal-v0.1`) is written to `--refusal-report` if provided.

### 5.4 Exit codes (from `cli_contract.rs`)

| Code | Name           | Meaning                                |
|------|----------------|----------------------------------------|
| 0    | `Success`      | Bundle created                         |
| 1    | `NotFound`     | Input file not found                   |
| 2    | `InvalidArgs`  | Bad arguments                          |
| 3    | `ExportRefused`| Secrets detected; no bundle written    |
| 4    | `RuntimeError` | Unexpected runtime failure             |

---

## 6. Sample Normalized Records

### 6.1 First event — `run_started` → `RunStart`

```json
{"commit_index":0,"run_id":"run-case-002-20260416075553","event_id":"denial-review-workbench:0","source_id":"denial-review-workbench","source_seq":0,"timestamp_ns":1776326153828240000,"tier":"A","payload":{"type":"RunStart","agent":"denial-review-workbench","args":"case-002 facility-a"}}
```

### 6.2 Domain event — `facts_extracted` → `Generic`

```json
{"commit_index":2,"run_id":"run-case-002-20260416075553","event_id":"denial-review-workbench:2","source_id":"denial-review-workbench","source_seq":2,"timestamp_ns":1776326157988689000,"tier":"B","payload":{"type":"Generic","event_type":"facts_extracted","data":{"payload_json":"{\"facts\":{\"payer\":\"Example Health Plan\",\"service_requested\":\"skilled nursing follow-up\",\"denial_reason\":\"Insufficient supporting documentation\",\"confidence\":0.95}}"}}}
```

### 6.3 Terminal event — `approved` → `RunEnd`

```json
{"commit_index":7,"run_id":"run-case-002-20260416075553","event_id":"denial-review-workbench:7","source_id":"denial-review-workbench","source_seq":7,"timestamp_ns":1776326171970905000,"tier":"A","payload":{"type":"RunEnd","exit_code":0,"reason":"approved"}}
```

### 6.4 Escalated terminal — `analysis_completed` (legacy) + synthetic `RunEnd`

Last source event (commit_index 4):
```json
{"commit_index":4,"run_id":"run-case-003-20260416085208","event_id":"denial-review-workbench:4","source_id":"denial-review-workbench","source_seq":4,"timestamp_ns":1776329536787280000,"tier":"B","payload":{"type":"Generic","event_type":"analysis_completed","data":{"payload_json":"{\"findings\":{\"should_escalate\":true,\"conflicts\":[\"Denial letter simultaneously states...\"]}}"}}}
```

Synthetic RunEnd (commit_index 5):
```json
{"commit_index":5,"run_id":"run-case-003-20260416085208","event_id":"denial-review-workbench:5","source_id":"denial-review-workbench","source_seq":5,"timestamp_ns":1776329536787280000,"tier":"A","payload":{"type":"RunEnd","reason":"escalated: detected from analysis_completed"},"synthesized":true}
```

---

## 7. Support Matrix

| Run Class                    | Status         | Expected Event Count | Terminal Event          | v1 Bridge Action                                     |
|------------------------------|----------------|----------------------|-------------------------|------------------------------------------------------|
| Approved live run            | **SUPPORTED**  | 8                    | `approved`              | Normalize all events, export via `vifei export`      |
| Approved mock run            | **DEFERRED**   | 1-3 (terminal only)  | `approved`              | Fail with message (see 7.1)                          |
| Escalated live run (new)     | **SUPPORTED**  | 6 → 6 normalized     | `run_escalated`         | `run_escalated` maps to `RunEnd`                     |
| Escalated live run (legacy)  | **SUPPORTED**  | 5 → 6 normalized     | `analysis_completed`    | Synthetic `RunEnd` appended (see 4.7)                |
| Partial / failed run         | **DEFERRED**   | 1-2                  | `documents_loaded` etc. | Fail with message (see 7.2)                          |
| `approval_requested` (not yet approved) | **DEFERRED** | 7           | `approval_requested`    | Fail with message (see 7.3)                          |

### 7.1 Mock run failure contract

Mock JSONL files contain only terminal events without the full pipeline lifecycle.
They are seeding snapshots, not complete audit trails. Exporting them would produce
a misleading proof artifact.

```
Error: run-case-002-mock appears to be a mock run (missing run_started event).
Mock runs contain only terminal events and cannot produce a valid Vifei export.
Use a live pipeline run instead: ./bench.sh case-002
```

Detection: the first event's `type` is not `run_started`.

### 7.2 Partial run failure contract

Runs that failed mid-pipeline have an incomplete event sequence.

```
Error: run-case-002-20260415104157 is a partial run (2 events, terminal: documents_loaded).
Only complete runs (approved or escalated) can be exported.
Re-run the pipeline: ./bench.sh case-002
```

Detection: the terminal event is not one of `approved`, `run_escalated`, or
`analysis_completed` (with `should_escalate: true`).

### 7.3 Pending approval failure contract

```
Error: run-case-002-20260415111641 is pending approval (terminal: approval_requested).
Approve the run first, then re-export.
```

Detection: the terminal event is `approval_requested`.

---

## 8. Normalizer Design

### 8.1 Input

A single workbench JSONL file: `data/runs/{run_id}.jsonl`.

### 8.2 Output

A normalized JSONL file of `CommittedEvent` records suitable as input to
`vifei export`. One record per line, canonical field order (see 3.1).

### 8.3 Algorithm

```
1. Read all lines from source JSONL.
2. Validate: first event must be run_started.
3. Validate: terminal event must indicate a complete run (approved or escalated).
4. Extract run_id from the run_started payload.
5. For each source event at index i:
   a. Parse timestamp → timestamp_ns (u64 nanoseconds).
   b. Map workbench event to EventPayload variant and tier (section 4.6, 4.7):
      - run_started     → RunStart, Tier A
      - approved        → RunEnd,   Tier A
      - run_escalated   → RunEnd,   Tier A
      - all others      → Generic,  Tier B
   c. Construct CommittedEvent:
      - commit_index: i
      - run_id: from step 4
      - event_id: "denial-review-workbench:{i}"
      - source_id: "denial-review-workbench"
      - source_seq: i
      - timestamp_ns: from step 5a
      - tier: from step 5b (A for typed variants, B for Generic)
      - payload: from step 5b
      - (omit payload_ref, omit synthesized when false)
   d. Serialize with canonical field order, write as JSONL line.
6. If legacy escalated run (terminal is analysis_completed with should_escalate):
   Append synthetic RunEnd event at commit_index N with synthesized: true.
7. Return path to normalized file.
```

### 8.4 Implementation language

Shell script (`export_to_vifei.sh`) with inline Python for JSON transformation.
Python 3.11+ is required (for `datetime.fromisoformat()` Z-suffix support).
The script must not require any dependencies beyond the Python standard library.

---

## 9. Binary Detection Strategy

The `vifei` binary is not currently installed on this VPS. The export script must
detect this and fail with actionable instructions pointing at the local repo.

### 9.1 Detection

```bash
if ! command -v vifei >/dev/null 2>&1; then
    echo "Error: vifei binary not found in PATH."
    echo ""
    echo "Build from the local Vifei repo:"
    echo "  cd /data/projects/PanopticonAliveca2.5"
    echo "  cargo build --release -p vifei-tui"
    echo "  cp target/release/vifei ~/.local/bin/"
    echo ""
    echo "The normalized JSONL has been written to: $NORMALIZED_FILE"
    echo "You can run the export manually once built:"
    echo "  vifei export $NORMALIZED_FILE --share-safe --output out/$RUN_ID.tar.zst"
    exit 1
fi
```

### 9.2 Graceful degradation

When `vifei` is not available, the script should still produce the normalized
JSONL file as output. This lets operators inspect the normalization independently
of whether the Vifei binary is installed. The script exits non-zero but leaves
the normalized file in place.

---

## 10. Explicit Non-Goals

### 10.1 agent-cassette bridge

The `agent-cassette` output format is schema-divergent from the Vifei cassette
importer. Routing through agent-cassette is **not** the first bridge target.
This may be revisited if the schemas converge.

### 10.2 incident-pack — evaluated and declined (bd-ky8.6)

`vifei incident-pack` is a two-input deterministic comparison workflow
(`cli_contract.rs:98-118`). It takes two EventLog JSONL files (left, right)
and produces a divergence report.

**Decision: not applicable for this project.**

The workbench produces one run per case. There is no natural two-input
comparison that is both real and non-trivial:
- Comparing two runs of the same case shows model output variation, which
  is expected and not a useful proof artifact.
- Comparing runs of different cases is not meaningful — different inputs,
  different facts, different outcomes.
- Comparing the same run exported twice is a tautology (the normalization
  is deterministic).

The single-run `export --share-safe` path is the right stopping point. The
workbench proof story is: one case, one pipeline, one human decision, one
audit trail, one share-safe bundle. `incident-pack` would require inventing
a scenario to demonstrate, not documenting a real workflow.

If a real comparative use case emerges later (e.g., regression testing across
policy versions), the infrastructure is already in place: produce two
normalized JSONL files and run `vifei incident-pack left.jsonl right.jsonl`.

### 10.3 Bidirectional sync

This bridge is export-only. The workbench does not import from Vifei. The
original JSONL is never modified.

### 10.4 Real-time streaming

The bridge operates on completed run files. There is no streaming or
incremental export.

---

## 11. Verification Sources

All target schema sections in this contract were verified against the local
Vifei repo at `/data/projects/PanopticonAliveca2.5`:

| Contract Section | Verified Against |
|------------------|------------------|
| 3.1 CommittedEvent fields | `crates/vifei-core/src/event.rs` lines 377-405 |
| 3.2 Tier enum | `crates/vifei-core/src/event.rs` lines 92-100 |
| 3.3 EventPayload variants | `crates/vifei-core/src/event.rs` lines 172-297 |
| 5.2 Export CLI flags | `crates/vifei-tui/src/cli_contract.rs` lines 47-64 |
| 5.3 Bundle output format | Export implementation (tar.zst deterministic bundle) |
| 5.4 Exit codes | `crates/vifei-tui/src/cli_contract.rs` lines 146-155 |
| 6.x Sample records | `docs/assets/readme/sample-eventlog.jsonl` (format reference) |

**Remaining assumptions requiring runtime verification:**
- Vifei `export` accepts a JSONL file with `CommittedEvent` records produced
  outside its own append writer (the normalizer constructs them directly).
  If `export` validates provenance, this may need adjustment.
- The share-safe scanner behavior on workbench-specific content (e.g., clinical
  notes text in `Generic.data.payload_json`) — unlikely to trigger but untested.

---

## 12. Change Log

| Date       | Author      | Change                                    |
|------------|-------------|-------------------------------------------|
| 2026-04-19 | SilentPeak  | Initial contract from bd-ky8.1 definition |
| 2026-04-19 | SilentPeak  | Revised: grounded in local Vifei repo (`/data/projects/PanopticonAliveca2.5`). Fixed tiers to A/B/C, payload to tagged enum (RunStart/RunEnd/Generic), removed `references` field, added `source_seq`/`payload_ref`/`synthesized`, fixed export CLI to positional arg + tar.zst output, updated binary instructions to point at local repo, added exit codes, added verification source table. |
| 2026-04-20 | SilentPeak  | Fixed Generic/Tier A issue: Generic events now Tier B per Vifei importer convention (`cassette.rs:260`, `anthropic_messages.rs:184`, `projection.rs:1193-1203`). Only typed variants (RunStart, RunEnd) get Tier A. Updated section 4.6, samples 6.2/6.4, algorithm 8.3. |
| 2026-04-20 | SilentPeak  | Evaluated incident-pack (bd-ky8.6): declined. No natural two-input comparison exists for this project. Updated section 10.2 with full rationale. |
