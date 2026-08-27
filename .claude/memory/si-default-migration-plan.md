---
name: si-default-migration-plan
description: "Rough plan to make the SI stack the default and migrate baseline/control/cpet onto it, then delete/refactor the legacy modelClass/modelEq stack. Currently only calibration can reach SI; baseline/control are hardwired to legacy."
metadata:
  node_type: memory
  type: project
  originSessionId: 15bbe054-ded2-47eb-876d-1e118dbf77cc
  modified: 2026-08-23T10:03:41.810Z
---

Goal: **SI becomes the one stack.** Make `modelClassSI`/`modelEqSI` the default, move
baseline + control + cpet onto it, then delete/refactor the legacy `modelClass`/`modelEq`
path. Rough plan only — not yet decision-checked; flesh out via the `plan` skill before building.
Solver internals in `.claude/rules/model-stack.md`. This plan is inherited work from
CardioPulmonaryModel ([[model-stack-upstream]]) — doing it here means doing it there
first, or the next sync conflicts.

**Re-verified 2026-08-23: nothing below has been built.** `runner.py:123` is still
`cfg.get("stack", "legacy")`, there is still no `runBaselineSI` / `runControlSI`, and
`runner.run` still branches on the stack in the calibration path only. The whole EFC paper
was produced on this fork as it stands, so the migration is unblocked by the paper and is
purely a cleanup decision now.

## Where we are today (the fork)
- `runConfig["stack"]` → `buildSimulationParams` → `simulationParams["stack"]`, default
  `cfg.get("stack", "legacy")` (`python/library/run/runner.py`).
- The stack switch **only branches in calibration**: `runner.run` calls `runCalibrationSI`
  when `stack=="SI"`, else `runCalibration`.
- **baseline + control are hardwired to legacy** — `runBaseline`/`runControl` build on
  `modelClass` and IGNORE the `stack` key. There is **no `runBaselineSI` / `runControlSI`**.
- SI solvers: euler/rk4 (fixed, vmappable) + dopri5/tsit5/dopri8/heun/bosh3 (adaptive). Legacy
  = 1 solver (hardwired `diffrax.Euler`). SI euler is the parity baseline (matches the Euler oracle).
- **cpet/gas exchange is structurally already on SI:** `modelClassSI` processes membrane +
  multi-flow gas flows (docstring: "14 membrane flows, 9 multi-flow gas flows"); `modelEqSI`
  only overrides the 5 cycle-operator classes, everything else (resistors/caps/membranes/
  reactions/gas) inherits from `modelEq`. So no new physics classes needed for cpet — but it
  has never been *run* end-to-end on SI. Needs a real gas-exchange solve to confirm (bigger
  than a smoke test → ASK first).

## Build items (rough order)
1. **`runBaselineSI`** — SI counterpart of `runBaseline`: `modelClassSI` prepare + `solveModelArray`,
   honouring `simulationParams["solver"]`. Watch the **solver trap** (model-stack rule): the SI
   baseline path currently reads solver from `modelStructure['simulationParameters']['solver']`,
   not the passed `sp` — pick one source and make it consistent.
2. **`runControlSI`** — SI multi-stage control (mirror `runControl`'s stage loop, but integrate
   with `modelClassSI.solveModelArray`; controllers already have SI-promoted algebraic forms).
3. **Wire dispatch** in `runner.run`: route baseline/control to the SI runners when `stack=="SI"`
   (same pattern the calibration branch already uses).
4. **Flip the default**: `cfg.get("stack", "legacy")` → `"SI"`; default solver `euler`.
5. **Parity gate (do before deleting anything):** SI-euler baseline / control / cpet must track
   the legacy `diffrax.Euler` results (near bit-for-bit for cardio; validate gas exchange on cpet).
   This is the go/no-go for retiring legacy. NOTE: the old parity harness
   (`python/run_test/hr.ipynb` = legacy oracle → `notebookData/test/results_hr_test_`, `python/run_test/hr_si.ipynb`
   = SI diff table) was **deleted 2026-08-10**; this gate needs a fresh harness.
6. **Migrate notebooks**: flip `python/run_cpet/*` and the control drivers to
   `stack:"SI"` in their `runConfig` (or just drop the key once the default flips). Keep single
   config surface — no new knobs.

## Delete / refactor once parity holds
- **Delete:** `python/library/model/modelClass.py`, `python/library/model/modelEq.py` (legacy equation classes),
  `runBaseline`/`runControl` (replaced by the SI runners), the `stack` branch + `stack` key itself.
- **Keep (shared, stack-agnostic):** `modelGen.py`, `treeCreation.py`, `stateSetup.py`,
  all of `postproc/`, `viz/`, `hdf5/`, `utils.py`, config, notebooks.
- **Rename after:** drop the `SI` suffix (`modelClassSI`→`modelClass`, `runCalibrationSI`→
  `runCalibration`, `runnerBatchSI`→`runnerBatch`) since there's only one stack left. Update
  imports, CLAUDE.md "Two stacks" section, and the `.claude/rules/model-stack.md` internals.

## Open risks / to resolve when planning for real
- Adaptive SI solvers are **diode-limited** (~260 steps/beat) — euler stays the default; not a
  blocker for making SI default, but don't advertise adaptive as production until valve events land.
- cpet gas-exchange on SI is untested end-to-end (the biggest unknown).
- Does control's per-stage mutation interact with SI's algebraic-output promotion of controllers?
  Verify controller updaters still hit the right slots on the SI structure.
