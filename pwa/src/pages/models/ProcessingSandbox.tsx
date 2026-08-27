// Page: ProcessingSandbox — visual builder for cardio post-processing configs.
// Reads/writes: proc_configs table (GraphQL). Config mirrors data_processing.py operation keys.
// Authenticated (private route).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  IonButton,
  IonCol,
  IonGrid,
  IonInput,
  IonItem,
  IonLabel,
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
import EmptyState from '../../components/shell/EmptyState';
import JsonViewer from '../../components/shell/JsonViewer';
import { CardioProcConfig } from '../../interfaces/types';
import { AREA_NAV, PANEL_CONFIG } from '../../constants';
import { downloadBlob } from '../../utils/download';


// ── Constants ─────────────────────────────────────────────────────────────────

const BLANK_PROC_CONFIG: Record<string, any> = {};


// ── Operation catalogue ───────────────────────────────────────────────────────

interface ParamDef {
  name:    string;
  label:   string;
  kind:    'text' | 'number' | 'select';
  options?: { value: string; label: string }[];
}

const UNIT_PAIRS = [
  'Pa→mmHg', 'mmHg→Pa', 'mmHg→cmH2O', 'cmH2O→mmHg',
  'Pa→cmH2O', 'cmH2O→Pa', 'mmHg→mol/ml',
];

const CYCLE_OP_OPTIONS = [
  { value: 'max',  label: 'max'  },
  { value: 'min',  label: 'min'  },
  { value: 'mean', label: 'mean' },
];

