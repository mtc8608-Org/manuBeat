// Module: modelSchema — the sandbox's mirror of the model library's JSON dispatch surface.
// Pure (no React, no API): every equation type python/library/model/modelGen.py branches on,
// the params it reads, and the states it registers. ModelSandbox renders it; the tests assert it.
//
// WHY THIS EXISTS. `modelGen` is the single JSON→objects compiler: `initCapacitor`,
// `initResistors`, `initMembraneResistor`, `initReactions`, `initOtherCalculations`,
// `initOtherModelDependentCalculations`, `initTimekeeping` and `initParameterVariation`
// each switch on a `type` string and register state names built from fixed prefixes
// (python/config/metadata.json → data.prefixes). The sandbox used to hard-code a subset of
// that knowledge inline, so it could not author gas-exchange models and mis-seeded `states`.
// Here it is declared once, next to the line of modelGen it mirrors, so a divergence is a
// failing unit test rather than a model that will not run.
//
// The library is the authority. If a spec here and modelGen disagree, modelGen is right.

import { ModelMetadata, GasRegion } from '../../interfaces/types';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Editable sections of a model JSON. `resistive` and `membrane` both live under
 *  `connections`; the rest are top-level keys. */
export type Section =
  | 'compartments'
  | 'resistive'
  | 'membrane'
  | 'cycles'
  | 'other'
  | 'reactions'
  | 'calibration'
  | 'control';

export type FieldKind =
  | 'number'          // plain float
  | 'text'            // free string
  | 'select'          // fixed option list
  | 'stateRef'        // the NAME of another state (e.g. thorax uVol, elastanceInput E)
  | 'parameterRef'    // the name of a CONTROLLABLE parameter — the only valid controller target
  | 'compartmentRef'  // a compartment name
  | 'cycleRef'        // a key of the top-level `cycles` section
  | 'gasRegionRef'    // a key of metadata.gasRegions
  | 'stateList'       // comma-separated list of state names
  | 'speciesList'     // comma-separated list of species names
  | 'ratioList';      // comma-separated list of numbers

export interface FieldDef {
  name:      string;
  label:     string;
  kind:      FieldKind;
  /** The library defaults this when absent — the modal may leave it blank. */
  optional?: boolean;
  /** Present in shipped configs but never read by modelGen; kept so values round-trip. */
  inert?:    boolean;
  note?:     string;
  options?:  { value: string; label: string }[];
}

/** One state name the library registers for an entry.
 *  `param` — registered in `modelParams` with a `NoController`, so `calibration`/`control`
 *  may target it. `shared` — written only if absent (first writer wins), e.g. the
 *  `t_Sys_<cycle>` pair and a reaction's `k_`/`Kratio_`. */
export interface StateSeed {
  name:   string;
  value:  number;
  param?: boolean;
  shared?: boolean;
}

export interface EntityCtx {
  /** The entry's key in its section (compartment name, `<from>_<to>`, membrane name, …). */
  key:      string;
  params:   Record<string, any>;
  model:    ModelJson;
  meta:     ModelMetadata | null;
  /** True when the run builds the gas-exchange stack — see `inferGasExchange`. */
  gas:      boolean;
  from?:    string;
  to?:      string;
  /** `reactions` only: the gasRegion the reaction block is filed under. */
  region?:  string;
}

export interface TypeSpec {
  label:   string;
  /** Fields inside the entry's `params` (or, for `reactions`, its flat body). */
  fields:  FieldDef[];
  /** The states modelGen registers for this entry. */
  states:  (ctx: EntityCtx) => StateSeed[];
}

export interface SectionSpec {
  label: string;
  /** Fields that identify the entry rather than parameterising it. */
  meta:  FieldDef[];
  types: Record<string, TypeSpec>;
}

export type ModelJson = Record<string, any>;

export interface Finding {
  level:   'error' | 'warning';
  message: string;
}

// ── Small helpers ─────────────────────────────────────────────────────────────

const num = (v: any, fallback = 0): number => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};

const list = (v: any): string[] =>
  Array.isArray(v) ? v.map(String)
    : String(v ?? '').split(',').map(s => s.trim()).filter(Boolean);

const numList = (v: any): number[] =>
  Array.isArray(v) ? v.map(x => num(x))
    : String(v ?? '').split(',').map(s => num(s.trim()));

/** The gas region a compartment sits in, or null when metadata is unavailable or the
 *  region name is not one metadata declares (modelGen would KeyError on that). */
export function gasRegionOf(
  model: ModelJson, meta: ModelMetadata | null, compartment: string,
): GasRegion | null {
  const name = model?.compartments?.[compartment]?.gasRegion;
  if (!name || !meta?.gasRegions) return null;
  return meta.gasRegions[name] ?? null;
}

/** Species present in a region: metadata lists every species, and a -1.0 entry means
 *  ABSENT — modelGen skips those, so they must not reach a picker or a state. */
export function speciesOf(region: GasRegion | null): string[] {
  if (!region) return [];
  return Object.entries(region.gases).filter(([, v]) => v > 0.0).map(([g]) => g);
}

/** A model builds the gas-exchange stack when it declares membranes or reactions.
 *  `configurations.simulationParameters.gasExchange` cannot answer this: modelClass
 *  (`modelClass.py:78`, `modelClassSI.py:86`) overwrites that whole block from the
 *  scenario before the generator runs, which is why cpet.json omits it entirely. */
export function inferGasExchange(model: ModelJson): boolean {
  const membranes = Object.keys(model?.connections?.membrane ?? {}).length;
  const reactions = Object.keys(model?.reactions ?? {}).length;
  return membranes > 0 || reactions > 0;
}

// ── Compartments — initCapacitor (modelGen.py:628-991) ────────────────────────

// Every capacitor type ends at the common tail (modelGen.py:979-988): a gas-state
// compartment gets one partial volume per species (`V_<gas>_<n>` = y0 × share) INSTEAD of
// `V_<n>`; every compartment gets `P_<n>` = p0. Dissolved compartments additionally get one
// concentration per present species (`Y_<gas>_<n>`, initGasExchange at :1451).
function compartmentTail(ctx: EntityCtx): StateSeed[] {
  const { key, params, gas, meta, model } = ctx;
  const out: StateSeed[] = [];
  const region = gas ? gasRegionOf(model, meta, key) : null;

  if (region?.state === 'gas') {
    for (const [species, value] of Object.entries(region.gases)) {
      out.push({ name: `V_${species}_${key}`, value: num(params.y0) * (value / region.total) });
    }
  } else {
    out.push({ name: `V_${key}`, value: num(params.y0) });
  }
  out.push({ name: `P_${key}`, value: num(params.p0) });

  if (region?.state === 'dissolved') {
    for (const species of speciesOf(region)) {
      out.push({ name: `Y_${species}_${key}`, value: region.gases[species] });
    }
  }
  return out;
}

/** `y0` seeds the volume state and `p0` the pressure state, for every capacitor type. */
const CAP_TAIL_FIELDS: FieldDef[] = [
  { name: 'y0', label: 'Initial Volume (y0)',   kind: 'number' },
  { name: 'p0', label: 'Initial Pressure (p0)', kind: 'number' },
];

/** The cycle a compartment is wired to, from `connections.cycles` — `elastance` and
 *  `ventilator` read it and TypeError on an empty value. */
const cycleOf = (ctx: EntityCtx): string => ctx.model?.connections?.cycles?.[ctx.key] ?? '';

