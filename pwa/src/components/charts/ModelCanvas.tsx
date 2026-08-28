// Component: ModelCanvas — the Model Sandbox's circuit diagram of a cardio-pulmonary model.
//
// Draws every structural key a model JSON carries, each behind its own layer toggle:
//   compartments  → one node, styled by `capacitor.type` (NODE_STYLE)
//   connections.resistive → flow edges, styled by type (EDGE_STYLE: valve + coil glyphs)
//   connections.membrane  → diffusion edges (MEMBRANE_STYLE) — the only thing tying the
//                           tissue compartments to the circuit
//   connections.bias      → the pressure-reference map, as faint dotted links
//   connections.regions   → containment envelopes (thorax, pleura)
//   connections.cycles    → a per-node cycle badge
//   reactions             → a per-node badge, resolved through the compartment's gasRegion
//
// The three style maps are keyed on the exact type strings pages/models/modelSchema.ts
// declares; ModelCanvas.test.ts pins them against that registry so a new equation type
// cannot silently fall through to "unknown" again.
//
// Positions are model-space points. Auto-sort lays the graph out in role bands; any node
// the caller's saved layout names overrides its auto position. Nothing is persisted here —
// every commit goes out through onLayoutChange, and the page saves it with the model.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IonButton, IonChip, IonLabel } from '@ionic/react';
import { CanvasLayer, ModelLayout } from '../../interfaces/types';

interface ModelCanvasProps {
  modelJson:       Record<string, any> | null;
  layout?:         ModelLayout | null;
  onLayoutChange?: (next: ModelLayout) => void;
  onSelectNode?:   (id: string) => void;
  selectedNode?:   string | null;
  height?:         number;
}


// ── Type registry mirror ──────────────────────────────────────────────────────

export type NodeRole = 'pump' | 'vessel' | 'nonlinear' | 'driver' | 'container' | 'reference';

/** Every key of SCHEMA.compartments.types → the role it is drawn as. */
export const NODE_STYLE: Record<string, NodeRole> = {
  capacitor:              'vessel',
  elastance:              'pump',
  thorax:                 'container',
  elastanceInput:         'pump',
  sigmoidCapacitor:       'nonlinear',
  doubleSigmoidCapacitor: 'nonlinear',
  constantPressure:       'reference',
  ventilator:             'driver',
  ventilatorFile:         'driver',
};

const ROLE_STYLE: Record<NodeRole, { fill: string; label: string; box?: boolean }> = {
  pump:      { fill: '#e05b5b', label: 'Heart / pump (elastance)' },
  vessel:    { fill: '#4a90d9', label: 'Vessel (capacitor)' },
  nonlinear: { fill: '#4a90d9', label: 'Vessel (nonlinear compliance)' },
  driver:    { fill: '#2aa198', label: 'Ventilator' },
  container: { fill: '#d9932a', label: 'Pressure container (thorax)', box: true },
  reference: { fill: '#888888', label: 'Reference (constant pressure)' },
};

/** Every key of SCHEMA.resistive.types → its glyphs. `valve` marks a diode, `coil` an
 *  inductance, `source` the driven-pressure variant. */
export const EDGE_STYLE: Record<string, { valve: boolean; coil: boolean; source?: boolean }> = {
  resistor:              { valve: false, coil: false },
  diode:                 { valve: true,  coil: false },
  inertial:              { valve: false, coil: true  },
  diode_inertial:        { valve: true,  coil: true  },
  resistorInputPressure: { valve: false, coil: false, source: true },
};

/** Every key of SCHEMA.membrane.types. Membranes are drawn dashed and arrowless —
 *  diffusion runs both ways — with `valve` marking the rectifying variant. */
export const MEMBRANE_STYLE: Record<string, { valve: boolean }> = {
  resistorAlveoli: { valve: false },
  resistor:        { valve: false },
  diode:           { valve: true  },
};

const UNKNOWN_ROLE: NodeRole = 'vessel';


// ── Geometry ──────────────────────────────────────────────────────────────────

const NODE_R  = 24;   // node radius (containers are drawn as a 2R box)
const COL_W   = 132;  // horizontal spacing between layout columns
const BAND_H  = 118;  // vertical spacing between role bands
const SUB_H   = 74;   // vertical spacing between nodes sharing a column
const PAD     = 60;   // padding used when fitting the viewport

const ARROW_ID = 'cvCanvas-arrow';

const LAYER_ORDER: CanvasLayer[] = ['flow', 'membranes', 'bias', 'regions', 'cycles', 'reactions'];

