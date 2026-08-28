---
name: model-sandbox-schema
description: The Model Sandbox is driven by modelSchema.ts, a pure registry mirroring modelGen's JSON dispatch — where to change it, and the two config drifts its tests pin
metadata:
  node_type: memory
  type: project
---

# The Model Sandbox mirrors `modelGen`, declaratively

`pwa/src/pages/models/modelSchema.ts` is a React-free registry of **every `type` string
`python/library/model/modelGen.py` dispatches on**, the `params` each reads, and the
state names each registers. `ModelSandbox.tsx` renders it; `modelSchema.test.ts` asserts
it against the shipped `python/config/models/*.json` read off disk.

**Adding or changing an equation type is a one-place edit here.** Add the `TypeSpec` to
the right section of `SCHEMA` — `fields` drives the modal, `states(ctx)` mirrors what
modelGen registers — and the panels, forms, state seeding, validation and JSON writing
all follow. Never re-derive a state name or a param list at a call site.

Non-obvious invariants the registry encodes (all verified against modelGen):

- **Gas exchange is inferred from structure**, not from `configurations` — that block is
  overwritten wholesale from the scenario at load (`modelClass.py:78`). A model is on the
  gas path iff it declares `connections.membrane` or `reactions` (`inferGasExchange`).
- A **gas**-region compartment gets `V_<species>_<name>` instead of `V_<name>`; a
  **dissolved** one additionally gets `Y_<species>_<name>` for each species `> 0` in
  `config/metadata.json` (a `-1.0` means absent). Metadata reaches the browser through
  `GET /api/cardio/metadata`.
- **Membrane states are keyed `<from>_<to>`, not by the membrane's name** — cpet's
  `AlvMem` registers `area_R_La_Cp`.
- **`connections.bias` needs a key for every compartment AND every resistive AND every
  membrane entry**: modelGen resolves it with `utils.findStrInDictionaryAndAddPrefix`,
  whose return is unbound on a miss, so a gap is an `UnboundLocalError`, not a default.
- `calibration`/`control` **create no states**; an entry's key must equal
  `params.varToControl` and must already be a registered controllable parameter
  (`deriveParameterStates`), else the `if parameter == key` guard silently drops it.
- The `sigmoid` in `other` and the `sigmoid` in `control` share a name and nothing else —
  the schema is keyed on (section, type) for exactly this.
- Removal prunes only the names `deriveStates` attributes to the entry. The old page swept
  `key.endsWith('_' + name)`, which deleted `avg_P_As` and `Q_Hl_As` with compartment `As`.

## Two config drifts the tests pin (not bugs in the schema)

Both are named in `modelSchema.test.ts` so a *new* divergence still fails:

1. The shipped cvModel configs carry `Q_<from>_<to>` for plain resistors/diodes. Those
   flows are algebraic, so the names are not in `stateNames` and `encodeStates` ignores
   them. cpet carries only the four inertial ones.
2. `cvModel_linear_inertial*.json` make `Hl_As` a `diode_inertial` — which registers
   `L_Hl_As` — but never declare it in `states`; the run falls back to `params.L`.

`cpet.json` also keeps five orphan `connections.regions`/`cycles` keys (`Ah`, `Aa`, `Al`,
`Va`, `Vl`) from an older arterial/venous split. Nothing looks them up; the checks panel
reports them as warnings and they are deliberately left in place.

## Known gaps

- `components/charts/ModelCanvas.tsx` still draws only compartments and resistive
  connections — membranes, gas regions and controllers are invisible on it. (That file is
  also fork-only while sitting in the verbatim `components/` tree — pre-existing drift.)
- `POST /cardio/validate` (`python/api/domains/medical/cardio_routes.py`) is a stub that
  requires `configurations`, so it would reject every current config. Nothing calls it.
  The real structural check is `validateModel` in the schema module.

Related: [[model-stack-upstream]] (divergence 3 is the config normalisation this depends
on), [[model-initialisation]] (how `states` is merged over the generator defaults).