const COMPARTMENT_TYPES: Record<string, TypeSpec> = {
  capacitor: {
    label: 'Capacitor',
    fields: [
      { name: 'C',  label: 'Compliance (C)',       kind: 'number' },
      { name: 'V0', label: 'Unstressed Volume (V0)', kind: 'number' },
      ...CAP_TAIL_FIELDS,
    ],
    states: ctx => [
      { name: `C_${ctx.key}`,  value: num(ctx.params.C),  param: true },
      { name: `V0_${ctx.key}`, value: num(ctx.params.V0), param: true },
      ...compartmentTail(ctx),
    ],
  },

  elastance: {
    label: 'Elastance',
    fields: [
      { name: 'Emax',           label: 'Max Elastance (Emax)', kind: 'number' },
      { name: 'Emin',           label: 'Min Elastance (Emin)', kind: 'number' },
      { name: 'systolicTime',   label: 'Systolic Time',        kind: 'number',
        note: 'Seeds t_Sys_<cycle>, shared by every entry on that cycle — the first one wins.' },
      { name: 'transitionTime', label: 'Transition Time',      kind: 'number',
        note: 'Seeds t_transition_<cycle>, shared the same way.' },
      { name: 'V0',             label: 'Unstressed Volume (V0)', kind: 'number', optional: true, inert: true,
        note: 'Carried by the cvModel configs; ElastanceCapacitor never reads it.' },
      ...CAP_TAIL_FIELDS,
    ],
    states: ctx => {
      const c = cycleOf(ctx);
      const seeds: StateSeed[] = [
        { name: `E_${ctx.key}`, value: num(ctx.params.Emax), param: true },
        { name: `e_${ctx.key}`, value: num(ctx.params.Emin), param: true },
      ];
      if (c) seeds.push(
        { name: `t_transition_${c}`, value: num(ctx.params.transitionTime), param: true, shared: true },
        { name: `t_Sys_${c}`,        value: num(ctx.params.systolicTime),   param: true, shared: true },
      );
      return [...seeds, ...compartmentTail(ctx)];
    },
  },

  thorax: {
    label: 'Thorax',
    fields: [
      { name: 'C',    label: 'Compliance (C)',        kind: 'number' },
      { name: 'V0',   label: 'Unstressed Volume (V0)', kind: 'number' },
      { name: 'uVol', label: 'Muscle Volume State',   kind: 'stateRef',
        note: 'A state NAME (e.g. V0_ThoraxMuscle), not a number — read straight as an index.' },
      ...CAP_TAIL_FIELDS,
    ],
    states: ctx => [
      { name: `V0_${ctx.key}`, value: num(ctx.params.V0), param: true },
      { name: `C_${ctx.key}`,  value: num(ctx.params.C),  param: true },
      ...compartmentTail(ctx),
    ],
  },

  elastanceInput: {
    label: 'Elastance Input',
    fields: [
      { name: 'E',  label: 'Elastance State',        kind: 'stateRef',
        note: 'A state NAME (e.g. elastance_Hl), usually driven by an `other` heldtParamVariation.' },
      { name: 'V0', label: 'Unstressed Volume (V0)', kind: 'number' },
      ...CAP_TAIL_FIELDS,
    ],
    states: ctx => [
      { name: `V0_${ctx.key}`, value: num(ctx.params.V0), param: true },
      ...compartmentTail(ctx),
    ],
  },

  sigmoidCapacitor: {
    label: 'Sigmoid Capacitor',
    fields: [
      { name: 'V0',             label: 'Unstressed Volume (V0)', kind: 'number' },
      { name: 'maxValue',       label: 'Max Compliance',         kind: 'number' },
      { name: 'minValue',       label: 'Min Compliance',         kind: 'number' },
      { name: 'inflectionPoint', label: 'Inflection Point',      kind: 'number' },
      { name: 'slope',          label: 'Slope',                  kind: 'number' },
      ...CAP_TAIL_FIELDS,
    ],
    states: ctx => [
      { name: `V0_${ctx.key}`,    value: num(ctx.params.V0),             param: true },
      { name: `Cmax_${ctx.key}`,  value: num(ctx.params.maxValue),       param: true },
      { name: `Cmin_${ctx.key}`,  value: num(ctx.params.minValue),       param: true },
      { name: `InfP_${ctx.key}`,  value: num(ctx.params.inflectionPoint), param: true },
      { name: `slope_${ctx.key}`, value: num(ctx.params.slope),          param: true },
      ...compartmentTail(ctx),
    ],
  },

  doubleSigmoidCapacitor: {
    label: 'Double Sigmoid Capacitor',
    fields: [
      { name: 'V0',             label: 'Unstressed Volume (V0)', kind: 'number' },
      { name: 'maxValue',       label: 'Max Compliance',         kind: 'number' },
      { name: 'minValue',       label: 'Min Compliance',         kind: 'number' },
      { name: 'inflectionPoint', label: 'Inflection Point',      kind: 'number' },
      { name: 'slope',          label: 'Slope',                  kind: 'number' },
      { name: 'separation',     label: 'Separation',             kind: 'number' },
      ...CAP_TAIL_FIELDS,
    ],
    states: ctx => [
      { name: `V0_${ctx.key}`,         value: num(ctx.params.V0),             param: true },
      { name: `Cmax_${ctx.key}`,       value: num(ctx.params.maxValue),       param: true },
      { name: `Cmin_${ctx.key}`,       value: num(ctx.params.minValue),       param: true },
      { name: `InfP_${ctx.key}`,       value: num(ctx.params.inflectionPoint), param: true },
      { name: `slope_${ctx.key}`,      value: num(ctx.params.slope),          param: true },
      { name: `separation_${ctx.key}`, value: num(ctx.params.separation),     param: true },
      ...compartmentTail(ctx),
    ],
  },

  constantPressure: {
    label: 'Constant Pressure',
    fields: [...CAP_TAIL_FIELDS],
    states: ctx => compartmentTail(ctx),
  },

  ventilator: {
    label: 'Ventilator',
    fields: [
      { name: 'amplitude',     label: 'Amplitude',      kind: 'number' },
      { name: 'PEEP',          label: 'PEEP',           kind: 'number',
        note: 'Stored as atmospheric pressure + PEEP.' },
      { name: 'I',             label: 'I of I:E ratio', kind: 'number' },
      { name: 'E',             label: 'E of I:E ratio', kind: 'number' },
      { name: 'slopeFraction', label: 'Slope Fraction', kind: 'number' },
      ...CAP_TAIL_FIELDS,
    ],
    states: ctx => [
      { name: `Amp_${ctx.key}`,   value: num(ctx.params.amplitude),     param: true },
      // atmPressure comes from metadata.gasRegions.Atmosphere.total (760 in every shipped set).
      { name: `PEEP_${ctx.key}`,  value: atmPressure(ctx) + num(ctx.params.PEEP), param: true },
      { name: `Iven_${ctx.key}`,  value: num(ctx.params.I),             param: true },
      { name: `Even_${ctx.key}`,  value: num(ctx.params.E),             param: true },
      { name: `Slope_${ctx.key}`, value: num(ctx.params.slopeFraction), param: true },
      ...compartmentTail(ctx),
    ],
  },

  ventilatorFile: {
    label: 'Ventilator (from file)',
    fields: [
      { name: 'file',                   label: 'HDF5 File',              kind: 'text',   optional: true },
      { name: 'file_dir_path',          label: 'File Directory',         kind: 'text',   optional: true },
      { name: 'start',                  label: 'Slice Start',            kind: 'number', optional: true },
      { name: 'end',                    label: 'Slice End',              kind: 'number', optional: true },
      { name: 'interpolationThreshold', label: 'Interpolation Threshold', kind: 'number', optional: true },
      { name: 'fileStep',               label: 'File Step (s)',          kind: 'number', optional: true,
        note: 'Defaults to 0.01 when absent.' },
      { name: 'array',                  label: 'Inline Pressure Array',  kind: 'text',   optional: true, inert: true,
        note: 'A raw sample array used in place of a file; not editable here, it round-trips untouched.' },
      ...CAP_TAIL_FIELDS,
    ],
    states: ctx => compartmentTail(ctx),
  },
};

const atmPressure = (ctx: EntityCtx): number =>
  ctx.meta?.gasRegions?.Atmosphere?.total ?? 760.0;

// ── connections.resistive — initResistors (modelGen.py:993-1166) ──────────────

// `R_<from>_<to>` is registered for every type (the unconditional NoController at :1025);
// only the two inertial types integrate the flow, so only they seed `Q_<from>_<to>`.
const RESISTIVE_TYPES: Record<string, TypeSpec> = {
  resistor: {
    label: 'Resistor',
    fields: [
      { name: 'R',  label: 'Resistance (R)', kind: 'number' },
      { name: 'L',  label: 'Inductance (L)', kind: 'number', optional: true, inert: true,
        note: 'Carried by some cvModel entries; the plain resistor branch never reads it.' },
      { name: 'y0', label: 'Initial Flow (y0)', kind: 'number', optional: true, inert: true },
    ],
    states: ctx => [{ name: `R_${ctx.key}`, value: num(ctx.params.R), param: true }],
  },

  diode: {
    label: 'Diode',
    fields: [
      { name: 'R',         label: 'Resistance (R)',   kind: 'number' },
      { name: 'threshold', label: 'Opening Threshold', kind: 'number' },
      { name: 'L',         label: 'Inductance (L)',   kind: 'number', optional: true, inert: true },
      { name: 'y0',        label: 'Initial Flow (y0)', kind: 'number', optional: true, inert: true },
    ],
    states: ctx => [
      { name: `R_${ctx.key}`,  value: num(ctx.params.R),         param: true },
      { name: `Th_${ctx.key}`, value: num(ctx.params.threshold), param: true },
    ],
  },

  inertial: {
    label: 'Inertial',
    fields: [
      { name: 'R',  label: 'Resistance (R)',   kind: 'number' },
      { name: 'L',  label: 'Inductance (L)',   kind: 'number' },
      { name: 'y0', label: 'Initial Flow (y0)', kind: 'number' },
    ],
    states: ctx => [
      { name: `Q_${ctx.key}`, value: num(ctx.params.y0) },
      { name: `R_${ctx.key}`, value: num(ctx.params.R), param: true },
      { name: `L_${ctx.key}`, value: num(ctx.params.L), param: true },
    ],
  },

  diode_inertial: {
    label: 'Diode Inertial',
    fields: [
      { name: 'R',         label: 'Resistance (R)',   kind: 'number' },
      { name: 'L',         label: 'Inductance (L)',   kind: 'number' },
      { name: 'threshold', label: 'Opening Threshold', kind: 'number' },
      { name: 'y0',        label: 'Initial Flow (y0)', kind: 'number' },
    ],
    states: ctx => [
      { name: `Q_${ctx.key}`,  value: num(ctx.params.y0) },
      { name: `R_${ctx.key}`,  value: num(ctx.params.R),         param: true },
      { name: `L_${ctx.key}`,  value: num(ctx.params.L),         param: true },
      { name: `Th_${ctx.key}`, value: num(ctx.params.threshold), param: true },
    ],
  },

  resistorInputPressure: {
    label: 'Resistor (input pressure)',
    fields: [
      { name: 'R',             label: 'Resistance (R)',  kind: 'number' },
      { name: 'inputPressure', label: 'Input Pressure',  kind: 'number',
        note: 'Baked into the equation object as a literal — not a state, so it cannot be controlled.' },
    ],
    states: ctx => [{ name: `R_${ctx.key}`, value: num(ctx.params.R), param: true }],
  },
};

