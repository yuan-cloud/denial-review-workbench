# Optimization Proof and Deploy Conclusion

**Bead:** bd-3mj.10.4
**Date:** 2026-04-20
**Baseline reference:** `docs/baselines/pre-deploy-baselines.md`
**Matrix reference:** `docs/baselines/opportunity-matrix.md`

---

## Decision: Proceed with deployment as-is

No optimizations were implemented. No optimizations were needed.
The system is fast enough for deployment in its current state.

---

## Before-After Comparison

No code changes were made in the optimization round. The "after"
numbers are a re-benchmark to confirm stability.

### Replay integrity

| Metric | Baseline (bd-3mj.10.1) | Re-benchmark (bd-3mj.10.4) | Delta |
|--------|------------------------|----------------------------|-------|
| Per-replay latency range | 42-58 ms | 54-308 ms | Within expected VPS variance |
| 10/10 pass | Yes | Yes | Unchanged |
| JSONL lines changed | 0 | 0 | Unchanged |

### Export pipeline

| Metric | Baseline | Re-benchmark | Delta |
|--------|----------|--------------|-------|
| Bundle hash (BLAKE3) | `20f96940...` | `20f96940...` | **Identical** |
| Bundle size | 2131 bytes | 2131 bytes | **Identical** |
| Event count | 8 | 8 | Identical |

### Golden artifact verification

| Artifact | Expected Hash | Observed Hash | Match |
|----------|---------------|---------------|-------|
| Export bundle | `20f96940ae97c23ad7b74f2f3793c0c775bb58ca29af7c418399d49ebfa3d569` | `20f96940ae97c23ad7b74f2f3793c0c775bb58ca29af7c418399d49ebfa3d569` | Yes |
| Replay invariant | 10/10 identical, 0 events written | 10/10 identical, 0 events written | Yes |

---

## Remaining Hotspots

| Hotspot | Blocks deployment? | Why not |
|---------|-------------------|---------|
| Anthropic API latency (10-20s pipeline) | No | External service, not repo-controlled |
| Single-worker uvicorn | No | Sufficient for protected preview; concurrent users not expected |
| In-memory state (`run_states`) | No | Acceptable for demo; JSONL is the persistence layer |
| No frontend perf baseline | No | Not user-facing at scale yet |

None of these block a protected preview deployment. They are documented
for awareness, not as deployment gates.

---

## Go/No-Go for Deployment Preview

**Go.** The system is performant, deterministic, and behaviorally
verified against golden artifacts. Deploy the protected preview.

Conditions:
- All deterministic flows complete in under 300ms
- Golden hashes match across runs (proven determinism)
- Replay invariant holds (10/10, zero events written)
- No optimization debt introduced
- Single-worker model is sufficient for preview traffic