const LAYER_LABEL: Record<CanvasLayer, string> = {
  flow:      'Flow',
  membranes: 'Membranes',
  bias:      'Bias',
  regions:   'Regions',
  cycles:    'Cycles',
  reactions: 'Reactions',
};

const DEFAULT_LAYERS: Record<CanvasLayer, boolean> = {
  flow: true, membranes: true, bias: false, regions: false, cycles: true, reactions: true,
};


// ── Reading the model ─────────────────────────────────────────────────────────

export interface CanvasNode {
  id:        string;
  type:      string;          // capacitor.type as written in the JSON
  role:      NodeRole;
  cycle:     string;          // connections.cycles[id]
  reactions: number;          // reaction count of the compartment's gas region
  bias:      string | null;   // connections.bias[id]
}

export interface CanvasEdge {
  id:      string;
  kind:    'flow' | 'membrane';
  type:    string;
  from:    string;
  to:      string;
  species: number;            // membranes only: how many species it carries
  bias:    string | null;     // connections.bias[<edge id>]
}

const compartmentType = (comp: any): string => String(comp?.capacitor?.type ?? '');

export const roleOf = (comp: any): NodeRole => NODE_STYLE[compartmentType(comp)] ?? UNKNOWN_ROLE;

/** Flatten a model JSON into the nodes and edges the canvas draws. Pure. */
export function readModel(modelJson: Record<string, any>): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const comps:     Record<string, any> = modelJson?.compartments ?? {};
  const resistive: Record<string, any> = modelJson?.connections?.resistive ?? {};
  const membrane:  Record<string, any> = modelJson?.connections?.membrane ?? {};
  const bias:      Record<string, any> = modelJson?.connections?.bias ?? {};
  const cycles:    Record<string, any> = modelJson?.connections?.cycles ?? {};
  const reactions: Record<string, any> = modelJson?.reactions ?? {};

  const nodes: CanvasNode[] = Object.entries(comps).map(([id, comp]) => ({
    id,
    type:      compartmentType(comp),
    role:      roleOf(comp),
    cycle:     String(cycles[id] ?? ''),
    reactions: Object.keys(reactions[comp?.gasRegion] ?? {}).length,
    bias:      typeof bias[id] === 'string' && bias[id] !== id ? bias[id] : null,
  }));

  const edge = (kind: 'flow' | 'membrane') => ([id, c]: [string, any]): CanvasEdge => ({
    id,
    kind,
    type:    String(c?.type ?? ''),
    from:    String(c?.from ?? ''),
    to:      String(c?.to ?? ''),
    // A membrane's per-species diffusion map lives under `params`; paramsMemb holds the
    // area/thickness pair and is not a species.
    species: kind === 'membrane' ? Object.keys(c?.params ?? {}).length : 0,
    bias:    typeof bias[id] === 'string' ? bias[id] : null,
  });

  const known = new Set(nodes.map(n => n.id));
  const edges = [
    ...Object.entries(resistive).map(edge('flow')),
    ...Object.entries(membrane).map(edge('membrane')),
  ].filter(e => known.has(e.from) && known.has(e.to));

  return { nodes, edges };
}


// ── Layered-by-role auto layout ───────────────────────────────────────────────

type Pos = { x: number; y: number };

/** Connected components (undirected) of the flow graph, over the nodes that have at
 *  least one flow edge. */
function flowComponents(ids: string[], edges: CanvasEdge[]): string[][] {
  const adj: Record<string, Set<string>> = {};
  ids.forEach(id => { adj[id] = new Set(); });
  edges.forEach(e => { adj[e.from]?.add(e.to); adj[e.to]?.add(e.from); });

  const seen = new Set<string>();
  const out: string[][] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    const stack = [id];
    const group: string[] = [];
    seen.add(id);
    while (stack.length) {
      const cur = stack.pop() as string;
      group.push(cur);
      adj[cur].forEach(n => { if (!seen.has(n)) { seen.add(n); stack.push(n); } });
    }
    out.push(group.sort());
  }
  return out;
}

/** Longest-path depth over a DAG given as an adjacency list, plus a DFS back-edge sweep
 *  so a cycle that survived the pump cut cannot hang the walk. */
