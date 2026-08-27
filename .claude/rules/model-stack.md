---
paths:
  - "python/library/**"
  - "**/*.ipynb"
---

# Code reuse (non-negotiable)

Always extend the existing stack. Only add a new file/class when the behaviour
is genuinely new and cannot be expressed by parameterising something that
exists. The array stack (`modelEq` → `modelGen` → `modelClass`/`modelClassSI`),
orchestrated by `run/runner.py`, is the pattern authority — see the "Cardiopulmonary model stack"
section in `CLAUDE.md` and the Internals section at the bottom of this file.

**Why:** physics inlined in a notebook, a bespoke integrator loop, an ad-hoc
save format, or a per-notebook config constant all diverge from the
JSON-driven, single-config-surface design and rot immediately. This holds even
for "quick" one-off cells.

Before writing new code, map the need onto the guide below and confirm against
the cited source.

## The hard rule that overrides everything: single config surface

A configurable value exists in exactly three places (`CLAUDE.md`, "Cardiopulmonary model stack" → single config surface): (1) a default at the definition site, (2) `python/config/models/*`
or `python/config/scenarios/*` JSON if it's part of the experiment definition, (3) the
notebook `runConfig` dict as the per-run override, wired through
`runner.buildSimulationParams` → `simulationParams`. Never add a knob that needs
editing library source, and never invent a second override mechanism (env var,
module global, extra config cell, hard-coded literal). **Why:** a tunable that
lands only in library source or scenario JSON (as `maxCubicFactor` once did) can't
be swept from a notebook and silently rots — every knob must reach `runConfig`.

## Decision guide (the single right choice for each need)

- **New physical element** (compartment, resistor, capacitor, valve, gas
  exchange, cycle/timing op) → add an `eqx.Module` class in `model/modelEq.py`
  under the matching `# region` (CAPACITORS / RESISTORS / Cycles / GAS EXCHANGE
  / MATH OTHER), and wire it from JSON via `modelGen`. Never write ODE math
  inline in `modelClass`, the runner, or a notebook.
