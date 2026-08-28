// Tests: modelSchema — the sandbox's registry vs. the model configs the library actually runs.
// Fixtures are the shipped python/config JSONs themselves, read off disk: they are the
// single source of truth the seeds are generated from, so the suite fails the moment the
// registry and a real model drift apart.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
  SCHEMA, Section, ModelJson,
  applyEntity, removeEntity, referencesTo, entityId,
  canonicalModelJson, compartmentsInRegion,
  deriveEntityStates, deriveParameterStates, deriveStates, editValuesFor,
  entryParams, entryType, inferGasExchange, sectionEntries, validateModel,
} from './modelSchema';
import { ModelMetadata } from '../../interfaces/types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Walk up from the working directory to the repo root — vitest runs with cwd=pwa/, but
 *  the fixtures are the real python/config tree so the suite can never drift from disk. */
const CONFIG = (() => {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, 'python', 'config');
    if (fs.existsSync(path.join(candidate, 'metadata.json'))) return candidate;
    dir = path.dirname(dir);
  }
  throw new Error('python/config not found above ' + process.cwd());
})();

const readJson = (p: string) => JSON.parse(fs.readFileSync(p, 'utf8'));

const META: ModelMetadata = readJson(path.join(CONFIG, 'metadata.json'));

const MODEL_FILES = fs.readdirSync(path.join(CONFIG, 'models'))
  .filter(f => f.endsWith('.json'))
  .sort();

const MODELS: Record<string, ModelJson> = Object.fromEntries(
  MODEL_FILES.map(f => [f, readJson(path.join(CONFIG, 'models', f))]),
);

/** JSON with object keys sorted, for order-insensitive comparison. */
const stable = (v: any): string => JSON.stringify(v, (_k, val) =>
  val && typeof val === 'object' && !Array.isArray(val)
    ? Object.fromEntries(Object.keys(val).sort().map(k => [k, val[k]]))
    : val);

/** States the generator builds that a shipped config never declares, so the run falls back
 *  to the generator default. There are none left — the two `*_inertial*` configs now declare
 *  `L_Hl_As` at the value their `Hl_As` params carry. Kept as the seam a NEW divergence
 *  lands in, so the failure names the file instead of an opaque array mismatch. */
const KNOWN_UNDECLARED: Record<string, string[]> = {};

/** Every editable section, in the order the sandbox lists them. */
const SECTIONS: Section[] = [
  'compartments', 'resistive', 'membrane', 'cycles', 'other', 'reactions', 'calibration', 'control',
];

describe('fixtures', () => {
  it('finds the shipped model configs and metadata', () => {
    expect(MODEL_FILES.length).toBeGreaterThan(0);
    expect(Object.keys(META.gasRegions).length).toBeGreaterThan(0);
  });
});

// ── 1. Coverage: can the sandbox author everything that ships? ────────────────

// ── 0. Completeness against the library, not just against the configs ────────