function depths(members: string[], out: Record<string, string[]>): Record<string, number> {
  const indeg: Record<string, number> = {};
  members.forEach(m => { indeg[m] = 0; });
  members.forEach(m => out[m].forEach(t => { if (indeg[t] !== undefined) indeg[t] += 1; }));

  const depth: Record<string, number> = {};
  members.forEach(m => { depth[m] = 0; });

  // Kahn's algorithm; anything left over sits in a residual cycle and keeps depth 0.
  const queue = members.filter(m => indeg[m] === 0).sort();
  const ready = new Set(queue);
  while (queue.length) {
    const cur = queue.shift() as string;
    for (const t of out[cur]) {
      if (indeg[t] === undefined) continue;
      depth[t] = Math.max(depth[t], depth[cur] + 1);
      indeg[t] -= 1;
      if (indeg[t] === 0 && !ready.has(t)) { ready.add(t); queue.push(t); }
    }
  }
  return depth;
}

/** Place one band of nodes: `columns` maps column index → the ids in it, stacked. */
function placeBand(columns: string[][], y: number, reversed: boolean, pos: Record<string, Pos>): number {
  const cols = reversed ? [...columns].reverse() : columns;
  const width = (cols.length - 1) * COL_W;
  cols.forEach((ids, i) => {
    const x = i * COL_W - width / 2;
    ids.forEach((id, j) => { pos[id] = { x, y: y + (j - (ids.length - 1) / 2) * SUB_H }; });
  });
  return Math.max(...cols.map(c => c.length), 1);
}

/** Group ids by column index, each column ordered by the barycentre of its predecessors
 *  so parallel beds do not cross, alphabetical as the deterministic tie-break. */
function columnsOf(members: string[], depth: Record<string, number>, into: Record<string, string[]>): string[][] {
  const maxDepth = Math.max(0, ...members.map(m => depth[m] ?? 0));
  const cols: string[][] = Array.from({ length: maxDepth + 1 }, () => []);
  members.forEach(m => cols[depth[m] ?? 0].push(m));

  const slot: Record<string, number> = {};
  cols.forEach(ids => {
    ids.sort((a, b) => {
      const bary = (id: string) => {
        const preds = (into[id] ?? []).filter(p => slot[p] !== undefined);
        return preds.length ? preds.reduce((s, p) => s + slot[p], 0) / preds.length : Number.MAX_SAFE_INTEGER;
      };
      const ba = bary(a), bb = bary(b);
      return ba !== bb ? ba - bb : a.localeCompare(b);
    });
    ids.forEach((id, i) => { slot[id] = i; });
  });
  return cols;
}

/**
 * Deterministic layered layout, from structure alone — no compartment name is hardcoded,
 * because the shipped models do not agree on them (cvModel's `Cs` vs cpet's `Ch`/`Ca`/`Cl`).
 *
 * Bands, top to bottom:
 *   1. flow components with no pump — the ventilation chain
 *   2. the pulmonary half of each circulation (the half holding an alveolar membrane's
 *      partner; the shorter half when the model has no membranes)
 *   3. the systemic half, drawn right-to-left so the loop closes as a racetrack
 *   4. compartments reachable only through a membrane — the tissues — under their partner
 *   5. everything unwired: references and containers, on a bottom rail
 */