// ── connections.membrane — initMembraneResistor (modelGen.py:1168-1252) ───────

/** Species carried across a membrane: those present (>0) in BOTH endpoints' gas regions
 *  (modelGen.py:572). Anything else is skipped, states and all. */
export function membraneSpecies(ctx: EntityCtx): string[] {
  const from = gasRegionOf(ctx.model, ctx.meta, ctx.from ?? '');
  const to   = gasRegionOf(ctx.model, ctx.meta, ctx.to   ?? '');
  if (!from || !to) return [];
  return speciesOf(from).filter(g => (to.gases[g] ?? -1) > 0.0);
}

/** Membrane states are keyed by `<from>_<to>`, NOT by the membrane's own name
 *  (`resistorNameGeneral`, modelGen.py:576) — cpet's `AlvMem` yields `area_R_La_Cp`. */
const memberPairKey = (ctx: EntityCtx): string => `${ctx.from}_${ctx.to}`;

const MEMBRANE_TYPES: Record<string, TypeSpec> = {
  resistorAlveoli: {
    label: 'Alveolar / tissue membrane',
    fields: [
      { name: 'area',      label: 'Exchange Area',     kind: 'number' },
      { name: 'thickness', label: 'Membrane Thickness', kind: 'number' },
    ],
    states: ctx => {
      // No shared species means the loop never runs and nothing is registered.
      if (membraneSpecies(ctx).length === 0) return [];
      const pair = memberPairKey(ctx);
      return [
        { name: `area_R_${pair}`,      value: num(ctx.params.area),      param: true, shared: true },
        { name: `thickness_R_${pair}`, value: num(ctx.params.thickness), param: true, shared: true },
      ];
    },
  },

  resistor: {
    label: 'Membrane resistor',
    fields: [{ name: 'R', label: 'Resistance (R)', kind: 'number' }],
    states: ctx => membraneSpecies(ctx).map(g => ({
      name: `R_${g}_${ctx.from}_${ctx.to}`, value: num(ctx.params.R), param: true,
    })),
  },

  diode: {
    label: 'Membrane diode',
    fields: [{ name: 'R', label: 'Resistance (R)', kind: 'number' }],
    states: ctx => membraneSpecies(ctx).map(g => ({
      name: `R_${g}_${ctx.from}_${ctx.to}`, value: num(ctx.params.R), param: true,
    })),
  },
};

/** Per-species diffusion/solubility pair a membrane declares under `params.<species>`.
 *  Only `resistorAlveoli` reads them; the other two take a scalar `R` instead. */
export const MEMBRANE_SPECIES_FIELDS: FieldDef[] = [
  { name: 'diffusion',  label: 'Diffusion',  kind: 'number' },
  { name: 'solubility', label: 'Solubility', kind: 'number' },
];

export const membraneUsesSpeciesMap = (type: string): boolean => type === 'resistorAlveoli';

// ── cycles — initTimekeeping (modelGen.py:1464-1516) ──────────────────────────

// `type` is never read: the branch that would dispatch cycle/ramp/sine sits inside a
// triple-quoted literal, so every entry becomes a PeriodicTrigger. `cycle` is the only
// value the shipped configs use and the only one offered.
const CYCLE_TYPES: Record<string, TypeSpec> = {
  cycle: {
    label: 'Cycle',
    fields: [
      { name: 'duration',      label: 'Duration (s)',     kind: 'number' },
      { name: 'triggerOffset', label: 'Trigger Offset (s)', kind: 'number' },
      { name: 'timerOffset',   label: 'Timer Offset (s)',  kind: 'number' },
    ],
    states: ctx => [
      { name: `Cyc_${ctx.key}`,  value: num(ctx.params.duration), param: true },
      { name: `Trig_${ctx.key}`, value: num(ctx.params.triggerOffset) },
      { name: `Tim_${ctx.key}`,  value: num(ctx.params.timerOffset) },
    ],
  },
};

// ── other — initOtherCalculations + initOtherModelDependentCalculations ───────

/** Most `other` types name their own state; the two moving averages ignore `newVarName`
 *  and derive `avg_<varIn>` from the prefix table instead (modelGen.py:1533). */
export function otherKeyFor(type: string, params: Record<string, any>): string {
  if (type === 'movingAverage' || type === 'movingAverageCycle') return `avg_${params.varIn ?? ''}`;
  return String(params.newVarName ?? '');
}

const Y0: FieldDef = { name: 'y0', label: 'Initial Value (y0)', kind: 'number' };
const NEW_VAR: FieldDef = { name: 'newVarName', label: 'State Name', kind: 'text' };

/** The shape shared by cycleKeeper / cycleMax / cycleMin. */
const cycleOpFields = (): FieldDef[] => [
  NEW_VAR,
  { name: 'varIn',   label: 'Variable In',        kind: 'stateRef' },
  { name: 't0',      label: 'Initial Time State', kind: 'stateRef' },
  { name: 'trigger', label: 'Trigger State',      kind: 'stateRef' },
  Y0,
];

/** Everything except `constant` seeds one integrated state named after the entry. */
const selfState = (extra?: (ctx: EntityCtx) => StateSeed[]) =>
  (ctx: EntityCtx): StateSeed[] => [
    { name: ctx.key, value: num(ctx.params.y0) },
    ...(extra ? extra(ctx) : []),
  ];