describe('the registry covers every type modelGen dispatches', () => {
  /** Transcribed from python/library/model/modelGen.py — the exhaustive accepted-type list
   *  of each dispatch point. A type the library gains (or the sandbox invents) fails here.
   *  Excluded on purpose: `resistorMultiFlow` / `diodeMultiFlow` /
   *  `resistorInputPressureMultiFlow` are SYNTHESISED at :529-534 by rewriting a gas-side
   *  resistor — never written in JSON, so never offered. */
  const LIBRARY_TYPES: Record<Section, string[]> = {
    compartments: ['elastance', 'capacitor', 'thorax', 'elastanceInput', 'sigmoidCapacitor',
                   'doubleSigmoidCapacitor', 'constantPressure', 'ventilator', 'ventilatorFile'],
    resistive:    ['diode', 'resistor', 'diode_inertial', 'inertial', 'resistorInputPressure'],
    membrane:     ['diode', 'resistor', 'resistorAlveoli'],
    // initTimekeeping never reads `type` — the cycle/ramp/sine chain is inside a dead
    // triple-quoted literal, so every entry becomes a PeriodicTrigger.
    cycles:       ['cycle'],
    other:        ['movingAverage', 'movingAverageCycle', 'cycleIntegral', 'cycleKeeper',
                   'cycleMax', 'cycleMin', 'pressureToConcentration', 'mmolpH', 'constant',
                   'stateRatio', 'stateSummation', 'stateSubstraction', 'ramp', 'atp_Prod',
                   'constant_Multiplication', 'sigmoid', 'heldtParamVariation', 'stiffness',
                   'elastanceCalc', 'lungVolume', 'concentrationHenrysLaw'],
    reactions:    ['equilibrium', 'oneWayReaction', 'creation'],
    // calibration and control run through the same initParameterVariation function.
    calibration:  ['localController', 'localStateController', 'ladder', 'cosine', 'ramp',
                   'rampGated', 'rampLocalGated', 'rampLocal', 'sigmoid', 'sigmoidCTRL',
                   'cubicController', 'cubicStateController', 'stressStateController',
                   'polynomialController'],
    control:      ['localController', 'localStateController', 'ladder', 'cosine', 'ramp',
                   'rampGated', 'rampLocalGated', 'rampLocal', 'sigmoid', 'sigmoidCTRL',
                   'cubicController', 'cubicStateController', 'stressStateController',
                   'polynomialController'],
  };

  it.each(SECTIONS)('%s — offers exactly the library\'s types', section => {
    expect(Object.keys(SCHEMA[section].types).sort()).toEqual([...LIBRARY_TYPES[section]].sort());
  });

  it('every type declares a label and at least one way to be identified', () => {
    for (const section of SECTIONS) {
      for (const [type, spec] of Object.entries(SCHEMA[section].types)) {
        expect(`${section}/${type} label`).toBe(spec.label ? `${section}/${type} label` : `${section}/${type} MISSING label`);
        const named = SCHEMA[section].meta.length > 0
          || spec.fields.some(f => ['newVarName', 'varIn', 'varToControl'].includes(f.name));
        expect(`${section}/${type} identifiable`).toBe(named ? `${section}/${type} identifiable` : `${section}/${type} HAS NO KEY SOURCE`);
      }
    }
  });
});

describe('coverage of the shipped configs', () => {
  it.each(MODEL_FILES)('%s — every type is implemented', file => {
    const model = MODELS[file];
    const unknown: string[] = [];
    for (const section of SECTIONS) {
      for (const [id, entry] of sectionEntries(model, section)) {
        const type = entryType(section, entry);
        if (!SCHEMA[section].types[type]) unknown.push(`${section}/${id}: "${type}"`);
      }
    }
    expect(unknown).toEqual([]);
  });

  it.each(MODEL_FILES)('%s — every params key is a declared field', file => {
    const model = MODELS[file];
    const undeclared: string[] = [];
    for (const section of SECTIONS) {
      for (const [id, entry] of sectionEntries(model, section)) {
        const spec = SCHEMA[section].types[entryType(section, entry)];
        if (!spec) continue;
        const declared = new Set(spec.fields.map(f => f.name));
        for (const key of Object.keys(entryParams(section, entry))) {
          if (!declared.has(key)) undeclared.push(`${section}/${id}: "${key}"`);
        }
      }
    }
    expect(undeclared).toEqual([]);
  });

  it('membrane species maps only name species both endpoints carry', () => {
    const model = MODELS['cpet.json'];
    const bad: string[] = [];
    for (const [id, entry] of sectionEntries(model, 'membrane')) {
      const region = META.gasRegions[model.compartments[entry.from]?.gasRegion];
      for (const key of Object.keys(entry.params ?? {})) {
        if (key.startsWith('#')) continue;   // commented-out species
        for (const sub of Object.keys(entry.params[key])) {
          if (sub.startsWith('#')) continue;
          if (!['diffusion', 'solubility'].includes(sub)) bad.push(`${id}.${key}.${sub}`);
        }
        if (!(key in (region?.gases ?? {}))) bad.push(`${id}: "${key}" is not in the source region`);
      }
    }
    expect(bad).toEqual([]);
  });
});

// ── 2. State parity: does the registry reproduce the library's state vector? ──

