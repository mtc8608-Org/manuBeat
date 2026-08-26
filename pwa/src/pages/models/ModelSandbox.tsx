// Page: ModelSandbox — visual builder for cardio-pulmonary model configs.
// Reads/writes: model_configs table (GraphQL). Canvas reads workingModel (local edit buffer).
// Authenticated (private route).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  IonButton,
  IonCol,
  IonGrid,
  IonInput,
  IonItem,
  IonLabel,
  IonNote,
  IonRow,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonText,
} from '@ionic/react';
import ApiService from '../../services/Api';
import SplitPageLayout from '../../components/shell/SplitPageLayout';
import TabPanel from '../../components/shell/TabPanel';
import ResourcePanel from '../../components/shell/ResourcePanel';
import ModalShell from '../../components/shell/ModalShell';
import JsonViewer from '../../components/shell/JsonViewer';
import FormRenderer from '../../components/forms/FormRenderer';
import ModelCanvas from '../../components/charts/ModelCanvas';
import { ModelConfig, ComponentResults } from '../../interfaces/types';
import { AREA_NAV, PANEL_CONFIG, FORM_ID } from '../../constants';

// ── Types ─────────────────────────────────────────────────────────────────────

type CapacitorType =
  | 'capacitor'
  | 'elastance'
  | 'constantPressure'
  | 'thorax'
  | 'elastanceInput'
  | 'ventilator'
  | 'ventilatorFile';

type GasRegion = 'bloodPlr' | 'Atmosphere';

// ── Constants ─────────────────────────────────────────────────────────────────

const BLANK_MODEL: Record<string, any> = {
  configurations: { simulationParameters: { dt: 0.001, calibration: false } },
  compartments: {
    Atm: { 
      gasRegion: 'Atmosphere', 
      type: 'component', 
      capacitor: { 
        type: 'constantPressure', 
        params: { p0: 760.0, y0: 0.0 } 
      } 
    },
  },
  connections: {
    resistive: {},
    bias:      { Atm: 'Atm' },
    regions:   { Atm: [] },
    cycles:    { Atm: '' },
  },
  cycles:      {},
  other:       {},
  reactions:   {},
  calibration: {},
  control:     {},
  states:      { V_Atm: 0.0, P_Atm: 0.0 },
  modelParams: { 
    volumeDistribution: {}, 
    flowDistribution: {} 
  },
};

const COMPARTMENT_PARAMS: Record<CapacitorType, Record<string, number>> = {
  capacitor:        { C: 0.0, V0: 0.0, y0: 0.0, p0: 0.0 },
  elastance:        { Emax: 0.0, Emin: 0.0, V0: 0.0, y0: 0.0, systolicTime: 0.0, transitionTime: 0.0, p0: 0.0 },
  constantPressure: { p0: 0.0, y0: 0.0 },
  thorax:           { C: 0.0, V0: 0.0, uVol: 0.0 },
  elastanceInput:   { E: 0.0, V0: 0.0 },
  ventilator:       { amplitude: 0.0, PEEP: 0.0, I: 0.0, E: 0.0, slopeFraction: 0.0 },
  ventilatorFile:   { y0: 0.0, p0: 0.0, start: 0.0, end: 0.0, interpolationThreshold: 0.0 },
};

function statesForCompartment(name: string, type: CapacitorType): Record<string, number> {
  const base: Record<string, number> = { [`V_${name}`]: 0.0, [`P_${name}`]: 0.0 };
  switch (type) {
    case 'capacitor':        return { ...base, [`C_${name}`]: 0.0, [`V0_${name}`]: 0.0 };
    case 'elastance':        return { ...base, [`E_${name}`]: 0.0, [`e_${name}`]: 0.0, [`V0_${name}`]: 0.0 };
    case 'thorax':           return { ...base, [`C_${name}`]: 0.0, [`V0_${name}`]: 0.0 };
    case 'elastanceInput':   return { ...base, [`V0_${name}`]: 0.0 };
    case 'ventilator':       return { ...base, [`Amp_${name}`]: 0.0, [`PEEP_${name}`]: 0.0, [`Iven_${name}`]: 0.0, [`Even_${name}`]: 0.0, [`Slope_${name}`]: 0.0 };
    case 'constantPressure':
    case 'ventilatorFile':
    default:                 return base;
  }
}

const CONNECTION_PARAMS: Record<string, Record<string, number>> = {
  resistor:       { R: 0.0 },
  diode:          { R: 0.0, L: 0.0, threshold: 0.0, y0: 0.0 },
  inertial:       { R: 0.0, L: 0.0, y0: 0.0 },
  diode_inertial: { R: 0.0, L: 0.0, threshold: 0.0, y0: 0.0 },
};

function statesForConnection(id: string, type: string, params: Record<string, number>): Record<string, number> {
  const s: Record<string, number> = {
    [`Q_${id}`]: params.y0 ?? 0.0,
    [`R_${id}`]: params.R  ?? 0.0,
  };
  if (type === 'diode' || type === 'diode_inertial') {
    s[`Th_${id}`] = params.threshold ?? 0.0;
  }
  return s;
}

function removeConnectionStates(states: Record<string, number>, id: string): Record<string, number> {
  return Object.fromEntries(
    Object.entries(states).filter(([k]) => k !== `Q_${id}` && k !== `R_${id}` && k !== `Th_${id}`)
  );
}

function statesForCycle(name: string, duration: number, triggerOffset: number, timerOffset: number): Record<string, number> {
  return {
    [`Cyc_${name}`]:  duration,
    [`Tim_${name}`]:  timerOffset,
    [`Trig_${name}`]: triggerOffset,
  };
}

function removeCycleStates(states: Record<string, number>, name: string): Record<string, number> {
  return Object.fromEntries(
    Object.entries(states).filter(([k]) =>
      k !== `Cyc_${name}` && k !== `Tim_${name}` && k !== `Trig_${name}` &&
      k !== `t_Sys_${name}` && k !== `t_transition_${name}`
    )
  );
}

// ── Local types ────────────────────────────────────────────────────────────────

interface CompartmentItem {
  id:      string; // compartment name — used as ResourcePanel's required id key
  capType: string;
}

interface ConnectionItem {
  id:       string; // connection name — used as ResourcePanel's required id key
  from:     string;
  to:       string;
  connType: string;
}

interface CycleItem {
  id:       string; // cycle name
  duration: number;
}

interface OtherItem {
  id:        string; // key in the other dict (= state name or avg_*)
  otherType: string;
}

// ── Field definitions ──────────────────────────────────────────────────────────

interface FieldDef {
  name:      string;
  label:     string;
  kind:      'text' | 'number' | 'select';
  required?: boolean;
  options?:  { value: string; label: string }[];
  dynamic?:  'cycles' | 'compartments';
}

// ── Compartment form ───────────────────────────────────────────────────────────

const CAPACITOR_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'capacitor',        label: 'Capacitor' },
  { value: 'elastance',        label: 'Elastance' },
  { value: 'constantPressure', label: 'Constant Pressure' },
  { value: 'thorax',           label: 'Thorax' },
  { value: 'elastanceInput',   label: 'Elastance Input' },
  { value: 'ventilator',       label: 'Ventilator' },
  { value: 'ventilatorFile',   label: 'Ventilator File' },
];