const OTHER_TYPES: Record<string, TypeSpec> = {
  movingAverage: {
    label: 'Moving Average',
    fields: [
      { name: 'varIn',  label: 'Variable In', kind: 'stateRef' },
      { name: 'period', label: 'Period (s)',  kind: 'number' },
      Y0,
      { name: 'newVarName', label: 'State Name', kind: 'text', optional: true, inert: true,
        note: 'Ignored — the state is always avg_<varIn>.' },
    ],
    states: selfState(),
  },
  movingAverageCycle: {
    label: 'Moving Average (per cycle)',
    fields: [
      { name: 'varIn',  label: 'Variable In', kind: 'stateRef' },
      { name: 'period', label: 'Period (s)',  kind: 'number' },
      Y0,
    ],
    states: selfState(),
  },
  cycleIntegral: {
    label: 'Cycle Integral',
    fields: [
      NEW_VAR,
      { name: 'varIn',                 label: 'Variable In',        kind: 'stateRef' },
      { name: 't0',                    label: 'Initial Time State', kind: 'stateRef' },
      { name: 'trigger',               label: 'Trigger State',      kind: 'stateRef' },
      { name: 'triggerConditionValue', label: 'Trigger Value',      kind: 'number' },
      Y0,
    ],
    states: selfState(),
  },
  cycleKeeper: { label: 'Cycle Keeper', fields: cycleOpFields(), states: selfState() },
  cycleMax:    { label: 'Cycle Max',    fields: cycleOpFields(), states: selfState() },
  cycleMin:    { label: 'Cycle Min',    fields: cycleOpFields(), states: selfState() },

  pressureToConcentration: {
    label: 'Pressure → Concentration',
    fields: [
      NEW_VAR,
      { name: 'pressureIn',    label: 'Pressure In State', kind: 'stateRef' },
      { name: 'volumeIn',      label: 'Volume In State',   kind: 'stateRef' },
      { name: 'temperatureIn', label: 'Temperature (K)',   kind: 'number' },
      { name: 'R',             label: 'Gas Constant R',    kind: 'number' },
      Y0,
    ],
    states: selfState(),
  },
  mmolpH: {
    label: 'mmol → pH',
    fields: [
      NEW_VAR,
      { name: 'concentrationIn', label: 'Concentration State', kind: 'stateRef' },
      Y0,
    ],
    states: selfState(),
  },

  // The one type that does NOT create an integrated state: it registers a controllable
  // parameter instead (modelGen.py:1645), which is why `control` can target it.
  constant: {
    label: 'Constant',
    fields: [
      { name: 'newVarName', label: 'Parameter Name', kind: 'text' },
      { name: 'y0',         label: 'Value',          kind: 'number' },
    ],
    states: ctx => [{ name: ctx.key, value: num(ctx.params.y0), param: true }],
  },

  stateRatio: {
    label: 'State Ratio',
    fields: [
      NEW_VAR,
      { name: 'numerator_state',   label: 'Numerator State',   kind: 'stateRef' },
      { name: 'denominator_state', label: 'Denominator State', kind: 'stateRef' },
      Y0,
    ],
    states: selfState(),
  },
  stateSummation: {
    label: 'State Summation',
    fields: [
      NEW_VAR,
      { name: 'states', label: 'States (comma-sep)', kind: 'stateList' },
      Y0,
    ],
    states: selfState(),
  },
  stateSubstraction: {
    label: 'State Subtraction',
    fields: [
      NEW_VAR,
      { name: 'state1', label: 'State 1', kind: 'stateRef' },
      { name: 'state2', label: 'State 2', kind: 'stateRef' },
      Y0,
    ],
    states: selfState(),
  },

  ramp: {
    label: 'Ramp',
    fields: [
      NEW_VAR,
      { name: 'rate',             label: 'Rate',                  kind: 'number' },
      Y0,
      { name: 'chemoSensitivity', label: 'Chemo Sensitivity',     kind: 'number', optional: true },
      { name: 'baroSensitivity',  label: 'Baro Sensitivity',      kind: 'number', optional: true },
      { name: 'chemoRegulator',   label: 'Chemo Regulator State', kind: 'stateRef', optional: true,
        note: 'Defaults to P_Atm when absent.' },
      { name: 'baroRegulator',    label: 'Baro Regulator State',  kind: 'stateRef', optional: true,
        note: 'Defaults to P_Atm when absent.' },
    ],
    states: selfState(),
  },

  atp_Prod: {
    label: 'ATP Production',
    fields: [
      NEW_VAR,
      { name: 'rateLact',  label: 'Lactate Rate State',  kind: 'stateRef' },
      { name: 'ratioLact', label: 'Lactate Ratio',       kind: 'number' },
      { name: 'rateOxid',  label: 'Oxidative Rate State', kind: 'stateRef' },
      { name: 'ratioOxid', label: 'Oxidative Ratio',     kind: 'number' },
      { name: 'rateFat',   label: 'Fat Rate State',      kind: 'stateRef' },
      { name: 'ratioFat',  label: 'Fat Ratio',           kind: 'number' },
      Y0,
    ],
    states: selfState(),
  },
  constant_Multiplication: {
    label: 'Constant Multiplication',
    fields: [
      NEW_VAR,
      { name: 'value',    label: 'Variable State', kind: 'stateRef' },
      { name: 'constant', label: 'Constant',       kind: 'number' },
      Y0,
    ],
    states: selfState(),
  },

  // Also registers a controllable `inflectionPoint_<name>` (modelGen.py:1764-1767) — that is
  // how cpet's control stack retargets the baro/chemo receptors at run time.
  sigmoid: {
    label: 'Sigmoid',
    fields: [
      NEW_VAR,
      { name: 'baseVar',        label: 'Base Variable State', kind: 'stateRef' },
      { name: 'maxValue',       label: 'Max Value',           kind: 'number' },
      { name: 'minValue',       label: 'Min Value',           kind: 'number' },
      { name: 'slope',          label: 'Slope',               kind: 'number' },
      { name: 'inflectionPoint', label: 'Inflection Point',   kind: 'number' },
      Y0,
      { name: 'inhibitor', label: 'Inhibitor State', kind: 'stateRef', optional: true,
        note: 'Defaults to P_Atm; supplying it makes I0 required.' },
      { name: 'I0',        label: 'Inhibitor I0',    kind: 'number',   optional: true },
    ],
    states: selfState(ctx => [
      { name: `inflectionPoint_${ctx.key}`, value: num(ctx.params.inflectionPoint), param: true },
    ]),
  },

  // Registers the Vv0_/VV0_ envelope plus the cycle's shared t_Sys_/t_transition_ pair
  // (modelGen.py:1810-1821) — in cpet this is where all four timing states come from.
  heldtParamVariation: {
    label: 'Heldt Parameter Variation',
    fields: [
      NEW_VAR,
      { name: 'cycle',    label: 'Cycle',          kind: 'cycleRef' },
      { name: 'maxValue', label: 'Max Value',      kind: 'number' },
      { name: 'minValue', label: 'Min Value',      kind: 'number' },
      { name: 't_up',     label: 'Systolic Time (t_up)',   kind: 'number' },
      { name: 't_down',   label: 'Transition Time (t_down)', kind: 'number' },
      Y0,
    ],
    states: selfState(ctx => {
      const c = String(ctx.params.cycle ?? '');
      const seeds: StateSeed[] = [
        { name: `Vv0_${ctx.key}`, value: num(ctx.params.maxValue), param: true },
        { name: `VV0_${ctx.key}`, value: num(ctx.params.minValue), param: true },
      ];
      if (c) seeds.push(
        { name: `t_Sys_${c}`,        value: num(ctx.params.t_up),   param: true, shared: true },
        { name: `t_transition_${c}`, value: num(ctx.params.t_down), param: true, shared: true },
      );
      return seeds;
    }),
  },

  stiffness: {
    label: 'Stiffness',
    fields: [
      NEW_VAR,
      { name: 'volume',     label: 'Volume State',     kind: 'stateRef' },
      { name: 'compliance', label: 'Compliance State', kind: 'stateRef' },
      { name: 'V0',         label: 'V0 State',         kind: 'stateRef' },
      Y0,
    ],
    states: selfState(),
  },
  elastanceCalc: {
    label: 'Elastance Calculation',
    fields: [
      NEW_VAR,
      { name: 'volume',    label: 'Volume State',    kind: 'stateRef' },
      { name: 'stiffness', label: 'Stiffness State', kind: 'stateRef' },
      { name: 'V0',        label: 'V0 State',        kind: 'stateRef' },
      Y0,
    ],
    states: selfState(),
  },

  // The two second-pass types: built after compartments and connections exist
  // (initOtherModelDependentCalculations, modelGen.py:1868-1935).
  lungVolume: {
    label: 'Lung Volume',
    fields: [
      NEW_VAR,
      { name: 'compartment', label: 'Compartment', kind: 'compartmentRef' },
      Y0,
    ],
    states: selfState(),
  },
  concentrationHenrysLaw: {
    label: "Concentration (Henry's law)",
    fields: [
      NEW_VAR,
      { name: 'pressureIn',    label: 'Partial Pressure State', kind: 'stateRef' },
      { name: 'partialVolume', label: 'Partial Volume State',   kind: 'stateRef' },
      { name: 'volume',        label: 'Volume State',           kind: 'stateRef' },
      { name: 'V0',            label: 'V0 State',               kind: 'stateRef' },
      { name: 'C',             label: 'Compliance State',       kind: 'stateRef' },
      { name: 'kh',            label: "Henry's Constant (kh)",  kind: 'number' },
      Y0,
      { name: 'compartment', label: 'Compartment', kind: 'compartmentRef', optional: true, inert: true,
        note: 'Read into a local and never used; kept because the cpet entries carry it.' },
    ],
    states: selfState(),
  },
};

// ── reactions — initReactions (modelGen.py:1255-1436) ─────────────────────────

// Reaction entries are FLAT — no `params` wrapper. They are filed under a gasRegion name
// and instantiated once per compartment in that region, so the pdY_ fan-out is
// (compartments in region) × (reactants ∪ products).
const REACTION_COMMON: FieldDef[] = [
  { name: 'reactants',      label: 'Reactants',       kind: 'speciesList' },
  { name: 'reactantsRatio', label: 'Reactant Ratios', kind: 'ratioList' },
  { name: 'products',       label: 'Products',        kind: 'speciesList' },
  { name: 'productsRatio',  label: 'Product Ratios',  kind: 'ratioList' },
];

/** Compartments filed under a gasRegion — the reaction is built once for each. */
export function compartmentsInRegion(model: ModelJson, region: string): string[] {
  return Object.entries(model?.compartments ?? {})
    .filter(([, c]: [string, any]) => c?.gasRegion === region)
    .map(([n]) => n);
}

const reactionPdY = (ctx: EntityCtx): StateSeed[] => {
  const species = [...list(ctx.params.reactants), ...list(ctx.params.products)];
  const out: StateSeed[] = [];
  for (const comp of compartmentsInRegion(ctx.model, ctx.region ?? '')) {
    for (const s of species) out.push({ name: `pdY_${s}_${comp}_${ctx.key}`, value: 0.0 });
  }
  return out;
};

const REACTION_TYPES: Record<string, TypeSpec> = {
  equilibrium: {
    label: 'Equilibrium',
    fields: [
      ...REACTION_COMMON,
      { name: 'k',      label: 'Rate Constant (k)',     kind: 'number' },
      { name: 'Kratio', label: 'Equilibrium Ratio',     kind: 'number' },
    ],
    states: ctx => [
      // k_ / Kratio_ are keyed by reaction NAME only, so every compartment in the region
      // shares one pair — first writer wins (modelGen.py:1307, :1313).
      { name: `k_${ctx.key}`,      value: num(ctx.params.k),      param: true, shared: true },
      { name: `Kratio_${ctx.key}`, value: num(ctx.params.Kratio), param: true, shared: true },
      ...reactionPdY(ctx),
    ],
  },
  oneWayReaction: {
    label: 'One-Way Reaction',
    fields: [
      ...REACTION_COMMON,
      { name: 'k',    label: 'Rate Constant (k)', kind: 'number' },
      { name: 'rate', label: 'Rate',              kind: 'number', optional: true, inert: true,
        note: 'Present on the glycolysis reactions; initReactions never reads it.' },
    ],
    states: ctx => [
      { name: `k_${ctx.key}`, value: num(ctx.params.k), param: true, shared: true },
      ...reactionPdY(ctx),
    ],
  },
  creation: {
    label: 'Creation (no-op)',
    fields: [...REACTION_COMMON],
    states: () => [],
  },
};

