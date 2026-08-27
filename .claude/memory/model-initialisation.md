---
name: model-initialisation
description: "how a run's Y0 is seeded — the required injected inputs (volumes, cycle period) beyond the structural JSON, and where they come from"
metadata: 
  node_type: memory
  type: reference
  originSessionId: a355b600-0b54-40fa-81a6-191f2edd52a7
  modified: 2026-08-23T10:06:04.924Z
---

Every run's initial state `Y0` is seeded by `stateSetup.configureStates(sp,
modelStructure, mode, twinTargets=...)` (mode = baseline / calibration /
control). This is NOT optional: the raw generator init Euler-explodes (see the
Internals section in `.claude/rules/model-stack.md` — `V_La=0` also zeros membrane areas/flows),
so a run must start from the `configureStates` equilibrium init. In the batched
SI path it runs inside `runnerBatchSI.prepare` → `_prepareStages`, and its output
becomes `baseStates` → `baseVec` → the base `Y0`.

**Required injected inputs (beyond the model structural JSON), from the scenario
`shared.twin`** — set by `_configureCalibration` (`python/library/run/stateSetup.py`):

- **Compartment volumes**: `V_<comp> = twinTargets['TotalBloodVolume'] *
  volumeDistribution[comp]` for every compartment in `shared.twin.volumeDistribution`.
  Without this, total blood volume isn't conserved and the volumes never settle.
- **Cardiac cycle period**: every `Cyc_HC` state = `60 / twinTargets['HR']` (and
  `Cyc_RCLa` = `60 / twinTargets['RR']` when an `RR` target exists). This is an
  INPUT set by the driver, not a fit target — do not score `Cyc_HC` in a likelihood.
- **Per-mode calibration targets / control params**: pressures, SV (`CO/HR`), pulse
  amplitudes, etc. mapped from `twinTargets` onto each calibrator's `targetValue`
  (or, for State-type calibrators, its target state's `y0`).

**Overlay rule (batched / MCMC / population):** sampled params overwrite ONLY
their own state columns (`Y0[:, nameIdx[p]] = draw`); every other state — volumes,
`Cyc_HC`, unswept states — keeps its `configureStates` value. So the sampled 16
(R/C/E/V0) do not include the compartment volumes or cycle period; those come from
the twin via `configureStates` and stay put.
