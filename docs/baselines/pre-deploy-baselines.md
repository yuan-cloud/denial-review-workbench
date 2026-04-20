# Pre-Deploy Performance Baselines

**Bead:** bd-3mj.10.1
**Date:** 2026-04-20
**Environment:** Contabo VPS, Ubuntu, Python 3.13.7, Rust 1.95.0-nightly

---

## 1. Benchmark Surface Classification

The workbench has two distinct latency regimes. Mixing them would
produce misleading numbers.

### Deterministic output (repo-controlled logic)

These flows produce identical output every time. Wall time varies with
VPS load, but the output (hashes, event counts, invariants) is fixed.

| Surface | What it does | Dominant cost | Network? |
|---------|-------------|---------------|----------|
| Replay integrity | 10x replay via HTTP against local backend | JSONL read + JSON serialize | Local loopback |
| Vifei normalization | Python: parse JSONL → emit CommittedEvent JSONL | JSON parse + datetime math | None |
| Vifei export | Rust: read JSONL → share-safe scan → tar.zst bundle | I/O + zstd compression | None |
| Health endpoint | Backend liveness check | Trivial | Local loopback |

**Prerequisites:** Backend must be running (`uvicorn` on port 8000) for
replay and health baselines. `BACKEND_URL` defaults to
`http://localhost:8000`. Vifei binary must be built for export baselines
(see `docs/vifei-bridge-contract.md` section 9).

### Model/network-dominated (not optimization targets yet)

| Surface | Dominant cost | Why not a target |
|---------|---------------|------------------|
| `POST /runs` pipeline | 3 Anthropic API calls (10-20s total) | Latency is 99%+ external API wait |
| `bench.sh` | Wraps pipeline | Same |
| `demo.sh` full arc | Pipeline + approve + replay + export | Pipeline dominates |

Optimizing the model-call path would mean changing the Anthropic SDK
transport or batching, which is outside the current scope.

---

## 2. Deterministic Flow Baselines

### 2.1 Replay integrity (`scripts/replay_integrity.sh`)

10 sequential replay requests against the running backend.
Target run: `run-case-002-mock`.

**5-run measurement:**

| Run | Wall time |
|-----|-----------|
| 1   | 2993 ms   |
| 2   | 4417 ms   |
| 3   | 4733 ms   |
| 4   | 2021 ms   |
| 5   | 2422 ms   |

**Summary:** median ~2993 ms, range 2021-4733 ms (10 HTTP round-trips
each). Per-replay latency is 50-110 ms from the script's own timing.

**Invariant:** All 10 replays produce identical JSON responses. JSONL
line count unchanged. `is_replay_response: true` on every response.

### 2.2 Vifei normalization (Python, inline)

Parse workbench JSONL, emit Vifei CommittedEvent JSONL. No network.
Target: `run-case-002-20260416075553` (8 events).

**Measurement:** ~60 ms (Python startup + 8-event transform).
Negligible for any practical workload.

### 2.3 Vifei export (`vifei export --share-safe`)

Read normalized JSONL, run share-safe secret scan, produce
deterministic `tar.zst` bundle with BLAKE3 hash.

**Measurement:** ~250 ms (8 events, 2131-byte bundle).

### 2.4 Full export pipeline (`scripts/export_to_vifei.sh`)

Normalization + vifei export end-to-end.

**5-run measurement:**

| Run | Wall time |
|-----|-----------|
| 1   | 281 ms    |
| 2   | 184 ms    |
| 3   | 265 ms    |
| 4   | 150 ms    |
| 5   | 529 ms    |

**Summary:** median ~265 ms, range 150-529 ms.

### 2.5 Health endpoint

**Measurement:** ~34 ms. Trivial.

---

## 3. Golden Artifacts

These hashes prove behavior equivalence. If a future optimization
changes the output, the hash will differ and the change must be
investigated.

| Artifact | Hash | Algorithm | Notes |
|----------|------|-----------|-------|
| Replay source JSONL (`run-case-002-mock.jsonl`) | `f1b89a920ba310b3f4bbddb5f28db5cf` | BLAKE2b (first 32 hex) | Replay invariant: this file never changes |
| Vifei export bundle (`run-case-002-20260416075553`) | `20f96940ae97c23ad7b74f2f3793c0c775bb58ca29af7c418399d49ebfa3d569` | BLAKE3 | Deterministic: same hash every run (verified bd-ky8.7) |

**Replay golden behavior:** 10/10 replays identical, JSONL line count
unchanged, `is_replay_response: true`. Verified by
`scripts/replay_integrity.sh`.

**Export golden behavior:** Normalized JSONL → tar.zst bundle. Bundle
hash is deterministic across runs (BLAKE3 of the tar.zst bytes).
Verified in bd-ky8.7 and bd-ky8.5.

---

## 4. What This Baseline Does NOT Cover

| Gap | Why | When to address |
|-----|-----|-----------------|
| Pipeline latency (model calls) | 99%+ external API — not repo-controlled | When SDK batching or caching becomes relevant |
| Frontend render performance | No Lighthouse/Core Web Vitals baseline | Before frontend-focused optimization work |
| Concurrent request behavior | Backend is single-worker (`uvicorn` without `-w`) | Before multi-user deployment |
| Cold start time | `uvicorn` startup + mock seeding | Before serverless/container deployment |
| Memory footprint | No profiling done | Before scaling to many concurrent runs |

---

## 5. How to Reuse This Baseline

Later profiling or verification beads should:

1. Run the same commands on the same fixtures.
2. Compare wall times against the ranges documented here.
3. Verify golden hashes are unchanged (behavior equivalence).
4. If a hash changes, investigate whether the change is intentional
   (new feature) or a regression (bug).

Commands:

```bash
# Replay baseline
./scripts/replay_integrity.sh

# Export baseline
./scripts/export_to_vifei.sh run-case-002-20260416075553

# Bundle hash check (should match golden)
# The script surfaces the hash in its output
```

---

## 6. What Would Make This Baseline Outdated

- Changes to `replay.py` that alter the reconstructed `RunStatus` shape
  (golden replay hash would change).
- Changes to the normalizer in `scripts/export_to_vifei.sh` that alter
  the normalized JSONL output (golden bundle hash would change).
- Changes to the Vifei binary that alter bundle creation determinism
  (zstd level, tar entry ordering, manifest format).
- Moving to a different VPS or significantly different hardware (wall
  time ranges would shift, but golden hashes should remain stable).