const GAS_REGION_OPTIONS: { value: string; label: string }[] = [
  { value: 'bloodPlr',   label: 'Blood PLR' },
  { value: 'Atmosphere', label: 'Atmosphere' },
];

const COMPARTMENT_META_FIELDS: FieldDef[] = [
  { name: 'name',               label: 'Name',                kind: 'text',   required: true },
  { name: 'capacitorType',      label: 'Capacitor Type',      kind: 'select', options: CAPACITOR_TYPE_OPTIONS },
  { name: 'gasRegion',          label: 'Gas Region',          kind: 'select', options: GAS_REGION_OPTIONS },
  { name: 'cycle',              label: 'Cycle',               kind: 'select', dynamic: 'cycles' },
  { name: 'bias',               label: 'Bias Compartment',    kind: 'select', dynamic: 'compartments' },
  { name: 'volumeDistribution', label: 'Volume Distribution', kind: 'number' },
];

// ── Connection form ────────────────────────────────────────────────────────────

const CONNECTION_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'resistor',       label: 'Resistor' },
  { value: 'diode',          label: 'Diode' },
  { value: 'inertial',       label: 'Inertial' },
  { value: 'diode_inertial', label: 'Diode Inertial' },
];

const CONNECTION_META_FIELDS: FieldDef[] = [
  { name: 'from',           label: 'From',            kind: 'select', dynamic: 'compartments' },
  { name: 'to',             label: 'To',              kind: 'select', dynamic: 'compartments' },
  { name: 'connectionType', label: 'Connection Type', kind: 'select', options: CONNECTION_TYPE_OPTIONS },
];

// ── Cycle form ─────────────────────────────────────────────────────────────────

const CYCLE_FIELDS: FieldDef[] = [
  { name: 'name',          label: 'Name',          kind: 'text',   required: true },
  { name: 'duration',      label: 'Duration (s)',   kind: 'number' },
  { name: 'triggerOffset', label: 'Trigger Offset', kind: 'number' },
  { name: 'timerOffset',   label: 'Timer Offset',   kind: 'number' },
];

// ── Other section ─────────────────────────────────────────────────────────────

const OTHER_FIELDS: Record<string, FieldDef[]> = {
  movingAverage: [
    { name: 'varIn',  label: 'Variable In',        kind: 'text'   },
    { name: 'period', label: 'Period (s)',           kind: 'number' },
    { name: 'y0',     label: 'Initial Value (y0)',  kind: 'number' },
  ],
  movingAverageCycle: [
    { name: 'varIn',  label: 'Variable In',        kind: 'text'   },
    { name: 'period', label: 'Period (s)',           kind: 'number' },
    { name: 'y0',     label: 'Initial Value (y0)',  kind: 'number' },
  ],
  cycleIntegral: [
    { name: 'newVarName',            label: 'State Name',           kind: 'text'   },
    { name: 'varIn',                 label: 'Variable In',          kind: 'text'   },
    { name: 't0',                    label: 'Initial Time State',   kind: 'text'   },
    { name: 'trigger',               label: 'Trigger State',        kind: 'text'   },
    { name: 'triggerConditionValue', label: 'Trigger Value',        kind: 'number' },
    { name: 'y0',                    label: 'Initial Value (y0)',   kind: 'number' },
  ],
  cycleKeeper: [
    { name: 'newVarName', label: 'State Name',          kind: 'text'   },
    { name: 'varIn',      label: 'Variable In',         kind: 'text'   },
    { name: 't0',         label: 'Initial Time State',  kind: 'text'   },
    { name: 'trigger',    label: 'Trigger State',       kind: 'text'   },
    { name: 'y0',         label: 'Initial Value (y0)',  kind: 'number' },
  ],
  cycleMax: [
    { name: 'newVarName', label: 'State Name',          kind: 'text'   },
    { name: 'varIn',      label: 'Variable In',         kind: 'text'   },
    { name: 't0',         label: 'Initial Time State',  kind: 'text'   },
    { name: 'trigger',    label: 'Trigger State',       kind: 'text'   },
    { name: 'y0',         label: 'Initial Value (y0)',  kind: 'number' },
  ],
  cycleMin: [
    { name: 'newVarName', label: 'State Name',          kind: 'text'   },
    { name: 'varIn',      label: 'Variable In',         kind: 'text'   },
    { name: 't0',         label: 'Initial Time State',  kind: 'text'   },
    { name: 'trigger',    label: 'Trigger State',       kind: 'text'   },
    { name: 'y0',         label: 'Initial Value (y0)',  kind: 'number' },
  ],
  pressureToConcentration: [
    { name: 'newVarName',    label: 'State Name',         kind: 'text'   },
    { name: 'pressureIn',    label: 'Pressure In State',  kind: 'text'   },
    { name: 'volumeIn',      label: 'Volume In State',    kind: 'text'   },
    { name: 'temperatureIn', label: 'Temperature (K)',    kind: 'number' },
    { name: 'R',             label: 'Gas Constant R',     kind: 'number' },
    { name: 'y0',            label: 'Initial Value (y0)', kind: 'number' },
  ],
  mmolpH: [
    { name: 'newVarName',      label: 'State Name',          kind: 'text'   },
    { name: 'concentrationIn', label: 'Concentration State', kind: 'text'   },
    { name: 'y0',              label: 'Initial Value (y0)',  kind: 'number' },
  ],
  constant: [
    { name: 'newVarName', label: 'Parameter Name',       kind: 'text'   },
    { name: 'y0',         label: 'Value',                kind: 'number' },
  ],
  stateSummation: [
    { name: 'newVarName', label: 'State Name',             kind: 'text'   },
    { name: 'states',     label: 'States (comma-sep)',     kind: 'text'   },
    { name: 'y0',         label: 'Initial Value (y0)',     kind: 'number' },
  ],
  stateSubstraction: [
    { name: 'newVarName', label: 'State Name',           kind: 'text'   },
    { name: 'state1',     label: 'State 1',              kind: 'text'   },
    { name: 'state2',     label: 'State 2',              kind: 'text'   },
    { name: 'y0',         label: 'Initial Value (y0)',   kind: 'number' },
  ],
  ramp: [
    { name: 'newVarName',       label: 'State Name',              kind: 'text'   },
    { name: 'rate',             label: 'Rate',                    kind: 'number' },
    { name: 'y0',               label: 'Initial Value (y0)',      kind: 'number' },
    { name: 'chemoSensitivity', label: 'Chemo Sensitivity',       kind: 'number' },
    { name: 'baroSensitivity',  label: 'Baro Sensitivity',        kind: 'number' },
    { name: 'chemoRegulator',   label: 'Chemo Regulator State',   kind: 'text'   },
    { name: 'baroRegulator',    label: 'Baro Regulator State',    kind: 'text'   },
  ],
  atp_Prod: [
    { name: 'newVarName', label: 'State Name',           kind: 'text'   },
    { name: 'rateLact',   label: 'Rate Lact',            kind: 'number' },
    { name: 'ratioLact',  label: 'Ratio Lact',           kind: 'number' },
    { name: 'rateOxid',   label: 'Rate Oxid',            kind: 'number' },
    { name: 'ratioOxid',  label: 'Ratio Oxid',           kind: 'number' },
    { name: 'ratioFat',   label: 'Ratio Fat',            kind: 'number' },
    { name: 'rateFat',    label: 'Rate Fat',             kind: 'number' },
    { name: 'y0',         label: 'Initial Value (y0)',   kind: 'number' },
  ],
  constant_Multiplication: [
    { name: 'newVarName', label: 'State Name',           kind: 'text'   },
    { name: 'value',      label: 'Variable State',       kind: 'text'   },
    { name: 'constant',   label: 'Constant',             kind: 'number' },
    { name: 'y0',         label: 'Initial Value (y0)',   kind: 'number' },
  ],
  sigmoid: [
    { name: 'newVarName',      label: 'State Name',           kind: 'text'   },
    { name: 'baseVar',         label: 'Base Variable State',  kind: 'text'   },
    { name: 'maxValue',        label: 'Max Value',            kind: 'number' },
    { name: 'minValue',        label: 'Min Value',            kind: 'number' },
    { name: 'slope',           label: 'Slope',                kind: 'number' },
    { name: 'inflectionPoint', label: 'Inflection Point',     kind: 'number' },
    { name: 'y0',              label: 'Initial Value (y0)',   kind: 'number' },
    { name: 'inhibitor',       label: 'Inhibitor State',      kind: 'text'   },
    { name: 'I0',              label: 'Inhibitor I0',         kind: 'number' },
  ],
  heldtParamVariation: [
    { name: 'newVarName', label: 'State Name',                kind: 'text'   },
    { name: 'cycle',      label: 'Cycle Name',                kind: 'text'   },
    { name: 'maxValue',   label: 'Max Value',                 kind: 'number' },
    { name: 'minValue',   label: 'Min Value',                 kind: 'number' },
    { name: 'y0',         label: 'Initial Value (y0)',        kind: 'number' },
    { name: 't_up',       label: 'Systolic Time (t_up)',      kind: 'number' },
    { name: 't_down',     label: 'Transition Time (t_down)',  kind: 'number' },
  ],
  stiffness: [
    { name: 'newVarName', label: 'State Name',         kind: 'text'   },
    { name: 'volume',     label: 'Volume State',       kind: 'text'   },
    { name: 'compliance', label: 'Compliance State',   kind: 'text'   },
    { name: 'V0',         label: 'V0 State',           kind: 'text'   },
    { name: 'y0',         label: 'Initial Value (y0)', kind: 'number' },
  ],
  elastanceCalc: [
    { name: 'newVarName', label: 'State Name',         kind: 'text'   },
    { name: 'volume',     label: 'Volume State',       kind: 'text'   },
    { name: 'stiffness',  label: 'Stiffness State',    kind: 'text'   },
    { name: 'V0',         label: 'V0 State',           kind: 'text'   },
    { name: 'y0',         label: 'Initial Value (y0)', kind: 'number' },
  ],
};