// ── calibration / control — initParameterVariation (modelGen.py:1938-2213) ────

// Both sections run through the same function, so they share the type table. Neither
// creates a state: an entry only REPLACES the NoController on an already-registered
// parameter, which is why its key must equal `params.varToControl` and must name a state
// something else already declared (the outer `if parameter == key` guard at :1944 silently
// drops anything else).
const CONTROLLER_TARGET: FieldDef = {
  name: 'varToControl', label: 'Parameter To Control', kind: 'parameterRef',
  note: 'Must equal the entry key and name an existing controllable parameter.',
};
const CONTROLLER_OFFSET: FieldDef = {
  name: 'offset', label: 'Offset', kind: 'number', optional: true,
  note: 'Defaults to 0.0 when absent.',
};
const noStates = (): StateSeed[] => [];

const rampFields = (): FieldDef[] => [
  CONTROLLER_TARGET,
  { name: 'rate',             label: 'Rate',                  kind: 'number' },
  { name: 'chemoRegulator',   label: 'Chemo Regulator State', kind: 'stateRef' },
  { name: 'chemoSensitivity', label: 'Chemo Sensitivity',     kind: 'number' },
  { name: 'baroRegulator',    label: 'Baro Regulator State',  kind: 'stateRef' },
  { name: 'baroSensitivity',  label: 'Baro Sensitivity',      kind: 'number' },
  { name: 'minValue',         label: 'Min Value',             kind: 'number' },
  { name: 'maxValue',         label: 'Max Value',             kind: 'number' },
];
const gateFields = (): FieldDef[] => [
  { name: 'gateSlope',    label: 'Gate Slope',    kind: 'number' },
  { name: 'edgeFrac',     label: 'Edge Fraction', kind: 'number' },
  { name: 'recoveryRate', label: 'Recovery Rate', kind: 'number' },
];
const localFields = (): FieldDef[] => [
  { name: 'localTarget',      label: 'Local Target State',    kind: 'stateRef' },
  { name: 'localRegulator',   label: 'Local Regulator State', kind: 'stateRef' },
  { name: 'localSensitivity', label: 'Local Sensitivity',     kind: 'number' },
];
const cubicFields = (targetKind: FieldKind): FieldDef[] => [
  CONTROLLER_TARGET,
  { name: 'varTarget',    label: 'Observed State', kind: 'stateRef' },
  { name: 'targetValue',  label: targetKind === 'stateRef' ? 'Target State' : 'Target Value', kind: targetKind },
  { name: 'minValue',     label: 'Min Value',     kind: 'number' },
  { name: 'maxValue',     label: 'Max Value',     kind: 'number' },
  { name: 'cubicFactor',  label: 'Cubic Factor',  kind: 'number' },
  { name: 'linearFactor', label: 'Linear Factor', kind: 'number' },
  { name: 'k',            label: 'Gain (k)',      kind: 'number' },
  CONTROLLER_OFFSET,
  // Read by nothing in the library; cpet's calibration entries carry them, so they are
  // declared here purely so they survive an edit instead of being dropped.
  { name: 'SAbounds',   label: 'SA Bounds',   kind: 'ratioList', optional: true, inert: true },
  { name: 'TWINbounds', label: 'Twin Bounds', kind: 'ratioList', optional: true, inert: true },
];

const CONTROLLER_TYPES: Record<string, TypeSpec> = {
  cubicController: {
    label: 'Cubic Controller',
    fields: cubicFields('number'),
    states: noStates,
  },
  cubicStateController: {
    label: 'Cubic Controller (state target)',
    fields: cubicFields('stateRef'),
    states: noStates,
  },
  polynomialController: {
    label: 'Polynomial Controller',
    fields: [
      CONTROLLER_TARGET,
      { name: 'varTarget', label: 'Observed State', kind: 'stateRef' },
      { name: 'dc',        label: 'Constant Term',  kind: 'number' },
      { name: 'linear',    label: 'Linear Term',    kind: 'number' },
      { name: 'quadratic', label: 'Quadratic Term', kind: 'number' },
      CONTROLLER_OFFSET,
    ],
    states: noStates,
  },
  localController: {
    label: 'Local Controller',
    fields: [
      CONTROLLER_TARGET,
      { name: 'varTarget',     label: 'Observed State',   kind: 'stateRef' },
      { name: 'targetValue',   label: 'Target Value',     kind: 'number' },
      { name: 'proportionalK', label: 'Proportional Gain', kind: 'number' },
      { name: 'minValue',      label: 'Min Value',        kind: 'number' },
      { name: 'maxValue',      label: 'Max Value',        kind: 'number' },
      CONTROLLER_OFFSET,
    ],
    states: noStates,
  },
  localStateController: {
    label: 'Local Controller (state target)',
    fields: [
      CONTROLLER_TARGET,
      { name: 'varTarget',     label: 'Observed State',    kind: 'stateRef' },
      { name: 'targetValue',   label: 'Target State',      kind: 'stateRef' },
      { name: 'proportionalK', label: 'Proportional Gain', kind: 'number' },
      { name: 'minValue',      label: 'Min Value',         kind: 'number' },
      { name: 'maxValue',      label: 'Max Value',         kind: 'number' },
      CONTROLLER_OFFSET,
    ],
    states: noStates,
  },
  ladder: {
    label: 'Ladder',
    fields: [CONTROLLER_TARGET, { name: 'rate', label: 'Rate', kind: 'number' }, CONTROLLER_OFFSET],
    states: noStates,
  },
  cosine: {
    label: 'Cosine',
    fields: [
      CONTROLLER_TARGET,
      { name: 'freq', label: 'Frequency', kind: 'number' },
      { name: 'amp',  label: 'Amplitude', kind: 'number' },
      CONTROLLER_OFFSET,
    ],
    states: noStates,
  },
  ramp:           { label: 'Ramp',              fields: [...rampFields(), CONTROLLER_OFFSET], states: noStates },
  rampGated:      { label: 'Ramp (gated)',      fields: [...rampFields(), ...gateFields(), CONTROLLER_OFFSET], states: noStates },
  rampLocal:      { label: 'Ramp (local)',      fields: [...rampFields(), ...localFields(), CONTROLLER_OFFSET], states: noStates },
  rampLocalGated: { label: 'Ramp (local, gated)', fields: [...rampFields(), ...localFields(), ...gateFields(), CONTROLLER_OFFSET], states: noStates },
  sigmoid: {
    // NOTE: a `control`/`calibration` sigmoid is NOT the `other` sigmoid — same type
    // string, different params (xAxis instead of baseVar, no y0, no newVarName).
    label: 'Sigmoid Controller',
    fields: [
      CONTROLLER_TARGET,
      { name: 'xAxis',           label: 'Input State',     kind: 'stateRef' },
      { name: 'maxValue',        label: 'Max Value',       kind: 'number' },
      { name: 'minValue',        label: 'Min Value',       kind: 'number' },
      { name: 'inflectionPoint', label: 'Inflection Point', kind: 'number' },
      { name: 'slope',           label: 'Slope',           kind: 'number' },
      { name: 'inhibitor', label: 'Inhibitor State', kind: 'stateRef', optional: true,
        note: 'Defaults to P_Atm; supplying it makes I0 required.' },
      { name: 'I0',        label: 'Inhibitor I0',    kind: 'number',   optional: true },
      CONTROLLER_OFFSET,
    ],
    states: noStates,
  },
  sigmoidCTRL: {
    label: 'Sigmoid Controller (target)',
    fields: [
      CONTROLLER_TARGET,
      { name: 'varTarget',   label: 'Observed State', kind: 'stateRef' },
      { name: 'targetValue', label: 'Target Value',   kind: 'number' },
      { name: 'maxValue',    label: 'Max Value',      kind: 'number' },
      { name: 'minValue',    label: 'Min Value',      kind: 'number' },
      { name: 'slope',       label: 'Slope',          kind: 'number' },
      CONTROLLER_OFFSET,
    ],
    states: noStates,
  },
  stressStateController: {
    label: 'Stress Controller',
    fields: [
      CONTROLLER_TARGET,
      { name: 'varTarget',   label: 'Observed State', kind: 'stateRef' },
      { name: 'stressValue', label: 'Stress State',   kind: 'stateRef' },
      { name: 'V0',          label: 'V0 State',       kind: 'stateRef' },
      CONTROLLER_OFFSET,
    ],
    states: noStates,
  },
};

// ── The registry ──────────────────────────────────────────────────────────────