const OP_PARAMS: Record<string, ParamDef[]> = {
  // Independent
  sumOfArrays: [
    { name: 'resultNames', label: 'Result names (comma-sep)', kind: 'text' },
  ],
  proportion: [
    { name: 'multiplier', label: 'Multiplier (result name)', kind: 'text' },
    { name: 'numerator',  label: 'Numerator (result name)',  kind: 'text' },
    { name: 'denominator',label: 'Denominator (result name)',kind: 'text' },
  ],
  constantMultiplication: [
    { name: 'resultName', label: 'Result name', kind: 'text'   },
    { name: 'constant',   label: 'Constant',    kind: 'number' },
  ],
  constantSubstraction: [
    { name: 'resultName', label: 'Result name', kind: 'text'   },
    { name: 'constant',   label: 'Constant',    kind: 'number' },
  ],
  absoluteValue: [
    { name: 'resultName', label: 'Result name', kind: 'text' },
  ],
  integral: [
    { name: 'resultName', label: 'Result name', kind: 'text'   },
    { name: 'step',       label: 'Step (dt)',   kind: 'number' },
  ],
  minusMin: [
    { name: 'resultName', label: 'Result name', kind: 'text' },
  ],
  minusY0: [
    { name: 'resultName', label: 'Result name', kind: 'text' },
  ],
  difference: [
    { name: 'resultName1', label: 'Result name 1', kind: 'text' },
    { name: 'resultName2', label: 'Result name 2', kind: 'text' },
  ],
  range: [
    { name: 'start', label: 'Start', kind: 'number' },
    { name: 'end',   label: 'End',   kind: 'number' },
  ],
  division: [
    { name: 'numerator',  label: 'Numerator (result name)',  kind: 'text' },
    { name: 'denominator',label: 'Denominator (result name)',kind: 'text' },
  ],
  pH: [
    { name: 'concentration', label: 'Concentration (result name)', kind: 'text' },
  ],
  oxygenSaturation: [
    { name: 'resultName',  label: 'Result name', kind: 'text' },
    { name: 'compartment', label: 'Compartment', kind: 'text' },
  ],
  movingAverage: [
    { name: 'resultName', label: 'Result name', kind: 'text'   },
    { name: 'window',     label: 'Window',      kind: 'number' },
  ],
  // Cycle dependent
  integralOverCycle: [
    { name: 'resultName', label: 'Result name', kind: 'text'   },
    { name: 'cycle',      label: 'Cycle',       kind: 'text'   },
    { name: 'step',       label: 'Step (dt)',   kind: 'number' },
  ],
  variationOfIntegalValueOverCycle: [
    { name: 'resultName', label: 'Result name', kind: 'text'   },
    { name: 'cycle',      label: 'Cycle',       kind: 'text'   },
    { name: 'step',       label: 'Step (dt)',   kind: 'number' },
  ],
  variationOfValueOverCycle: [
    { name: 'resultName', label: 'Result name', kind: 'text'   },
    { name: 'cycle',      label: 'Cycle',       kind: 'text'   },
    { name: 'step',       label: 'Step (dt)',   kind: 'number' },
  ],
  valueOverCycle: [
    { name: 'resultName', label: 'Result name',       kind: 'text'   },
    { name: 'cycle',      label: 'Cycle',             kind: 'text'   },
    { name: 'step',       label: 'Step (dt)',         kind: 'number' },
    { name: 'operation',  label: 'Aggregate',         kind: 'select', options: CYCLE_OP_OPTIONS },
  ],
  // Unit conversion
  unitConversion: [
    { name: 'resultName', label: 'Result name', kind: 'text'   },
    { name: 'from',       label: 'From unit',   kind: 'text'   },
    { name: 'to',         label: 'To unit',     kind: 'text'   },
  ],
  // Minute variables
  cardiacOutput: [
    { name: 'SV', label: 'SV (result name)', kind: 'text' },
    { name: 'HR', label: 'HR (result name)', kind: 'text' },
  ],
  heartRate: [
    { name: 'cycle', label: 'Cycle (result name)', kind: 'text'   },
    { name: 'time',  label: 'Time (s)',             kind: 'number' },
  ],
  volumetricFlow: [
    { name: 'pressure', label: 'Pressure (result name)', kind: 'text' },
    { name: 'flow',     label: 'Flow (result name)',     kind: 'text' },
  ],
  totalBloodGasMoles: [
    { name: 'tag',        label: 'Tag prefix',  kind: 'text'   },
    { name: 'multiplier', label: 'Multiplier',  kind: 'number' },
  ],
  totalTissueGasMoles: [
    { name: 'tag',        label: 'Tag prefix',  kind: 'text'   },
    { name: 'multiplier', label: 'Multiplier',  kind: 'number' },
  ],
  molToVolume: [
    { name: 'nmol',        label: 'nmol (result name)',    kind: 'text'   },
    { name: 'pressure',    label: 'Pressure',              kind: 'number' },
    { name: 'volume',      label: 'Volume (result name)',  kind: 'text'   },
    { name: 'temperature', label: 'Temperature (K)',       kind: 'number' },
  ],
  volumeToMol: [
    { name: 'volume',      label: 'Volume (result name)',   kind: 'text'   },
    { name: 'pressure',    label: 'Pressure (result name)', kind: 'text'   },
    { name: 'temperature', label: 'Temperature (K)',        kind: 'number' },
  ],
  concentrationToVolume: [
    { name: 'volume',        label: 'Volume (result name)',        kind: 'text' },
    { name: 'concentration', label: 'Concentration (result name)', kind: 'text' },
  ],
  // Model specific
  thoraxUnstressedVolume: [
    { name: 'resultName', label: 'Result name', kind: 'text' },
  ],
  calculateElastance: [
    { name: 'resultName', label: 'Result name', kind: 'text' },
  ],
  calculateCompliance: [
    { name: 'resultName', label: 'Result name', kind: 'text' },
  ],
  calculateSigmoidCompliance: [
    { name: 'resultName', label: 'Result name', kind: 'text' },
  ],
  calculateSigmoidComplianceRange: [
    { name: 'resultName', label: 'Result name',         kind: 'text'   },
    { name: 'tagToUse',   label: 'Tag to use',          kind: 'text'   },
    { name: 'start',      label: 'Start',               kind: 'number' },
    { name: 'end',        label: 'End',                 kind: 'number' },
  ],
  calculateSigmoid: [
    { name: 'resultName', label: 'Result name', kind: 'text' },
  ],
  calculateSigmoidRange: [
    { name: 'resultName', label: 'Result name', kind: 'text'   },
    { name: 'start',      label: 'Start',       kind: 'number' },
    { name: 'end',        label: 'End',         kind: 'number' },
  ],
  calculateSigmoidRangeArray: [
    { name: 'start', label: 'Start', kind: 'number' },
    { name: 'end',   label: 'End',   kind: 'number' },
  ],
  calculateConcentrationInGas: [
    { name: 'pressureIn',    label: 'Pressure in (result name)', kind: 'text'   },
    { name: 'volumeIn',      label: 'Volume in (result name)',   kind: 'text'   },
    { name: 'temperatureIn', label: 'Temperature (K)',           kind: 'number' },
    { name: 'R',             label: 'Gas constant R',            kind: 'number' },
  ],
};