const OTHER_TYPES = Object.keys(OTHER_FIELDS) as string[];

function buildLocalForm(key: string, fields: FieldDef[]): ComponentResults {
  return {
    name: `local_${key}`,
    type: 'form',
    data: { text: '' },
    options: {},
    children: fields.map(f => ({
      name:     `f_${f.name}`,
      type:     f.kind === 'number' ? 'number' : f.kind === 'select' ? 'select' : 'input',
      data:     { text: f.label },
      options:  { label: f.name, placeholder: f.kind === 'number' ? '0' : '' },
      children: [],
    })),
  };
}

function resolveInjectedOptions(
  fields: FieldDef[],
  cycleOpts: { value: string; label: string }[],
  compartmentOpts: { value: string; label: string }[],
): Record<string, { value: string; label: string }[]> {
  const out: Record<string, { value: string; label: string }[]> = {};
  for (const f of fields) {
    if (f.kind !== 'select') continue;
    if      (f.dynamic === 'cycles')       out[f.name] = cycleOpts;
    else if (f.dynamic === 'compartments') out[f.name] = compartmentOpts;
    else if (f.options)                    out[f.name] = f.options;
  }
  return out;
}

const COMPARTMENT_FORM = buildLocalForm('compartment', COMPARTMENT_META_FIELDS);
const CONNECTION_FORM  = buildLocalForm('connection',  CONNECTION_META_FIELDS);
const CYCLE_FORM       = buildLocalForm('cycle',       CYCLE_FIELDS);

function otherKey(type: string, params: Record<string, any>): string {
  if (type === 'movingAverage' || type === 'movingAverageCycle') {
    return `avg_${params.varIn ?? ''}`;
  }
  return String(params.newVarName ?? '');
}

function buildOtherParams(type: string, values: Record<string, any>): Record<string, any> {
  const numericFields = new Set(
    (OTHER_FIELDS[type] ?? []).filter(f => f.kind === 'number').map(f => f.name)
  );
  const params: Record<string, any> = {};
  for (const [k, v] of Object.entries(values)) {
    if (numericFields.has(k)) {
      params[k] = parseFloat(v as string) || 0;
    } else if (k === 'states' && type === 'stateSummation') {
      params[k] = (v as string).split(',').map((s: string) => s.trim()).filter(Boolean);
    } else {
      params[k] = v ?? '';
    }
  }
  return params;
}

function statesForOther(type: string, key: string, params: Record<string, any>): Record<string, number> {
  if (type === 'constant') return {};
  return { [key]: parseFloat(params.y0 ?? 0) || 0 };
}

function removeOtherFromStates(states: Record<string, number>, key: string): Record<string, number> {
  const { [key]: _removed, ...rest } = states;
  return rest;
}

// ── State prefix order ─────────────────────────────────────────────────────────

const STATE_PREFIX_ORDER = ['V_', 'P_', 'C_', 'E_', 'e_', 'V0_', 'Amp_', 'PEEP_', 'Iven_', 'Even_', 'Slope_', 'Q_', 'R_', 'Th_', 'Cyc_', 'Tim_', 'Trig_', 't_', 'avg_'];

function sortedStateEntries(states: Record<string, number>): [string, number][] {
  return Object.entries(states).sort(([a], [b]) => {
    const ai = STATE_PREFIX_ORDER.findIndex(p => a.startsWith(p));
    const bi = STATE_PREFIX_ORDER.findIndex(p => b.startsWith(p));
    if (ai !== bi) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    return a.localeCompare(b);
  });
}

const MODEL_KEY_ORDER       = ['configurations', 'modelParams', 'states', 'connections', 'cycles', 'compartments', 'other', 'reactions', 'calibration', 'control'];
const CONNECTION_KEY_ORDER  = ['resistive', 'bias', 'regions', 'cycles'];

function reorder<T extends Record<string, any>>(obj: T, priority: string[]): T {
  const result: Record<string, any> = {};
  for (const k of priority)           if (k in obj) result[k] = obj[k];
  for (const k of Object.keys(obj))   if (!(k in result)) result[k] = obj[k];
  return result as T;
}

function canonicalModelJson(model: Record<string, any>): Record<string, any> {
  const ordered = reorder(model, MODEL_KEY_ORDER);
  if (ordered.connections) ordered.connections = reorder(ordered.connections, CONNECTION_KEY_ORDER);
  return ordered;
}