export const SCHEMA: Record<Section, SectionSpec> = {
  compartments: {
    label: 'Compartments',
    meta: [
      { name: 'name',      label: 'Name',             kind: 'text' },
      { name: 'gasRegion', label: 'Gas Region',       kind: 'gasRegionRef' },
      { name: 'cycle',     label: 'Cycle',            kind: 'cycleRef',       optional: true },
      { name: 'bias',      label: 'Bias Compartment', kind: 'compartmentRef' },
    ],
    types: COMPARTMENT_TYPES,
  },
  resistive: {
    label: 'Connections',
    meta: [
      { name: 'from', label: 'From', kind: 'compartmentRef' },
      { name: 'to',   label: 'To',   kind: 'compartmentRef' },
    ],
    types: RESISTIVE_TYPES,
  },
  membrane: {
    label: 'Membranes',
    meta: [
      { name: 'name', label: 'Name', kind: 'text' },
      { name: 'from', label: 'From', kind: 'compartmentRef' },
      { name: 'to',   label: 'To',   kind: 'compartmentRef' },
    ],
    types: MEMBRANE_TYPES,
  },
  cycles: {
    label: 'Cycles',
    meta: [{ name: 'name', label: 'Name', kind: 'text' }],
    types: CYCLE_TYPES,
  },
  other: {
    label: 'Other',
    meta: [],
    types: OTHER_TYPES,
  },
  reactions: {
    label: 'Reactions',
    meta: [
      { name: 'region', label: 'Gas Region', kind: 'gasRegionRef' },
      { name: 'name',   label: 'Name',       kind: 'text' },
    ],
    types: REACTION_TYPES,
  },
  calibration: { label: 'Calibration', meta: [], types: CONTROLLER_TYPES },
  control:     { label: 'Control',     meta: [], types: CONTROLLER_TYPES },
};

export const typeOptions = (section: Section): { value: string; label: string }[] =>
  Object.entries(SCHEMA[section].types).map(([value, spec]) => ({ value, label: spec.label }));

// ── Reading a model ───────────────────────────────────────────────────────────

/** Entries of a section as `[key, entry]`. `reactions` is two levels deep, so its keys
 *  come back as `<region>/<name>` — the one composite id in the sandbox. */
export function sectionEntries(model: ModelJson, section: Section): [string, any][] {
  switch (section) {
    case 'resistive': return Object.entries(model?.connections?.resistive ?? {});
    case 'membrane':  return Object.entries(model?.connections?.membrane ?? {});
    case 'reactions':
      return Object.entries(model?.reactions ?? {}).flatMap(([region, block]) =>
        Object.entries((block ?? {}) as Record<string, any>)
          .map(([name, entry]) => [`${region}/${name}`, entry] as [string, any]));
    default: return Object.entries(model?.[section] ?? {});
  }
}

export const splitReactionId = (id: string): { region: string; name: string } => {
  const i = id.indexOf('/');
  return i < 0 ? { region: '', name: id } : { region: id.slice(0, i), name: id.slice(i + 1) };
};

/** An entry's `params` — `reactions` keeps its parameters flat on the entry body, and
 *  `membrane` splits them across `paramsMemb` (geometry) and `params` (per-species). */
export function entryParams(section: Section, entry: any): Record<string, any> {
  if (!entry) return {};
  if (section === 'reactions') {
    const { type, ...rest } = entry;
    return rest;
  }
  if (section === 'membrane') return entry.paramsMemb ?? {};
  if (section === 'compartments') return entry.capacitor?.params ?? {};
  return entry.params ?? {};
}

export const entryType = (section: Section, entry: any): string =>
  (section === 'compartments' ? entry?.capacitor?.type : entry?.type) ?? '';

/** The values an entry's META fields hold, read back off the model — the identity half of
 *  what a modal prefills, and the inverse of what `applyEntity` writes. Kept next to
 *  `buildEntry`/`auxFor` so a round-trip cannot lose a field. */
export function metaValuesFor(
  model: ModelJson, section: Section, id: string, entry: any,
): Record<string, any> {
  switch (section) {
    case 'compartments': return {
      name:      id,
      gasRegion: entry?.gasRegion ?? '',
      cycle:     model?.connections?.cycles?.[id] ?? '',
      bias:      model?.connections?.bias?.[id] ?? '',
    };
    case 'resistive': return { from: entry?.from ?? '', to: entry?.to ?? '' };
    case 'membrane':  return { name: id, from: entry?.from ?? '', to: entry?.to ?? '', speciesParams: entry?.params ?? {} };
    case 'reactions': { const { region, name } = splitReactionId(id); return { region, name }; }
    default:          return { name: id };
  }
}

/** Everything a modal prefills for an entry: identity plus params. */
export const editValuesFor = (model: ModelJson, section: Section, id: string, entry: any) =>
  ({ ...metaValuesFor(model, section, id, entry), ...entryParams(section, entry) });

// ── State derivation ──────────────────────────────────────────────────────────

function ctxFor(
  model: ModelJson, meta: ModelMetadata | null, gas: boolean,
  section: Section, id: string, entry: any,
): EntityCtx {
  const base = { params: entryParams(section, entry), model, meta, gas };
  if (section === 'reactions') {
    const { region, name } = splitReactionId(id);
    return { ...base, key: name, region };
  }
  if (section === 'resistive' || section === 'membrane') {
    return { ...base, key: id, from: entry?.from, to: entry?.to };
  }
  return { ...base, key: id };
}

/** The states one entry registers. Used both to seed on add and to prune on remove, so
 *  the two can never drift apart. */
export function deriveEntityStates(
  model: ModelJson, meta: ModelMetadata | null, section: Section, id: string, entry: any,
  gas = inferGasExchange(model),
): StateSeed[] {
  const type = entryType(section, entry);
  const spec = SCHEMA[section].types[type];
  if (!spec) return [];
  return spec.states(ctxFor(model, meta, gas, section, id, entry));
}

/** The sections modelGen walks, in the order it walks them. `other` runs before
 *  compartments (initOtherCalculations at :257), which is why an `other` entry may name a
 *  cycle's t_Sys_ pair and win it. */
const DERIVE_ORDER: Section[] = [
  'cycles', 'other', 'compartments', 'resistive', 'membrane', 'reactions',
];

/** Every state the library would register for this model, with its initial value.
 *  `shared` seeds are first-writer-wins, matching the `if name not in modelParams` guards. */
export function deriveStates(
  model: ModelJson, meta: ModelMetadata | null, gas = inferGasExchange(model),
): Record<string, number> {
  const out: Record<string, number> = {};
  const sharedTaken = new Set<string>();

  for (const section of DERIVE_ORDER) {
    for (const [id, entry] of sectionEntries(model, section)) {
      for (const seed of deriveEntityStates(model, meta, section, id, entry, gas)) {
        if (seed.shared) {
          if (sharedTaken.has(seed.name)) continue;
          sharedTaken.add(seed.name);
        }
        out[seed.name] = seed.value;
      }
    }
  }
  // The global clock, registered by initTimekeeping for every model (modelGen.py:1478).
  out.T  = out.T  ?? 0.0;
  out.T0 = out.T0 ?? 0.0;
  return out;
}

/** The states a `calibration` / `control` entry may target: those registered in
 *  `modelParams` with a NoController. Anything else is silently ignored by modelGen. */
export function deriveParameterStates(
  model: ModelJson, meta: ModelMetadata | null, gas = inferGasExchange(model),
): string[] {
  const out = new Set<string>();
  for (const section of DERIVE_ORDER) {
    for (const [id, entry] of sectionEntries(model, section)) {
      for (const seed of deriveEntityStates(model, meta, section, id, entry, gas)) {
        if (seed.param) out.add(seed.name);
      }
    }
  }
  return [...out].sort();
}

// ── Mutation ──────────────────────────────────────────────────────────────────

/** Coerce one modal's raw values into the JSON types the library expects. Fields the
 *  form left blank are dropped rather than written as 0/"" — an optional param the
 *  library defaults must stay absent. */
export function buildParams(fields: FieldDef[], values: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const f of fields) {
    const raw = values[f.name];
    const blank = raw === undefined || raw === null || raw === '';
    if (blank) {
      if (f.optional || f.inert) continue;
      out[f.name] = f.kind === 'number' ? 0 : f.kind === 'ratioList' || f.kind === 'stateList' || f.kind === 'speciesList' ? [] : '';
      continue;
    }
    switch (f.kind) {
      case 'number':                          out[f.name] = num(raw); break;
      case 'ratioList':                       out[f.name] = numList(raw); break;
      case 'stateList': case 'speciesList':   out[f.name] = list(raw); break;
      default:                                out[f.name] = String(raw); break;
    }
  }
  return out;
}

export interface AuxWrites {
  bias?:    Record<string, string>;
  regions?: Record<string, string[]>;
  cycles?:  Record<string, string>;
}

/** `connections.bias` must carry a key for every compartment, resistive connection AND
 *  membrane: modelGen resolves it with `utils.findStrInDictionaryAndAddPrefix`, whose
 *  `newName` is unbound on a miss — a missing key is an UnboundLocalError, not a default.
 *  `regions` and `cycles` are looked up leniently but `capacitor`/`thorax` iterate the
 *  region list, so a compartment needs at least an empty one. */
function auxFor(section: Section, id: string, values: Record<string, any>, prev: ModelJson): AuxWrites {
  if (section === 'compartments') {
    return {
      bias:    { [id]: String(values.bias ?? 'Atm') },
      regions: { [id]: prev?.connections?.regions?.[id] ?? [] },
      cycles:  { [id]: String(values.cycle ?? '') },
    };
  }
  if (section === 'resistive' || section === 'membrane') {
    // Connections and membranes carry a bias key too — cpet's map is 22 + 17 + 4 entries.
    return { bias: { [id]: prev?.connections?.bias?.[id] ?? 'Atm' } };
  }
  return {};
}

