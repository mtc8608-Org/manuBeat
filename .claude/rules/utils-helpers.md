---
paths:
  - "python/library/**"
---

# Utils helpers (don't hand-roll)

`python/library/utils.py` is the shared helper module, imported everywhere as
`import library.utils as utils`. Before writing a path build, a JSON load/dump, a
clamp, a unit conversion, or a display label, check whether utils already provides
it — it almost certainly does. Never re-implement one of these inline; never
invent a second copy under a different name.

## The current surface — reach for these

- **Config paths** → `utils.configPath('models'|'scenarios'|'processing'|'plots', name)`
  or `utils.configPath('metadata.json')`. Never `os.path.join(..., 'config', ...)`.
- **Load a scenario** → `utils.loadScenario(name)` (= `loadJSONfile(configPath("scenarios", name))`).
  Load any other config JSON → `utils.loadJSONfile(utils.configPath(...))`. (There is no
  `loadModel` helper — models load via `loadJSONfile(configPath("models", name))`.)
- **Load model structure + metadata merged** → `utils.loadModelStructure(structPath, metaPath)`.
- **Serialise a modelStructure to a JSON string** (numpy/jax → list coercion) →
  `utils.modelStructureJSON(modelStructure)`. Never hand-roll
  `json.dumps(..., default=lambda o: o.tolist() ...)`.
- **Atmospheric offset / gauge steady-state** → `utils.obsOffset(name, atm)` and
  `utils.steadyState(results, name, atm)`. `atm` is passed explicitly
  (single-config-surface rule — it comes from `runConfig["analysis"]["atm"]`, never a
  module global in utils).
- **Clamp** → `utils.clamp(value, lo, hi)`.
- **Strip a trailing error suffix** → `utils.baseVarName(name)`.
- **Robust percentile y-limits** (nan/inf-safe, padded) → `utils.robustYLim(y, p=..., padFrac=..., symmetric=...)`.
- **Display / paper label for a variable** → `utils.labelFor(name, 'latex'|'plain'|'unit', default=...)`
  (data-driven from `python/config/labels.json`) and `utils.labelsFor(names, fmt)`. Never keep a
  local `paper_name` alias.
- **Colours** → `utils.getColors(n, type)`. **Sigmoid** → `utils.sigmoid(x,a,b,c,d)`.
  **Unit conversions** → `utils.paTOmmHg` / `mmHgTOPa` / … .
- **Dict lookups** → `utils.findKeyInDictionaryReturnValue`, `utils.findStrInDictionaryAndAddPrefix`.

This list is the source of record for the helper surface. Domain-coupled helpers
(twin schema, model stack, HDF5 layout) intentionally do NOT live here.

## Adding a new generic helper

A new generic, domain-free helper (path/JSON/string/numeric/label) goes **into utils.py**
with a default at the definition site — not into a call site or a second library
module. If the helper is domain-coupled (knows the twin schema, the model stack, the HDF5
layout), it does NOT belong in utils — place it by kind per [[model-stack]]
(run/ orchestration, postproc DAG, viz, hdf5 schema).