const ModelSandbox: React.FC = () => {


/*
   ██████  ██████████    ████    ██████████  ████████
 ██            ██      ██    ██      ██      ██
   ████        ██      ████████      ██      ██████
       ██      ██      ██    ██      ██      ██
 ██████        ██      ██    ██      ██      ████████
                                                       */


  // Model list
  const [version, setVersion]               = useState(0);
  const [selectedConfig, setSelectedConfig] = useState<ModelConfig | null>(null);

  // Working model — local edit buffer loaded from selectedConfig.config
  const [workingModel, setWorkingModel]     = useState<Record<string, any> | null>(null);

  // New model modal
  const [newModalOpen, setNewModalOpen] = useState(false);
  const [newForm, setNewForm]           = useState<ComponentResults | null>(null);
  const [newError, setNewError]         = useState<string | null>(null);

  // Import JSON
  const importInputRef                  = useRef<HTMLInputElement>(null);
  const [importError, setImportError]   = useState<string | null>(null);

  // Selected compartment — drives canvas highlight
  const [selectedCompartment, setSelectedCompartment] = useState<string | null>(null);

  // Add/edit compartment modal — same form, different submit handler
  const [compModalOpen, setCompModalOpen]         = useState(false);
  const [compModalMode, setCompModalMode]         = useState<'add' | 'edit'>('add');
  const [compDefaultValues, setCompDefaultValues] = useState<Record<string, any>>({});
  const [compError, setCompError]                 = useState<string | null>(null);

  // Save state
  const [saving, setSaving]     = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Add/edit connection modal
  const [connModalOpen, setConnModalOpen]         = useState(false);
  const [connModalMode, setConnModalMode]         = useState<'add' | 'edit'>('add');
  const [connDefaultValues, setConnDefaultValues] = useState<Record<string, any>>({});
  const [connError, setConnError]                 = useState<string | null>(null);
  const [selectedConnection, setSelectedConnection] = useState<string | null>(null);

  // Add/edit cycle modal
  const [cycleModalOpen, setCycleModalOpen]         = useState(false);
  const [cycleModalMode, setCycleModalMode]         = useState<'add' | 'edit'>('add');
  const [cycleDefaultValues, setCycleDefaultValues] = useState<Record<string, any>>({});
  const [cycleError, setCycleError]                 = useState<string | null>(null);
  const [selectedCycle, setSelectedCycle]           = useState<string | null>(null);

  // Add/edit other modal
  const [otherModalOpen, setOtherModalOpen]         = useState(false);
  const [otherModalMode, setOtherModalMode]         = useState<'add' | 'edit'>('add');
  const [otherType, setOtherType]                   = useState('movingAverage');
  const [otherDefaultValues, setOtherDefaultValues] = useState<Record<string, any>>({});
  const [otherError, setOtherError]                 = useState<string | null>(null);
  const [selectedOther, setSelectedOther]           = useState<string | null>(null);


/*
 ██          ████      ████    ██████
 ██        ██    ██  ██    ██  ██    ██
 ██        ██    ██  ████████  ██    ██
 ██        ██    ██  ██    ██  ██    ██
 ████████    ████    ██    ██  ██████
                                         */


  const fetchConfigs = useCallback(() => ApiService.getModelConfigs(), []);

  // Autosave — skip the save triggered by loading a freshly-selected config
  const skipNextSaveRef = useRef(false);
  const saveTimeoutRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setWorkingModel(selectedConfig ? JSON.parse(JSON.stringify(selectedConfig.config)) : null);
    setSelectedCompartment(null);
    skipNextSaveRef.current = true;
  }, [selectedConfig?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    ApiService.getComponentByName(FORM_ID.ADD_MODEL_CONFIG).then(f => setNewForm(f ?? null));
  }, []);

  // Autosave workingModel to the backend on every edit (debounced)
  useEffect(() => {
    if (skipNextSaveRef.current) { skipNextSaveRef.current = false; return; }
    if (!selectedConfig || !workingModel) return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      setSaving(true); setSaveError(null);
      ApiService.updateModelConfig(selectedConfig.id, { config: workingModel })
        .then(updated => setSelectedConfig(updated))
        .catch((err: any) => setSaveError(err.message ?? 'Save failed'))
        .finally(() => setSaving(false));
    }, 500);
    return () => { if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current); };
  }, [workingModel]); // eslint-disable-line react-hooks/exhaustive-deps