const ALL_OPERATIONS = Object.keys(OP_PARAMS);

// ── Local types ────────────────────────────────────────────────────────────────

interface StageItem { id: string }
interface OpItem    { id: string; operation: string }

interface OpFormState {
  key:       string;
  operation: string;
  params:    Record<string, string>;
}

const BLANK_OP_FORM: OpFormState = { key: '', operation: 'sumOfArrays', params: {} };


// ── Component ─────────────────────────────────────────────────────────────────

const ProcessingSandbox: React.FC = () => {


/*
   ██████  ██████████    ████    ██████████  ████████
 ██            ██      ██    ██      ██      ██
   ████        ██      ████████      ██      ██████
       ██      ██      ██    ██      ██      ██
 ██████        ██      ██    ██      ██      ████████
                                                       */


  const [version, setVersion]               = useState(0);
  const [selectedConfig, setSelectedConfig] = useState<CardioProcConfig | null>(null);
  const [workingConfig, setWorkingConfig]   = useState<Record<string, any> | null>(null);

  const [saving, setSaving]       = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const importInputRef                = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);

  // New config modal
  const [newModalOpen, setNewModalOpen] = useState(false);
  const [newName, setNewName]           = useState('');
  const [newDesc, setNewDesc]           = useState('');
  const [newError, setNewError]         = useState<string | null>(null);

  // Stage selection + add modal
  const [selectedStage, setSelectedStage]   = useState<string | null>(null);
  const [stageModalOpen, setStageModalOpen] = useState(false);
  const [stageName, setStageName]           = useState('');
  const [stageError, setStageError]         = useState<string | null>(null);

  // Op add/edit modal
  const [opModalOpen, setOpModalOpen]   = useState(false);
  const [opModalMode, setOpModalMode]   = useState<'add' | 'edit'>('add');
  const [opForm, setOpForm]             = useState<OpFormState>(BLANK_OP_FORM);
  const [editingOpKey, setEditingOpKey] = useState<string | null>(null);
  const [opError, setOpError]           = useState<string | null>(null);
  const [selectedOp, setSelectedOp]     = useState<string | null>(null);


/*
 ██          ████      ████    ██████
 ██        ██    ██  ██    ██  ██    ██
 ██        ██    ██  ████████  ██    ██
 ██        ██    ██  ██    ██  ██    ██
 ████████    ████    ██    ██  ██████
                                         */


  const fetchConfigs = useCallback(() => ApiService.getProcConfigs(), []);

  useEffect(() => {
    setWorkingConfig(selectedConfig ? JSON.parse(JSON.stringify(selectedConfig.config)) : null);
    setSelectedStage(null);
    setSelectedOp(null);
  }, [selectedConfig?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setSelectedOp(null);
  }, [selectedStage]);


