---
name: population-notebook
description: Scaffold a new convergence / sweep driver notebook of the python/run_convergence family (serial or batched) — the two-phase config→run→save→load→analyse→plot layout on the array/SI stack. Use when asked to make a new population, convergence, LHS-study, OR any "run the model N ways and compare" notebook — including comparing solvers/integrators, dt values, or a config parameter across runs — or a batched/serial counterpart of one. Clones a canonical template and adapts it; never hand-rolls the loop, save, or plots.
---

# Population / convergence / sweep driver notebook

Create a new sweep-study notebook by **cloning the closest canonical template and
adapting it** — never build one cell-by-cell from scratch, and never invent a different
shape (e.g. a bare forward-solve with hand-rolled matplotlib). If the study is "run the
same model several ways and compare convergence / accuracy / time", it IS this family:
`load config+scenario → run loop → save via schema_pop → load → analyse → plot vs
target`. The two authorities are:

- `python/run_convergence/serial.ipynb` — **serial** driver (`runner.run` one sample at a
  time; per-run `runs/{id}/raw` groups via `schema_pop.add_run`; per-run wall timings).
- `python/run_convergence/batch.ipynb` — **batched** driver
  (`runnerBatchSI.batchedCalibration`, one vmapped solve; top-level `raw` tensor via
  `RawTraceStreamWriter` + `schema_pop.write_final_states`; amortized timings).

Two adapted family members to copy from when they fit better:
`python/run_test/solver_compare.ipynb` (serial, sweeps `runConfig["solvers"]` instead of LHS
rows) and `python/run_sepsis/gen_population.ipynb` (batched, per-phenotype LHS of clinical
targets). (Historically these were named `Convergence_Run*.ipynb` /
`Solver_Compare_Run.ipynb`; those files no longer exist — use the paths above.)

The two are kept section-for-section identical except where the storage/solve model
genuinely differs. A new notebook joins that family and must preserve the invariants
below. Respect the single config surface (`CLAUDE.md` "Cardiopulmonary model stack")
and the reuse guide ([[model-stack]]) throughout.

## The sweep axis is generalizable (read this first)

The template loops over `population.nrModels` LHS samples, but **the loop's iterable is
just the study axis** — a "run" is one point on that axis, `run_id = index`, and every
Phase-2 cell (load, error summary, boxplot, `plotCalibrationConvergence` vs target,
timings) is generic over "runs". So to compare the model N ways, **change only what the
run loop iterates**; keep the mode (usually `calibration`), `runner.run`, the target
array, the save, and the plots.

Worked example — **compare solvers** (`python/run_test/solver_compare.ipynb`): clone
`python/run_convergence/serial.ipynb`; keep `mode:"calibration"`, targets, save, plots. Take ONE set
of initial conditions (`sampled_params[population.sampleIndex]`) and iterate the run loop
over `runConfig["solvers"]` (e.g. euler/rk4/dopri5), rebuilding `simulationParams` per
solver (`runner.buildSimulationParams({**runConfig,"solver":ov}, scenario)`), writing
each as `add_run(run_id=str(i))` with `meta.solverLabels`. The convergence plots then
overlay each solver's calibration trajectory against the same targets. Same recipe for a
dt sweep or a config-parameter sweep: only the loop's iterable changes.

Do NOT, for such a study, switch to a baseline forward-solve, drop the target plots, or
hand-roll bar charts — that throws away the whole point (traces converging to target).

## Procedure

1. **Identify the sweep axis, then pick the variant.** The axis is what the run loop
   iterates: LHS population members (default), or solvers, dt values, a config
   parameter, … (see "The sweep axis is generalizable"). Then: serial for small N /
   reference parity / per-run timing; batched for 100s–1000s of models (one vmapped
   solve, streamed raw). If the ask is "the batched/serial version of X", clone X's
   counterpart. When unclear, ask.
2. **Copy the template** to the new name (e.g. `cp python/run_convergence/batch.ipynb
   python/run_mystudy/batch.ipynb`). Edit the copy — do not regenerate cells.
3. **Adapt the study-specific pieces only** (below). Leave the machinery cells
   (imports, LHS, run, load, error-summary, plots, cleanup) structurally intact.
4. **Keep serial↔batched parity.** If both variants exist for the study, mirror every
   change into both; the only allowed divergences are the storage/solve/timings ones
   listed under Invariants.
5. **Verify:** byte-compile every code cell, then run a tiny smoke sweep
   (`population.nrModels` = 1–2, `output.save` on) per the [[smoke-test]] limits — ASK
   before anything larger.

