// Page: PlotSandbox — visual builder for cardio plot configurations.
// Reads/writes: plot_configs table (GraphQL). Canvas shows axis grid layout.
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
  IonToggle,
} from '@ionic/react';
import ApiService from '../../services/Api';
import SplitPageLayout from '../../components/shell/SplitPageLayout';
import TabPanel from '../../components/shell/TabPanel';
import ResourcePanel from '../../components/shell/ResourcePanel';
import ModalShell from '../../components/shell/ModalShell';
import EmptyState from '../../components/shell/EmptyState';
import JsonViewer from '../../components/shell/JsonViewer';
import { CardioPlotConfig } from '../../interfaces/types';
import { AREA_NAV, PANEL_CONFIG } from '../../constants';


// ── Constants ─────────────────────────────────────────────────────────────────

const COLORMAP_OPTIONS = ['Blues', 'Reds', 'Greens', 'Oranges', 'Purples', 'Greys'];

const LEGEND_POSITION_OPTIONS = [
  'upper left', 'upper right', 'lower left', 'lower right',
  'upper center', 'lower center', 'center left', 'center right',
];

const BLANK_PLOT_CONFIG: Record<string, any> = {
  formatOptions: {
    nbins: 6,
    fonts: { title: 15, xlabel: 10, ylabel: 12, legend: 10, ticks: 9 },
    gases: {
      O2: { color: 'tab:blue', label: 'O2', name: 'Oxygen' },
      C2: { color: 'tab:red',  label: 'C2', name: 'Carbon Dioxide' },
      N2: { color: 'tab:green', label: 'N2', name: 'Nitrogen' },
    },
  },
  simulationParams: {
    runTime: 5, runsToIgnore: 1, runsToSave: 40,
    sampPeriod: 0.01, atmPressure: 760.0,
    control: false, calibration: false,
    modelFileName: '',
  },
  figSize: { width: 15, height: 30 },
  grid: { rows: 4, cols: 2 },
  axes: {},
};


// ── Local types ────────────────────────────────────────────────────────────────

interface AxisItem {
  id:          string;
  title:       string;
  row:         number;
  col:         number;
  rowSpan:     number;
  colSpan:     number;
  left:        string[];
  right:       string[];
  colorsLeft:  string;
  colorsRight: string;
}

interface AxisFormState {
  key:         string;
  title:       string;
  row:         string;
  col:         string;
  rowSpan:     string;
  colSpan:     string;
  left:        string;  // comma-separated
  right:       string;  // comma-separated
  colorsLeft:  string;
  colorsRight: string;
  zeroTime:    boolean;
  offset:      string;
  round:       string;
  legendShow:  boolean;
  legendLeft:  string;
  legendRight: string;
}

const BLANK_AXIS_FORM: AxisFormState = {
  key: '', title: '', row: '0', col: '0', rowSpan: '1', colSpan: '1',
  left: '', right: '', colorsLeft: 'Blues', colorsRight: 'Reds',
  zeroTime: true, offset: '0', round: '2',
  legendShow: true, legendLeft: 'upper left', legendRight: 'upper right',
};


// ── Component ─────────────────────────────────────────────────────────────────