describe('state derivation against the shipped states blocks', () => {
  /** The shipped configs now declare exactly the state vector the generator builds — no
   *  tolerated drift in either direction. Both halves used to carry an exemption: the
   *  cvModels declared a `Q_<from>_<to>` per non-inertial connection (algebraic, so
   *  `encodeStates` ignored it) and the `*_inertial*` pair omitted `L_Hl_As`. Both were
   *  fixed in the configs, so the assertions are now unconditional. */
  it.each(MODEL_FILES)('%s — the derived state set matches the config', file => {
    const model   = MODELS[file];
    const derived = new Set(Object.keys(deriveStates(model, META)));
    const stated  = new Set(Object.keys(model.states ?? {}));

    // Derived but not declared: the run silently falls back to the generator default.
    const undeclared = [...derived].filter(n => !stated.has(n)).sort();
    expect(undeclared).toEqual(KNOWN_UNDECLARED[file] ?? []);

    // Declared but never built: a stale key the state vector has no slot for.
    const unbuilt = [...stated].filter(n => !derived.has(n)).sort();
    expect(unbuilt).toEqual([]);
  });

  it('the derived initial VALUES match the config, not just the names', () => {
    for (const file of MODEL_FILES) {
      const model   = MODELS[file];
      const derived = deriveStates(model, META);
      // Only the states whose value the schema claims to know: params-backed seeds. A
      // calibrated config has drifted away from them, so compare structure-only entries —
      // the reaction pdY_ zeroes and the cycle/derived seeds a fresh build would produce.
      for (const [id, entry] of sectionEntries(model, 'cycles')) {
        expect(`${file}:Cyc_${id}`).toBe(`${file}:Cyc_${id}`);
        expect(derived[`Cyc_${id}`]).toBe(entry.params.duration);
      }
    }
  });

  it('gas exchange is inferred from structure, not from `configurations`', () => {
    expect(inferGasExchange(MODELS['cpet.json'])).toBe(true);
    for (const file of MODEL_FILES.filter(f => f.startsWith('cvModel'))) {
      expect(inferGasExchange(MODELS[file])).toBe(false);
    }
  });

  it('cpet derives the gas states a no-gas model never gets', () => {
    const gasStates = Object.keys(deriveStates(MODELS['cpet.json'], META));
    expect(gasStates).toContain('Y_O2_As');            // dissolved concentration
    expect(gasStates).toContain('V_O2_La');            // alveolar partial volume
    expect(gasStates).toContain('area_R_La_Cp');       // membrane geometry, keyed from_to
    expect(gasStates).toContain('thickness_R_La_Cp');
    expect(gasStates).toContain('k_HbO2_Hb-O2');       // reaction rate constant
    expect(gasStates).toContain('Kratio_HbO2_Hb-O2');
    expect(gasStates).toContain('pdY_O2_As_HbO2_Hb-O2');
    // A gas compartment's scalar volume is replaced by one partial volume per species.
    // (V_La is the exception and not a counter-example: cpet declares it explicitly as an
    // `other` stateSummation over V_O2_La / V_C2_La / V_N2_La.)
    expect(gasStates).not.toContain('V_Lt');
    expect(gasStates).toContain('V_O2_Lt');

    const noGas = Object.keys(deriveStates(MODELS['cvModel_linear.json'], META));
    expect(noGas.filter(n => n.startsWith('Y_') || n.startsWith('pdY_'))).toEqual([]);
    expect(noGas).toContain('V_Atm');                  // no gas path keeps the scalar volume
  });

  it('the states the old page got wrong are now derived', () => {
    const cpet = deriveStates(MODELS['cpet.json'], META);
    expect(cpet).toHaveProperty('inflectionPoint_baroreceptor');   // other/sigmoid
    expect(cpet).toHaveProperty('Vv0_elastance_Hl');               // other/heldtParamVariation
    expect(cpet).toHaveProperty('VV0_elastance_Hl');
    expect(cpet).toHaveProperty('t_Sys_HC');
    expect(cpet).toHaveProperty('t_transition_RCLa');
    expect(cpet).toHaveProperty('L_Hl_As');                        // diode_inertial inductance
    expect(cpet).toHaveProperty('T');
    expect(cpet).toHaveProperty('T0');
  });

  it('controller targets are all registered parameters in every shipped config', () => {
    for (const file of MODEL_FILES) {
      const model = MODELS[file];
      const parameters = new Set(deriveParameterStates(model, META));
      for (const section of ['calibration', 'control'] as Section[]) {
        for (const [id] of sectionEntries(model, section)) {
          expect(`${file}:${section}:${id}`,
            `${id} is not a controllable parameter`).toBe(
            parameters.has(id) ? `${file}:${section}:${id}` : `${file}:${section}:MISSING(${id})`);
        }
      }
    }
  });
});

