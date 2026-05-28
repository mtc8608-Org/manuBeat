import React, { useMemo } from 'react';

interface ModelCanvasProps {
  modelJson:      Record<string, any> | null;
  width?:         number;
  height?:        number;
  onSelectNode?:  (id: string) => void;
  selectedNode?:  string | null;
}

type ElementType = 'capacitor' | 'elastance' | 'constantPressure' | 'unknown';
type EdgeType = 'resistor' | 'diode' | 'unknown';

interface CanvasNode {
  id: string;
  elementType: ElementType;
  x: number;
  y: number;
}

interface CanvasEdge {
  id: string;
  type: EdgeType;
  from: string;
  to: string;
}

const NODE_COLOR: Record<ElementType, string> = {
  capacitor:        '#4a90d9',
  elastance:        '#e05b5b',
  constantPressure: '#888888',
  unknown:          '#aaaaaa',
};

const ARROW_ID = 'cvCanvas-arrow';

function getElementType(comp: any): ElementType {
  const t = comp?.capacitor?.type;
  if (t === 'capacitor') return 'capacitor';
  if (t === 'elastance') return 'elastance';
  if (t === 'constantPressure') return 'constantPressure';
  return 'unknown';
}

function parseModel(
  modelJson: Record<string, any>,
  W: number,
  H: number,
  nodeRadius: number,
): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const rawCompartments: Record<string, any> = modelJson?.compartments ?? {};
  const rawResistive: Record<string, any> = modelJson?.connections?.resistive ?? {};

  const edges: CanvasEdge[] = Object.entries(rawResistive).map(([id, conn]) => ({
    id,
    type: conn.type === 'resistor' ? 'resistor' : conn.type === 'diode' ? 'diode' : 'unknown',
    from: conn.from as string,
    to: conn.to as string,
  }));

  const circuitIds: string[] = [];
  const refIds: string[] = [];

  for (const [id, comp] of Object.entries(rawCompartments)) {
    if (getElementType(comp) === 'constantPressure') refIds.push(id);
    else circuitIds.push(id);
  }

  // Walk the connection graph to produce a circuit-ordered list
  function walkCircuit(ids: string[]): string[] {
    const adj: Record<string, string[]> = {};
    ids.forEach(n => { adj[n] = []; });
    edges.forEach(e => {
      if (adj[e.from] !== undefined && ids.includes(e.to)) adj[e.from].push(e.to);
    });

    const start = ids.find(id => getElementType(rawCompartments[id]) === 'elastance') ?? ids[0];
    if (!start) return ids;

    const visited = new Set<string>();
    const order: string[] = [];
    let cur = start;

    while (order.length < ids.length) {
      if (visited.has(cur)) break;
      visited.add(cur);
      order.push(cur);
      const next = adj[cur]?.find(n => !visited.has(n));
      if (next) { cur = next; continue; }
      const unvisited = ids.find(n => !visited.has(n));
      if (unvisited) cur = unvisited; else break;
    }

    ids.forEach(n => { if (!visited.has(n)) order.push(n); });
    return order;
  }

  const orderedIds = walkCircuit(circuitIds);

  const cx = W / 2;
  const cy = H / 2 - 20;
  const rx = W / 2 - nodeRadius - 40;
  const ry = H / 2 - nodeRadius - 60;

  const nodes: CanvasNode[] = [];

  orderedIds.forEach((id, i) => {
    const angle = (2 * Math.PI * i) / orderedIds.length - Math.PI / 2;
    nodes.push({
      id,
      elementType: getElementType(rawCompartments[id]),
      x: Math.round(cx + rx * Math.cos(angle)),
      y: Math.round(cy + ry * Math.sin(angle)),
    });
  });

  // Reference nodes beneath the main circuit
  refIds.forEach((id, i) => {
    nodes.push({
      id,
      elementType: 'constantPressure',
      x: Math.round(cx + (i - (refIds.length - 1) / 2) * 90),
      y: H - nodeRadius - 8,
    });
  });

  return { nodes, edges };
}