export function autoLayout(nodes: CanvasNode[], edges: CanvasEdge[]): Record<string, Pos> {
  const pos: Record<string, Pos> = {};
  if (nodes.length === 0) return pos;

  const byId  = Object.fromEntries(nodes.map(n => [n.id, n]));
  const flow  = edges.filter(e => e.kind === 'flow');
  const membs = edges.filter(e => e.kind === 'membrane');

  const wired = new Set<string>();
  flow.forEach(e => { wired.add(e.from); wired.add(e.to); });

  const components  = flowComponents([...wired].sort(), flow);
  const chains      = components.filter(c => !c.some(id => byId[id].role === 'pump'));
  const circulations = components.filter(c => c.some(id => byId[id].role === 'pump'));

  let y = 0;

  // ── Band 1: pump-free chains (the airway) ──────────────────────────────────
  for (const members of chains) {
    const out: Record<string, string[]> = {}, into: Record<string, string[]> = {};
    members.forEach(m => { out[m] = []; into[m] = []; });
    flow.forEach(e => { if (out[e.from] && out[e.to] !== undefined) { out[e.from].push(e.to); into[e.to].push(e.from); } });
    const rows = placeBand(columnsOf(members, depths(members, out), into), y, false, pos);
    y += BAND_H + (rows - 1) * SUB_H;
  }

  // ── Bands 2 & 3: each circulation, split at its pumps ───────────────────────
  // The alveolar membrane's circulation-side endpoint marks the pulmonary half.
  const chainIds = new Set(chains.flat());
  const alveolarPartners = new Set(
    membs.flatMap(m => (chainIds.has(m.from) ? [m.to] : chainIds.has(m.to) ? [m.from] : [])),
  );

  for (const members of circulations) {
    const memberSet = new Set(members);
    const out: Record<string, string[]> = {}, into: Record<string, string[]> = {};
    members.forEach(m => { out[m] = []; into[m] = []; });
    // Cutting every edge that *enters* a pump opens both loops at the valves, leaving one
    // DAG source per pump — which is exactly the split we want to draw.
    flow.forEach(e => {
      if (!memberSet.has(e.from) || !memberSet.has(e.to)) return;
      if (byId[e.to].role === 'pump') return;
      out[e.from].push(e.to);
      into[e.to].push(e.from);
    });

    const depth = depths(members, out);
    const pumps = members.filter(m => byId[m].role === 'pump').sort();

    // Each node belongs to the pump it is nearest to, following the cut graph forward.
    const owner: Record<string, string> = {};
    const dist:  Record<string, number> = {};
    for (const pump of pumps) {
      const queue: [string, number][] = [[pump, 0]];
      while (queue.length) {
        const [cur, d] = queue.shift() as [string, number];
        if (dist[cur] !== undefined && (dist[cur] < d || (dist[cur] === d && owner[cur] <= pump))) continue;
        owner[cur] = pump; dist[cur] = d;
        out[cur].forEach(t => queue.push([t, d + 1]));
      }
    }
    members.forEach(m => { if (owner[m] === undefined) owner[m] = pumps[0] ?? m; });

    const halves = (pumps.length ? pumps : [members[0]])
      .map(pump => ({ pump, members: members.filter(m => owner[m] === pump) }))
      .filter(h => h.members.length > 0);

    // Pulmonary first: the half holding an alveolar membrane partner, else the shorter one.
    const pulmonary = halves.find(h => h.members.some(m => alveolarPartners.has(m)));
    const ordered = pulmonary
      ? [pulmonary, ...halves.filter(h => h !== pulmonary)]
      : [...halves].sort((a, b) => a.members.length - b.members.length || a.pump.localeCompare(b.pump));

    ordered.forEach((half, i) => {
      // Alternate the column direction so consecutive halves close into a racetrack.
      const rows = placeBand(columnsOf(half.members, depth, into), y, i % 2 === 1, pos);
      y += BAND_H + (rows - 1) * SUB_H;
    });
  }

  // ── Band 4: membrane-only compartments (tissues), under their partner ───────
  const loose = nodes.map(n => n.id).filter(id => !wired.has(id)).sort();
  const partnerOf = (id: string): string | null => {
    const m = membs.find(e => e.from === id || e.to === id);
    if (!m) return null;
    const other = m.from === id ? m.to : m.from;
    return pos[other] ? other : null;
  };

  const tissues = loose.filter(id => partnerOf(id) !== null);
  if (tissues.length) {
    // Several tissues can hang off columns that share an x (parallel vascular beds), so
    // spread the ones that collide instead of stacking them on the same point.
    const buckets: Record<number, string[]> = {};
    tissues.forEach(id => {
      const x = pos[partnerOf(id) as string].x;
      (buckets[x] ??= []).push(id);
    });
    Object.entries(buckets).forEach(([x, ids]) => {
      ids.forEach((id, i) => { pos[id] = { x: Number(x) + (i - (ids.length - 1) / 2) * COL_W, y }; });
    });
    y += BAND_H;
  }

  // ── Band 5: the unwired rail — references and containers ───────────────────
  const rail = loose.filter(id => !tissues.includes(id));
  if (rail.length) {
    const width = (rail.length - 1) * COL_W;
    rail.forEach((id, i) => { pos[id] = { x: i * COL_W - width / 2, y }; });
  }

  return pos;
}


// ── Drawing helpers ───────────────────────────────────────────────────────────

/** Trim an edge back to the node boundary, leaving room for the arrowhead. */
function trim(from: Pos, to: Pos, headroom: number): { x1: number; y1: number; x2: number; y2: number } {
  const dx = to.x - from.x, dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return { x1: from.x, y1: from.y, x2: to.x, y2: to.y };
  const nx = dx / len, ny = dy / len;
  return {
    x1: from.x + nx * NODE_R,
    y1: from.y + ny * NODE_R,
    x2: to.x   - nx * (NODE_R + headroom),
    y2: to.y   - ny * (NODE_R + headroom),
  };
}