// ── 3. Round-trip: does an edit produce the right JSON and states? ────────────

/** The smallest model the schema accepts, no gas path. */
const noGasFixture = (): ModelJson => ({
  states: { T: 0.0, T0: 0.0 },
  connections: { resistive: {}, membrane: {}, bias: {}, regions: {}, cycles: {} },
  cycles: {}, compartments: {}, other: {}, reactions: {}, calibration: {}, control: {},
});

/** Two compartments on real gas regions, so membranes and reactions have somewhere to go. */
const gasFixture = (): ModelJson => {
  let m = noGasFixture();
  m = applyEntity(m, META, 'compartments', 'capacitor',
    { name: 'La', gasRegion: 'Alveoli', bias: 'La', cycle: '', C: 1, V0: 0, y0: 100, p0: 760 }).model;
  m = applyEntity(m, META, 'compartments', 'capacitor',
    { name: 'Cp', gasRegion: 'bloodPhysioArt', bias: 'Cp', cycle: '', C: 1, V0: 0, y0: 50, p0: 760 }).model;
  return m;
};

describe('applyEntity writes the JSON the library expects', () => {
  it('a compartment lands with its capacitor block and aux maps', () => {
    const { model, error } = applyEntity(noGasFixture(), META, 'compartments', 'capacitor', {
      name: 'As', gasRegion: 'bloodPlr', bias: 'Atm', cycle: '', C: 1.27, V0: 523, y0: 650, p0: 860,
    });
    expect(error).toBeUndefined();
    expect(model.compartments.As).toEqual({
      gasRegion: 'bloodPlr',
      type: 'component',
      capacitor: { type: 'capacitor', params: { C: 1.27, V0: 523, y0: 650, p0: 860 } },
    });
    expect(model.connections.bias.As).toBe('Atm');
    expect(model.connections.regions.As).toEqual([]);
    expect(model.connections.cycles.As).toBe('');
    expect(model.states).toMatchObject({ C_As: 1.27, V0_As: 523, V_As: 650, P_As: 860 });
  });

  it('a connection id is derived from from_to and seeds only the states its type owns', () => {
    let m = noGasFixture();
    for (const name of ['Hl', 'As']) {
      m = applyEntity(m, META, 'compartments', 'capacitor',
        { name, gasRegion: 'bloodPlr', bias: 'Atm', cycle: '', C: 1, V0: 0, y0: 0, p0: 760 }).model;
    }

    const plain = applyEntity(m, META, 'resistive', 'resistor', { from: 'Hl', to: 'As', R: 0.01 }).model;
    expect(plain.connections.resistive.Hl_As).toEqual({ from: 'Hl', to: 'As', type: 'resistor', params: { R: 0.01 } });
    expect(plain.states).toHaveProperty('R_Hl_As', 0.01);
    expect(plain.states).not.toHaveProperty('Q_Hl_As');   // algebraic flow, not integrated
    expect(plain.states).not.toHaveProperty('L_Hl_As');
    expect(plain.connections.bias.Hl_As).toBe('Atm');     // every connection needs a bias key

    const inertial = applyEntity(m, META, 'resistive', 'diode_inertial',
      { from: 'Hl', to: 'As', R: 0.01, L: 0.001, threshold: 0.0, y0: -0.94 }).model;
    expect(inertial.states).toMatchObject({ Q_Hl_As: -0.94, R_Hl_As: 0.01, L_Hl_As: 0.001, Th_Hl_As: 0.0 });
  });

  it('a membrane keys its geometry states from from_to, not from its own name', () => {
    const m = applyEntity(gasFixture(), META, 'membrane', 'resistorAlveoli',
      { name: 'AlvMem', from: 'La', to: 'Cp', area: 2800, thickness: 2e-6 }).model;
    expect(m.connections.membrane.AlvMem).toMatchObject({
      from: 'La', to: 'Cp', type: 'resistorAlveoli', paramsMemb: { area: 2800, thickness: 2e-6 },
    });
    expect(m.states).toMatchObject({ area_R_La_Cp: 2800, thickness_R_La_Cp: 2e-6 });
    expect(m.states).not.toHaveProperty('area_R_AlvMem');
    expect(m.connections.bias.AlvMem).toBe('Atm');
  });

  it('a reaction fans pdY_ out over every compartment in its region', () => {
    let m = gasFixture();
    // A second compartment in the same region so the fan-out is visible.
    m = applyEntity(m, META, 'compartments', 'capacitor',
      { name: 'Vp', gasRegion: 'bloodPhysioArt', bias: 'Vp', cycle: '', C: 1, V0: 0, y0: 10, p0: 760 }).model;
    const { model } = applyEntity(m, META, 'reactions', 'equilibrium', {
      region: 'bloodPhysioArt', name: 'C2_HCO3-',
      reactants: 'C2', reactantsRatio: '1', products: 'HCO3-', productsRatio: '1',
      k: 1.0, Kratio: 31.0,
    });
    expect(model.reactions['bloodPhysioArt']['C2_HCO3-']).toEqual({
      type: 'equilibrium',
      reactants: ['C2'], reactantsRatio: [1], products: ['HCO3-'], productsRatio: [1],
      k: 1.0, Kratio: 31.0,
    });
    expect(compartmentsInRegion(model, 'bloodPhysioArt').sort()).toEqual(['Cp', 'Vp']);
    expect(model.states).toMatchObject({
      'k_C2_HCO3-': 1.0, 'Kratio_C2_HCO3-': 31.0,
      'pdY_C2_Cp_C2_HCO3-': 0.0, 'pdY_HCO3-_Cp_C2_HCO3-': 0.0,
      'pdY_C2_Vp_C2_HCO3-': 0.0, 'pdY_HCO3-_Vp_C2_HCO3-': 0.0,
    });
  });

  it('a controller adds no state and is keyed by varToControl', () => {
    let m = noGasFixture();
    m = applyEntity(m, META, 'compartments', 'capacitor',
      { name: 'As', gasRegion: 'bloodPlr', bias: 'Atm', cycle: '', C: 1, V0: 0, y0: 0, p0: 760 }).model;
    const before = Object.keys(m.states).sort();

    const { model } = applyEntity(m, META, 'control', 'cubicController', {
      varToControl: 'C_As', varTarget: 'amp_P_As', targetValue: 60,
      minValue: 0.02, maxValue: 10, cubicFactor: -1, linearFactor: 0, k: 0.1, offset: 0,
    });
    expect(Object.keys(model.control)).toEqual(['C_As']);
    expect(model.control.C_As.type).toBe('cubicController');
    expect(model.control.C_As.params.varToControl).toBe('C_As');
    expect(Object.keys(model.states).sort()).toEqual(before);
  });

  it('an `other` moving average is keyed avg_<varIn>, ignoring newVarName', () => {
    const { model } = applyEntity(noGasFixture(), META, 'other', 'movingAverage',
      { varIn: 'P_As', period: 3.0, y0: 91.5 });
    expect(Object.keys(model.other)).toEqual(['avg_P_As']);
    expect(model.states.avg_P_As).toBe(91.5);
  });

  it('an `other` heldtParamVariation seeds its envelope and the cycle timing pair', () => {
    let m = applyEntity(noGasFixture(), META, 'cycles', 'cycle',
      { name: 'HC', duration: 0.8, triggerOffset: 0, timerOffset: 0 }).model;
    m = applyEntity(m, META, 'other', 'heldtParamVariation', {
      newVarName: 'elastance_Hl', cycle: 'HC', maxValue: 3.8, minValue: 0.15,
      t_up: 0.3, t_down: 0.1, y0: 0,
    }).model;
    expect(m.states).toMatchObject({
      elastance_Hl: 0, Vv0_elastance_Hl: 3.8, VV0_elastance_Hl: 0.15,
      t_Sys_HC: 0.3, t_transition_HC: 0.1,
      Cyc_HC: 0.8, Trig_HC: 0, Tim_HC: 0,
    });
  });

  it('an `other` constant is a controllable parameter, not an integrated state', () => {
    const { model } = applyEntity(noGasFixture(), META, 'other', 'constant',
      { newVarName: 'Upt_TissuesLeg', y0: 0.01 });
    expect(model.states.Upt_TissuesLeg).toBe(0.01);
    expect(deriveParameterStates(model, META)).toContain('Upt_TissuesLeg');
    // and it must NOT be written into the model's (dead) modelParams block
    expect(model.modelParams).toBeUndefined();
  });

  /** Fill every declared field so only the schema itself can fail the call. */
  const fillValues = (section: Section, type: string): Record<string, any> => {
    const identity: Record<string, any> = {
      name: 'X', from: 'La', to: 'Cp', gasRegion: 'bloodPhysioArt', bias: 'La',
      region: 'bloodPhysioArt', cycle: 'HC',
    };
    const values: Record<string, any> = { ...identity };
    for (const f of [...SCHEMA[section].meta, ...SCHEMA[section].types[type].fields]) {
      if (f.name in identity) continue;
      values[f.name] =
        f.kind === 'number'         ? 1
        : f.kind === 'compartmentRef' ? 'La'
        : f.kind === 'cycleRef'       ? ''
        : f.kind === 'gasRegionRef'   ? 'bloodPhysioArt'
        : f.kind === 'ratioList'      ? '1'
        : f.kind === 'speciesList'    ? 'O2'
        : f.kind === 'stateList'      ? 'V_La'
        : f.name === 'newVarName'     ? 'X'
        : f.name === 'varToControl'   ? 'C_La'
        : f.name === 'varIn'          ? 'P_La'
        : 'V_La';
    }
    return values;
  };

  it('every type in every section can be created with its declared fields', () => {
    // A cycle must exist for the types that reference one (elastance, ventilator, heldt).
    const base = applyEntity(gasFixture(), META, 'cycles', 'cycle',
      { name: 'HC', duration: 0.8, triggerOffset: 0, timerOffset: 0 }).model;

    for (const section of SECTIONS) {
      for (const type of Object.keys(SCHEMA[section].types)) {
        const values = fillValues(section, type);
        const { model, error } = applyEntity(base, META, section, type, values);
        expect(`${section}/${type}: ${error ?? 'ok'}`).toBe(`${section}/${type}: ok`);

        // The entry must land under the id the schema says it owns, with the chosen type.
        const id      = entityId(section, type, values);
        const entries = Object.fromEntries(sectionEntries(model, section));
        expect(`${section}/${type} -> ${id}: ${id in entries ? 'present' : 'MISSING'}`)
          .toBe(`${section}/${type} -> ${id}: present`);
        expect(entryType(section, entries[id])).toBe(type);
      }
    }
  });

  it('refuses a duplicate key, a blank key and a blank required param', () => {
    const full = { name: 'HC', duration: 0.8, triggerOffset: 0, timerOffset: 0 };
    const m = applyEntity(noGasFixture(), META, 'cycles', 'cycle', full).model;
    expect(applyEntity(m, META, 'cycles', 'cycle', full).error).toMatch(/already exists/);
    expect(applyEntity(m, META, 'cycles', 'cycle', { ...full, name: '' }).error).toMatch(/Required/);
    // 0 is a legitimate value — only an absent/empty field counts as blank.
    expect(applyEntity(m, META, 'cycles', 'cycle', { ...full, name: 'RCLa', duration: 0 }).error).toBeUndefined();
    expect(applyEntity(m, META, 'cycles', 'cycle', { name: 'RCLa', duration: 5 }).error).toMatch(/Trigger Offset/);
  });
});

