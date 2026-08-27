---
name: gpu-no-benefit
description: "POLICY + benchmark — GPU is off by default EVERYWHERE (useGpu:False in every notebook, codified in CLAUDE.md); it gives NO wall-clock benefit and is 1.7–2.7x SLOWER than CPU for the batched SI calibration; drop the GPU-vs-CPU axis from the reviewer timing answer"
metadata: 
  node_type: memory
  type: project
  originSessionId: d2aca0df-74a7-4004-aaa5-311422fb5066
  modified: 2026-08-23T10:06:12.903Z
---

**Policy (2026-07-10): GPU is off by default everywhere.** `runConfig["device"]["useGpu"]`
is `False` in every notebook and must stay that way by default; this is codified as a HARD
RULE in the project `CLAUDE.md` ("GPU is off by default"). Only flip it True transiently for
a deliberate, documented benchmark, then revert — never commit a notebook with `useGpu:True`.
The reason is the benchmark below.

**GPU provides no speed benefit for this model — it is measurably slower than CPU.** Measured 2026-07-09 on this laptop (RTX 3050 6GB), one vmapped `runnerBatchSI.batchedCalibration` solve (SI stack, euler, float64, cvModel/sepsis, 2-stage compact walk, runTime=5), CPU vs GPU forced per-process:

| N (runTime=5) | CPU warm | GPU warm | GPU/CPU |
|-----|----------|----------|---------|
| 64   | 7.4 s   | 16.6 s  | 2.25x   |
| 256  | 28.1 s  | 47.0 s  | 1.67x   |
| 1024 | 194.6 s | 266.0 s | 1.37x   |

The gap narrows as N grows (GPU amortizes launch overhead better, and CPU starts saturating — its 256→1024 scaling is super-linear), but GPU never crosses over, even at N=1024 where CPU is worst. runTime doesn't rescue it either: at N=64, GPU stayed 2.0–2.7x slower across runTime 2→20 (2.0x@rt2, 2.25x@rt5, 2.73x@rt20 — longer runs = more sequential steps = *worse* for GPU). Both devices produce identical results (all lanes finite, same `(N, 88)` state shape); it is purely a wall-clock comparison. GPU loses on cold (JIT compile) too.

**Why:** the integrator is a long *sequential* `lax.scan` (~10k euler steps per internal run) over a *tiny* state vector (88 states), vmapped only across lanes. That's thousands of sequential kernel launches with negligible per-step work, so GPU launch/dispatch latency dominates and CPU wins. The ratio narrows as vmap width grows (GPU amortizes launch overhead better), but it does **not** cross over within the card's 6 GB, so more lanes won't rescue it. Batching itself is still the real lever — but on CPU (per the batch notebook's own header note: "batching speeds up the sweep even on CPU").

**How to apply:**
- Run the batch/convergence/calibration work on **CPU** (`runConfig.device.useGpu = False`). Don't reach for the GPU expecting a speedup.
- The published timing result reports CPU cost per calibration with the sequential-scan / tiny-state justification; no GPU sweep was ever run. Do not add one without a reason.

Reproduce: `scratchpad/gpu_vs_cpu_batch.py`-style throwaway (deepcopy scenario → compact 2 stages → `batchedCalibration` at chunkSize=N, timed cold+warm, `DEVICE=cpu|gpu` forced before `import jax`). Ported from CardioPulmonaryModel ([[model-stack-upstream]]).
