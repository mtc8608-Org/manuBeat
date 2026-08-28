---
name: model-sandbox-schema
description: The Model Sandbox is driven by modelSchema.ts, a pure registry mirroring modelGen's JSON dispatch — where to change it, the two config drifts its tests pin, and how ModelCanvas + model_configs.layout hang off it
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

## The shipped configs carry no drift — `validateModel` returns zero findings

There used to be three tolerated divergences; all were fixed in the configs on 2026-08-28
and `modelSchema.test.ts` now asserts a clean profile (`expect(profile).toEqual([])` and an
unconditional derived-vs-declared match), so any NEW drift fails the suite rather than being
added to an exemption list. What was removed, for when one of these reappears:

1. The cvModel configs declared a `Q_<from>_<to>` per plain resistor/diode. Those flows are
   algebraic, so the names were never in `stateNames` and `encodeStates` ignored them.
2. `cvModel_linear_inertial*.json` make `Hl_As` a `diode_inertial`, which registers
   `L_Hl_As`, but did not declare it; the run fell back to `params.L`. They now declare
   `L_Hl_As: 0.01`, the same value, so nothing about the run changed.
3. `cpet.json` kept five orphan `connections.regions` AND `connections.cycles` keys (`Ah`,
   `Aa`, `Al`, `Va`, `Vl`) from an older arterial/venous split — 10 keys, though the checks
   panel only walks `regions` and so reported 5.

The same sweep cleaned the other three config kinds (dead scenario stage keys, a
zero-producing processing stage, archived plot `saved`/`axes_Saved` blocks); the audit that
found them cross-references disk against `resultsEngine.opDependencies` and `buildPlot`.

## The canvas mirrors the registry too, and is pinned the same way

`components/charts/ModelCanvas.tsx` draws every structural key a model carries, each behind
a layer toggle: compartments (styled by `capacitor.type`), `connections.resistive` (valve
and inductor glyphs per type), `connections.membrane` (dashed, arrowless — diffusion runs
both ways), `connections.bias`, `connections.regions` (containment envelopes),
`connections.cycles` and `reactions` (badges, the latter resolved through the compartment's
`gasRegion`). Its three style maps — `NODE_STYLE`, `EDGE_STYLE`, `MEMBRANE_STYLE` — are
keyed on the registry's own type strings and **`ModelCanvas.test.ts` asserts set equality
against `SCHEMA`**, so adding an equation type to `modelSchema.ts` without styling it fails
the suite. It used to know 3 of 9 compartment and 2 of 5 resistive types, which is why
cpet's `elastanceInput` hearts and `diode_inertial` valves rendered as anonymous grey blobs
and the three tissue compartments floated unconnected.

`autoLayout` is pure and deterministic, from structure alone — no compartment name is
hardcoded, because the shipped configs disagree on them (`cvModel`'s `Cs` vs cpet's
`Ch`/`Ca`/`Cl`). It bands the graph: pump-free flow components (the airway) on top, then
each circulation split at its pumps into a pulmonary and a systemic half — the half holding
an alveolar membrane's partner is pulmonary, and consecutive halves alternate column
direction so the loop closes as a racetrack — then membrane-only compartments under their
partner, then the unwired rail of references and containers.

**Canvas state is NOT in the model JSON.** Node positions, the pan/zoom transform and the
layer toggles live in `model_configs.layout` (`ModelLayout` in `interfaces/types.ts`), added
to `02-init-medical.sql` with `DEFAULT '{}'`. The model config stays exactly the document
`python/library` consumes, `scripts/gen-physiology-seed.py` never writes the column, and the
Sandbox's one Save button writes both through `updateModelConfig`. A commit always emits the
**resolved** positions (auto ∪ dragged), so freezing captures what is on screen.

`ModelCanvas.tsx` and its test are fork-only files sitting in the verbatim `components/`
tree — pre-existing drift ([[fork-verbatim-surface]]), deliberately left in place.

## Known gaps

- `POST /cardio/validate` (`python/api/domains/medical/cardio_routes.py`) is a stub that
  requires `configurations`, so it would reject every current config. Nothing calls it.
  The real structural check is `validateModel` in the schema module.

Related: [[model-stack-upstream]] (divergence 3 is the config normalisation this depends
on), [[model-initialisation]] (how `states` is merged over the generator defaults).