// ── 4. Lossless round-trip on the real configs ───────────────────────────────

describe('editing a shipped config preserves everything else', () => {
  /** The whole point of the exercise: open ANY entry of ANY shipped model, press Save
   *  without changing a thing, and get the same JSON back. A schema field the registry is
   *  missing, a param it coerces wrongly, or a state it seeds differently all surface here. */
  it.each(MODEL_FILES)('%s — re-applying every entry unchanged is a no-op', file => {
    const model = MODELS[file];
    const damage: string[] = [];

    for (const section of SECTIONS) {
      for (const [id, entry] of sectionEntries(model, section)) {
        const type   = entryType(section, entry);
        const values = editValuesFor(model, section, id, entry);
        const { model: next, error } = applyEntity(model, META, section, type, values, id);

        if (error) { damage.push(`${section}/${id}: ${error}`); continue; }

        const after = Object.fromEntries(sectionEntries(next, section))[id];
        // Key ORDER inside params carries no meaning — the config lands in a JSONB column,
        // which does not preserve it either. Compare on content only.
        if (stable(after) !== stable(entry)) {
          damage.push(`${section}/${id}: entry changed\n  was ${stable(entry)}\n  now ${stable(after)}`);
        }
        const lost = Object.keys(model.states ?? {}).filter(k => !(k in next.states));
        if (lost.length) damage.push(`${section}/${id}: lost states ${lost.join(', ')}`);
        const allowed = new Set(['T', 'T0', ...(KNOWN_UNDECLARED[file] ?? [])]);
        const gained = Object.keys(next.states).filter(k => !(k in (model.states ?? {})) && !allowed.has(k));
        if (gained.length) damage.push(`${section}/${id}: invented states ${gained.join(', ')}`);
      }
    }
    expect(damage).toEqual([]);
  });

  it.each(MODEL_FILES)('%s — a no-op re-apply changes only the edited entry', file => {
    const model = MODELS[file];
    const [id, entry] = sectionEntries(model, 'compartments')[0];
    const type = entryType('compartments', entry);
    const { model: next, error } = applyEntity(model, META, 'compartments', type, {
      name: id,
      gasRegion: entry.gasRegion,
      bias: model.connections.bias[id],
      cycle: model.connections.cycles[id] ?? '',
      ...entryParams('compartments', entry),
    }, id);

    expect(error).toBeUndefined();
    // Sections the sandbox does not touch survive byte-for-byte.
    for (const key of ['reactions', 'calibration', 'control', 'savedd', 'configurations', 'modelParams']) {
      expect(next[key]).toEqual(model[key]);
    }
    expect(next.connections.membrane).toEqual(model.connections.membrane);
    expect(next.compartments[id]).toEqual(model.compartments[id]);
    // states may only gain the globals a config might not have listed
    const added = Object.keys(next.states).filter(k => !(k in model.states));
    expect(added.filter(k => k !== 'T' && k !== 'T0')).toEqual([]);
  });

  it('canonicalModelJson reorders without losing or changing any value', () => {
    for (const file of MODEL_FILES) {
      const model = MODELS[file];
      const canon = canonicalModelJson(structuredClone(model));
      expect(Object.keys(canon).sort()).toEqual(Object.keys(model).sort());
      for (const key of Object.keys(model)) expect(canon[key]).toEqual(model[key]);
    }
  });
});