function edgePoints(
  from: CanvasNode,
  to: CanvasNode,
  r: number,
): { x1: number; y1: number; x2: number; y2: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return { x1: from.x, y1: from.y, x2: to.x, y2: to.y };
  const nx = dx / len, ny = dy / len;
  return {
    x1: from.x + nx * r,
    y1: from.y + ny * r,
    x2: to.x - nx * (r + 7),
    y2: to.y - ny * (r + 7),
  };
}

const LEGEND = [
  { type: 'elastance' as ElementType,        label: 'Heart (elastance)' },
  { type: 'capacitor' as ElementType,         label: 'Vessel (capacitor)' },
  { type: 'constantPressure' as ElementType,  label: 'Reference' },
];

const ModelCanvas: React.FC<ModelCanvasProps> = ({ modelJson, width = 900, height = 580, onSelectNode, selectedNode }) => {
  const nodeRadius = 26;

  const { nodes, edges } = useMemo(() => {
    if (!modelJson) return { nodes: [], edges: [] };
    return parseModel(modelJson, width, height, nodeRadius);
  }, [modelJson, width, height]);

  const nodeMap = useMemo(() => {
    const m: Record<string, CanvasNode> = {};
    nodes.forEach(n => { m[n.id] = n; });
    return m;
  }, [nodes]);

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

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      style={{ width: '100%', display: 'block' }}
    >
      <defs>
        <marker id={ARROW_ID} markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L0,6 L8,3 z" fill="var(--ion-color-medium)" />
        </marker>
      </defs>

      {/* Edges */}
      {edges.map(edge => {
        const from = nodeMap[edge.from];
        const to   = nodeMap[edge.to];
        if (!from || !to) return null;
        const { x1, y1, x2, y2 } = edgePoints(from, to, nodeRadius);
        return (
          <line
            key={edge.id}
            x1={x1} y1={y1} x2={x2} y2={y2}
            stroke="var(--ion-color-medium)"
            strokeWidth={1.5}
            strokeDasharray={edge.type === 'diode' ? '5,4' : undefined}
            markerEnd={`url(#${ARROW_ID})`}
          />
        );
      })}

      {/* Nodes */}
      {nodes.map(node => {
        const isSelected = selectedNode === node.id;
        return (
          <g
            key={node.id}
            onClick={() => onSelectNode?.(node.id)}
            style={{ cursor: onSelectNode ? 'pointer' : undefined }}
          >
            <circle
              cx={node.x} cy={node.y} r={nodeRadius}
              fill={NODE_COLOR[node.elementType]}
              stroke={isSelected ? '#ffffff' : 'var(--ion-background-color)'}
              strokeWidth={isSelected ? 3 : 2}
              opacity={isSelected ? 1 : 0.85}
            />
            <text
              x={node.x} y={node.y + 5}
              textAnchor="middle"
              fontSize={11}
              fontFamily="monospace"
              fontWeight="bold"
              fill="#ffffff"
            >
              {node.id}
            </text>
          </g>
        );
      })}

      {/* Legend */}
      {LEGEND.map(({ type, label }, i) => (
        <g key={type} transform={`translate(${16 + i * 150}, ${height - 22})`}>
          <circle r={7} cx={8} cy={0} fill={NODE_COLOR[type]} />
          <text x={20} y={5} fontSize={10} fill="var(--ion-color-medium)">{label}</text>
        </g>
      ))}
      <g transform={`translate(${16 + 3 * 150}, ${height - 22})`}>
        <line x1={0} y1={0} x2={18} y2={0} stroke="var(--ion-color-medium)" strokeWidth={1.5} />
        <text x={22} y={5} fontSize={10} fill="var(--ion-color-medium)">Resistor</text>
      </g>
      <g transform={`translate(${16 + 3 * 150 + 100}, ${height - 22})`}>
        <line x1={0} y1={0} x2={18} y2={0} stroke="var(--ion-color-medium)" strokeWidth={1.5} strokeDasharray="5,3" />
        <text x={22} y={5} fontSize={10} fill="var(--ion-color-medium)">Diode (valve)</text>
      </g>
    </svg>
  );
};

export default ModelCanvas;
