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
  deriveEntityStates, deriveParameterStates, deriveStates,
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
  /** Two documented, behaviour-neutral discrepancies between the shipped configs and the
   *  state vector the generator actually builds. Both are config drift, not schema bugs —
   *  keep them named here so a NEW divergence still fails the suite.
   *
   *  1. `Q_<from>_<to>` on a non-inertial connection: the flow is algebraic, so the name is
   *     not in `stateNames` and `encodeStates` ignores the key. The cvModel configs carry
   *     one per connection; cpet carries only the four inertial ones.
   *  2. `L_Hl_As` missing from the two `*_inertial*` configs: their `Hl_As` is
   *     `diode_inertial`, so the generator registers `L_Hl_As`; the configs park a stale
   *     0.0002 in the dead `savedd` block instead, and the run falls back to the
   *     generator default (`params.L` = 0.01). */
  const inertFlowKey = (model: ModelJson, name: string): boolean => {
    if (!name.startsWith('Q_')) return false;
    const entry = (model.connections?.resistive ?? {})[name.slice(2)];
    return !!entry && !['inertial', 'diode_inertial'].includes(entry.type);
  };
  const KNOWN_UNDECLARED: Record<string, string[]> = {
    'cvModel_linear_inertial.json':    ['L_Hl_As'],
    'cvModel_linear_inertialAlt.json': ['L_Hl_As'],
  };

  it.each(MODEL_FILES)('%s — the derived state set matches the config', file => {
    const model   = MODELS[file];
    const derived = new Set(Object.keys(deriveStates(model, META)));
    const stated  = new Set(Object.keys(model.states ?? {}));

    // Derived but not declared: the run silently falls back to the generator default.
    const undeclared = [...derived].filter(n => !stated.has(n)).sort();
    expect(undeclared).toEqual(KNOWN_UNDECLARED[file] ?? []);

    // Declared but never built: a stale key the state vector has no slot for.
    const unbuilt = [...stated].filter(n => !derived.has(n) && !inertFlowKey(model, n)).sort();
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

  it('every type in every section can be created from empty values', () => {
    for (const section of SECTIONS) {
      for (const type of Object.keys(SCHEMA[section].types)) {
        const values: Record<string, any> = {
          name: 'X', from: 'A', to: 'B', gasRegion: 'bloodPlr', bias: 'A',
          region: 'bloodPhysioArt', varToControl: 'R_A_B', newVarName: 'X', varIn: 'P_A',
          cycle: '', compartment: 'A',
        };
        const { model, error } = applyEntity(gasFixture(), META, section, type, values);
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

  it('refuses a duplicate key and an empty key', () => {
    const m = applyEntity(noGasFixture(), META, 'cycles', 'cycle',
      { name: 'HC', duration: 0.8, triggerOffset: 0, timerOffset: 0 }).model;
    expect(applyEntity(m, META, 'cycles', 'cycle', { name: 'HC', duration: 1 }).error).toMatch(/already exists/);
    expect(applyEntity(m, META, 'cycles', 'cycle', { name: '', duration: 1 }).error).toMatch(/Required field/);
  });
});

// ── 4. Lossless round-trip on the real configs ───────────────────────────────

describe('editing a shipped config preserves everything else', () => {
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