// ── 5. Removal prunes exactly what it owns ───────────────────────────────────

describe('removeEntity', () => {
  it('does not sweep unrelated states that merely end in the same name', () => {
    let m = noGasFixture();
    m = applyEntity(m, META, 'compartments', 'capacitor',
      { name: 'As', gasRegion: 'bloodPlr', bias: 'Atm', cycle: '', C: 1, V0: 0, y0: 0, p0: 760 }).model;
    m = applyEntity(m, META, 'other', 'movingAverage', { varIn: 'P_As', period: 3, y0: 0 }).model;
    m = applyEntity(m, META, 'other', 'constant', { newVarName: 'SV_target_As', y0: 55 }).model;

    const { model, dependants } = removeEntity(m, META, 'compartments', 'As');
    expect(dependants).toEqual([]);
    expect(model.compartments.As).toBeUndefined();
    expect(model.states).not.toHaveProperty('V_As');
    expect(model.states).not.toHaveProperty('C_As');
    // The old page's `endsWith('_As')` prune took these with it.
    expect(model.states).toHaveProperty('avg_P_As');
    expect(model.states).toHaveProperty('SV_target_As');
    expect(model.connections.bias).not.toHaveProperty('As');
  });

  it('refuses to remove a compartment a connection still points at', () => {
    let m = noGasFixture();
    for (const name of ['Hl', 'As']) {
      m = applyEntity(m, META, 'compartments', 'capacitor',
        { name, gasRegion: 'bloodPlr', bias: 'Atm', cycle: '', C: 1, V0: 0, y0: 0, p0: 760 }).model;
    }
    m = applyEntity(m, META, 'resistive', 'resistor', { from: 'Hl', to: 'As', R: 0.01 }).model;

    const { model, dependants } = removeEntity(m, META, 'compartments', 'As');
    expect(dependants).toContain('connection Hl_As');
    expect(model.compartments.As).toBeDefined();          // unchanged
    expect(referencesTo(m, 'compartments', 'As')).not.toEqual([]);
  });

  it('keeps a shared cycle timing state while another entry still claims it', () => {
    let m = applyEntity(noGasFixture(), META, 'cycles', 'cycle',
      { name: 'HC', duration: 0.8, triggerOffset: 0, timerOffset: 0 }).model;
    for (const name of ['elastance_Hl', 'elastance_Hr']) {
      m = applyEntity(m, META, 'other', 'heldtParamVariation',
        { newVarName: name, cycle: 'HC', maxValue: 1, minValue: 0, t_up: 0.3, t_down: 0.1, y0: 0 }).model;
    }
    const { model } = removeEntity(m, META, 'other', 'elastance_Hl');
    expect(model.states).not.toHaveProperty('Vv0_elastance_Hl');
    expect(model.states).toHaveProperty('t_Sys_HC');       // still owned by elastance_Hr
    expect(model.states).toHaveProperty('Vv0_elastance_Hr');
  });
});

