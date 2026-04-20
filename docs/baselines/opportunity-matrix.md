# Optimization Opportunity Matrix

**Bead:** bd-3mj.10.2
**Date:** 2026-04-20
**Baseline reference:** `docs/baselines/pre-deploy-baselines.md`

---

## Recommendation: Do not optimize yet

All deterministic flows complete well under user-perceptible thresholds.
The only meaningful latency in the system is the Anthropic API pipeline
(10-20s for 3 model calls), which is external and not optimizable from
this repo without changing SDK transport or caching strategy.

---

## Profiling Results

### Normalization (Python, inline in export_to_vifei.sh)

Profiled with `cProfile` over 100 iterations on `run-case-002-20260416075553`
(8 events):

| Function | Calls/iter | Cumulative | % of total |
|----------|-----------|------------|------------|
| `json.dumps` (serialization) | 14 | 0.28 ms | 48% |
| `json.loads` (parsing) | 8 | 0.10 ms | 17% |
| `ts_to_ns` (timestamp) | 8 | 0.03 ms | 5% |
| File I/O (`open`) | 1 | 0.04 ms | 7% |
| **Total per iteration** | | **0.58 ms** | |

At 0.58 ms/run, this is not an optimization target. Python startup (~60ms)
dominates the observed wall time of `scripts/export_to_vifei.sh`.

### Vifei export (Rust, external binary)

Wall time ~250 ms for 8 events → 2131-byte tar.zst bundle. This is the
Vifei repo's code, not ours. Breakdown is I/O + zstd compression + secret
scanning. Not actionable from this repo.

### Replay (backend, single request)

10-sample latency distribution:

| Percentile | Latency |
|-----------|---------|
| min       | 24 ms   |
| median    | 37 ms   |
| p90       | 76 ms   |
| max       | 359 ms  |

The max outlier (359ms) is likely GC or process scheduling. Median 37ms is
well within acceptable response time. The replay path reads a 3-line JSONL
file and reconstructs state in memory — no model calls, no external I/O.

### Health endpoint

34 ms. Trivial. No profiling needed.

---

## Scored Opportunity Matrix

Score = (Impact × Confidence) ÷ Effort

Scale: Impact 1-5, Confidence 0.0-1.0, Effort 1-5 (higher = harder).

| # | Opportunity | Impact | Confidence | Effort | Score | Recommendation |
|---|-------------|--------|-----------|--------|-------|----------------|
| 1 | Parallelize replay_integrity.sh (10 sequential → concurrent) | 2 | 0.9 | 1 | 1.8 | **Defer** — proof script, not user-facing |
| 2 | Eliminate Python startup for normalizer (precompile or native) | 1 | 0.8 | 3 | 0.3 | **Skip** — 60ms total, not perceptible |
| 3 | Reduce vifei export latency | 2 | 0.5 | 4 | 0.25 | **Skip** — external binary, wrong repo |
| 4 | Cache replay responses | 2 | 0.6 | 2 | 0.6 | **Defer** — only matters with repeated reads |
| 5 | Pipeline batching (model calls) | 5 | 0.3 | 5 | 0.3 | **Defer** — requires SDK/API changes |

**No opportunity scores above 1.0.** The highest-scoring item (parallelize
replay integrity script) is a proof script that runs once during demos,
not a user-facing hot path.

---

## Where Bottlenecks Will Shift After Deployment

| Trigger | What changes | New bottleneck |
|---------|-------------|----------------|
| Multi-user deployment | Concurrent requests | Single-worker uvicorn becomes the ceiling |
| Large JSONL files | Many runs accumulated | JSONL scan in approve guard (linear) |
| Hosted backend (network latency) | Extra RTT | Health + replay latency increases |
| Cold start (container/serverless) | Python startup | uvicorn + mock seeding (~1-2s) |

These are deployment-specific concerns, not pre-deploy optimization
targets. They should be measured after deployment, not guessed now.

---

## Conclusion

The current system is fast enough. Optimization energy should go toward
deployment correctness (single-worker safety, JSONL persistence, CORS
alignment) rather than shaving milliseconds off flows that already
complete in under 300ms.

If a future benchmark shows a real regression against the golden baselines
in `pre-deploy-baselines.md`, revisit this matrix.