/*
 ██    ██    ████    ██      ██  ██████    ██        ████████  ██████      ██████
 ██    ██  ██    ██  ████    ██  ██    ██  ██        ██        ██    ██  ██
 ████████  ████████  ██  ██  ██  ██    ██  ██        ██████    ██████      ████
 ██    ██  ██    ██  ██    ████  ██    ██  ██        ██        ██    ██        ██
 ██    ██  ██    ██  ██      ██  ██████    ████████  ████████  ██    ██  ██████
                                                                                   */


  // ── New model ──────────────────────────────────────────────────────────────

  const openNewModal = () => {
    setNewError(null);
    setNewModalOpen(true);
  };

  const handleCreate = async (values: Record<string, any>) => {
    const name = (values.name ?? '').trim();
    const desc = (values.description ?? '').trim();
    if (!name) { setNewError('Name is required'); return; }
    setNewError(null);
    try {
      const created = await ApiService.createModelConfig(name, desc, BLANK_MODEL);
      setSelectedConfig(created);
      setVersion(v => v + 1);
      setNewModalOpen(false);
    } catch (err: any) {
      setNewError(err.message ?? 'Failed to create');
    }
  };

  const handleDelete = async (cfg: ModelConfig) => {
    await ApiService.deleteModelConfig(cfg.id);
    if (selectedConfig?.id === cfg.id) setSelectedConfig(null);
    setVersion(v => v + 1);
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setImportError(null);
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const name = file.name.replace(/\.json$/i, '');
      const created = await ApiService.createModelConfig(name, '', json);
      setSelectedConfig(created);
      setVersion(v => v + 1);
    } catch (e) {
      setImportError((e as Error).message);
    }
  };

  // ── Add compartment ────────────────────────────────────────────────────────

  const openAddModal = () => {
    setCompModalMode('add');
    setCompDefaultValues({});
    setCompError(null);
    setCompModalOpen(true);
  };

  const handleAddCompartment = (values: Record<string, any>) => {
    const name      = (values.name ?? '').trim();
    const capType   = (values.capacitorType ?? 'capacitor') as CapacitorType;
    const gasRegion = (values.gasRegion ?? 'bloodPlr') as GasRegion;
    const cycle     = (values.cycle ?? '').trim();
    const bias      = (values.bias ?? 'Atm').trim() || 'Atm';
    const volDist   = parseFloat(values.volumeDistribution ?? '0') || 0;

    if (!name) { setCompError('Name is required'); return; }
    if (workingModel?.compartments?.[name]) { setCompError('A compartment with this name already exists'); return; }

    setWorkingModel(prev => {
      if (!prev) return prev;
      let extraStates: Record<string, number> = {};
      if (cycle && capType === 'elastance') {
        const compParams = COMPARTMENT_PARAMS.elastance;
        if (!(`t_Sys_${cycle}` in (prev.states ?? {})))        extraStates[`t_Sys_${cycle}`]        = compParams.systolicTime;
        if (!(`t_transition_${cycle}` in (prev.states ?? {}))) extraStates[`t_transition_${cycle}`] = compParams.transitionTime;
      }
      return {
        ...prev,
        compartments: {
          ...prev.compartments,
          [name]: { gasRegion, type: 'component', capacitor: { type: capType, params: { ...COMPARTMENT_PARAMS[capType] } } },
        },
        connections: {
          ...prev.connections,
          bias:    { ...prev.connections?.bias,    [name]: bias },
          regions: { ...prev.connections?.regions, [name]: []  },
          cycles:  { ...prev.connections?.cycles,  [name]: cycle },
        },
        modelParams: {
          ...prev.modelParams,
          volumeDistribution: { ...prev.modelParams?.volumeDistribution, [name]: volDist },
        },
        states: { ...prev.states, ...statesForCompartment(name, capType), ...extraStates },
      };
    });

    setCompModalOpen(false);
  };

  // ── Edit compartment ───────────────────────────────────────────────────────

  const openEditModal = (name: string) => {
    if (!workingModel) return;
    const comp = workingModel.compartments?.[name];
    setSelectedCompartment(name);
    setCompModalMode('edit');
    setCompDefaultValues({
      name,
      capacitorType:      comp?.capacitor?.type ?? 'capacitor',
      gasRegion:          comp?.gasRegion ?? 'bloodPlr',
      cycle:              workingModel.connections?.cycles?.[name] ?? '',
      bias:               workingModel.connections?.bias?.[name] ?? 'Atm',
      volumeDistribution: String(workingModel.modelParams?.volumeDistribution?.[name] ?? 0),
    });
    setCompError(null);
    setCompModalOpen(true);
  };

  const handleEditCompartment = (values: Record<string, any>) => {
    if (!selectedCompartment || !workingModel) return;
    const oldName   = selectedCompartment;
    const newName   = (values.name ?? '').trim();
    const capType   = (values.capacitorType ?? 'capacitor') as CapacitorType;
    const gasRegion = (values.gasRegion ?? 'bloodPlr') as GasRegion;
    const newCycle  = (values.cycle ?? '').trim();
    const newBias   = (values.bias ?? 'Atm').trim() || 'Atm';
    const volDist   = parseFloat(values.volumeDistribution ?? '0') || 0;
    if (!newName) return;

    const nameChanged  = newName !== oldName;
    const typeChanged  = capType !== workingModel.compartments?.[oldName]?.capacitor?.type;
    const oldCycle     = workingModel.connections?.cycles?.[oldName] ?? '';
    const cycleChanged = newCycle !== oldCycle;
    const params = typeChanged
      ? { ...COMPARTMENT_PARAMS[capType] }
      : { ...workingModel.compartments?.[oldName]?.capacitor?.params };

    setWorkingModel(prev => {
      if (!prev) return prev;
      const existing     = prev.compartments?.[oldName];
      const compartments = { ...prev.compartments };
      delete compartments[oldName];
      compartments[newName] = {
        ...existing,
        gasRegion,
        capacitor: { ...existing?.capacitor, type: capType, params },
      };

      const bias    = { ...prev.connections?.bias };
      const regions = { ...prev.connections?.regions };
      const cycles  = { ...prev.connections?.cycles };
      if (nameChanged) {
        regions[newName] = regions[oldName]; delete regions[oldName];
        delete bias[oldName];
        delete cycles[oldName];
      }
      bias[newName]   = newBias;
      cycles[newName] = newCycle;

      const volDists = { ...prev.modelParams?.volumeDistribution };
      if (nameChanged) delete volDists[oldName];
      volDists[newName] = volDist;

      let states = { ...prev.states };
      if (nameChanged || typeChanged) {
        states = Object.fromEntries(
          Object.entries(states).filter(([k]) => !k.endsWith(`_${oldName}`))
        );
        Object.assign(states, statesForCompartment(newName, capType));
      }

      // Remove t_Sys/t_transition for old cycle if no other elastance uses it
      if (oldCycle && (cycleChanged || typeChanged)) {
        const otherElastancesOnOldCycle = Object.entries(compartments).some(
          ([n, c]) => n !== newName && cycles[n] === oldCycle && (c as any)?.capacitor?.type === 'elastance'
        );
        if (!otherElastancesOnOldCycle) {
          delete states[`t_Sys_${oldCycle}`];
          delete states[`t_transition_${oldCycle}`];
        }
      }
      // Add t_Sys/t_transition for new cycle if elastance and not already present
      if (newCycle && capType === 'elastance') {
        if (!(`t_Sys_${newCycle}` in states))        states[`t_Sys_${newCycle}`]        = params.systolicTime  ?? 0.0;
        if (!(`t_transition_${newCycle}` in states)) states[`t_transition_${newCycle}`] = params.transitionTime ?? 0.0;
      }

      return {
        ...prev,
        compartments,
        connections: { ...prev.connections, bias, regions, cycles },
        modelParams: { ...prev.modelParams, volumeDistribution: volDists },
        states,
      };
    });

    setSelectedCompartment(nameChanged ? newName : oldName);
    setCompModalOpen(false);
  };

  // ── Remove compartment ─────────────────────────────────────────────────────

  const handleRemoveCompartment = (name: string) => {
    setWorkingModel(prev => {
      if (!prev) return prev;
      const compartments = { ...prev.compartments };
      delete compartments[name];
      const bias    = { ...prev.connections?.bias };    delete bias[name];
      const regions = { ...prev.connections?.regions }; delete regions[name];
      const cycles  = { ...prev.connections?.cycles };  delete cycles[name];
      const states  = Object.fromEntries(
        Object.entries(prev.states ?? {}).filter(([k]) => !k.endsWith(`_${name}`))
      );
      const volDists = { ...prev.modelParams?.volumeDistribution };
      delete volDists[name];
      return {
        ...prev,
        compartments,
        connections: { ...prev.connections, bias, regions, cycles },
        modelParams: { ...prev.modelParams, volumeDistribution: volDists },
        states,
      };
    });
    if (selectedCompartment === name) setSelectedCompartment(null);
  };


  // ── Add cycle ──────────────────────────────────────────────────────────────

  const openAddCycleModal = () => {
    setCycleModalMode('add');
    setCycleDefaultValues({});
    setCycleError(null);
    setCycleModalOpen(true);
  };

  const handleAddCycle = (values: Record<string, any>) => {
    const name          = (values.name ?? '').trim();
    const duration      = parseFloat(values.duration ?? '0') || 0;
    const triggerOffset = parseFloat(values.triggerOffset ?? '0') || 0;
    const timerOffset   = parseFloat(values.timerOffset ?? '0') || 0;
    if (!name) { setCycleError('Name is required'); return; }
    if (workingModel?.cycles?.[name]) { setCycleError('A cycle with this name already exists'); return; }
    setWorkingModel(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        cycles: { ...prev.cycles, [name]: { type: 'cycle', params: { duration, triggerOffset, timerOffset } } },
        states: { ...prev.states, ...statesForCycle(name, duration, triggerOffset, timerOffset) },
      };
    });
    setSelectedCycle(name);
    setCycleModalOpen(false);
  };

  // ── Edit cycle ─────────────────────────────────────────────────────────────

  const openEditCycleModal = (name: string) => {
    if (!workingModel) return;
    const cyc = workingModel.cycles?.[name];
    setSelectedCycle(name);
    setCycleModalMode('edit');
    setCycleDefaultValues({
      name,
      duration:      String(cyc?.params?.duration      ?? 0),
      triggerOffset: String(cyc?.params?.triggerOffset  ?? 0),
      timerOffset:   String(cyc?.params?.timerOffset    ?? 0),
    });
    setCycleError(null);
    setCycleModalOpen(true);
  };

  const handleEditCycle = (values: Record<string, any>) => {
    if (!selectedCycle || !workingModel) return;
    const oldName       = selectedCycle;
    const newName       = (values.name ?? '').trim();
    const duration      = parseFloat(values.duration ?? '0') || 0;
    const triggerOffset = parseFloat(values.triggerOffset ?? '0') || 0;
    const timerOffset   = parseFloat(values.timerOffset ?? '0') || 0;
    if (!newName) return;
    const nameChanged = newName !== oldName;
    setWorkingModel(prev => {
      if (!prev) return prev;
      const cycles = { ...prev.cycles };
      delete cycles[oldName];
      cycles[newName] = { type: 'cycle', params: { duration, triggerOffset, timerOffset } };
      // Remap connections.cycles values that point to oldName
      const connCycles = Object.fromEntries(
        Object.entries(prev.connections?.cycles ?? {}).map(([k, v]) => [k, v === oldName ? newName : v])
      );
      let states = removeCycleStates(prev.states ?? {}, oldName);
      Object.assign(states, statesForCycle(newName, duration, triggerOffset, timerOffset));
      // Rename t_Sys / t_transition if name changed
      if (nameChanged) {
        if (`t_Sys_${oldName}` in (prev.states ?? {})) {
          states[`t_Sys_${newName}`]        = prev.states[`t_Sys_${oldName}`];
          delete states[`t_Sys_${oldName}`];
        }
        if (`t_transition_${oldName}` in (prev.states ?? {})) {
          states[`t_transition_${newName}`]  = prev.states[`t_transition_${oldName}`];
          delete states[`t_transition_${oldName}`];
        }
      }
      return { ...prev, cycles, connections: { ...prev.connections, cycles: connCycles }, states };
    });
    setSelectedCycle(newName);
    setCycleModalOpen(false);
  };

  // ── Remove cycle ───────────────────────────────────────────────────────────

  const handleRemoveCycle = (name: string) => {
    setWorkingModel(prev => {
      if (!prev) return prev;
      const cycles = { ...prev.cycles };
      delete cycles[name];
      const connCycles = Object.fromEntries(
        Object.entries(prev.connections?.cycles ?? {}).map(([k, v]) => [k, v === name ? '' : v])
      );
      const states = removeCycleStates(prev.states ?? {}, name);
      return { ...prev, cycles, connections: { ...prev.connections, cycles: connCycles }, states };
    });
    if (selectedCycle === name) setSelectedCycle(null);
  };

  // ── Add other ─────────────────────────────────────────────────────────────

  const openAddOtherModal = () => {
    setOtherModalMode('add');
    setOtherType('movingAverage');
    setOtherDefaultValues({});
    setOtherError(null);
    setOtherModalOpen(true);
  };

  const handleSubmitOther = (values: Record<string, any>) => {
    const params = buildOtherParams(otherType, values);
    const newKey = otherKey(otherType, params);
    if (!newKey) { setOtherError('Required field is empty'); return; }
    if (otherModalMode === 'add' && workingModel?.other?.[newKey]) {
      setOtherError(`Entry "${newKey}" already exists`); return;
    }
    const newEntry = { type: otherType, params };
    const newStates = statesForOther(otherType, newKey, params);
    setWorkingModel(prev => {
      if (!prev) return prev;
      const other  = { ...prev.other };
      let   states = { ...prev.states };
      if (otherModalMode === 'edit' && selectedOther) {
        const old = other[selectedOther];
        states = removeOtherFromStates(states, selectedOther);
        delete other[selectedOther];
        // if the type was 'constant', it never went into states — clean up modelParams key
        if (old?.type === 'constant') {
          const mp = { ...prev.modelParams };
          delete mp[selectedOther];
          return { ...prev, other: { ...other, [newKey]: newEntry }, states: { ...states, ...newStates }, modelParams: mp };
        }
      }
      return { ...prev, other: { ...other, [newKey]: newEntry }, states: { ...states, ...newStates } };
    });
    setSelectedOther(newKey);
    setOtherModalOpen(false);
  };

  // ── Edit other ─────────────────────────────────────────────────────────────

  const openEditOtherModal = (key: string) => {
    if (!workingModel) return;
    const entry = workingModel.other?.[key];
    setSelectedOther(key);
    setOtherType(entry?.type ?? 'movingAverage');
    const params = entry?.params ?? {};
    const defaults: Record<string, any> = {};
    for (const [k, v] of Object.entries(params)) {
      defaults[k] = Array.isArray(v) ? (v as string[]).join(', ') : String(v);
    }
    setOtherDefaultValues(defaults);
    setOtherModalMode('edit');
    setOtherError(null);
    setOtherModalOpen(true);
  };

  // ── Remove other ───────────────────────────────────────────────────────────

  const handleRemoveOther = (key: string) => {
    setWorkingModel(prev => {
      if (!prev) return prev;
      const other = { ...prev.other };
      const entry = other[key];
      delete other[key];
      const states = removeOtherFromStates(prev.states ?? {}, key);
      if (entry?.type === 'constant') {
        const mp = { ...prev.modelParams };
        delete mp[key];
        return { ...prev, other, states, modelParams: mp };
      }
      return { ...prev, other, states };
    });
    if (selectedOther === key) setSelectedOther(null);
  };

  // ── Add connection ─────────────────────────────────────────────────────────

  const openAddConnModal = () => {
    setConnModalMode('add');
    setConnDefaultValues({});
    setConnError(null);
    setConnModalOpen(true);
  };

  const handleAddConnection = (values: Record<string, any>) => {
    const from     = values.from ?? '';
    const to       = values.to ?? '';
    const connType = values.connectionType ?? 'resistor';
    const id       = `${from}_${to}`;

    if (!from || !to) { setConnError('From and To are required'); return; }
    if (workingModel?.connections?.resistive?.[id]) { setConnError(`Connection ${id} already exists`); return; }

    const params = { ...(CONNECTION_PARAMS[connType] ?? CONNECTION_PARAMS.resistor) };

    setWorkingModel(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        connections: {
          ...prev.connections,
          resistive: { ...prev.connections?.resistive, [id]: { type: connType, from, to, params } },
          bias:      { ...prev.connections?.bias,      [id]: 'Atm' },
        },
        states: { ...prev.states, ...statesForConnection(id, connType, params) },
      };
    });

    setConnModalOpen(false);
  };

  // ── Edit connection ────────────────────────────────────────────────────────

  const openEditConnModal = (id: string) => {
    if (!workingModel) return;
    const conn = workingModel.connections?.resistive?.[id];
    setSelectedConnection(id);
    setConnModalMode('edit');
    setConnDefaultValues({
      from:           conn?.from ?? '',
      to:             conn?.to   ?? '',
      connectionType: conn?.type ?? 'resistor',
    });
    setConnError(null);
    setConnModalOpen(true);
  };

  const handleEditConnection = (values: Record<string, any>) => {
    if (!selectedConnection || !workingModel) return;
    const oldId    = selectedConnection;
    const from     = values.from ?? '';
    const to       = values.to ?? '';
    const connType = values.connectionType ?? 'resistor';
    const newId    = `${from}_${to}`;

    const oldConn    = workingModel.connections?.resistive?.[oldId];
    const typeChanged = connType !== oldConn?.type;
    const params = typeChanged
      ? { ...(CONNECTION_PARAMS[connType] ?? CONNECTION_PARAMS.resistor) }
      : { ...(oldConn?.params ?? CONNECTION_PARAMS[connType] ?? CONNECTION_PARAMS.resistor) };

    setWorkingModel(prev => {
      if (!prev) return prev;
      const resistive = { ...prev.connections?.resistive };
      delete resistive[oldId];
      resistive[newId] = { type: connType, from, to, params };
      const bias = { ...prev.connections?.bias };
      delete bias[oldId];
      bias[newId] = 'Atm';
      const newConnStates = statesForConnection(newId, connType, params);
      if (!typeChanged) newConnStates[`Q_${newId}`] = prev.states?.[`Q_${oldId}`] ?? 0.0;
      const states = { ...removeConnectionStates(prev.states ?? {}, oldId), ...newConnStates };
      return { ...prev, connections: { ...prev.connections, resistive, bias }, states };
    });

    setSelectedConnection(newId);
    setConnModalOpen(false);
  };

  // ── Remove connection ──────────────────────────────────────────────────────

  const handleRemoveConnection = (id: string) => {
    setWorkingModel(prev => {
      if (!prev) return prev;
      const resistive = { ...prev.connections?.resistive };
      delete resistive[id];
      const bias = { ...prev.connections?.bias };
      delete bias[id];
      const states = removeConnectionStates(prev.states ?? {}, id);
      return { ...prev, connections: { ...prev.connections, resistive, bias }, states };
    });
    if (selectedConnection === id) setSelectedConnection(null);
  };

  // ── Edit state value ───────────────────────────────────────────────────────

  const handleStateChange = (key: string, raw: string) => {
    const value = parseFloat(raw);
    if (isNaN(value)) return;
    setWorkingModel(prev => prev ? { ...prev, states: { ...prev.states, [key]: value } } : prev);
  };