/** Build the JSON body for one entry, in the shape its section uses. */
function buildEntry(
  section: Section, type: string, values: Record<string, any>,
  params: Record<string, any>, previous: any,
): any {
  switch (section) {
    case 'compartments':
      return {
        gasRegion: String(values.gasRegion ?? ''),
        type:      'component',
        capacitor: { type, params },
      };
    case 'resistive':
      return { from: String(values.from ?? ''), to: String(values.to ?? ''), type, params };
    case 'membrane':
      return {
        from: String(values.from ?? ''), to: String(values.to ?? ''), type,
        paramsMemb: params,
        // The per-species diffusion/solubility map has its own editor (one row per species
        // both endpoints carry); the modal hands it over whole, else the old one is kept.
        params: values.speciesParams ?? previous?.params ?? {},
      };
    case 'cycles':
      return { type: 'cycle', params };
    case 'reactions':
      return { type, ...params };
    case 'calibration':
    case 'control':
      // `description` is a free-text note some entries carry and the library ignores.
      // Only carry it over when it was there — never invent an empty one.
      return previous?.description !== undefined
        ? { type, params, description: previous.description }
        : { type, params };
    default:
      return { type, params };
  }
}

function setEntry(model: ModelJson, section: Section, id: string, entry: any): ModelJson {
  if (section === 'resistive' || section === 'membrane') {
    const bucket = section === 'resistive' ? 'resistive' : 'membrane';
    return { ...model, connections: { ...model.connections, [bucket]: { ...model.connections?.[bucket], [id]: entry } } };
  }
  if (section === 'reactions') {
    const { region, name } = splitReactionId(id);
    return { ...model, reactions: { ...model.reactions, [region]: { ...model.reactions?.[region], [name]: entry } } };
  }
  return { ...model, [section]: { ...model[section], [id]: entry } };
}

function dropEntry(model: ModelJson, section: Section, id: string): ModelJson {
  if (section === 'resistive' || section === 'membrane') {
    const bucket = section === 'resistive' ? 'resistive' : 'membrane';
    const next = { ...model.connections?.[bucket] };
    delete next[id];
    return { ...model, connections: { ...model.connections, [bucket]: next } };
  }
  if (section === 'reactions') {
    const { region, name } = splitReactionId(id);
    const block = { ...model.reactions?.[region] };
    delete block[name];
    const reactions = { ...model.reactions, [region]: block };
    // A region with no reactions left is dropped: an empty block would still make
    // inferGasExchange report a gas model.
    if (Object.keys(block).length === 0) delete reactions[region];
    return { ...model, reactions };
  }
  const next = { ...model[section] };
  delete next[id];
  return { ...model, [section]: next };
}

function applyAux(model: ModelJson, aux: AuxWrites): ModelJson {
  if (!aux.bias && !aux.regions && !aux.cycles) return model;
  return {
    ...model,
    connections: {
      ...model.connections,
      ...(aux.bias    ? { bias:    { ...model.connections?.bias,    ...aux.bias } }    : {}),
      ...(aux.regions ? { regions: { ...model.connections?.regions, ...aux.regions } } : {}),
      ...(aux.cycles  ? { cycles:  { ...model.connections?.cycles,  ...aux.cycles } }  : {}),
    },
  };
}

/** The id an entry gets from its own values. Connection ids are derived (`<from>_<to>`)
 *  because that is what the library builds every state name from; `other` keys are
 *  derived from the type; controller keys must equal `varToControl`. */
export function entityId(section: Section, type: string, values: Record<string, any>): string {
  switch (section) {
    case 'resistive':  return `${values.from ?? ''}_${values.to ?? ''}`;
    case 'membrane':   return String(values.name ?? '');
    case 'reactions':  return `${values.region ?? ''}/${values.name ?? ''}`;
    case 'other':      return otherKeyFor(type, values);
    case 'calibration':
    case 'control':    return String(values.varToControl ?? '');
    default:           return String(values.name ?? '');
  }
}

export interface ApplyResult {
  model:  ModelJson;
  error?: string;
}

/** The single mutation entry point: add or rename/retype one entry, rewrite the aux maps
 *  it owns, and re-seed `states` from the schema. `previousId` turns it into an edit. */
export function applyEntity(
  model:  ModelJson,
  meta:   ModelMetadata | null,
  section: Section,
  type:   string,
  values: Record<string, any>,
  previousId?: string | null,
): ApplyResult {
  const spec = SCHEMA[section].types[type];
  if (!spec) return { model, error: `Unknown ${section} type "${type}"` };

  // A blank required field would otherwise produce a half-formed key (`avg_`, `_As`) or a
  // param the generator reads as 0 — name the field instead.
  const blank = [...SCHEMA[section].meta, ...spec.fields]
    .filter(f => !f.optional && !f.inert)
    .filter(f => { const v = values[f.name]; return v === undefined || v === null || v === ''; })
    .map(f => f.label);
  if (blank.length > 0) return { model, error: `Required: ${blank.join(', ')}` };

  const id = entityId(section, type, values);
  if (!id || id.includes('undefined')) return { model, error: 'Required field is empty' };
  if (id !== previousId && sectionEntries(model, section).some(([k]) => k === id)) {
    return { model, error: `"${id}" already exists` };
  }

  let next = model;
  const previous = previousId ? Object.fromEntries(sectionEntries(model, section))[previousId] : null;

  // Remove the old entry first so a rename cannot leave the old states behind.
  if (previousId && previousId !== id) {
    next = pruneEntity(next, meta, section, previousId);
  } else if (previousId) {
    next = stripStates(next, deriveEntityStates(next, meta, section, previousId, previous));
  }

  const params = buildParams(spec.fields, values);
  next = setEntry(next, section, id, buildEntry(section, type, values, params, previous));
  next = applyAux(next, auxFor(section, id, values, model));

  // Derive against the model that already contains the entry: a compartment's gas states
  // depend on its own gasRegion, and a reaction's pdY fan-out on the region's members.
  const entry = Object.fromEntries(sectionEntries(next, section))[id];
  next = seedStates(next, deriveEntityStates(next, meta, section, id, entry));
  return { model: next };
}

function seedStates(model: ModelJson, seeds: StateSeed[]): ModelJson {
  const states = { ...model.states };
  for (const seed of seeds) {
    // A shared state already claimed by another entry keeps its value (first writer wins).
    if (seed.shared && seed.name in states) continue;
    if (!(seed.name in states)) states[seed.name] = seed.value;
  }
  states.T  = states.T  ?? 0.0;
  states.T0 = states.T0 ?? 0.0;
  return { ...model, states };
}

/** Remove exactly the states a schema entry owns — never a name-prefix sweep. The old
 *  page pruned with `key.endsWith('_' + name)`, which deleted `avg_P_As` and `Q_Hl_As`
 *  along with compartment `As`. */
function stripStates(model: ModelJson, seeds: StateSeed[]): ModelJson {
  if (seeds.length === 0) return model;
  const states = { ...model.states };
  for (const seed of seeds) delete states[seed.name];
  return { ...model, states };
}

/** Names that must survive a removal because another remaining entry also registers them
 *  (the shared t_Sys_/t_transition_ pair, a reaction's k_ shared across a region). */
function stillClaimed(model: ModelJson, meta: ModelMetadata | null, exclude: { section: Section; id: string }): Set<string> {
  const keep = new Set<string>();
  for (const section of DERIVE_ORDER) {
    for (const [id, entry] of sectionEntries(model, section)) {
      if (section === exclude.section && id === exclude.id) continue;
      for (const seed of deriveEntityStates(model, meta, section, id, entry)) keep.add(seed.name);
    }
  }
  return keep;
}

function pruneEntity(model: ModelJson, meta: ModelMetadata | null, section: Section, id: string): ModelJson {
  const entry = Object.fromEntries(sectionEntries(model, section))[id];
  const owned = deriveEntityStates(model, meta, section, id, entry);
  const keep  = stillClaimed(model, meta, { section, id });

  let next = stripStates(model, owned.filter(s => !keep.has(s.name)));
  next = dropEntry(next, section, id);
  if (section === 'compartments') {
    next = {
      ...next,
      connections: {
        ...next.connections,
        bias:    omit(next.connections?.bias, id),
        regions: omit(next.connections?.regions, id),
        cycles:  omit(next.connections?.cycles, id),
      },
    };
  }
  if (section === 'resistive' || section === 'membrane') {
    next = { ...next, connections: { ...next.connections, bias: omit(next.connections?.bias, id) } };
  }
  return next;
}

const omit = (obj: Record<string, any> | undefined, key: string): Record<string, any> => {
  const next = { ...(obj ?? {}) };
  delete next[key];
  return next;
};

export interface RemoveResult {
  model:      ModelJson;
  /** Non-empty when the removal was refused because something still points at the entry. */
  dependants: string[];
}

/** Remove an entry and the states it owns. Refuses while another entry still references
 *  it — a dangling `from`/`to` or a controller with no target is a run-time crash, not a
 *  warning, so the sandbox must not be able to create one by deleting. */
export function removeEntity(
  model: ModelJson, meta: ModelMetadata | null, section: Section, id: string,
): RemoveResult {
  const dependants = referencesTo(model, section, id);
  if (dependants.length > 0) return { model, dependants };
  return { model: pruneEntity(model, meta, section, id), dependants: [] };
}