/** Valve glyph: a triangle pointing along the edge, against a bar. */
const ValveGlyph: React.FC<{ x: number; y: number; angle: number; color: string }> = ({ x, y, angle, color }) => (
  <g transform={`translate(${x},${y}) rotate(${angle})`}>
    <path d="M-5,-5 L5,0 L-5,5 Z" fill={color} />
    <line x1={5} y1={-6} x2={5} y2={6} stroke={color} strokeWidth={1.6} />
  </g>
);

/** Inductor glyph: three humps along the edge. */
const CoilGlyph: React.FC<{ x: number; y: number; angle: number; color: string }> = ({ x, y, angle, color }) => (
  <g transform={`translate(${x},${y}) rotate(${angle})`}>
    <path
      d="M-9,0 a3,3 0 0 1 6,0 a3,3 0 0 1 6,0 a3,3 0 0 1 6,0"
      fill="none" stroke={color} strokeWidth={1.6}
    />
  </g>
);

/** Driven-pressure glyph: a circled plus at the edge's source end. */
const SourceGlyph: React.FC<{ x: number; y: number; color: string }> = ({ x, y, color }) => (
  <g transform={`translate(${x},${y})`}>
    <circle r={6} fill="none" stroke={color} strokeWidth={1.4} />
    <line x1={-3} y1={0} x2={3} y2={0} stroke={color} strokeWidth={1.4} />
    <line x1={0} y1={-3} x2={0} y2={3} stroke={color} strokeWidth={1.4} />
  </g>
);

const Badge: React.FC<{ x: number; y: number; text: string; fill: string }> = ({ x, y, text, fill }) => {
  const w = Math.max(16, text.length * 6 + 8);
  return (
    <g transform={`translate(${x},${y})`}>
      <rect x={-w / 2} y={-7} width={w} height={14} rx={7} fill={fill} opacity={0.9} />
      <text x={0} y={4} textAnchor="middle" fontSize={9} fontFamily="monospace" fill="#ffffff">{text}</text>
    </g>
  );
};


// ── Component ─────────────────────────────────────────────────────────────────