/*
 ██████    ████████  ██      ██  ██████    ████████  ██████
 ██    ██  ██        ████    ██  ██    ██  ██        ██    ██
 ██████    ██████    ██  ██  ██  ██    ██  ██████    ██████
 ██    ██  ██        ██    ████  ██    ██  ██        ██    ██
 ██    ██  ████████  ██      ██  ██████    ████████  ██    ██
                                                               */


  const jsonPreview = workingModel ? JSON.stringify(canonicalModelJson(workingModel), null, 2) : '';

  const handleDownload = () => {
    if (!workingModel || !selectedConfig) return;
    const blob = new Blob([jsonPreview], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `${selectedConfig.name}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const compartmentItems: CompartmentItem[] = Object.entries(workingModel?.compartments ?? {}).map(
    ([name, comp]) => ({ id: name, capType: (comp as any)?.capacitor?.type ?? 'unknown' })
  );

  const connectionItems: ConnectionItem[] = Object.entries(workingModel?.connections?.resistive ?? {}).map(
    ([id, conn]) => ({ id, from: (conn as any).from, to: (conn as any).to, connType: (conn as any).type })
  );

  const compartmentOptions = Object.keys(workingModel?.compartments ?? {}).map(n => ({ value: n, label: n }));

  const cycleItems: CycleItem[] = Object.entries(workingModel?.cycles ?? {}).map(
    ([name, cyc]) => ({ id: name, duration: (cyc as any)?.params?.duration ?? 0 })
  );

  const otherItems: OtherItem[] = Object.entries(workingModel?.other ?? {}).map(
    ([key, entry]) => ({ id: key, otherType: (entry as any)?.type ?? 'unknown' })
  );

  const cycleOptions = [
    { value: '', label: 'None' },
    ...Object.keys(workingModel?.cycles ?? {}).map(n => ({ value: n, label: n })),
  ];

  const stateEntries = sortedStateEntries(workingModel?.states ?? {});

  return (
    <SplitPageLayout
      navItems={AREA_NAV.PHYSIOLOGY}
      title="Model Sandbox"
      rightHeader={
        selectedConfig && workingModel ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px' }}>
            {saving && (
              <>
                <IonSpinner name="dots" style={{ width: 16, height: 16 }} />
                <IonNote style={{ fontSize: '0.8rem' }}>Saving…</IonNote>
              </>
            )}
            {saveError && <IonText color="danger" style={{ fontSize: '0.8rem' }}>{saveError}</IonText>}
          </div>
        ) : undefined
      }
      leftTabs={[{
        label: 'Configurations',
        actions: (
          <IonButton size="small" color="medium" onClick={() => importInputRef.current?.click()}>
            Import
          </IonButton>
        ),
        content: (
          <>
            {importError && <IonText color="danger" style={{ fontSize: '0.75rem', padding: '4px 8px', display: 'block' }}>{importError}</IonText>}
            <ResourcePanel
              fetcher={fetchConfigs}
              refreshToken={String(version)}
              config={PANEL_CONFIG.MODEL_CONFIGS}
              selectedId={selectedConfig?.id}
              getLabel={c => c.name}
              onSelect={setSelectedConfig}
              onDelete={handleDelete}
              onAdd={openNewModal}
            />
          </>
        ),
      }]}
      hidden={
        <input
          ref={importInputRef}
          type="file"
          accept=".json"
          style={{ display: 'none' }}
          onChange={handleImportFile}
        />
      }
      right={
        <TabPanel tabs={[
          {
            label: 'Builder',
            content: (
              <>
                {/* ── Top row: controls + JSON preview ── */}
                <IonGrid>
                  <IonRow>
                    <IonCol size="3">
                      <ResourcePanel<CompartmentItem>
                        data={compartmentItems}
                        config={PANEL_CONFIG.COMPARTMENTS}
                        selectedId={selectedCompartment}
                        getLabel={c => c.id}
                        getSubLabel={c => c.capType}
                        onSelect={c => openEditModal(c.id)}
                        onDelete={c => handleRemoveCompartment(c.id)}
                        onAdd={selectedConfig ? openAddModal : undefined}
                        collapsible
                      />
                      <ResourcePanel<ConnectionItem>
                        data={connectionItems}
                        config={PANEL_CONFIG.CONNECTIONS}
                        selectedId={selectedConnection}
                        getLabel={c => c.id}
                        getSubLabel={c => `${c.from} → ${c.to}  (${c.connType})`}
                        onSelect={c => openEditConnModal(c.id)}
                        onDelete={c => handleRemoveConnection(c.id)}
                        onAdd={selectedConfig ? openAddConnModal : undefined}
                        collapsible
                      />
                      <ResourcePanel<CycleItem>
                        data={cycleItems}
                        config={PANEL_CONFIG.CYCLES}
                        selectedId={selectedCycle}
                        getLabel={c => c.id}
                        getSubLabel={c => `duration: ${c.duration}s`}
                        onSelect={c => openEditCycleModal(c.id)}
                        onDelete={c => handleRemoveCycle(c.id)}
                        onAdd={selectedConfig ? openAddCycleModal : undefined}
                        collapsible
                      />
                      <ResourcePanel<OtherItem>
                        data={otherItems}
                        config={PANEL_CONFIG.OTHER}
                        selectedId={selectedOther}
                        getLabel={o => o.id}
                        getSubLabel={o => o.otherType}
                        onSelect={o => openEditOtherModal(o.id)}
                        onDelete={o => handleRemoveOther(o.id)}
                        onAdd={selectedConfig ? openAddOtherModal : undefined}
                        collapsible
                      />
                    </IonCol>
                    <IonCol size="3">
                      {/* ── States editor ── */}
                      <IonItem lines="full">
                        <IonLabel style={{ fontWeight: 600, fontSize: '0.85rem' }}>Initial States</IonLabel>
                      </IonItem>
                      <div style={{ overflowY: 'auto', maxHeight: 320 }}>
                        {stateEntries.length === 0
                          ? <IonNote style={{ padding: '8px 16px', display: 'block' }}>No states yet</IonNote>
                          : stateEntries.map(([key, val]) => (
                            <IonItem key={key} lines="full" style={{ '--min-height': '36px' }}>
                              <IonLabel style={{ fontSize: '0.75rem', fontFamily: 'monospace' }}>{key}</IonLabel>
                              <IonInput
                                slot="end"
                                type="number"
                                value={String(val)}
                                style={{ textAlign: 'right', maxWidth: 90, fontSize: '0.8rem' }}
                                onIonBlur={e => handleStateChange(key, (e.target as HTMLIonInputElement).value as string)}
                              />
                            </IonItem>
                          ))
                        }
                      </div>
                    </IonCol>
                    <IonCol size="3" />
                    <IonCol size="3">
                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
                        <IonButton size="small" fill="outline" disabled={!workingModel} onClick={handleDownload}>
                          Download
                        </IonButton>
                      </div>
                      <JsonViewer value={workingModel ? canonicalModelJson(workingModel) : {}} />
                    </IonCol>
                  </IonRow>
                </IonGrid>

                {/* ── Bottom row: canvas ── */}
                <IonGrid>
                  <IonRow>
                    <IonCol size="12">
                      <ModelCanvas
                        modelJson={workingModel}
                        selectedNode={selectedCompartment}
                        onSelectNode={openEditModal}
                      />
                    </IonCol>
                  </IonRow>
                </IonGrid>
              </>
            ),
          },
        ]} />
      }
    >
      {/* ── New model modal ── */}
      <ModalShell
        isOpen={newModalOpen}
        onDismiss={() => setNewModalOpen(false)}
        title="New Model"
        dismissLabel="Cancel"
      >
        {newError && <IonText color="danger" style={{ padding: '4px 16px', display: 'block' }}>{newError}</IonText>}
        {newForm && (
          <FormRenderer
            component={newForm}
            onSubmit={handleCreate}
            submitLabel="Create"
          />
        )}
      </ModalShell>

      {/* ── Add / Edit compartment modal — same form, mode-switched handler ── */}
      <ModalShell
        isOpen={compModalOpen}
        onDismiss={() => setCompModalOpen(false)}
        title={compModalMode === 'add' ? 'Add Compartment' : 'Edit Compartment'}
        dismissLabel="Cancel"
      >
        {compError && <IonText color="danger" style={{ padding: '4px 16px', display: 'block' }}>{compError}</IonText>}
        <FormRenderer
          component={COMPARTMENT_FORM}
          defaultValues={compDefaultValues}
          injectedOptions={resolveInjectedOptions(COMPARTMENT_META_FIELDS, cycleOptions, compartmentOptions)}
          onSubmit={compModalMode === 'add' ? handleAddCompartment : handleEditCompartment}
          submitLabel={compModalMode === 'add' ? 'Add' : 'Save'}
        />
      </ModalShell>
      {/* ── Add / Edit connection modal ── */}
      <ModalShell
        isOpen={connModalOpen}
        onDismiss={() => setConnModalOpen(false)}
        title={connModalMode === 'add' ? 'Add Connection' : 'Edit Connection'}
        dismissLabel="Cancel"
      >
        {connError && <IonText color="danger" style={{ padding: '4px 16px', display: 'block' }}>{connError}</IonText>}
        <FormRenderer
          component={CONNECTION_FORM}
          defaultValues={connDefaultValues}
          injectedOptions={resolveInjectedOptions(CONNECTION_META_FIELDS, cycleOptions, compartmentOptions)}
          onSubmit={connModalMode === 'add' ? handleAddConnection : handleEditConnection}
          submitLabel={connModalMode === 'add' ? 'Add' : 'Save'}
        />
      </ModalShell>
      {/* ── Add / Edit cycle modal ── */}
      <ModalShell
        isOpen={cycleModalOpen}
        onDismiss={() => setCycleModalOpen(false)}
        title={cycleModalMode === 'add' ? 'Add Cycle' : 'Edit Cycle'}
        dismissLabel="Cancel"
      >
        {cycleError && <IonText color="danger" style={{ padding: '4px 16px', display: 'block' }}>{cycleError}</IonText>}
        <FormRenderer
          component={CYCLE_FORM}
          defaultValues={cycleDefaultValues}
          onSubmit={cycleModalMode === 'add' ? handleAddCycle : handleEditCycle}
          submitLabel={cycleModalMode === 'add' ? 'Add' : 'Save'}
        />
      </ModalShell>
      {/* ── Add / Edit other modal ── */}
      <ModalShell
        isOpen={otherModalOpen}
        onDismiss={() => setOtherModalOpen(false)}
        title={otherModalMode === 'add' ? 'Add Other' : 'Edit Other'}
        dismissLabel="Cancel"
      >
        <IonItem lines="full">
          <IonSelect
            label="Type"
            labelPlacement="stacked"
            value={otherType}
            disabled={otherModalMode === 'edit'}
            onIonChange={e => {
              setOtherType(e.detail.value);
              if (otherModalMode === 'add') setOtherDefaultValues({});
            }}
          >
            {OTHER_TYPES.map(t => (
              <IonSelectOption key={t} value={t}>{t}</IonSelectOption>
            ))}
          </IonSelect>
        </IonItem>
        {otherError && <IonText color="danger" style={{ padding: '4px 16px', display: 'block' }}>{otherError}</IonText>}
        <FormRenderer
          key={otherType}
          component={buildLocalForm(`other_${otherType}`, OTHER_FIELDS[otherType] ?? [])}
          defaultValues={otherDefaultValues}
          onSubmit={handleSubmitOther}
          submitLabel={otherModalMode === 'add' ? 'Add' : 'Save'}
        />
      </ModalShell>
    </SplitPageLayout>
  );
};

export default ModelSandbox;