/** What would break if this entry went away. */
export function referencesTo(model: ModelJson, section: Section, id: string): string[] {
  const hits: string[] = [];
  if (section === 'compartments') {
    for (const [cid, c] of sectionEntries(model, 'resistive')) {
      if (c?.from === id || c?.to === id) hits.push(`connection ${cid}`);
    }
    for (const [mid, m] of sectionEntries(model, 'membrane')) {
      if (m?.from === id || m?.to === id) hits.push(`membrane ${mid}`);
    }
    for (const [name, children] of Object.entries(model?.connections?.regions ?? {})) {
      if (Array.isArray(children) && children.includes(id)) hits.push(`region of ${name}`);
    }
    for (const [name, target] of Object.entries(model?.connections?.bias ?? {})) {
      if (target === id && name !== id) hits.push(`bias of ${name}`);
    }
  }
  if (section === 'cycles') {
    for (const [name, cyc] of Object.entries(model?.connections?.cycles ?? {})) {
      if (cyc === id) hits.push(`cycle of ${name}`);
    }
    for (const [oid, o] of sectionEntries(model, 'other')) {
      if (o?.params?.cycle === id) hits.push(`other ${oid}`);
    }
  }
  return hits;
}

// ── Validation ────────────────────────────────────────────────────────────────

/** Structural checks that mirror the ways modelGen fails: an unbound bias lookup, a
 *  missing region list, a gasRegion metadata has never heard of, a controller whose key
 *  and `varToControl` disagree (which renames the state and trips prepareModel's assert),
 *  and a controller aimed at something that is not a controllable parameter (silently
 *  dropped by the `if parameter == key` guard). */
export function validateModel(model: ModelJson, meta: ModelMetadata | null): Finding[] {
  const out: Finding[] = [];
  if (!model) return out;

  const compartments = Object.keys(model.compartments ?? {});
  const bias    = (model.connections?.bias    ?? {}) as Record<string, string>;
  const regions = (model.connections?.regions ?? {}) as Record<string, string[]>;
  const cycles  = (model.connections?.cycles  ?? {}) as Record<string, string>;
  const gas     = inferGasExchange(model);

  // bias / regions coverage
  const needsBias = [
    ...compartments,
    ...sectionEntries(model, 'resistive').map(([id]) => id),
    ...sectionEntries(model, 'membrane').map(([id]) => id),
  ];
  for (const name of needsBias) {
    if (!(name in bias)) out.push({ level: 'error', message: `connections.bias has no entry for "${name}" — the generator raises UnboundLocalError on a missing bias key.` });
    else if (!compartments.includes(bias[name])) out.push({ level: 'error', message: `connections.bias["${name}"] points at "${bias[name]}", which is not a compartment.` });
  }
  for (const name of compartments) {
    if (!(name in regions)) out.push({ level: 'error', message: `connections.regions has no entry for "${name}" — capacitor pressures iterate that list.` });
  }

  // dangling references
  for (const [id, c] of [...sectionEntries(model, 'resistive'), ...sectionEntries(model, 'membrane')]) {
    for (const end of ['from', 'to'] as const) {
      if (c?.[end] && !compartments.includes(c[end])) {
        out.push({ level: 'error', message: `"${id}" points ${end} at "${c[end]}", which is not a compartment.` });
      }
    }
  }
  for (const [name, children] of Object.entries(regions)) {
    if (!compartments.includes(name)) out.push({ level: 'warning', message: `connections.regions has an orphan key "${name}" with no matching compartment.` });
    for (const child of (children as string[]) ?? []) {
      if (!compartments.includes(child)) out.push({ level: 'error', message: `connections.regions["${name}"] lists "${child}", which is not a compartment.` });
    }
  }
  for (const [name, cyc] of Object.entries(cycles)) {
    if (cyc && !(cyc in (model.cycles ?? {}))) out.push({ level: 'error', message: `connections.cycles["${name}"] names cycle "${cyc}", which is not declared.` });
  }

  // gas regions
  if (meta?.gasRegions) {
    for (const name of compartments) {
      const region = model.compartments[name]?.gasRegion;
      if (!region) out.push({ level: 'error', message: `Compartment "${name}" has no gasRegion.` });
      else if (!(region in meta.gasRegions)) out.push({ level: 'error', message: `Compartment "${name}" uses gasRegion "${region}", which metadata.json does not declare.` });
    }
    for (const region of Object.keys(model.reactions ?? {})) {
      if (!(region in meta.gasRegions)) out.push({ level: 'error', message: `Reaction block "${region}" is not a gas region in metadata.json.` });
      else if (meta.gasRegions[region].state !== 'dissolved') out.push({ level: 'warning', message: `Reaction block "${region}" is a "${meta.gasRegions[region].state}" region — only dissolved regions run reactions.` });
      else if (compartmentsInRegion(model, region).length === 0) out.push({ level: 'warning', message: `Reaction block "${region}" has no compartments, so none of its reactions are built.` });
    }
  }
  // A membrane whose species map is empty, or whose endpoints share no species, is built
  // as nothing at all — the generator's per-gas loop simply never runs.
  for (const [id, entry] of sectionEntries(model, 'membrane')) {
    const ctx: EntityCtx = { key: id, params: {}, model, meta, gas, from: entry?.from, to: entry?.to };
    const shared = membraneSpecies(ctx);
    if (shared.length === 0) {
      out.push({ level: 'warning', message: `Membrane "${id}" links two gas regions that share no species — it exchanges nothing.` });
    } else if (membraneUsesSpeciesMap(entryType('membrane', entry))) {
      const declared = Object.keys(entry?.params ?? {}).filter(k => !k.startsWith('#'));
      for (const s of shared) {
        if (!declared.includes(s)) out.push({ level: 'warning', message: `Membrane "${id}" has no diffusion/solubility for "${s}", so that species is skipped.` });
      }
    }
  }

  // types the library does not implement
  for (const section of ['compartments', 'resistive', 'membrane', 'cycles', 'other', 'reactions', 'calibration', 'control'] as Section[]) {
    for (const [id, entry] of sectionEntries(model, section)) {
      const type = entryType(section, entry);
      if (!SCHEMA[section].types[type]) {
        out.push({ level: 'error', message: `${SCHEMA[section].label} "${id}" has type "${type}", which the library does not implement.` });
      }
    }
  }

  // controllers
  const parameters = new Set(deriveParameterStates(model, meta, gas));
  for (const section of ['calibration', 'control'] as Section[]) {
    for (const [id, entry] of sectionEntries(model, section)) {
      const target = entry?.params?.varToControl;
      if (target && target !== id) out.push({ level: 'error', message: `${SCHEMA[section].label} "${id}" controls "${target}" — the key and varToControl must match.` });
      if (!parameters.has(id)) out.push({ level: 'warning', message: `${SCHEMA[section].label} "${id}" targets a state no entry registers as a controllable parameter — the generator will skip it.` });
    }
  }

  // states block vs. what the generator will build
  const derived = deriveStates(model, meta, gas);
  const stated  = model.states ?? {};
  for (const name of Object.keys(derived)) {
    if (!(name in stated)) out.push({ level: 'warning', message: `states is missing "${name}"; the run falls back to the generator default.` });
  }
  return out;
}

// ── Canonical JSON ────────────────────────────────────────────────────────────

/** Section order for the emitted JSON. Anything not listed keeps its position after these,
 *  so a key the sandbox does not model still round-trips. */
export const MODEL_KEY_ORDER = [
  'configurations', 'modelParams', 'states', 'connections', 'cycles',
  'compartments', 'reactions', 'other', 'calibration', 'control',
];

const STATE_PREFIX_ORDER = [
  'V_', 'P_', 'C_', 'E_', 'e_', 'V0_', 'Vv0_', 'VV0_', 'Cmax_', 'Cmin_', 'InfP_', 'slope_',
  'separation_', 'Amp_', 'PEEP_', 'Iven_', 'Even_', 'Slope_', 'Q_', 'R_', 'L_', 'Th_',
  'area_', 'thickness_', 'Cyc_', 'Tim_', 'Trig_', 't_', 'Y_', 'pdY_', 'k_', 'Kratio_', 'avg_',
];

export function sortedStateEntries(states: Record<string, number>): [string, number][] {
  return Object.entries(states ?? {}).sort(([a], [b]) => {
    const rank = (k: string) => {
      const i = STATE_PREFIX_ORDER.findIndex(p => k.startsWith(p));
      return i === -1 ? STATE_PREFIX_ORDER.length : i;
    };
    const ra = rank(a), rb = rank(b);
    return ra !== rb ? ra - rb : a.localeCompare(b);
  });
}

const reorder = (obj: Record<string, any>, order: string[]): Record<string, any> => {
  const out: Record<string, any> = {};
  for (const key of order) if (key in obj) out[key] = obj[key];
  for (const key of Object.keys(obj)) if (!(key in out)) out[key] = obj[key];
  return out;
};

/** Stable key ordering for display, download AND save, so the three never disagree. */
export function canonicalModelJson(model: ModelJson): ModelJson {
  if (!model) return model;
  const out = reorder(model, MODEL_KEY_ORDER);
  if (out.states) out.states = Object.fromEntries(sortedStateEntries(out.states));
  if (out.connections) {
    out.connections = reorder(out.connections, ['resistive', 'membrane', 'bias', 'regions', 'cycles']);
  }
  return out;
}