const ModelCanvas: React.FC<ModelCanvasProps> = ({
  modelJson, layout, onLayoutChange, onSelectNode, selectedNode, height = 620,
}) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef  = useRef<SVGSVGElement>(null);

  const [size, setSize]   = useState({ w: 900, h: height });
  const [frozen, setFrozen] = useState<Record<string, Pos>>(layout?.positions ?? {});
  const [view, setView]     = useState(layout?.view ?? null);
  const [layers, setLayers] = useState<Record<CanvasLayer, boolean>>({ ...DEFAULT_LAYERS, ...(layout?.layers ?? {}) });

  // Live drag/pan state, kept out of React state so a pointermove is one re-render.
  const drag = useRef<{ id: string | null; startX: number; startY: number; t: number; moved: boolean } | null>(null);
  const viewCommit = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { nodes, edges } = useMemo(
    () => (modelJson ? readModel(modelJson) : { nodes: [], edges: [] }),
    [modelJson],
  );

  const auto = useMemo(() => autoLayout(nodes, edges), [nodes, edges]);

  // Auto placement for everything, overridden by whatever the user has frozen or dragged.
  const positions = useMemo(() => {
    const out: Record<string, Pos> = {};
    nodes.forEach(n => { out[n.id] = frozen[n.id] ?? auto[n.id] ?? { x: 0, y: 0 }; });
    return out;
  }, [nodes, auto, frozen]);

  const regions: Record<string, string[]> = modelJson?.connections?.regions ?? {};

  // ── Commit ────────────────────────────────────────────────────────────────

  // Every commit emits the RESOLVED positions, so "freeze" always captures what is on
  // screen rather than the handful of nodes that happen to have been dragged.
  // `view: null` clears a frozen viewport, which is how auto-sort hands the framing back
  // to the fitter; omitting `view` keeps whatever was there.
  const commit = useCallback((patch: {
    positions?: Record<string, Pos>;
    view?:      { x: number; y: number; k: number } | null;
    layers?:    Record<CanvasLayer, boolean>;
  }) => {
    onLayoutChange?.({
      positions: patch.positions ?? positions,
      view:      patch.view === null ? undefined : (patch.view ?? view ?? undefined),
      layers:    patch.layers ?? layers,
    });
  }, [onLayoutChange, positions, view, layers]);

  // ── Viewport ──────────────────────────────────────────────────────────────

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth || 900, h: height }));
    ro.observe(el);
    setSize({ w: el.clientWidth || 900, h: height });
    return () => ro.disconnect();
  }, [height]);

  const fitView = useCallback((): { x: number; y: number; k: number } => {
    const pts = Object.values(positions);
    if (!pts.length) return { x: size.w / 2, y: size.h / 2, k: 1 };
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    const minX = Math.min(...xs) - PAD, maxX = Math.max(...xs) + PAD;
    const minY = Math.min(...ys) - PAD, maxY = Math.max(...ys) + PAD;
    const k = Math.min(1.4, size.w / Math.max(1, maxX - minX), size.h / Math.max(1, maxY - minY));
    return {
      x: size.w / 2 - ((minX + maxX) / 2) * k,
      y: size.h / 2 - ((minY + maxY) / 2) * k,
      k,
    };
  }, [positions, size]);

  const t = view ?? fitView();

  const toModel = useCallback((clientX: number, clientY: number): Pos => {
    const rect = svgRef.current?.getBoundingClientRect();
    const px = clientX - (rect?.left ?? 0), py = clientY - (rect?.top ?? 0);
    return { x: (px - t.x) / t.k, y: (py - t.y) / t.k };
  }, [t]);

  // Wheel must be a native non-passive listener or preventDefault is ignored.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const px = e.clientX - rect.left, py = e.clientY - rect.top;
      // Computed from `t` rather than inside the updater: a state updater must stay pure,
      // and the effect re-attaches on every `t` change so this closure is never stale.
      const k = Math.min(3, Math.max(0.2, t.k * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
      const next = { k, x: px - ((px - t.x) / t.k) * k, y: py - ((py - t.y) / t.k) * k };
      setView(next);
      // A wheel gesture is dozens of events; only the settled view is worth a commit.
      if (viewCommit.current) clearTimeout(viewCommit.current);
      viewCommit.current = setTimeout(() => commit({ view: next }), 250);
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [t, commit]);

  // ── Pointer handling: node drag, background pan, click-vs-drag ─────────────

  const onPointerDown = (e: React.PointerEvent, id: string | null) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { id, startX: e.clientX, startY: e.clientY, t: Date.now(), moved: false };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.startX, dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    d.moved = true;
    if (d.id) {
      const p = toModel(e.clientX, e.clientY);
      setFrozen(prev => ({ ...prev, [d.id as string]: p }));
    } else {
      d.startX = e.clientX; d.startY = e.clientY;
      setView(prev => ({ ...(prev ?? t), x: (prev ?? t).x + dx, y: (prev ?? t).y + dy }));
    }
  };

  // A gesture ends either on pointerup or by leaving the canvas; both must commit, or the
  // node sits at its dragged position on screen while the page still holds the old one.
  const endGesture = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.moved) commit({});   // positions/view already live in state — emit them as-is
    return d;
  };

  const onPointerUp = () => {
    const d = endGesture();
    // A short, still press is a click — keep the original behaviour of opening the node.
    if (d && !d.moved && d.id && Date.now() - d.t < 400) onSelectNode?.(d.id);
  };

  // ── Toolbar actions ───────────────────────────────────────────────────────

  const handleAutoSort = () => {
    setFrozen(auto);
    setView(null);
    commit({ positions: auto, view: null });
  };

  const handleFit = () => {
    const next = fitView();
    setView(next);
    commit({ view: next });
  };

  const toggleLayer = (layer: CanvasLayer) => {
    const next = { ...layers, [layer]: !layers[layer] };
    setLayers(next);
    commit({ layers: next });
  };

  // ── Empty states ──────────────────────────────────────────────────────────

  if (!modelJson) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300, color: 'var(--ion-color-medium)' }}>
        Select a model to visualise
      </div>
    );
  }
  if (nodes.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300, color: 'var(--ion-color-medium)' }}>
        No compartments defined yet
      </div>
    );
  }

  const line = 'var(--ion-color-medium)';

  return (
    <div ref={wrapRef}>
      {/* ═══════════════════════════════════════════════════════════
           Toolbar — layout actions and the layer toggles            */}
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4, padding: '4px 0' }}>
        <IonButton size="small" fill="outline" onClick={handleAutoSort}>Auto-sort</IonButton>
        <IonButton size="small" fill="outline" onClick={handleFit}>Fit</IonButton>
        <div style={{ width: 12 }} />
        {LAYER_ORDER.map(l => (
          <IonChip
            key={l}
            outline={!layers[l]}
            color={layers[l] ? 'primary' : 'medium'}
            onClick={() => toggleLayer(l)}
            style={{ height: 26, fontSize: '0.75rem' }}
          >
            <IonLabel>{LAYER_LABEL[l]}</IonLabel>
          </IonChip>
        ))}
      </div>

      {/* ═══════════════════════════════════════════════════════════
           Canvas                                                    */}
      <svg
        ref={svgRef}
        width="100%"
        height={size.h}
        style={{ display: 'block', touchAction: 'none' }}
        onPointerDown={e => { if (e.target === svgRef.current) onPointerDown(e, null); }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={endGesture}
      >
        <defs>
          <marker id={ARROW_ID} markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L0,6 L8,3 z" fill={line} />
          </marker>
        </defs>

        <g transform={`translate(${t.x},${t.y}) scale(${t.k})`}>

          {/* ── Regions: containment envelopes behind everything ── */}
          {layers.regions && Object.entries(regions).map(([owner, members]) => {
            const pts = [owner, ...(members ?? [])].map(id => positions[id]).filter(Boolean);
            if (pts.length < 2) return null;
            const minX = Math.min(...pts.map(p => p.x)) - NODE_R - 14;
            const maxX = Math.max(...pts.map(p => p.x)) + NODE_R + 14;
            const minY = Math.min(...pts.map(p => p.y)) - NODE_R - 22;
            const maxY = Math.max(...pts.map(p => p.y)) + NODE_R + 14;
            return (
              <g key={`region_${owner}`}>
                <rect
                  x={minX} y={minY} width={maxX - minX} height={maxY - minY} rx={18}
                  fill={ROLE_STYLE.container.fill} fillOpacity={0.07}
                  stroke={ROLE_STYLE.container.fill} strokeOpacity={0.5} strokeDasharray="6,4"
                />
                <text x={minX + 10} y={minY + 14} fontSize={10} fontFamily="monospace" fill={ROLE_STYLE.container.fill}>
                  {owner}
                </text>
              </g>
            );
          })}

          {/* ── Bias: the pressure-reference map ── */}
          {layers.bias && (
            <g opacity={0.35}>
              {nodes.filter(n => n.bias && positions[n.bias]).map(n => (
                <line
                  key={`bias_${n.id}`}
                  x1={positions[n.id].x} y1={positions[n.id].y}
                  x2={positions[n.bias as string].x} y2={positions[n.bias as string].y}
                  stroke={line} strokeWidth={1} strokeDasharray="2,4"
                />
              ))}
              {edges.filter(e => e.bias && positions[e.bias]).map(e => {
                const a = positions[e.from], b = positions[e.to], r = positions[e.bias as string];
                return (
                  <line
                    key={`bias_${e.kind}_${e.id}`}
                    x1={(a.x + b.x) / 2} y1={(a.y + b.y) / 2} x2={r.x} y2={r.y}
                    stroke={line} strokeWidth={0.8} strokeDasharray="2,5"
                  />
                );
              })}
            </g>
          )}

          {/* ── Membranes: dashed, arrowless, labelled with the species count ── */}
          {layers.membranes && edges.filter(e => e.kind === 'membrane').map(edge => {
            const from = positions[edge.from], to = positions[edge.to];
            if (!from || !to) return null;
            const { x1, y1, x2, y2 } = trim(from, to, 0);
            const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
            const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
            const style = MEMBRANE_STYLE[edge.type];
            return (
              <g key={`memb_${edge.id}`}>
                <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#2aa198" strokeWidth={2} strokeDasharray="6,4" />
                {style?.valve && <ValveGlyph x={mx} y={my} angle={angle} color="#2aa198" />}
                {edge.species > 0 && (
                  <text
                    x={mx} y={my - 6} textAnchor="middle" fontSize={9} fontFamily="monospace"
                    fill="#2aa198" transform={`rotate(${Math.abs(angle) > 90 ? angle + 180 : angle},${mx},${my - 6})`}
                  >
                    {edge.species} sp
                  </text>
                )}
              </g>
            );
          })}

          {/* ── Flow: resistors, valves, inertances ── */}
          {layers.flow && edges.filter(e => e.kind === 'flow').map(edge => {
            const from = positions[edge.from], to = positions[edge.to];
            if (!from || !to) return null;
            const { x1, y1, x2, y2 } = trim(from, to, 7);
            const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
            const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
            const style = EDGE_STYLE[edge.type];
            // A type with no entry is still drawn — as a bare line, and the checks panel
            // is what reports it — but it must never silently look like a plain resistor.
            const dash = style ? undefined : '3,3';
            return (
              <g key={`flow_${edge.id}`}>
                <line
                  x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke={line} strokeWidth={1.6} strokeDasharray={dash}
                  markerEnd={`url(#${ARROW_ID})`}
                />
                {style?.valve  && <ValveGlyph  x={mx} y={my} angle={angle} color={line} />}
                {style?.coil   && <CoilGlyph   x={mx - (x2 - x1) * 0.18} y={my - (y2 - y1) * 0.18} angle={angle} color={line} />}
                {style?.source && <SourceGlyph x={x1 + (x2 - x1) * 0.2} y={y1 + (y2 - y1) * 0.2} color={line} />}
              </g>
            );
          })}

          {/* ── Nodes ── */}
          {nodes.map(node => {
            const p = positions[node.id];
            if (!p) return null;
            const style = ROLE_STYLE[node.role];
            const isSelected = selectedNode === node.id;
            return (
              <g
                key={node.id}
                transform={`translate(${p.x},${p.y})`}
                style={{ cursor: 'grab' }}
                onPointerDown={e => { e.stopPropagation(); onPointerDown(e, node.id); }}
              >
                {style.box ? (
                  <rect
                    x={-NODE_R} y={-NODE_R} width={NODE_R * 2} height={NODE_R * 2} rx={6}
                    fill={style.fill}
                    stroke={isSelected ? '#ffffff' : 'var(--ion-background-color)'}
                    strokeWidth={isSelected ? 3 : 2}
                    opacity={isSelected ? 1 : 0.85}
                  />
                ) : (
                  <circle
                    r={NODE_R}
                    fill={style.fill}
                    stroke={isSelected ? '#ffffff' : 'var(--ion-background-color)'}
                    strokeWidth={isSelected ? 3 : node.role === 'pump' ? 3 : 2}
                    opacity={isSelected ? 1 : 0.85}
                  />
                )}
                {/* Nonlinear compliance: an inner ring, because C is state-dependent. */}
                {node.role === 'nonlinear' && (
                  <circle r={NODE_R - 6} fill="none" stroke="#ffffff" strokeWidth={1.2} strokeOpacity={0.8} />
                )}
                {/* Driver: a wave, because the pressure is prescribed, not solved. */}
                {node.role === 'driver' && (
                  <path
                    d={`M${-NODE_R + 7},7 q6,-10 12,0 q6,10 12,0`}
                    fill="none" stroke="#ffffff" strokeWidth={1.4} strokeOpacity={0.85}
                  />
                )}
                <text
                  x={0} y={node.role === 'driver' ? -2 : 5}
                  textAnchor="middle" fontSize={11} fontFamily="monospace" fontWeight="bold" fill="#ffffff"
                >
                  {node.id}
                </text>
                {layers.cycles && node.cycle && (
                  <Badge x={NODE_R + 4} y={-NODE_R + 2} text={node.cycle} fill="#7a5bd9" />
                )}
                {layers.reactions && node.reactions > 0 && (
                  <Badge x={NODE_R + 4} y={NODE_R - 2} text={`⚗${node.reactions}`} fill="#5b9d5b" />
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {/* ═══════════════════════════════════════════════════════════
           Legend — only what is currently drawn                     */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 14, padding: '6px 2px',
        fontSize: '0.7rem', color: 'var(--ion-color-medium)', alignItems: 'center',
      }}>
        {(Object.keys(ROLE_STYLE) as NodeRole[])
          .filter(role => nodes.some(n => n.role === role))
          .map(role => (
            <span key={role} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{
                width: 12, height: 12, background: ROLE_STYLE[role].fill,
                borderRadius: ROLE_STYLE[role].box ? 2 : '50%', display: 'inline-block',
              }} />
              {ROLE_STYLE[role].label}
            </span>
          ))}
        {layers.flow && <span>── resistor · ▶ valve · ∿ inertance · ⊕ driven pressure</span>}
        {layers.membranes && <span style={{ color: '#2aa198' }}>– – membrane (bidirectional)</span>}
        {layers.bias && <span>· · · bias / pressure reference</span>}
        {layers.regions && <span style={{ color: ROLE_STYLE.container.fill }}>▭ region</span>}
      </div>
    </div>
  );
};

export default ModelCanvas;