/*
 ██    ██    ████    ██      ██  ██████    ██        ████████  ██████      ██████
 ██    ██  ██    ██  ████    ██  ██    ██  ██        ██        ██    ██  ██
 ████████  ████████  ██  ██  ██  ██    ██  ██        ██████    ██████      ████
 ██    ██  ██    ██  ██    ████  ██    ██  ██        ██        ██    ██        ██
 ██    ██  ██    ██  ██      ██  ██████    ████████  ████████  ██    ██  ██████
                                                                                   */


  // ── New config ─────────────────────────────────────────────────────────────

  const openNewModal = () => {
    setNewName(''); setNewDesc(''); setNewError(null);
    setNewModalOpen(true);
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) { setNewError('Name is required'); return; }
    setNewError(null);
    try {
      const created = await ApiService.createProcConfig(name, newDesc.trim(), BLANK_PROC_CONFIG);
      setSelectedConfig(created);
      setVersion(v => v + 1);
      setNewModalOpen(false);
    } catch (err: any) {
      setNewError(err.message ?? 'Failed to create');
    }
  };

  const handleDelete = async (cfg: CardioProcConfig) => {
    await ApiService.deleteProcConfig(cfg.id);
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
      const created = await ApiService.createProcConfig(name, '', json);
      setSelectedConfig(created);
      setVersion(v => v + 1);
    } catch (e) {
      setImportError((e as Error).message);
    }
  };

  // ── Save ───────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!selectedConfig || !workingConfig) return;
    setSaving(true); setSaveError(null);
    try {
      const updated = await ApiService.updateProcConfig(selectedConfig.id, { config: workingConfig });
      setSelectedConfig(updated);
    } catch (err: any) {
      setSaveError(err.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  // ── Stages ─────────────────────────────────────────────────────────────────

  const openAddStageModal = () => {
    setStageName(''); setStageError(null);
    setStageModalOpen(true);
  };

  const handleAddStage = () => {
    const name = stageName.trim();
    if (!name) { setStageError('Name is required'); return; }
    if (workingConfig?.[name] !== undefined) { setStageError('Stage already exists'); return; }
    setWorkingConfig(prev => prev ? { ...prev, [name]: {} } : prev);
    setSelectedStage(name);
    setStageModalOpen(false);
  };

  const handleRemoveStage = (name: string) => {
    setWorkingConfig(prev => {
      if (!prev) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
    if (selectedStage === name) setSelectedStage(null);
  };

  // ── Operations ─────────────────────────────────────────────────────────────

  const openAddOpModal = () => {
    setOpModalMode('add');
    setOpForm(BLANK_OP_FORM);
    setOpError(null);
    setOpModalOpen(true);
  };

  const openEditOpModal = (key: string) => {
    if (!workingConfig || !selectedStage) return;
    const entry = workingConfig[selectedStage]?.[key];
    if (!entry) return;
    const rawParams = entry.params ?? {};
    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawParams)) {
      params[k] = Array.isArray(v) ? (v as any[]).join(', ') : String(v);
    }
    setOpModalMode('edit');
    setEditingOpKey(key);
    setOpForm({ key, operation: entry.operation ?? 'sumOfArrays', params });
    setOpError(null);
    setOpModalOpen(true);
  };

  const setOpField = (field: keyof Omit<OpFormState, 'params'>, val: string) =>
    setOpForm(prev => ({ ...prev, [field]: val }));

  const setOpParam = (name: string, val: string) =>
    setOpForm(prev => ({ ...prev, params: { ...prev.params, [name]: val } }));

  const buildParams = (form: OpFormState): Record<string, any> => {
    const defs = OP_PARAMS[form.operation] ?? [];
    const result: Record<string, any> = {};
    for (const def of defs) {
      const raw = form.params[def.name] ?? '';
      if (def.name === 'resultNames') {
        result[def.name] = raw.split(',').map(s => s.trim()).filter(Boolean);
      } else if (def.kind === 'number') {
        result[def.name] = parseFloat(raw) || 0;
      } else {
        result[def.name] = raw;
      }
    }
    return result;
  };

  const handleSubmitOp = () => {
    const key = opForm.key.trim();
    if (!key) { setOpError('Output key is required'); return; }
    if (!selectedStage) return;
    const params = buildParams(opForm);
    const entry  = { operation: opForm.operation, params };

    setWorkingConfig(prev => {
      if (!prev) return prev;
      const stage = { ...(prev[selectedStage] ?? {}) };
      if (opModalMode === 'edit' && editingOpKey && editingOpKey !== key) {
        delete stage[editingOpKey];
      }
      stage[key] = entry;
      return { ...prev, [selectedStage]: stage };
    });
    setSelectedOp(key);
    setOpModalOpen(false);
  };

  const handleRemoveOp = (key: string) => {
    if (!selectedStage) return;
    setWorkingConfig(prev => {
      if (!prev) return prev;
      const stage = { ...(prev[selectedStage] ?? {}) };
      delete stage[key];
      return { ...prev, [selectedStage]: stage };
    });
    if (selectedOp === key) setSelectedOp(null);
  };

  // ── Download ───────────────────────────────────────────────────────────────

  const handleDownload = () => {
    if (!workingConfig || !selectedConfig) return;
    const blob = new Blob([jsonPreview], { type: 'application/json' });
    downloadBlob(blob, `${selectedConfig.name}.json`);
  };


/*
 ██████    ████████  ██      ██  ██████    ████████  ██████
 ██    ██  ██        ████    ██  ██    ██  ██        ██    ██
 ██████    ██████    ██  ██  ██  ██    ██  ██████    ██████
 ██    ██  ██        ██    ████  ██    ██  ██        ██    ██
 ██    ██  ████████  ██      ██  ██████    ████████  ██    ██
                                                               */


  const stageItems: StageItem[] = Object.keys(workingConfig ?? {}).map(k => ({ id: k }));

  const opItems: OpItem[] = selectedStage
    ? Object.entries(workingConfig?.[selectedStage] ?? {}).map(([k, v]) => ({
        id: k,
        operation: (v as any)?.operation ?? '?',
      }))
    : [];

  const jsonPreview = workingConfig ? JSON.stringify(workingConfig, null, 2) : '';

  const currentOpDefs = OP_PARAMS[opForm.operation] ?? [];

  const builderContent = !workingConfig ? (
    <EmptyState message="Select or create a processing config to start building" />
  ) : (
    <IonGrid>
      <IonRow>
        {/* ── Stages ── */}
        <IonCol size="4">
          <ResourcePanel<StageItem>
            data={stageItems}
            config={PANEL_CONFIG.PROC_STAGES}
            selectedId={selectedStage}
            getLabel={s => s.id}
            onSelect={s => setSelectedStage(s.id)}
            onDelete={s => handleRemoveStage(s.id)}
            onAdd={openAddStageModal}
            collapsible
          />
        </IonCol>

        {/* ── Operations ── */}
        <IonCol size="4">
          {selectedStage ? (
            <ResourcePanel<OpItem>
              data={opItems}
              config={PANEL_CONFIG.PROC_OPS}
              selectedId={selectedOp}
              getLabel={o => o.id}
              getSubLabel={o => o.operation}
              onSelect={o => { setSelectedOp(o.id); openEditOpModal(o.id); }}
              onDelete={o => handleRemoveOp(o.id)}
              onAdd={openAddOpModal}
              collapsible
            />
          ) : (
            <EmptyState message="Select a stage to view its operations" />
          )}
        </IonCol>

        {/* ── JSON preview ── */}
        <IonCol size="4">
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
            <IonButton size="small" fill="outline" disabled={!workingConfig} onClick={handleDownload}>
              Download
            </IonButton>
          </div>
          <JsonViewer value={workingConfig ?? {}} />
        </IonCol>
      </IonRow>
    </IonGrid>
  );

  return (
    <SplitPageLayout
      navItems={AREA_NAV.PHYSIOLOGY}
      title="Processing Sandbox"
      rightHeader={
        selectedConfig && workingConfig ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px' }}>
            {saveError && <IonText color="danger" style={{ fontSize: '0.8rem' }}>{saveError}</IonText>}
            <IonButton size="small" disabled={saving} onClick={handleSave}>
              {saving ? <IonSpinner name="dots" /> : 'Save'}
            </IonButton>
          </div>
        ) : undefined
      }
      leftTabs={[{
        label: 'Proc Configs',
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
              config={PANEL_CONFIG.PROC_CONFIGS}
              selectedId={selectedConfig?.id}
              getLabel={c => c.name}
              getSubLabel={c => c.description ?? ''}
              onSelect={setSelectedConfig}
              onDelete={handleDelete}
              onAdd={openNewModal}
            />
          </>
        ),
      }]}
      right={
        <TabPanel tabs={[
          { label: 'Builder', content: builderContent },
        ]} />
      }
      hidden={
        <input
          ref={importInputRef}
          type="file"
          accept=".json"
          style={{ display: 'none' }}
          onChange={handleImportFile}
        />
      }
    >
      {/* ── New config modal ── */}
      <ModalShell
        isOpen={newModalOpen}
        onDismiss={() => setNewModalOpen(false)}
        title="New Processing Config"
        dismissLabel="Cancel"
      >
        {newError && <IonText color="danger" style={{ padding: '4px 16px', display: 'block' }}>{newError}</IonText>}
        <IonItem>
          <IonInput
            label="Name" labelPlacement="stacked" placeholder="My processing config"
            value={newName}
            onIonInput={e => setNewName(e.detail.value ?? '')}
          />
        </IonItem>
        <IonItem>
          <IonInput
            label="Description" labelPlacement="stacked" placeholder="Optional"
            value={newDesc}
            onIonInput={e => setNewDesc(e.detail.value ?? '')}
          />
        </IonItem>
        <div style={{ padding: '8px 16px' }}>
          <IonButton expand="block" onClick={handleCreate}>Create</IonButton>
        </div>
      </ModalShell>

      {/* ── Add stage modal ── */}
      <ModalShell
        isOpen={stageModalOpen}
        onDismiss={() => setStageModalOpen(false)}
        title="Add Stage"
        dismissLabel="Cancel"
      >
        {stageError && <IonText color="danger" style={{ padding: '4px 16px', display: 'block' }}>{stageError}</IonText>}
        <IonItem>
          <IonInput
            label="Stage key" labelPlacement="stacked" placeholder="e.g. compliance0"
            value={stageName}
            onIonInput={e => setStageName(e.detail.value ?? '')}
          />
        </IonItem>
        <div style={{ padding: '8px 16px' }}>
          <IonButton expand="block" onClick={handleAddStage}>Add</IonButton>
        </div>
      </ModalShell>

      {/* ── Add / Edit operation modal ── */}
      <ModalShell
        isOpen={opModalOpen}
        onDismiss={() => setOpModalOpen(false)}
        title={opModalMode === 'add' ? 'Add Operation' : 'Edit Operation'}
        dismissLabel="Cancel"
      >
        {opError && <IonText color="danger" style={{ padding: '4px 16px', display: 'block' }}>{opError}</IonText>}

        <IonItem>
          <IonInput
            label="Output key (variable name)" labelPlacement="stacked"
            placeholder="e.g. avg_P_As"
            value={opForm.key}
            disabled={opModalMode === 'edit'}
            onIonInput={e => setOpField('key', e.detail.value ?? '')}
          />
        </IonItem>

        <IonItem>
          <IonSelect
            label="Operation" labelPlacement="stacked"
            value={opForm.operation}
            onIonChange={e => setOpForm(prev => ({ key: prev.key, operation: e.detail.value, params: {} }))}
          >
            {ALL_OPERATIONS.map(op => (
              <IonSelectOption key={op} value={op}>{op}</IonSelectOption>
            ))}
          </IonSelect>
        </IonItem>

        {currentOpDefs.map(def => (
          <IonItem key={def.name}>
            {def.kind === 'select' ? (
              <IonSelect
                label={def.label} labelPlacement="stacked"
                value={opForm.params[def.name] ?? (def.options?.[0]?.value ?? '')}
                onIonChange={e => setOpParam(def.name, e.detail.value)}
              >
                {(def.options ?? []).map(o => (
                  <IonSelectOption key={o.value} value={o.value}>{o.label}</IonSelectOption>
                ))}
              </IonSelect>
            ) : (
              <IonInput
                label={def.label}
                labelPlacement="stacked"
                type={def.kind === 'number' ? 'number' : 'text'}
                placeholder={def.kind === 'number' ? '0' : ''}
                value={opForm.params[def.name] ?? ''}
                onIonInput={e => setOpParam(def.name, e.detail.value ?? '')}
              />
            )}
          </IonItem>
        ))}

        <div style={{ padding: '8px 16px' }}>
          <IonButton expand="block" onClick={handleSubmitOp}>
            {opModalMode === 'add' ? 'Add' : 'Save'}
          </IonButton>
        </div>
      </ModalShell>
    </SplitPageLayout>
  );
};

export default ProcessingSandbox;
