// Page: ScenarioSandbox — editor for the VALUES half of a simulation run.
// Reads/writes: scenario_configs table (GraphQL). A scenario carries the twin
// targets, the integration numerics and the baseline/calibration/control stage
// stacks that python/library/run/runner.buildSimulationParams reads.
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
  IonTextarea,
  IonToggle,
} from '@ionic/react';
import ApiService from '../../services/Api';
import SplitPageLayout from '../../components/shell/SplitPageLayout';
import TabPanel from '../../components/shell/TabPanel';
import ResourcePanel from '../../components/shell/ResourcePanel';
import ModalShell from '../../components/shell/ModalShell';
import EmptyState from '../../components/shell/EmptyState';
import JsonViewer from '../../components/shell/JsonViewer';
import FormRenderer from '../../components/forms/FormRenderer';
import { ComponentResults, ScenarioConfig } from '../../interfaces/types';
import { AREA_NAV, FORM_ID, PANEL_CONFIG } from '../../constants';


// ── Constants ─────────────────────────────────────────────────────────────────

// The sections a scenario may declare. A run mode is only offered in the
// Simulator when its section exists, so "which sections does this scenario have"
// is the page's central fact.
const STAGE_SECTIONS = ['calibration', 'control'] as const;
type StageSection = typeof STAGE_SECTIONS[number];

const SOLVER_TYPES = ['euler', 'rk4', 'adaptive'];

// Mirrors python/config/scenarios/smoketest.json — the smallest scenario the
// model stack accepts. buildSimulationParams reads every key under
// shared.integration without a fallback, so a blank scenario must carry them all.
const BLANK_SCENARIO: Record<string, any> = {
  shared: {
    twin: {
      twinTargets: {
        TotalBloodVolume: 5000.0,
        Sys_P_As: 120.0, Dia_P_As: 80.0,
        Sys_P_Ap: 30.0,  Dia_P_Ap: 15.0,
        CVP: 5.0, HR: 70.0, CO: 5000.0,
      },
      volumeDistribution: {},
      flowDistribution: {},
    },
    integration: {
      dt: 0.00025,
      dtDense: 0.01,
      runTime: 10,
      gasExchange: false,
      useEquilibriumStates: true,
      solver: { type: 'euler', rtol: 1e-6, atol: 1e-9, maxSteps: 8192 },
    },
  },
  baseline: { runs: { ignore: 1, save: 20 } },
  calibration: { strategy: 'staged', stages: [] },
};

const BLANK_STAGE = {
  description: '',
  runsToIgnore: 0,
  runsToSave: 10,
  multiplier: 0.0,
  multiplierC: 0.0,
  parameters: [] as string[],
};


/*
 ██    ██  ████████  ██        ██████    ████████  ██████      ██████
 ██    ██  ██        ██        ██    ██  ██        ██    ██  ██
 ████████  ██████    ██        ██████    ██████    ██████      ████
 ██    ██  ██        ██        ██        ██        ██    ██        ██
 ██    ██  ████████  ████████  ██        ████████  ██    ██  ██████
                                                                       */


// Set a dot-path on a cloned object, creating intermediate objects as needed.
// Every editor field in this page writes through here, so a scenario the model
// stack has not seen before is still editable without a schema.
const setPath = (obj: Record<string, any>, path: string, value: any): Record<string, any> => {
  const next = JSON.parse(JSON.stringify(obj));
  const keys = path.split('.');
  let cursor = next;
  for (const key of keys.slice(0, -1)) {
    if (typeof cursor[key] !== 'object' || cursor[key] === null) cursor[key] = {};
    cursor = cursor[key];
  }
  cursor[keys[keys.length - 1]] = value;
  return next;
};

const getPath = (obj: Record<string, any> | null, path: string): any =>
  path.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), obj as any);

// A numeric field that keeps an in-progress edit ("0.00" while typing "0.00025")
// intact: only a parseable value is written back into the scenario.
const numberOrKeep = (raw: string | null | undefined, fallback: number): number => {
  const parsed = Number(raw);
  return raw !== null && raw !== undefined && raw !== '' && !Number.isNaN(parsed)
    ? parsed : fallback;
};


// ── Component ─────────────────────────────────────────────────────────────────