## Markdown cells: title + collapsible description (MUST)

Every markdown cell that has a heading followed by prose is **two** cells: a title-only heading
cell, then a description cell whose prose is wrapped in a collapsible `<details>` disclosure
(`<summary>` = first line of the prose, collapsed by default, blank line after `</summary>`). This
is the notebook-wide convention in [[notebook-cells]]; scaffold the pair from the start rather than
a single combined intro/section cell. Because each section heading is now a title+description pair,
the code-cell positions below are counted among these markdown pairs — treat the parenthetical cell
numbers as *role labels*, not literal indices.

## Section inventory (both variants, in order)

Phase 1 — run + save: (0) intro md · (1) **`runConfig`** · (2–3) Imports
[library-root bootstrap **first** (`chdir` up to the dir holding `library/`, i.e. `python/`), then the
device/precision block **before** `import jax`] · (4–5) assemble `simulationParams`
+ load the sweep config · (6–7) target array + offsets (`obsOffset`/`obsTarget`) ·
(8–9) LHS sample · (10–11) run the population + write artifact/timings/**progress trace**.

Phase 2 — load + analyse: (12–13) **load from file** (reconstruct `modelStructure`,
`obsMatrix`, `paramMatrix`, `finiteRow`, `timingMeta` — independent of Phase 1) ·
(14–15) **scope / rejection report** (why each run was dropped) · (16–17) error
summary · (18–19) boxplot · (20–21) LaTeX Table-5 · (22–23) observation convergence
plot · (24–25) parameter convergence plot · (26–27) timings · (28) deferred NN hook ·
(29) cleanup / release GPU memory.

## Run/plot separation (`runConfig["run"]` / `runConfig["plot"]`)

Two top-level booleans split the two phases so a notebook can run the full stack, just
run+save, or just load+plot:

- `run: True, plot: True` — full stack (sweep + save, then load + analyse + plot).
- `run: True, plot: False` — run + save only (headless generation of the artifact).
- `run: False, plot: True` — load + plot only, straight from the saved `.h5` (works on a
  fresh kernel; nothing from Phase 1 is needed in-session).

**Guard granularity (keep this exact split):** the setup cells — imports/device,
`runConfig`, `simulationParams`, targets (cells 0–7) — are **never** guarded; they always
run because both phases need them. `run` guards **only** the LHS-sample cell (9) and the
sweep + save cell (11). `plot` guards the load cell (13) and every Phase-2 cell after it
— scope/rejection report, error summary, plots, table, timings (15–27). Cleanup (29) is
unguarded. Guard by wrapping the cell body
`if runConfig["run"]:` / `if runConfig["plot"]:` inside the region markers. `output.save`
stays as the inner write gate under `run` (you can run without persisting).

Note: batched notebooks use a `plotOpts` dict for plot knobs (e.g.
`plotOpts.targetPoints`) — `plot` is reserved for the boolean switch, so never nest knobs
under `runConfig["plot"]`.

## What to adapt per study

- **`runConfig` cell** — the only place any knob lives. Change `model` / `scenario` /
  `output.name`, the `population` block (`nrModels`, `seed`, `errorTarget`), `solver`,
  and (batched) `chunkSize` / `saveRaw`. A new knob = a new `runConfig` key consumed
  with a `.get(key, default)` fallback; never a scattered constant. For a non-population
  axis, add the axis list here too (e.g. `solvers`, `dtValues`) + a selector like
  `population.sampleIndex` for the fixed init.
- **The run loop / sweep axis** (cell 11) — iterate the study axis. For a population it
  is `for i in range(nrModels)`; for another axis it is `for i, key in
  enumerate(runConfig[axis])` with `run_id=str(i)` and the axis labels in the artifact
  `meta`. Keep the try/except → sentinel, `add_run`, and per-run `runWall`; only the
  iterable and the per-iteration `override`/`simulationParams` change.
- **`obsTarget` / `obsOffset`** (target cell) — `obsTarget` derives each observation's
  target from the scenario (`shared.twin`, `volumeDistribution`, …) — the study's physics
  contract; rewrite it for the new targets, keeping the `(targetArr, offsetArr)` outputs
  and gauge convention. `obsOffset` is NOT rewritten: keep the one-line wrapper
  `def obsOffset(name): return utils.obsOffset(name, ATM)` (with `ATM =
  runConfig["analysis"]["atm"]`), and `steadyState` likewise wraps
  `utils.steadyState(results, name, ATM)` — see [[utils-helpers]]. Bare `obsOffset(o)`
  calls in later/Phase-2 cells rely on that wrapper name, so never rename it.
- **Parameter/observation source** — read from the scenario's sweep block (e.g.
  `convergence.parameters` / `.observations`); don't inline lists in the notebook.
- **Titles / file names** — `output.name`, the `.tex` path, plot title strings.

Reuse `python/library/utils.py` helpers throughout (never hand-roll, [[utils-helpers]]):
`scenario = utils.loadScenario(runConfig["scenario"])` (cell 5),
`utils.modelStructureJSON(prep["modelStructure"] or modelStructure)` for the
`init_population(model_structure=…)` arg (cell 11), and `utils.labelsFor` /
`utils.labelFor` for plot ticks + the LaTeX table. No inline `os.path.join(...,"config")`,
`json.dumps(..., default=lambda …)`, or `paper_name` alias.

## Live progress logging (display-as-it-runs + persisted trace)

Every driver in this family shows the **same** convergence line as it runs and persists
that trace for later comparison. The line is `mean|rel| / max|rel| / best` — obs-space
`|gauge obs − twinTarget| / |twinTarget|` reduced over the live population — formatted and
recorded by **one shared module, `library.run.progress`** (never re-paste the format or
the reduction into a notebook):

- `progress.obsTargetArrays(observations, twin, volumeDistribution, atm)` → the
  `(targetArr, offsetArr)` mapping (the single source of truth `buildSimulationParams`
  also uses; the notebook's `obsTarget`/`obsOffset` cell is the same contract).
- `progress.relErrorStats(gaugeObs, targetArr)` → `{meanRel, maxRel, bestRel}` (nan-safe).
- `progress.ProgressReporter` → `.emit(kind, label, done, total, elapsedWall, stats,
  acc=None)` prints the line and appends a record; `.records` is the persisted trace.

**Config knobs** (single config surface):
- `progressEvery` — EFC sim-time cadence in **simulated** seconds (default 10, `0` = off).
  Folds into the solver via `buildSimulationParams`; `debugEvery` is the deprecated alias.
- `output.logProgress` — persist the trace into the `.h5` (default `True`).
- MCMC drives its cadence from `inference.printEvery` (steps), not `progressEvery`.

**Serial family** (`serial.ipynb`, `solver_compare.ipynb`): the loop is in the notebook,
so build a `progressLib.ProgressReporter` before the run loop and `reporter.emit(...)` a
**population line over the runs completed so far** (`relErrorStats(obsMatrix[:done],
targetArr)`) at the `printEveryPct` cadence; set `progressEvery: 0` (within-sample
sim-time ticks off — the per-iteration line is the live view). Persist with
`schema_pop.write_progress(outPath, reporter.records, meta=…)` next to `write_timings`.

**Batched family** (`batch.ipynb`, `gen_population.ipynb`): the notebook blocks inside one
`batchedCalibration` call, so the line is emitted **inside** the library `_tick` (every
`progressEvery` sim-seconds over the vmapped population). Keep `progressEvery: 10`; after
the call, persist the returned trace: `schema_pop.write_progress(outPath,
batch["progress"], meta=…)`.

Read any run's trace back uniformly with `schema_pop.read_progress(path) → (values,
columns, meta)`. When cloning a template, this wiring comes with it — preserve it.

## Invariants (do not break)

- **Every code cell is region-wrapped (MUST).** The first line of every code cell is
  `# region -> <what the cell does>` and the last line is `# endregion`. No exceptions —
  new cells, adapted cells, and edited template cells alike.
- **Single config surface.** Every tunable flows default → `python/config/models|scenarios/*`
  JSON → `runConfig`. No env var, module global, extra config cell, or literal knob.
- **Library-root bootstrap at the top of the imports cell (MUST).** These notebooks live in
  `python/run_*/` subfolders but `import library` (top-level) and use relative `notebookData/`/`config/`
  paths, so the kernel breaks when the cwd is the subfolder. The imports cell must start by
  walking up from `os.getcwd()` to the first ancestor containing `library/` (`python/`), then
  `sys.path.insert(0, root)` + `os.chdir(root)` — before any `library` import or path use.
- **Device/precision block runs before `import jax`** (sets `JAX_PLATFORMS`, x64).
- **Reuse the stack, not the notebook:** run via `runner.run` (serial) /
  `runnerBatchSI.batchedCalibration` (batched); persist via `python/library/hdf5/schema_pop`
  (+ `raw_stream` for batched); plot via `libPlots.plotCalibrationConvergence` /
  `plotRunTimings`; report dropped runs via `library.postproc.reporting`. No inline
  integrator, save format, matplotlib, or scope-report block.
- **Live progress via `library.run.progress`, persisted via
  `schema_pop.write_progress`.** Show the standard convergence line as the sweep runs and
  log its trace — serial builds a notebook `ProgressReporter` (per-iteration population
  line, `progressEvery: 0`); batched keeps `progressEvery: 10` and the line comes from the
  library `_tick` (persist `batch["progress"]`). Never re-paste the line format or the
  `|rel err|` reduction into a cell — see "Live progress logging".
- **Phase 2 is self-contained** — the load cell rebuilds everything from the `.h5`, so
  analysis works after a kernel restart without re-running the sweep.
- **Run/plot switch** — `runConfig["run"]` / `runConfig["plot"]` booleans gate the two
  phases exactly as described under "Run/plot separation" (setup always runs; `run`
  guards cells 9+11; `plot` guards cells 13–27). `plot` is a boolean — batched plot knobs
  live under `plotOpts` (e.g. `plotOpts.targetPoints`), never `runConfig["plot"][...]`.
- **Bad-run filtering has one source: `schema_pop.good_run_mask(obsMatrix,
  divergence_limit, param_matrix=…)`.** It returns the per-run keep mask (drops
  sentinel-marked, NaN, and out-of-scope runs — *broken only*; a clean run that missed
  `errorTarget` is kept). A run is out of scope when **any observation OR any
  swept/calibrated parameter** reaches `|value| >= divergence_limit` — so ALWAYS pass
  `param_matrix` (the run-end parameter values: batched → `finalStates`/`lastRow` param
  columns, serial → `grp[p].flat[-1]` per run) alongside `obsMatrix`; a run whose
  observation stays finite but whose parameter blows up is still BAD. Bad runs are also
  *marked* at save (`_sanitize` → `BAD_RUN_SENTINEL`); the mask *drops* them at load.
  Every `good`/`finiteRow` call (serial + batched, Phase 1 save AND Phase 2 load/error
  summary) goes through it — never re-inline `~np.any(obs <= sentinel+1) & ~isnan(...)`
  or `isfinite & abs < divLimit`. `divergence_limit` is the single scope-threshold knob:
  `runConfig["analysis"].get("divergenceLimit", 1e6)` — **standard value `2000.0`** in
  the runConfig (the physiological-scope ceiling; library default is `1e6`). Tune it
  there; never add a second limit knob.
- **Scope / rejection report cell (Phase 2, right after load) — one shared function,
  never inlined.** The report is `library.postproc.reporting.scopeRejectionReport(rawObs,
  paramMatrix, observations, paramNames, lim=…)`: it recomputes the keep mask via
  `good_run_mask`, prints total kept/dropped + per-reason counts (sentinel / NaN /
  observation-out-of-scope / parameter-out-of-scope — a run can trip several), renders the
  offending-signals table and the genuine (non-sentinel) divergence-drivers table, and
  returns `ScopeReport(keep, offenders, diverged)`. The cell is just the `rawObs` prep +
  this one call — do NOT re-inline the counts/offenders/divergence blocks (that inline copy
  is exactly the drift this function removed). `rawObs` is the **pre-blanking** gauge obs
  (batched/tensor → rebuild from `lastRow`+`sigIdx`; serial → pass `obsMatrix` directly),
  `paramNames` matches `paramMatrix`'s columns (`paramInScope`), and
  `lim = runConfig["analysis"].get("divergenceLimit", 1e6)`. Both variants carry it. Where
  the study has phenotypes (sepsis), the per-phenotype kept/dropped table is a **separate
  follow-on cell** keyed off `rep.keep` — the shared function stays phenotype-agnostic.
- **Convergence-plot calls stay minimal** — `plotCalibrationConvergence(traces,
  traceT=…, targets=…/ranges=…, offsets=…, paramForObs=…, showLegend=…, title=…)`,
  default `nrCols`, no `showRuns` cap, so serial and batched render identically.
- **Variant-specific divergences (the only ones allowed):**
  - Serial writes per-run `runs/{id}/raw` groups (`add_run`) and per-run `runWall` →
    `write_timings` → `plotRunTimings` (bar/hist).
  - Batched streams one top-level `raw` (N,T,C) tensor (+ optional `raw_coarse`),
    `write_final_states`, and a single `total_wall` → amortized timings table (no
    per-run plot). Its load/plot cells read the `raw`/`raw_coarse` tensor, not `runs/`.