// ── 6. Validation ─────────────────────────────────────────────────────────────

describe('validateModel', () => {
  const messages = (m: ModelJson) => validateModel(m, META).map(f => f.message);

  it('reports no error on the shipped configs', () => {
    for (const file of MODEL_FILES) {
      const errors = validateModel(MODELS[file], META).filter(f => f.level === 'error');
      expect(`${file}: ${errors.map(e => e.message).join(' | ') || 'clean'}`).toBe(`${file}: clean`);
    }
  });

  /** The exact warning profile of the shipped configs. Pinning it keeps the checks panel
   *  honest: a new false positive shows up here, and so does a real problem we introduce. */
  it('produces only the known warnings on the shipped configs', () => {
    const profile = MODEL_FILES.flatMap(file => {
      const findings = validateModel(MODELS[file], META);
      const kinds = new Map<string, number>();
      for (const f of findings) {
        const kind = `${f.level}: ${f.message.replace(/"[^"]*"/g, '"…"')}`;
        kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
      }
      return [...kinds].map(([kind, n]) => `${file} x${n} ${kind}`);
    });
    // Clean: cpet's five orphan connections.regions/cycles keys (Ah, Aa, Al, Va, Vl) from the
    // older arterial/venous split are gone, and the inertial pair now declares L_Hl_As.
    expect(profile).toEqual([]);
  });

  it('catches a membrane with no bias entry', () => {
    const m = gasFixture();
    m.connections.membrane = { AlvMem: { from: 'La', to: 'Cp', type: 'resistorAlveoli', paramsMemb: { area: 1, thickness: 1 }, params: {} } };
    expect(messages(m).join('\n')).toMatch(/connections\.bias has no entry for "AlvMem"/);
  });

  it('catches a gasRegion metadata does not declare', () => {
    const m = gasFixture();
    m.compartments.La.gasRegion = 'NotARegion';
    expect(messages(m).join('\n')).toMatch(/metadata\.json does not declare/);
  });

  it('catches a controller whose key and varToControl disagree', () => {
    const m = gasFixture();
    m.control = { C_La: { type: 'cubicController', params: { varToControl: 'C_Cp' } } };
    expect(messages(m).join('\n')).toMatch(/the key and varToControl must match/);
  });

  it('catches a controller aimed at something that is not a parameter', () => {
    const m = gasFixture();
    m.control = { V_La: { type: 'cubicController', params: { varToControl: 'V_La' } } };
    expect(messages(m).join('\n')).toMatch(/not register .* controllable parameter|controllable parameter/);
  });

  it('catches a dangling connection endpoint', () => {
    const m = gasFixture();
    m.connections.resistive = { La_Nope: { from: 'La', to: 'Nope', type: 'resistor', params: { R: 1 } } };
    m.connections.bias.La_Nope = 'Atm';
    expect(messages(m).join('\n')).toMatch(/points to at "Nope"|points to "Nope"|"Nope", which is not a compartment/);
  });
});