const ScenarioSandbox: React.FC = () => {


/*
   ██████  ██████████    ████    ██████████  ████████
 ██            ██      ██    ██      ██      ██
   ████        ██      ████████      ██      ██████
       ██      ██      ██    ██      ██      ██
 ██████        ██      ██    ██      ██      ████████
                                                       */


  const [version, setVersion]                 = useState(0);
  const [selectedConfig, setSelectedConfig]   = useState<ScenarioConfig | null>(null);
  const [workingScenario, setWorkingScenario] = useState<Record<string, any> | null>(null);

  const [saving, setSaving]       = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const importInputRef                = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);

  // New scenario modal
  const [newModalOpen, setNewModalOpen] = useState(false);
  const [newForm, setNewForm]           = useState<ComponentResults | null>(null);
  const [newError, setNewError]         = useState<string | null>(null);

  // Stage editing
  const [stageSection, setStageSection]     = useState<StageSection>('calibration');
  const [selectedStage, setSelectedStage]   = useState<number | null>(null);
  const [stageModalOpen, setStageModalOpen] = useState(false);
  const [stageModalMode, setStageModalMode] = useState<'add' | 'edit'>('add');
  const [stageDraft, setStageDraft]         = useState<Record<string, any>>(BLANK_STAGE);
  const [stageParamsText, setStageParamsText] = useState('');
  const [stageError, setStageError]         = useState<string | null>(null);


/*
 ██          ████      ████    ██████
 ██        ██    ██  ██    ██  ██    ██
 ██        ██    ██  ████████  ██    ██
 ██        ██    ██  ██    ██  ██    ██
 ████████    ████    ██    ██  ██████
                                         */


  const fetchConfigs = useCallback(() => ApiService.getScenarioConfigs(), []);

  useEffect(() => {
    setWorkingScenario(selectedConfig ? JSON.parse(JSON.stringify(selectedConfig.config)) : null);
    setSelectedStage(null);
  }, [selectedConfig?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    ApiService.getComponentByName(FORM_ID.ADD_SCENARIO_CONFIG).then(f => setNewForm(f ?? null));
  }, []);