- **New controller law** → a new class in modelEq's `# region Controllers`,
  mirroring `LocalCubicController` (its `cube()` is already
  `error³·cubicFactor + error·linearFactor`, so cubic/linear is a config knob —
  don't fork a class to get a linear variant). See the Internals section below
  for which classes depend on `self.step`.
- **New / different integrator** → extend the solver dispatch in
  `modelClassSI.solveModelArray` / `solveFinalArray` (`euler`/`rk4`/adaptive
  diffrax already wired), selected via `runConfig` `solver`. Never hand-roll an
  Euler/RK loop in a notebook.
- **New tunable / constant** → the single config surface above. A new notebook
  knob = a new `runConfig` key consumed with a `.get(key, default)` fallback.
- **Initial state / equilibrium setup** → `run/stateSetup.py`
  (`configureStates` + the per-mode configurators like `_configureCalibration`);
  see `CLAUDE.md` "Cardiopulmonary model stack". Never build init vectors ad hoc in a notebook.
- **Run orchestration** (baseline / control / calibration, single or staged) →
  the `run/runner.py` entry points (`runBaseline`, `runControl`,
  `runCalibration`, `runCalibrationSI`, `run`) fed by `buildSimulationParams`.
  Notebooks are I/O only (`CLAUDE.md` "Cardiopulmonary model stack") — no physics/orchestration
  in a cell.
- **Population / batched runs** → `run/runnerBatchSI.batchedCalibration`
  (vmapped `(N,P)` sweep). Never loop the model sample-by-sample in a notebook.
- **Post-processing / derived variables** → the `postproc/resultsEngine.py` DAG
  (`ResultsEngine` / `runEngine`; `dataProcessing.processVariables` is the shim;
  `toPayload` for web, `computeModelDerived` for model-backed ops). See the repo
  `CLAUDE.md` Architecture. Never compute derived quantities inline in plot/analysis
  cells.
- **Plotting** → the `viz/plots.py` builders (`buildPlot` dispatcher +
  `build*` functions; `plotCalibrationConvergence` for convergence traces).
  Never hand-roll matplotlib per notebook.
- **Persistent storage** → the `python/library/hdf5/` module (`engine.py`, `schema_sim` /
  `schema_pop` / `schema_calib`, `raw_stream.py` for streaming, `migrate.py`).
  See [[model-stack-upstream]]. Never invent a new save format or pickle.
- **Single-run save → process → plot** (the notebook I/O sequence after a
  `runner.run`) → `run/runIO.py` (`saveRun` / `saveConfig` / `processResults` /
  `saveProcessed` / `plotResults`, wrapping hdf5.schema_sim + resultsEngine + viz).
  Never re-inline the save/process/plot block in a notebook — call `runIO.*`.
  (Population/sweep notebooks persist via `schema_pop` + `raw_stream` instead.)
- **Config / structure file paths** → `utils.configPath(*parts)` and
  `utils.loadModelStructure`. Never hard-code a path.

## When nothing fits

Classify the need as exactly one of:
- **(a) Covered** — name the class/function and the config/JSON to drive it.
- **(b) New parameter on an existing piece** — name it and sketch the knob
  (with its default → JSON → `runConfig` wiring).
- **(c) Genuinely new** — justify why no parameter expresses it, then place it
  by kind: physics → a modelEq class; orchestration → a runner function;
  derived output → a resultsEngine op; storage → an hdf5 schema. A new
  standalone constant or notebook config cell is never the answer.

## Internals & invariants (don't break)

The array/SI stack depends on these. Verify against current code before relying
on a line number; these are behavioural invariants, not a change log.

**Array mode (single flat `jnp` vector, integer indexing, under jit):**
- `Capacitor.pressure` (all capacitor classes) MUST gate on
  `isinstance(self.volIdx, int)`, NOT `if self.volIdx in y:` — on a `jnp` array
  the latter tests *value* membership and silently breaks arterial-pressure results.
- `cpModel` is a static jit arg → must be **hashable** → slot indices are plain
  Python `int` lists, NOT `jnp` arrays; wrap with `jnp.asarray(...)` inside
  `__call__` (constant-folded). The multi-flow index maps are precomputed in
  `prepareModel` before resolving.
- Results merge algebraic **flows then states** (states win on name collisions).
  `prepareModel` emits `outputNames` = resistor/membrane/multi-flow flow names.

**Integrator (original stack):** MUST be fixed-step `diffrax.Euler`. The model is
stiff (step operators deadbeat near cycle triggers) — a ~1e-14/step difference can
flip a `PeriodicTrigger` one step and diverge to NaN over a long run. Never
hand-roll a `lax.scan` Euler on the original stack. Runs MUST start from the
`stateSetup` equilibrium init (the raw generator init Euler-explodes; its `V_La=0`
also zeros membrane areas/flows).

**Step operators (`modelEq`):** classes that divide by `self.step` require
`step == dt`: P1 relaxation `(target−X)/step` (Capacitor/Elastance* pressures,
ChemicalEquilibrium, PolynomialController, SubstactStates, …), P2 timer/trigger
reset (`PeriodicTrigger`), P3 cycle accumulators (`CycleIntegrator/Keeper/Max/Min`).
Already step-independent (store `step` but don't use it): `Resistor`, `Diode`,
`MovingAverage`, `LocalCubicController` (bounds by `k`), `ConstantPressure`.

**SI stack (`modelEqSI` / `modelClassSI`, step-independent fork):** `modelEqSI`
defines step-free subclasses — `PeriodicTriggerSI` (dTrigger=0/dTimer=1 + resets),
`CycleIntegratorSI`, `CycleKeeperSI`, `CycleMaxSI`/`CycleMinSI` (projection-based,
not `/step`) — and promotes pressures/`SubstactStates`/`PolynomialController` to
algebraic outputs. `solveModelArray` dispatches on `solver['type']`
(`euler` jitted `lax.scan` with `applyProjections`→`applyResets`; `rk4`; adaptive
diffrax with a per-beat `Event`). Solver config lives in
`scenario.shared.integration.solver`, overridable per-key via `runConfig["solver"]`.

**Solver trap:** the SI *calibration* path honors the solver in the passed
`simulationParams['solver']`, but the SI *baseline* path
`modelClassSI.runSolverArray` reads it from
`structures['modelStructure']['simulationParameters']['solver']`, ignoring the
passed `sp`. Matters only for baseline solver swaps.

**Cardio-only models** (e.g. `cvModel`): `connections` has no `membrane` key, so
`modelGen` reads it as `connections.get('membrane', {})` (like the `trees`/
`reactions` guards). Everything else runs unchanged.

**Known limitation:** adaptive RK45 (Dopri5) runs the SI stack end-to-end but is
diode-limited (~260 steps/beat vs ~14 clean) — the valve open/close
discontinuities force tiny steps. A usable variable-step solver needs **diode
events** (root-find valve crossings); until then keep `dt == step == 5e-4` on the
integrated stack.