const PlotSandbox: React.FC = () => {


/*
   ██████  ██████████    ████    ██████████  ████████
 ██            ██      ██    ██      ██      ██
   ████        ██      ████████      ██      ██████
       ██      ██      ██    ██      ██      ██
 ██████        ██      ██    ██      ██      ████████
                                                       */


  const [version, setVersion]               = useState(0);
  const [selectedConfig, setSelectedConfig] = useState<CardioPlotConfig | null>(null);
  const [workingConfig, setWorkingConfig]   = useState<Record<string, any> | null>(null);

  const [saving, setSaving]       = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const importInputRef                  = useRef<HTMLInputElement>(null);
  const [importError, setImportError]   = useState<string | null>(null);

  // New config modal
  const [newModalOpen, setNewModalOpen] = useState(false);
  const [newName, setNewName]           = useState('');
  const [newDesc, setNewDesc]           = useState('');
  const [newError, setNewError]         = useState<string | null>(null);

  // Add/edit axis modal
  const [axisModalOpen, setAxisModalOpen]   = useState(false);
  const [axisModalMode, setAxisModalMode]   = useState<'add' | 'edit'>('add');
  const [axisForm, setAxisForm]             = useState<AxisFormState>(BLANK_AXIS_FORM);
  const [editingAxisKey, setEditingAxisKey] = useState<string | null>(null);
  const [axisError, setAxisError]           = useState<string | null>(null);
  const [selectedAxis, setSelectedAxis]     = useState<string | null>(null);


/*
 ██          ████      ████    ██████
 ██        ██    ██  ██    ██  ██    ██
 ██        ██    ██  ████████  ██    ██
 ██        ██    ██  ██    ██  ██    ██
 ████████    ████    ██    ██  ██████
                                         */


  const fetchConfigs = useCallback(() => ApiService.getPlotConfigs(), []);

  useEffect(() => {
    setWorkingConfig(selectedConfig ? JSON.parse(JSON.stringify(selectedConfig.config)) : null);
    setSelectedAxis(null);
  }, [selectedConfig?.id]); // eslint-disable-line react-hooks/exhaustive-deps


/*
 ██    ██    ████    ██      ██  ██████    ██        ████████  ██████      ██████
 ██    ██  ██    ██  ████    ██  ██    ██  ██        ██        ██    ██  ██
 ████████  ████████  ██  ██  ██  ██    ██  ██        ██████    ██████      ████
 ██    ██  ██    ██  ██    ████  ██    ██  ██        ██        ██    ██        ██
 ██    ██  ██    ██  ██      ██  ██████    ████████  ████████  ██    ██  ██████
                                                                                   */


  // ── New config ─────────────────────────────────────────────────────────────

  const openNewModal = () => {
    setNewName('');
    setNewDesc('');
    setNewError(null);
    setNewModalOpen(true);
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) { setNewError('Name is required'); return; }
    setNewError(null);
    try {
      const created = await ApiService.createPlotConfig(name, newDesc.trim(), BLANK_PLOT_CONFIG);
      setSelectedConfig(created);
      setVersion(v => v + 1);
      setNewModalOpen(false);
    } catch (err: any) {
      setNewError(err.message ?? 'Failed to create');
    }
  };

  const handleDelete = async (cfg: CardioPlotConfig) => {
    await ApiService.deletePlotConfig(cfg.id);
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
      const created = await ApiService.createPlotConfig(name, '', json);
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
      const updated = await ApiService.updatePlotConfig(selectedConfig.id, { config: workingConfig });
      setSelectedConfig(updated);
    } catch (err: any) {
      setSaveError(err.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  // ── Add axis ───────────────────────────────────────────────────────────────

  const openAddAxisModal = () => {
    setAxisModalMode('add');
    setAxisForm(BLANK_AXIS_FORM);
    setAxisError(null);
    setAxisModalOpen(true);
  };

  const openEditAxisModal = (key: string) => {
    if (!workingConfig) return;
    const ax = workingConfig.axes?.[key];
    if (!ax) return;
    setSelectedAxis(key);
    setAxisModalMode('edit');
    setEditingAxisKey(key);
    setAxisForm({
      key,
      title:       ax.params?.title ?? '',
      row:         String(ax.row ?? 0),
      col:         String(ax.col ?? 0),
      rowSpan:     String(ax.rowSpan ?? 1),
      colSpan:     String(ax.colSpan ?? 1),
      left:        (ax.params?.left ?? []).join(', '),
      right:       (ax.params?.right ?? []).join(', '),
      colorsLeft:  ax.params?.colorsLeft  ?? 'Blues',
      colorsRight: ax.params?.colorsRight ?? 'Reds',
      zeroTime:    ax.options?.zeroTime ?? true,
      offset:      String(ax.options?.offset ?? 0),
      round:       String(ax.options?.round ?? 2),
      legendShow:  ax.options?.legend?.show ?? true,
      legendLeft:  ax.options?.legend?.left  ?? 'upper left',
      legendRight: ax.options?.legend?.right ?? 'upper right',
    });
    setAxisError(null);
    setAxisModalOpen(true);
  };

  const setField = (field: keyof AxisFormState, val: any) =>
    setAxisForm(prev => ({ ...prev, [field]: val }));

  const handleSubmitAxis = () => {
    const key = axisForm.key.trim();
    if (!key) { setAxisError('Key is required'); return; }

    const left  = axisForm.left.split(',').map(s => s.trim()).filter(Boolean);
    const right = axisForm.right.split(',').map(s => s.trim()).filter(Boolean);

    const axisData = {
      row:     parseInt(axisForm.row)     || 0,
      col:     parseInt(axisForm.col)     || 0,
      rowSpan: parseInt(axisForm.rowSpan) || 1,
      colSpan: parseInt(axisForm.colSpan) || 1,
      type:    'multiSideBySide',
      params: {
        left, right,
        title:       axisForm.title.trim(),
        colorsLeft:  axisForm.colorsLeft,
        colorsRight: axisForm.colorsRight,
      },
      options: {
        zeroTime:  axisForm.zeroTime,
        toIgnore:  0,
        offset:    parseFloat(axisForm.offset) || 0,
        round:     parseInt(axisForm.round)    || 2,
        legend: {
          show:  axisForm.legendShow,
          left:  axisForm.legendLeft,
          right: axisForm.legendRight,
        },
        ticks: {
          useCustomTicks: true, dependentScales: false,
          params: { averageLeft: false, minLeft: false, averageRight: false, minRight: true },
        },
      },
    };

    setWorkingConfig(prev => {
      if (!prev) return prev;
      const axes = { ...prev.axes };
      if (axisModalMode === 'edit' && editingAxisKey && editingAxisKey !== key) {
        delete axes[editingAxisKey];
      }
      axes[key] = axisData;
      return { ...prev, axes };
    });

    setSelectedAxis(key);
    setAxisModalOpen(false);
  };

  // ── Remove axis ────────────────────────────────────────────────────────────

  const handleRemoveAxis = (key: string) => {
    setWorkingConfig(prev => {
      if (!prev) return prev;
      const axes = { ...prev.axes };
      delete axes[key];
      return { ...prev, axes };
    });
    if (selectedAxis === key) setSelectedAxis(null);
  };

  // ── Simulation params ──────────────────────────────────────────────────────

  const setSimParam = (key: string, val: any) =>
    setWorkingConfig(prev => prev ? { ...prev, simulationParams: { ...prev.simulationParams, [key]: val } } : prev);

  const setGridDim = (key: 'rows' | 'cols', val: string) =>
    setWorkingConfig(prev => prev ? { ...prev, grid: { ...prev.grid, [key]: parseInt(val) || 1 } } : prev);

  // ── Download ───────────────────────────────────────────────────────────────

  const handleDownload = () => {
    if (!workingConfig || !selectedConfig) return;
    const blob = new Blob([jsonPreview], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `${selectedConfig.name}.json`; a.click();
    URL.revokeObjectURL(url);
  };


/*
 ██████    ████████  ██      ██  ██████    ████████  ██████
 ██    ██  ██        ████    ██  ██    ██  ██        ██    ██
 ██████    ██████    ██  ██  ██  ██    ██  ██████    ██████
 ██    ██  ██        ██    ████  ██    ██  ██        ██    ██
 ██    ██  ████████  ██      ██  ██████    ████████  ██    ██
                                                               */


  const axisItems: AxisItem[] = Object.entries(workingConfig?.axes ?? {}).map(([id, ax]) => ({
    id,
    title:       (ax as any).params?.title ?? '',
    row:         (ax as any).row     ?? 0,
    col:         (ax as any).col     ?? 0,
    rowSpan:     (ax as any).rowSpan ?? 1,
    colSpan:     (ax as any).colSpan ?? 1,
    left:        (ax as any).params?.left  ?? [],
    right:       (ax as any).params?.right ?? [],
    colorsLeft:  (ax as any).params?.colorsLeft  ?? 'Blues',
    colorsRight: (ax as any).params?.colorsRight ?? 'Reds',
  }));

  const gridRows  = workingConfig?.grid?.rows ?? 4;
  const gridCols  = workingConfig?.grid?.cols ?? 2;
  const jsonPreview = workingConfig ? JSON.stringify(workingConfig, null, 2) : '';
  const simParams   = workingConfig?.simulationParams ?? {};

  const builderContent = !workingConfig ? (
    <EmptyState message="Select or create a plot config to start building" />
  ) : (
    <IonGrid>
      <IonRow>
        {/* ── Axes list ── */}
        <IonCol size="4">
          <ResourcePanel<AxisItem>
            data={axisItems}
            config={PANEL_CONFIG.PLOT_AXES}
            selectedId={selectedAxis}
            getLabel={a => a.title || a.id}
            getSubLabel={a => `row ${a.row}, col ${a.col} · L:${a.left.length} R:${a.right.length}`}
            onSelect={a => openEditAxisModal(a.id)}
            onDelete={a => handleRemoveAxis(a.id)}
            onAdd={openAddAxisModal}
            collapsible
          />
        </IonCol>

        {/* ── Grid preview ── */}
        <IonCol size="4">
          <IonItem lines="full">
            <IonLabel style={{ fontWeight: 600, fontSize: '0.85rem' }}>Grid preview</IonLabel>
            <IonNote slot="end" style={{ fontSize: '0.75rem' }}>{gridRows}r × {gridCols}c</IonNote>
          </IonItem>
          <div style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${gridCols}, 1fr)`,
            gridTemplateRows: `repeat(${gridRows}, 48px)`,
            gap: 3,
            padding: 8,
            background: 'repeating-linear-gradient(transparent, transparent calc(48px + 3px), var(--ion-border-color) calc(48px + 3px), var(--ion-border-color) calc(48px + 4px))',
            border: '1px solid var(--ion-border-color)',
            borderRadius: 4,
            margin: '4px 0',
          }}>
            {axisItems.map(a => (
              <div
                key={a.id}
                onClick={() => openEditAxisModal(a.id)}
                style={{
                  gridColumn: `${a.col + 1} / span ${a.colSpan}`,
                  gridRow:    `${a.row + 1} / span ${a.rowSpan}`,
                  background: selectedAxis === a.id
                    ? 'var(--ion-color-primary)'
                    : 'var(--ion-color-primary-tint)',
                  color: selectedAxis === a.id
                    ? 'var(--ion-color-primary-contrast)'
                    : 'var(--ion-color-primary-shade)',
                  borderRadius: 3,
                  padding:      '3px 5px',
                  fontSize:     '0.65rem',
                  cursor:       'pointer',
                  overflow:     'hidden',
                  border:       '1px solid var(--ion-color-primary)',
                  display:      'flex',
                  alignItems:   'center',
                }}
              >
                {a.title || a.id}
              </div>
            ))}
          </div>
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

      {/* ── Grid dimension controls ── */}
      <IonRow>
        <IonCol size="4">
          <IonItem>
            <IonInput
              label="Grid rows" type="number" labelPlacement="stacked"
              value={String(gridRows)}
              onIonBlur={e => setGridDim('rows', (e.target as HTMLIonInputElement).value as string)}
            />
          </IonItem>
        </IonCol>
        <IonCol size="4">
          <IonItem>
            <IonInput
              label="Grid cols" type="number" labelPlacement="stacked"
              value={String(gridCols)}
              onIonBlur={e => setGridDim('cols', (e.target as HTMLIonInputElement).value as string)}
            />
          </IonItem>
        </IonCol>
      </IonRow>
    </IonGrid>
  );

  const simContent = !workingConfig ? (
    <EmptyState message="Select a plot config first" />
  ) : (
    <>
      <IonItem>
        <IonInput label="Model file name" labelPlacement="stacked"
          value={simParams.modelFileName ?? ''}
          onIonInput={e => setSimParam('modelFileName', e.detail.value ?? '')}
        />
      </IonItem>
      <IonItem>
        <IonInput label="Run time (s)" type="number" labelPlacement="stacked"
          value={String(simParams.runTime ?? 5)}
          onIonBlur={e => setSimParam('runTime', parseFloat((e.target as HTMLIonInputElement).value as string) || 5)}
        />
      </IonItem>
      <IonItem>
        <IonInput label="Runs to ignore" type="number" labelPlacement="stacked"
          value={String(simParams.runsToIgnore ?? 1)}
          onIonBlur={e => setSimParam('runsToIgnore', parseInt((e.target as HTMLIonInputElement).value as string) || 1)}
        />
      </IonItem>
      <IonItem>
        <IonInput label="Runs to save" type="number" labelPlacement="stacked"
          value={String(simParams.runsToSave ?? 40)}
          onIonBlur={e => setSimParam('runsToSave', parseInt((e.target as HTMLIonInputElement).value as string) || 40)}
        />
      </IonItem>
      <IonItem>
        <IonInput label="Sample period (s)" type="number" labelPlacement="stacked"
          value={String(simParams.sampPeriod ?? 0.01)}
          onIonBlur={e => setSimParam('sampPeriod', parseFloat((e.target as HTMLIonInputElement).value as string) || 0.01)}
        />
      </IonItem>
      <IonItem>
        <IonInput label="Atmospheric pressure (mmHg)" type="number" labelPlacement="stacked"
          value={String(simParams.atmPressure ?? 760)}
          onIonBlur={e => setSimParam('atmPressure', parseFloat((e.target as HTMLIonInputElement).value as string) || 760)}
        />
      </IonItem>
      <IonItem>
        <IonLabel>Control</IonLabel>
        <IonToggle checked={!!simParams.control} onIonChange={e => setSimParam('control', e.detail.checked)} />
      </IonItem>
      <IonItem>
        <IonLabel>Calibration</IonLabel>
        <IonToggle checked={!!simParams.calibration} onIonChange={e => setSimParam('calibration', e.detail.checked)} />
      </IonItem>
    </>
  );

  return (
    <SplitPageLayout
      navItems={AREA_NAV.PHYSIOLOGY}
      title="Plot Sandbox"
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
        label: 'Plot Configs',
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
              config={PANEL_CONFIG.PLOT_CONFIGS}
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
          { label: 'Builder',    content: builderContent },
          { label: 'Simulation', content: simContent     },
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
        title="New Plot Config"
        dismissLabel="Cancel"
      >
        {newError && <IonText color="danger" style={{ padding: '4px 16px', display: 'block' }}>{newError}</IonText>}
        <IonItem>
          <IonInput
            label="Name" labelPlacement="stacked" placeholder="My plot config"
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

      {/* ── Add / Edit axis modal ── */}
      <ModalShell
        isOpen={axisModalOpen}
        onDismiss={() => setAxisModalOpen(false)}
        title={axisModalMode === 'add' ? 'Add Axis' : 'Edit Axis'}
        dismissLabel="Cancel"
      >
        {axisError && <IonText color="danger" style={{ padding: '4px 16px', display: 'block' }}>{axisError}</IonText>}

        <IonItem>
          <IonInput label="Key (unique ID)" labelPlacement="stacked" placeholder="ax_0_0_Label"
            value={axisForm.key} disabled={axisModalMode === 'edit'}
            onIonInput={e => setField('key', e.detail.value ?? '')}
          />
        </IonItem>
        <IonItem>
          <IonInput label="Title" labelPlacement="stacked" placeholder="Heart Cycle"
            value={axisForm.title}
            onIonInput={e => setField('title', e.detail.value ?? '')}
          />
        </IonItem>

        <IonItem>
          <IonInput label="Row (0-indexed)" type="number" labelPlacement="stacked"
            value={axisForm.row}
            onIonInput={e => setField('row', e.detail.value ?? '0')}
          />
        </IonItem>
        <IonItem>
          <IonInput label="Col (0-indexed)" type="number" labelPlacement="stacked"
            value={axisForm.col}
            onIonInput={e => setField('col', e.detail.value ?? '0')}
          />
        </IonItem>
        <IonItem>
          <IonInput label="Row span" type="number" labelPlacement="stacked"
            value={axisForm.rowSpan}
            onIonInput={e => setField('rowSpan', e.detail.value ?? '1')}
          />
        </IonItem>
        <IonItem>
          <IonInput label="Col span" type="number" labelPlacement="stacked"
            value={axisForm.colSpan}
            onIonInput={e => setField('colSpan', e.detail.value ?? '1')}
          />
        </IonItem>

        <IonItem>
          <IonInput label="Left variables (comma-separated)" labelPlacement="stacked"
            placeholder="P_As, avg_P_As"
            value={axisForm.left}
            onIonInput={e => setField('left', e.detail.value ?? '')}
          />
        </IonItem>
        <IonItem>
          <IonInput label="Right variables (comma-separated)" labelPlacement="stacked"
            placeholder="Q_Hl_As"
            value={axisForm.right}
            onIonInput={e => setField('right', e.detail.value ?? '')}
          />
        </IonItem>

        <IonItem>
          <IonSelect label="Colors left" labelPlacement="stacked"
            value={axisForm.colorsLeft}
            onIonChange={e => setField('colorsLeft', e.detail.value)}
          >
            {COLORMAP_OPTIONS.map(c => <IonSelectOption key={c} value={c}>{c}</IonSelectOption>)}
          </IonSelect>
        </IonItem>
        <IonItem>
          <IonSelect label="Colors right" labelPlacement="stacked"
            value={axisForm.colorsRight}
            onIonChange={e => setField('colorsRight', e.detail.value)}
          >
            {COLORMAP_OPTIONS.map(c => <IonSelectOption key={c} value={c}>{c}</IonSelectOption>)}
          </IonSelect>
        </IonItem>

        <IonItem>
          <IonLabel>Zero time</IonLabel>
          <IonToggle checked={axisForm.zeroTime} onIonChange={e => setField('zeroTime', e.detail.checked)} />
        </IonItem>
        <IonItem>
          <IonInput label="Offset" type="number" labelPlacement="stacked"
            value={axisForm.offset}
            onIonInput={e => setField('offset', e.detail.value ?? '0')}
          />
        </IonItem>
        <IonItem>
          <IonInput label="Round (decimal places)" type="number" labelPlacement="stacked"
            value={axisForm.round}
            onIonInput={e => setField('round', e.detail.value ?? '2')}
          />
        </IonItem>

        <IonItem>
          <IonLabel>Show legend</IonLabel>
          <IonToggle checked={axisForm.legendShow} onIonChange={e => setField('legendShow', e.detail.checked)} />
        </IonItem>
        <IonItem>
          <IonSelect label="Legend left position" labelPlacement="stacked"
            value={axisForm.legendLeft}
            onIonChange={e => setField('legendLeft', e.detail.value)}
          >
            {LEGEND_POSITION_OPTIONS.map(p => <IonSelectOption key={p} value={p}>{p}</IonSelectOption>)}
          </IonSelect>
        </IonItem>
        <IonItem>
          <IonSelect label="Legend right position" labelPlacement="stacked"
            value={axisForm.legendRight}
            onIonChange={e => setField('legendRight', e.detail.value)}
          >
            {LEGEND_POSITION_OPTIONS.map(p => <IonSelectOption key={p} value={p}>{p}</IonSelectOption>)}
          </IonSelect>
        </IonItem>

        <div style={{ padding: '8px 16px' }}>
          <IonButton expand="block" onClick={handleSubmitAxis}>
            {axisModalMode === 'add' ? 'Add' : 'Save'}
          </IonButton>
        </div>
      </ModalShell>
    </SplitPageLayout>
  );
};

export default PlotSandbox;