/*
 ██    ██    ████    ██      ██  ██████    ██        ████████  ██████      ██████
 ██    ██  ██    ██  ████    ██  ██    ██  ██        ██        ██    ██  ██
 ████████  ████████  ██  ██  ██  ██    ██  ██        ██████    ██████      ████
 ██    ██  ██    ██  ██    ████  ██    ██  ██        ██        ██    ██        ██
 ██    ██  ██    ██  ██      ██  ██████    ████████  ████████  ██    ██  ██████
                                                                                   */


  // ── New scenario ───────────────────────────────────────────────────────────

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
      const created = await ApiService.createScenarioConfig(name, desc, BLANK_SCENARIO);
      setSelectedConfig(created);
      setVersion(v => v + 1);
      setNewModalOpen(false);
    } catch (err: any) {
      setNewError(err.message ?? 'Failed to create');
    }
  };

  const handleDelete = async (cfg: ScenarioConfig) => {
    await ApiService.deleteScenarioConfig(cfg.id);
    if (selectedConfig?.id === cfg.id) setSelectedConfig(null);
    setVersion(v => v + 1);
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setImportError(null);
    try {
      const json = JSON.parse(await file.text());
      const name = file.name.replace(/\.json$/i, '');
      const created = await ApiService.createScenarioConfig(name, '', json);
      setSelectedConfig(created);
      setVersion(v => v + 1);
    } catch (err) {
      setImportError((err as Error).message);
    }
  };

  const handleSave = async () => {
    if (!selectedConfig || !workingScenario) return;
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await ApiService.updateScenarioConfig(selectedConfig.id, { config: workingScenario });
      setSelectedConfig(saved);
      setVersion(v => v + 1);
    } catch (err: any) {
      setSaveError(err.message ?? 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  // ── Field editing ──────────────────────────────────────────────────────────

  const setField = (path: string, value: any) =>
    setWorkingScenario(prev => (prev ? setPath(prev, path, value) : prev));

  // Twin targets / distributions are open-ended maps: the model stack reads them
  // by name (progress.obsTargetArrays, stateSetup), so the page edits whatever
  // keys a scenario happens to carry rather than a fixed field list.
  const setMapEntry = (mapPath: string, key: string, value: number) =>
    setField(`${mapPath}.${key}`, value);

  const removeMapEntry = (mapPath: string, key: string) =>
    setWorkingScenario(prev => {
      if (!prev) return prev;
      const map = { ...(getPath(prev, mapPath) ?? {}) };
      delete map[key];
      return setPath(prev, mapPath, map);
    });

  // ── Stages ─────────────────────────────────────────────────────────────────

  const stages: any[] = getPath(workingScenario, `${stageSection}.stages`) ?? [];

  const fetchStages = useCallback(
    () => Promise.resolve(
      stages.map((s, i) => ({ ...s, id: String(i), index: i })),
    ),
    [stages],
  );

  const openStageModal = (mode: 'add' | 'edit', index?: number) => {
    const draft = mode === 'edit' && index !== undefined
      ? JSON.parse(JSON.stringify(stages[index]))
      : { ...BLANK_STAGE };
    setStageModalMode(mode);
    setSelectedStage(index ?? null);
    setStageDraft(draft);
    setStageParamsText((draft.parameters ?? []).join('\n'));
    setStageError(null);
    setStageModalOpen(true);
  };

  const commitStage = () => {
    const parameters = stageParamsText
      .split('\n').map(s => s.trim()).filter(Boolean);
    const stage: Record<string, any> = { ...stageDraft, parameters };
    if (!stage.description) { setStageError('Description is required'); return; }
    const next = [...stages];
    if (stageModalMode === 'add') next.push(stage);
    else if (selectedStage !== null) next[selectedStage] = stage;
    setField(`${stageSection}.stages`, next);
    setStageModalOpen(false);
  };

  const deleteStage = (index: number) => {
    setField(`${stageSection}.stages`, stages.filter((_, i) => i !== index));
    setSelectedStage(null);
  };


/*
 ██████    ████████  ██      ██  ██████    ████████  ██████
 ██    ██  ██        ████    ██  ██    ██  ██        ██    ██
 ██████    ██████    ██  ██  ██  ██    ██  ██████    ██████
 ██    ██  ██        ██    ████  ██    ██  ██        ██    ██
 ██    ██  ████████  ██      ██  ██████    ████████  ██    ██
                                                               */


  const noSelection = (
    <EmptyState message="Select a scenario to edit its targets, numerics and stages." />
  );

  // A numeric row bound to a dot-path in the working scenario.
  const numberRow = (label: string, path: string, note?: string) => {
    const current = getPath(workingScenario, path);
    return (
      <IonItem key={path}>
        <IonInput
          label={label}
          labelPlacement="stacked"
          type="number"
          value={current ?? ''}
          onIonInput={e => setField(path, numberOrKeep(e.detail.value, current ?? 0))}
        />
        {note && <IonNote slot="end">{note}</IonNote>}
      </IonItem>
    );
  };

  const mapEditor = (title: string, mapPath: string) => {
    const map: Record<string, number> = getPath(workingScenario, mapPath) ?? {};
    const entries = Object.entries(map);
    return (
      <>
        <IonItem lines="none">
          <IonLabel><strong>{title}</strong></IonLabel>
          <IonNote slot="end">{entries.length} entries</IonNote>
        </IonItem>
        {entries.length === 0 && (
          <IonItem lines="none"><IonNote>None declared.</IonNote></IonItem>
        )}
        <IonGrid>
          {entries.map(([key, value]) => (
            <IonRow key={key} className="ion-align-items-center">
              <IonCol size="6">
                <IonItem lines="none"><IonLabel>{key}</IonLabel></IonItem>
              </IonCol>
              <IonCol size="4">
                <IonItem lines="none">
                  <IonInput
                    type="number"
                    value={value}
                    onIonInput={e => setMapEntry(mapPath, key, numberOrKeep(e.detail.value, value))}
                  />
                </IonItem>
              </IonCol>
              <IonCol size="2">
                <IonButton size="small" fill="clear" color="danger"
                           onClick={() => removeMapEntry(mapPath, key)}>
                  Remove
                </IonButton>
              </IonCol>
            </IonRow>
          ))}
        </IonGrid>
      </>
    );
  };

  // ── Twin ───────────────────────────────────────────────────────────────────

  const twinContent = !workingScenario ? noSelection : (
    <>
      <IonItem lines="none">
        <IonNote>
          Twin targets are the physiological set-points a calibration drives the model
          onto; the distributions seed the initial state (TBV × volumeDistribution).
        </IonNote>
      </IonItem>
      {mapEditor('Twin targets',        'shared.twin.twinTargets')}
      {mapEditor('Volume distribution', 'shared.twin.volumeDistribution')}
      {mapEditor('Flow distribution',   'shared.twin.flowDistribution')}
    </>
  );

  // ── Integration ────────────────────────────────────────────────────────────

  const integrationContent = !workingScenario ? noSelection : (
    <>
      {numberRow('Integrator step (dt)',   'shared.integration.dt',      's')}
      {numberRow('Output grid (dtDense)',  'shared.integration.dtDense', 's')}
      {numberRow('Run time',               'shared.integration.runTime', 's')}
      <IonItem>
        <IonLabel>Gas exchange</IonLabel>
        <IonToggle
          checked={!!getPath(workingScenario, 'shared.integration.gasExchange')}
          onIonChange={e => setField('shared.integration.gasExchange', e.detail.checked)}
        />
      </IonItem>
      <IonItem>
        <IonLabel>Equilibrium initial states</IonLabel>
        <IonToggle
          checked={!!getPath(workingScenario, 'shared.integration.useEquilibriumStates')}
          onIonChange={e => setField('shared.integration.useEquilibriumStates', e.detail.checked)}
        />
      </IonItem>
      <IonItem>
        <IonSelect
          label="Solver" labelPlacement="stacked"
          value={getPath(workingScenario, 'shared.integration.solver.type') ?? 'euler'}
          onIonChange={e => setField('shared.integration.solver.type', e.detail.value)}
        >
          {SOLVER_TYPES.map(t => <IonSelectOption key={t} value={t}>{t}</IonSelectOption>)}
        </IonSelect>
      </IonItem>
      <IonItem lines="none">
        <IonNote>
          euler and rk4 are fixed-step; adaptive needs the SI stack. Only the SI stack
          honours this choice — the legacy stack is diffrax.Euler regardless.
        </IonNote>
      </IonItem>
      {numberRow('Relative tolerance', 'shared.integration.solver.rtol')}
      {numberRow('Absolute tolerance', 'shared.integration.solver.atol')}
      {numberRow('Max steps',          'shared.integration.solver.maxSteps')}
      <IonItem lines="none">
        <IonLabel><strong>Baseline runs</strong></IonLabel>
      </IonItem>
      {numberRow('Runs to ignore', 'baseline.runs.ignore')}
      {numberRow('Runs to save',   'baseline.runs.save')}
    </>
  );

  // ── Stages ─────────────────────────────────────────────────────────────────

  const stagesContent = !workingScenario ? noSelection : (
    <>
      <IonItem>
        <IonSelect
          label="Section" labelPlacement="stacked"
          value={stageSection}
          onIonChange={e => { setStageSection(e.detail.value); setSelectedStage(null); }}
        >
          {STAGE_SECTIONS.map(s => <IonSelectOption key={s} value={s}>{s}</IonSelectOption>)}
        </IonSelect>
      </IonItem>
      {!getPath(workingScenario, stageSection) && (
        <IonItem lines="none">
          <IonNote>
            This scenario declares no {stageSection} section, so the Simulator will not
            offer {stageSection} mode. Adding a stage creates the section.
          </IonNote>
        </IonItem>
      )}
      {stageError && (
        <IonText color="danger" style={{ fontSize: '0.75rem', padding: '4px 8px', display: 'block' }}>
          {stageError}
        </IonText>
      )}
      <ResourcePanel<any>
        fetcher={fetchStages}
        refreshToken={`${stageSection}:${stages.length}:${JSON.stringify(stages).length}`}
        config={PANEL_CONFIG.SCENARIO_STAGES}
        selectedId={selectedStage !== null ? String(selectedStage) : undefined}
        getLabel={s => s.description || `Stage ${s.index + 1}`}
        getSubLabel={s => `${(s.parameters ?? []).length} parameters · ignore ${s.runsToIgnore} · save ${s.runsToSave}`}
        onSelect={s => openStageModal('edit', s.index)}
        onDelete={s => deleteStage(s.index)}
        onAdd={() => openStageModal('add')}
      />
    </>
  );

  // ── Preview ────────────────────────────────────────────────────────────────

  const jsonContent = !workingScenario ? noSelection : (
    <JsonViewer value={workingScenario} initialDepth={2} />
  );

  return (
    <SplitPageLayout
      navItems={AREA_NAV.PHYSIOLOGY}
      title="Scenario Sandbox"
      rightHeader={
        selectedConfig && workingScenario ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px' }}>
            {saveError && <IonText color="danger" style={{ fontSize: '0.8rem' }}>{saveError}</IonText>}
            <IonButton size="small" disabled={saving} onClick={handleSave}>
              {saving ? <IonSpinner name="dots" /> : 'Save'}
            </IonButton>
          </div>
        ) : undefined
      }
      leftTabs={[{
        label: 'Scenarios',
        actions: (
          <IonButton size="small" color="medium" onClick={() => importInputRef.current?.click()}>
            Import
          </IonButton>
        ),
        content: (
          <>
            {importError && (
              <IonText color="danger" style={{ fontSize: '0.75rem', padding: '4px 8px', display: 'block' }}>
                {importError}
              </IonText>
            )}
            <ResourcePanel
              fetcher={fetchConfigs}
              refreshToken={String(version)}
              config={PANEL_CONFIG.SCENARIO_CONFIGS}
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
          { label: 'Twin',        content: twinContent        },
          { label: 'Integration', content: integrationContent },
          { label: 'Stages',      content: stagesContent      },
          { label: 'JSON',        content: jsonContent        },
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
      {/* ═══════════════════════════════════════════════════════════
           Modals                                                     */}
      <ModalShell
        isOpen={newModalOpen}
        onDismiss={() => setNewModalOpen(false)}
        title="New Scenario"
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

      <ModalShell
        isOpen={stageModalOpen}
        onDismiss={() => setStageModalOpen(false)}
        title={stageModalMode === 'add' ? `Add ${stageSection} stage` : `Edit ${stageSection} stage`}
        dismissLabel="Cancel"
      >
        {stageError && <IonText color="danger" style={{ padding: '4px 16px', display: 'block' }}>{stageError}</IonText>}
        <IonItem>
          <IonInput
            label="Description" labelPlacement="stacked"
            placeholder="What this stage does"
            value={stageDraft.description}
            onIonInput={e => setStageDraft(d => ({ ...d, description: e.detail.value ?? '' }))}
          />
        </IonItem>
        <IonItem>
          <IonInput
            label="Runs to ignore" labelPlacement="stacked" type="number"
            value={stageDraft.runsToIgnore}
            onIonInput={e => setStageDraft(d => ({ ...d, runsToIgnore: numberOrKeep(e.detail.value, d.runsToIgnore) }))}
          />
        </IonItem>
        <IonItem>
          <IonInput
            label="Runs to save" labelPlacement="stacked" type="number"
            value={stageDraft.runsToSave}
            onIonInput={e => setStageDraft(d => ({ ...d, runsToSave: numberOrKeep(e.detail.value, d.runsToSave) }))}
          />
        </IonItem>
        <IonItem>
          <IonInput
            label="Linear gain (multiplier)" labelPlacement="stacked" type="number"
            value={stageDraft.multiplier}
            onIonInput={e => setStageDraft(d => ({ ...d, multiplier: numberOrKeep(e.detail.value, d.multiplier) }))}
          />
        </IonItem>
        <IonItem>
          <IonInput
            label="Cubic gain (multiplierC)" labelPlacement="stacked" type="number"
            value={stageDraft.multiplierC}
            onIonInput={e => setStageDraft(d => ({ ...d, multiplierC: numberOrKeep(e.detail.value, d.multiplierC) }))}
          />
        </IonItem>
        <IonItem>
          <IonTextarea
            label="Parameters (one per line)" labelPlacement="stacked"
            autoGrow rows={8}
            placeholder={'C_Vs\nR_As_Cs\nE_Hl'}
            value={stageParamsText}
            onIonInput={e => setStageParamsText(e.detail.value ?? '')}
          />
        </IonItem>
        <IonItem lines="none">
          <IonNote>
            Parameter names are the model's calibration controllers — they must exist in
            the model config's `calibration` block for this stage to drive them.
          </IonNote>
        </IonItem>
        <div style={{ padding: '8px 16px' }}>
          <IonButton expand="block" onClick={commitStage}>
            {stageModalMode === 'add' ? 'Add stage' : 'Save stage'}
          </IonButton>
        </div>
      </ModalShell>
    </SplitPageLayout>
  );
};

export default ScenarioSandbox;
