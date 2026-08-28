---
name: smoke-test
description: Run the SMALLEST simulation that exercises a code change to the CardioPulmonary stack, to confirm it works end-to-end without a full calibration. Use when asked to smoke-test / sanity-check / quickly verify a change to library or library/hdf5, before committing, or after touching runner / modelEq / modelClass(SI) / stateSetup / postproc / a config JSON. Drives the real runner.run entry point on one short solve — never a real calibration.
---

# Smoke test — verify a change on the smallest possible run

A smoke test confirms a change to the stack still runs end-to-end and produces
finite, right-shaped output. It is NOT a calibration, a convergence sweep, or a
correctness proof — it is the cheapest run that actually exercises the changed
code path. Hard limit: **1 model, one ~10 s solve, save off.** ASK before anything
longer (more models, more simulated time, a real calibration/batch).

## The one load-bearing rule

A smoke test loads the committed **`python/config/scenarios/smoketest.json`** scenario,
which is purpose-built tiny: a 10 s solve, one controllers-on calibration stage,
a 2-phenotype population, and a 1-run baseline. It is a dedicated test *fixture*
— a legitimate scenario file under the single config surface
(`CLAUDE.md` "Cardiopulmonary model stack"), not a run definition to tune. So
the default path needs **no in-memory shrinking**: load `smoketest.json`, pick
the mode, run. Only knock down `runsToIgnore` / `runsToSave` / `runTime` on the
built dict when you must exercise a path `smoketest.json` doesn't already cover —
and never edit `smoketest.json` itself to chase a one-off.

## Invocation — you write it, the USER runs it

There is no venv here: the stack only exists inside the containers, and this repo's
CLAUDE.md forbids Claude from running `./run` or any docker command. A smoke test is
therefore a script you **hand to the user**, never one you execute.

Write the script into the scratchpad (or `python/`, which is bind-mounted at `/src`),
then give the user one command and wait for the output they paste back:

```bash
docker compose exec python python /src/<your-script>.py
```

The `python` service mounts `./python` at `/src`, so `import library.*` resolves.
Nothing needs forcing onto CPU — the image installs `jax[cpu]` and GPU is off by
design ([[gpu-no-benefit]]).

**Import ceiling:** the image has no `matplotlib`, so `library.viz.plots` and
`library.run.runIO` (which imports it at module level) are NOT importable there.
Everything else — `runner`, `utils`, `model/*`, `postproc/*`, `hdf5/*` — is. A
smoke script must therefore never import `runIO`; do saves and post-processing the
way `api/domains/medical/cardio_routes.py` does, via `library.hdf5.schema_sim` and
`library.postproc.resultsEngine` directly.

If the stack is not running, say so and let the user start it.

`jax.config.update("jax_enable_x64", True)` before the first solve to match the
stack's float64 default (the containers set `JAX_ENABLE_X64=1`). Keep
`output.save=False`, `plots=[]`, `postProcessing=None`, `printStatus=False` unless
the change is in one of those.

## Tiers — climb only as far as the change requires

### Tier 0 — import (no solve)
Cheapest check; catches syntax/import breakage: import the touched module. Do this
first whenever a broadly-imported module changed.

### Tier 1 — one short baseline solve (DEFAULT)
Baseline mode skips the whole calibration stage-walk, so it is the cheapest
end-to-end path through `initialiseModel → configureStates → prepareModel →
CardioPulmonaryModelArray → runSimulationArray → results`. ~2 s on CPU.

```python
import time, numpy as np
import library.run.runner as runner, library.utils as utils
import jax; jax.config.update("jax_enable_x64", True)

scenario  = utils.loadScenario("smoketest.json")   # already tiny — no shrinking needed
runConfig = {"model": "cvModel_linear.json", "scenario": "smoketest.json", "mode": "baseline",
             "output": {"save": False, "path": "smokeData", "name": "smoke"},
             "postProcessing": None, "plots": [], "printStatus": False}
sp = runner.buildSimulationParams(runConfig, scenario)   # baseline: one 10 s solve

t = time.time()
states, _, modelStructure, results, _ = runner.run(sp)
print(f"wall={time.time()-t:.2f}s  nPts={len(results['T'])}  nSignals={len(results)}")
assert all(np.all(np.isfinite(np.asarray(v))) for v in results.values()), "non-finite output"
```
Assert on: no exception, all signals finite, `len(results['T'])` ==
`runTime/dtDense` (1000 here), `T` spans `dtDense..runTime`. Verified baseline
(cvModel_linear.json + smoketest.json): ~3 s, 1000 pts, 109 signals, all finite.

### Tier 2 — one short solve on the stack you touched
Only when the change is in a path baseline doesn't reach. Same shrink principle;
pick the matching entry:

- **SI stack / solver work** (`modelClassSI`, `runCalibrationSI`, `solver.type`
  euler/rk4/adaptive): `smoketest.json` already carries a single controllers-on
  calibration stage, so just run it in calibration mode — no shrinking:
  ```python
  runConfig = {**runConfig, "mode": "calibration", "stack": "SI",
               "solver": {"type": "euler"}}
  sp = runner.buildSimulationParams(runConfig, scenario)
  states, _, _, results, _ = runner.run(sp)
  ```
  Verified (cvModel_linear.json + smoketest.json): ~1.9 s, 2000 pts, all finite. Swap
  `solver.type` to smoke a new integrator. The stage runs controllers on
  (`multiplierC = 1.0`), so you exercise the calibration *machinery* end to end;
  it is not a convergence proof.
- **Legacy calibration** (`runCalibration`): same, `stack` omitted (legacy
  default), euler-only.
- **Batched SI** (`runnerBatchSI.batchedCalibration`, `python/library/hdf5/raw_stream`,
  `schema_pop`): drive **1 lane** (`sampled_params` shape `(1, P)`) with the
  same single-stage shrink; assert the streamed `raw` tensor is `(1, T, C)` and
  finite. This is the ceiling for an unprompted smoke — do not raise lane count
  or add stages without asking.
- **hdf5 / postproc only**: run Tier 1, then hand the results to
  `library.hdf5.schema_sim` (write + reload the artifact) or
  `library.postproc.resultsEngine` (check the engine output) directly, instead of
  touching the solver. Note `runConfig["output"]["save"]` only lands in
  `simulationParams["saveToHDF5"]` — nothing in the library acts on it, so the
  caller does the write.

## Reporting

State the tier run, the wall time, and the assertions that passed (finite,
shape, T range) — or the exact exception + where it fired. If the change needs
more than one short run to be truly validated, say so and **ASK** rather than
escalating on your own.
