// Tests: ModelCanvas — the canvas's style maps vs. the schema registry it draws.
//
// The bug this pins: the canvas used to know three compartment types and two connection
// types out of the fourteen modelSchema declares, so cpet's `elastanceInput` hearts,
// `thorax` containers and `diode_inertial` valves all fell through to an "unknown" style
// and the membranes were not drawn at all. Coverage is now a failing test, not a redraw.
//
// It also runs the pure layout over the shipped python/config models, so a topology the
// auto-sort cannot place shows up here rather than as nodes stacked on the origin.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { NODE_STYLE, EDGE_STYLE, MEMBRANE_STYLE, readModel, autoLayout } from './ModelCanvas';
import { SCHEMA } from '../../pages/models/modelSchema';

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Same walk-up as modelSchema.test.ts: vitest runs with cwd=pwa/, the fixtures are the
 *  real python/config tree so the suite can never drift from disk. */
const CONFIG = (() => {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, 'python', 'config');
    if (fs.existsSync(path.join(candidate, 'metadata.json'))) return candidate;
    dir = path.dirname(dir);
  }
  throw new Error('python/config not found above ' + process.cwd());
})();

const MODEL_FILES = fs.readdirSync(path.join(CONFIG, 'models')).filter(f => f.endsWith('.json')).sort();

const MODELS: Record<string, any> = Object.fromEntries(
  MODEL_FILES.map(f => [f, JSON.parse(fs.readFileSync(path.join(CONFIG, 'models', f), 'utf8'))]),
);

// ── Coverage of the registry ──────────────────────────────────────────────────

describe('canvas style maps cover the schema registry', () => {
  it('NODE_STYLE has every compartment type', () => {
    expect(Object.keys(NODE_STYLE).sort()).toEqual(Object.keys(SCHEMA.compartments.types).sort());
  });

  it('EDGE_STYLE has every resistive type', () => {
    expect(Object.keys(EDGE_STYLE).sort()).toEqual(Object.keys(SCHEMA.resistive.types).sort());
  });

  it('MEMBRANE_STYLE has every membrane type', () => {
    expect(Object.keys(MEMBRANE_STYLE).sort()).toEqual(Object.keys(SCHEMA.membrane.types).sort());
  });
});

// ── The shipped models ────────────────────────────────────────────────────────

describe.each(MODEL_FILES)('%s', file => {
  const model = () => MODELS[file];

  it('every compartment and connection type is styled', () => {
    const { nodes, edges } = readModel(model());
    nodes.forEach(n => expect(NODE_STYLE[n.type], `${n.id}: ${n.type}`).toBeDefined());
    edges.forEach(e => {
      const map = e.kind === 'flow' ? EDGE_STYLE : MEMBRANE_STYLE;
      expect(map[e.type], `${e.id}: ${e.type}`).toBeDefined();
    });
  });

  it('auto-layout places every compartment at a distinct point', () => {
    const { nodes, edges } = readModel(model());
    const pos = autoLayout(nodes, edges);
    nodes.forEach(n => expect(pos[n.id], n.id).toBeDefined());
    const points = nodes.map(n => `${pos[n.id].x},${pos[n.id].y}`);
    expect(new Set(points).size).toBe(nodes.length);
  });

  it('auto-layout is deterministic', () => {
    const { nodes, edges } = readModel(model());
    expect(autoLayout(nodes, edges)).toEqual(autoLayout(nodes, edges));
  });
});

// ── The one model whose structure exercises every layer ───────────────────────

describe('cpet.json', () => {
  const { nodes, edges } = readModel(MODELS['cpet.json']);
  const byId = Object.fromEntries(nodes.map(n => [n.id, n]));

  it('reads the hearts as pumps and the thorax pair as containers', () => {
    expect(byId.Hl.role).toBe('pump');
    expect(byId.Hr.role).toBe('pump');
    expect(byId.Thx.role).toBe('container');
    expect(byId.Plr.role).toBe('container');
    expect(byId.Atm.role).toBe('reference');
  });

  it('reads the membranes that tie the tissues in', () => {
    const memb = edges.filter(e => e.kind === 'membrane');
    expect(memb.map(e => e.id).sort()).toEqual(['AlvMem', 'TissMemAbdomen', 'TissMemHead', 'TissMemLeg']);
    memb.forEach(e => expect(e.species).toBeGreaterThan(0));
  });

  it('reads cycles and reaction counts onto the nodes', () => {
    expect(byId.Hr.cycle).toBe('HC');
    expect(byId.Plr.cycle).toBe('RCLa');
    expect(byId.As.reactions).toBe(2);        // bloodPhysioArt
    expect(byId.TissueLeg.reactions).toBe(5); // tissueLeg
    expect(byId.Atm.reactions).toBe(0);
  });

  it('lays the airway above the pulmonary loop, the tissues below the systemic one', () => {
    const pos = autoLayout(nodes, edges);
    // Airway chain (no pump) is the top band.
    ['Comp0', 'Lt', 'Lb', 'La'].forEach(id => expect(pos[id].y).toBeLessThan(pos.Hr.y));
    // Pulmonary (holds Cp, the alveolar membrane's partner) sits above systemic.
    expect(pos.Cp.y).toBeLessThan(pos.As.y);
    // Tissues hang below the systemic band.
    ['TissueLeg', 'TissueHead', 'TissueAbdomen'].forEach(id => expect(pos[id].y).toBeGreaterThan(pos.As.y));
    // The unwired rail is last.
    expect(pos.Atm.y).toBeGreaterThan(pos.TissueLeg.y);
  });
});
