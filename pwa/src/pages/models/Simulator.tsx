// Page: Cardio-pulmonary simulation — run management and results.
// Reads/writes: model_runs table (GraphQL + REST proxy to Python).
// Authenticated (private route).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  IonButton,
  IonIcon,
  IonInput,
  IonItem,
  IonLabel,
  IonNote,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonText,
} from '@ionic/react';
import { chevronDownOutline, chevronForwardOutline } from 'ionicons/icons';
import EChart from '../../components/charts/EChart';
import type { EChartsOption, LineSeriesOption } from 'echarts';
import ApiService from '../../services/Api';
import SplitPageLayout from '../../components/shell/SplitPageLayout';
import TabPanel from '../../components/shell/TabPanel';
import ResourcePanel from '../../components/shell/ResourcePanel';
import EmptyState from '../../components/shell/EmptyState';
import ModalShell from '../../components/shell/ModalShell';
import { useTheme } from '../../contexts/ThemeContext';
import {
  ModelConfig, ScenarioConfig, RunMode, ModelRun, CardioSummary, CardioSignals, CardioProgress,
  CardioLogLine, CardioPlotConfig, CardioProcConfig,
} from '../../interfaces/types';
import { AREA_NAV, ECHARTS_PALETTE, PANEL_CONFIG } from '../../constants';


const STATUS_COLOR: Record<string, string> = {
  pending: 'medium',
  running: 'warning',
  done:    'success',
  error:   'danger',
};

// Run modes, and the scenario section each one needs. buildSimulationParams reads
// that section directly, so offering a mode a scenario does not declare would fail
// inside the solver rather than here.
const RUN_MODES: { mode: RunMode; section: string; label: string }[] = [
  { mode: 'baseline',    section: 'baseline',    label: 'Baseline — one passive solve' },
  { mode: 'calibration', section: 'calibration', label: 'Calibration — fit to twin targets' },
  { mode: 'control',     section: 'control',     label: 'Control — active ANS stage stack' },
];

// Numeric overrides are opt-in: an empty field is omitted from the request so the
// scenario's own shared.integration value stands.
const OVERRIDE_FIELDS: { key: string; label: string; note: string }[] = [
  { key: 'runTime', label: 'Run time',          note: 'simulated seconds per internal run' },
  { key: 'dt',      label: 'Integrator step',   note: 'seconds' },
  { key: 'dtDense', label: 'Output grid',       note: 'seconds between saved samples' },
];

const Simulator: React.FC = () => {


/*
   ██████  ██████████    ████    ██████████  ████████
 ██            ██      ██    ██      ██      ██
   ████        ██      ████████      ██      ██████
       ██      ██      ██    ██      ██      ██
 ██████        ██      ██    ██      ██      ████████
                                                       */


  const { theme } = useTheme();

  const [runVersion, setRunVersion] = useState(0);
  const [rightTab, setRightTab]     = useState(0); // 0=results 1=plots 2=process

  const [selectedRun, setSelectedRun] = useState<ModelRun | null>(null);

  // Run picker modal — a run is model + scenario + mode
  const [pickerOpen, setPickerOpen]         = useState(false);
  const [pickerVersion, setPickerVersion]   = useState(0);
  const [pickerSelected, setPickerSelected] = useState<ModelConfig | null>(null);
  const [pickerScenario, setPickerScenario] = useState<ScenarioConfig | null>(null);
  const [pickerMode, setPickerMode]         = useState<RunMode>('baseline');
  const [overrides, setOverrides]           = useState<Record<string, string>>({});
  const [runName, setRunName]               = useState('');
  const [running, setRunning]               = useState(false);

  // Polling
  const [pollingJobId, setPollingJobId] = useState<string | null>(null);
  const [progress, setProgress]         = useState<CardioProgress[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Console — everything the Python service printed for the selected run, plus its
  // traceback if it failed. Live from the job registry while a run is polling; read
  // back off model_runs.metadata for a run picked from the list.
  const [logs, setLogs]                 = useState<CardioLogLine[]>([]);
  const [consoleError, setConsoleError] = useState<string | null>(null);
  const [logsOpen, setLogsOpen]         = useState(false);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  // Results — a summary of the selected run; selecting a run loads no signal data
  const [summary, setSummary]         = useState<CardioSummary | null>(null);
  const [resultError, setResultError] = useState<string | null>(null);

  // Plots — signals are fetched only on Load, once a plot config AND a data layer are
  // chosen: only the names that plot references, over the chosen window and rate
  const [plotConfigs, setPlotConfigs]               = useState<CardioPlotConfig[]>([]);
  const [selectedPlotConfig, setSelectedPlotConfig] = useState<CardioPlotConfig | null>(null);
  const [selectedLayer, setSelectedLayer]           = useState<string | null>(null); // 'raw' | processed group
  const [plotData, setPlotData]                     = useState<CardioSignals | null>(null);
  const [loadingPlotData, setLoadingPlotData]       = useState(false);
  const [plotError, setPlotError]                   = useState<string | null>(null);
  const [plotFrom, setPlotFrom]                     = useState('');   // s from start; '' = start of file
  const [plotTo, setPlotTo]                         = useState('');   // s from start; '' = end of file
  const [plotRate, setPlotRate]                     = useState('10'); // Hz
  const plotRequestRef = useRef(0);

  // Post-processing
  const [procConfigs, setProcConfigs]                 = useState<CardioProcConfig[]>([]);
  const [procGroupNames, setProcGroupNames]           = useState<string[]>([]);
  const [selectedProcForRun, setSelectedProcForRun]   = useState<CardioProcConfig | null>(null);
  const [procRunName, setProcRunName]                 = useState('');
  const [processingState, setProcessingState]         = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [processingError, setProcessingError]         = useState<string | null>(null);


/*
 ██          ████      ████    ██████
 ██        ██    ██  ██    ██  ██    ██
 ██        ██    ██  ████████  ██    ██
 ██        ██    ██  ██    ██  ██    ██
 ████████    ████    ██    ██  ██████
                                         */


  // Stop polling when component unmounts
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  // Fetch plot and proc configs once on mount
  useEffect(() => {
    Promise.all([ApiService.getPlotConfigs(), ApiService.getProcConfigs()])
      .then(([plots, procs]) => { setPlotConfigs(plots); setProcConfigs(procs); });
  }, []);

  // Tail the console: keep the newest line in view while a run streams into it.
  useEffect(() => {
    if (logsOpen) logEndRef.current?.scrollIntoView({ block: 'nearest' });
  }, [logs, logsOpen]);

  // Loaded plot data belongs to one run + plot + layer: drop it (and orphan any
  // request still in flight) when one of them changes. Nothing is refetched here —
  // that only happens on Load.
  useEffect(() => {
    plotRequestRef.current += 1;
    setPlotData(null);
    setPlotError(null);
    setLoadingPlotData(false);
  }, [selectedRun, selectedPlotConfig, selectedLayer]);

  const fetchRuns = useCallback(() => ApiService.getModelRuns(), []);


/*
 ██    ██    ████    ██      ██  ██████    ██        ████████  ██████      ██████
 ██    ██  ██    ██  ████    ██  ██    ██  ██        ██        ██    ██  ██
 ████████  ████████  ██  ██  ██  ██    ██  ██        ██████    ██████      ████
 ██    ██  ██    ██  ██    ████  ██    ██  ██        ██        ██    ██        ██
 ██    ██  ██    ██  ██      ██  ██████    ████████  ████████  ██    ██  ██████
                                                                                   */


  const handleDeleteRun = async (run: ModelRun) => {
    await ApiService.deleteModelRun(run.id);
    if (selectedRun?.id === run.id) { setSelectedRun(null); setSummary(null); }
    setRunVersion(v => v + 1);
  };

  const startPolling = (jobId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const status = await ApiService.getCardioStatus(jobId);
        // A calibration reports its convergence trace while it runs (the model
        // stack's ProgressReporter); every other run reports an empty list.
        setProgress(status.progress ?? []);
        setLogs(status.logs ?? []);
        if (status.status === 'done' || status.status === 'error') {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setPollingJobId(null);
          setRunVersion(v => v + 1);
          setRightTab(0);
          if (status.status === 'error') {
            // Python stores the whole traceback on the job; showing it is the only
            // way a caller learns why a solve died.
            setConsoleError(status.error ?? 'The run failed without reporting a reason.');
            setLogsOpen(true);
          }
        }
      } catch { /* network hiccup — keep polling */ }
    }, 2000);
  };

  const loadSummary = async (run: ModelRun) => {
    setSummary(null);
    setResultError(null);
    try {
      const res = await ApiService.getCardioSummary(run.id);
      setSummary(res);
      setProcGroupNames(res.layers);
    } catch (err: any) {
      setResultError(err.message ?? 'Failed to load run summary');
    }
  };

  const executeRun = async (
    cfg: ModelConfig | null,
    scenario: ScenarioConfig | null,
    mode: RunMode,
    params: Record<string, any>,
    name: string,
  ) => {
    setRunning(true);
    setSummary(null);
    setProgress([]);
    setLogs([]);
    setConsoleError(null);
    setLogsOpen(false);
    try {
      const modelJson = cfg?.config ?? {};
      const { job_id } = await ApiService.runCardioModel(
        cfg?.id ?? null, modelJson, scenario?.id ?? null, mode, params, name || undefined,
      );
      setPollingJobId(job_id);
      setRunVersion(v => v + 1);
      startPolling(job_id);
    } catch (err: any) {
      const message = err.response?.data?.error ?? err.message ?? 'Run failed';
      setResultError(message);
      setConsoleError(message);
      setLogsOpen(true);
      setRightTab(0);
    } finally {
      setRunning(false);
    }
  };

  const openPicker = () => {
    setPickerSelected(null);
    setPickerScenario(null);
    setPickerMode('baseline');
    setOverrides({});
    setRunName('');
    setPickerOpen(true);
    setPickerVersion(v => v + 1);
  };

  // Only the modes the chosen scenario declares a section for.
  const availableModes = RUN_MODES.filter(m => {
    const section = (pickerScenario?.config ?? {})[m.section];
    if (!section) return false;
    return m.mode === 'baseline' ? true : Array.isArray(section.stages) && section.stages.length > 0;
  });

  const handlePickerConfirm = () => {
    if (!pickerSelected || !pickerScenario) return;
    const params: Record<string, any> = {};
    for (const { key } of OVERRIDE_FIELDS) {
      const raw = overrides[key];
      if (raw !== undefined && raw !== '' && !Number.isNaN(Number(raw))) params[key] = Number(raw);
    }
    setPickerOpen(false);
    executeRun(pickerSelected, pickerScenario, pickerMode, params, runName);
  };

  const resetProcState = () => {
    setProcGroupNames([]);
    setSelectedProcForRun(null);
    setProcRunName('');
    setSelectedLayer(null);
    setProcessingState('idle');
    setProcessingError(null);
  };

  const handleSelectRun = async (run: ModelRun) => {
    setSelectedRun(run);
    resetProcState();
    // Node persists the console tail and the traceback onto the run row when the job
    // finishes, so a run picked off the list still explains itself after a reload.
    setLogs((run.metadata?.logs as CardioLogLine[]) ?? []);
    setConsoleError((run.metadata?.error as string) ?? null);
    setLogsOpen(run.status === 'error');
    if (run.status === 'done') {
      setRightTab(0);
      await loadSummary(run);
    } else {
      setSummary(null);
      setResultError(null);
    }
  };

  // Fetch the time vector plus the signals the chosen plot config references, from
  // the chosen layer, over the chosen window and averaged down to the chosen rate.
  const handleLoadPlot = async () => {
    if (selectedRun?.status !== 'done' || !selectedPlotConfig || !selectedLayer) return;
    const names = new Set<string>();
    for (const ax of Object.values(selectedPlotConfig.config.axes ?? {}) as any[]) {
      for (const name of [...(ax.params?.left ?? []), ...(ax.params?.right ?? [])]) names.add(name);
    }
    const num = (raw: string) => (raw !== '' && !Number.isNaN(Number(raw)) ? Number(raw) : undefined);
    const request = ++plotRequestRef.current;
    setPlotData(null);
    setPlotError(null);
    setLoadingPlotData(true);
    try {
      const data = await ApiService.getCardioSignals(
        selectedRun.id, selectedLayer, [...names],
        { t_from: num(plotFrom), t_to: num(plotTo), rate_hz: num(plotRate) },
      );
      if (request === plotRequestRef.current) setPlotData(data);
    } catch (err: any) {
      if (request === plotRequestRef.current) {
        setPlotError(err.response?.data?.error ?? err.message ?? 'Failed to load plot data');
      }
    } finally {
      if (request === plotRequestRef.current) setLoadingPlotData(false);
    }
  };

  const handleRunProcessing = async () => {
    if (!selectedRun || !selectedProcForRun || !procRunName.trim()) return;
    const name = procRunName.trim();
    setProcessingState('running');
    setProcessingError(null);
    try {
      const res = await ApiService.processRun(selectedRun.id, selectedProcForRun.id, name);
      setLogs(prev => [...prev, ...(res.logs ?? [])]);
      setProcessingState('done');
      setProcGroupNames(prev => prev.includes(name) ? prev : [...prev, name]);
    } catch (err: any) {
      const body = err.response?.data;
      setProcessingState('error');
      setProcessingError(body?.error ?? err.message ?? 'Processing failed');
      setLogs(prev => [...prev, ...((body?.logs as CardioLogLine[]) ?? [])]);
      if (body?.traceback) {
        setConsoleError(body.traceback);
        setLogsOpen(true);
      }
    }
  };


/*
 ██████    ████████  ██      ██  ██████    ████████  ██████
 ██    ██  ██        ████    ██  ██    ██  ██        ██    ██
 ██████    ██████    ██  ██  ██  ██    ██  ██████    ██████
 ██    ██  ██        ██    ████  ██    ██  ██        ██    ██
 ██    ██  ████████  ██      ██  ██████    ████████  ██    ██
                                                               */


  const COLORMAP_PALETTES: Record<string, string[]> = {
    Blues:   ['#08519c', '#3182bd', '#6baed6', '#9ecae1', '#c6dbef'],
    Reds:    ['#a50f15', '#de2d26', '#fb6a4a', '#fc9272', '#fcbba1'],
    Greens:  ['#006d2c', '#31a354', '#74c476', '#a1d99b', '#c7e9c0'],
    Oranges: ['#a63603', '#e6550d', '#fd8d3c', '#fdae6b', '#fdd0a2'],
    Purples: ['#54278f', '#756bb1', '#9e9ac8', '#bcbddc', '#dadaeb'],
    Greys:   ['#252525', '#636363', '#969696', '#bdbdbd', '#d9d9d9'],
  };

  const colormapColor = (map: string, idx: number): string => {
    const pal = COLORMAP_PALETTES[map] ?? ECHARTS_PALETTE as unknown as string[];
    return pal[idx % pal.length];
  };

  const buildAxisOption = (ax: any, res: CardioSignals): EChartsOption => {
    const left:  string[] = ax.params?.left  ?? [];
    const right: string[] = ax.params?.right ?? [];
    const tOff  = ax.options?.zeroTime ? res.t[0] : 0;
    const tAdd  = ax.options?.offset   ?? 0;
    const t     = res.t.map(v => v - tOff + tAdd);
    const hasR  = right.length > 0;
    const allYs = res.signals;

    const mkSeries = (names: string[], yIdx: number, map: string): LineSeriesOption[] =>
      names.map((name, i) => ({
        name,
        type: 'line',
        yAxisIndex: yIdx,
        data: allYs[name]?.map((v, idx) => [t[idx], v]) ?? [],
        symbol: 'none',
        lineStyle: { color: colormapColor(map, i) },
        itemStyle:  { color: colormapColor(map, i) },
      }));

    return {
      backgroundColor: 'transparent',
      title: ax.params?.title ? { text: ax.params.title, textStyle: { fontSize: 11 }, left: 'center', top: 2 } : undefined,
      tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
      legend: ax.options?.legend?.show !== false
        ? { data: [...left, ...right], textStyle: { fontSize: 9 }, top: ax.params?.title ? 20 : 4 }
        : undefined,
      dataZoom: [{ type: 'inside' }],
      grid: { left: 46, right: hasR ? 46 : 12, top: 46, bottom: 28 },
      xAxis: { type: 'value', name: 't (s)', min: t[0], max: t[t.length - 1], nameTextStyle: { fontSize: 9 }, axisLabel: { fontSize: 9 } },
      yAxis: [
        { type: 'value', position: 'left',  splitLine: { show: true  }, axisLabel: { fontSize: 9 } },
        hasR ? { type: 'value', position: 'right', splitLine: { show: false }, axisLabel: { fontSize: 9 } } : {},
      ],
      series: [
        ...mkSeries(left,  0, ax.params?.colorsLeft  ?? 'Blues'),
        ...mkSeries(right, 1, ax.params?.colorsRight ?? 'Reds'),
      ],
    };
  };

  const getRunLabel = (run: ModelRun) =>
    run.metadata?.name || new Date(run.created_at).toLocaleString();

  const getRunSubLabel = (run: ModelRun) =>
    run.metadata?.name ? new Date(run.created_at).toLocaleString() : '';

  const getRunBadge = (run: ModelRun) => ({
    label: run.status,
    color: STATUS_COLOR[run.status] ?? 'medium',
  });

  // Live view while a run is in flight. A calibration streams its convergence
  // trace (max|rel| against the twin targets); everything else just spins.
  const latest = progress[progress.length - 1];
  const progressPanel = (
    <>
      <IonItem lines="none">
        <IonSpinner name="dots" style={{ marginInlineEnd: 12 }} />
        <IonLabel>Running…</IonLabel>
      </IonItem>
      {latest && (
        <>
          <IonItem lines="none">
            <IonLabel>
              {latest.label}
              <IonNote style={{ display: 'block', fontSize: '0.75rem' }}>
                {latest.total > 0 && `${Math.round(100 * latest.done / latest.total)}% · `}
                {Number.isFinite(latest.elapsedWall) && `${latest.elapsedWall.toFixed(0)} s elapsed`}
              </IonNote>
            </IonLabel>
          </IonItem>
          <IonItem lines="none">
            <IonNote style={{ fontSize: '0.75rem' }}>
              mean|rel| {latest.meanRel.toFixed(1)}% · max|rel| {latest.maxRel.toFixed(1)}%
              {' '}· best {latest.bestRel.toFixed(1)}%
            </IonNote>
          </IonItem>
        </>
      )}
      {!latest && (
        <IonItem lines="none">
          <IonNote style={{ fontSize: '0.75rem' }}>
            No convergence trace for this run — only a calibration over a scenario that
            declares convergence observations reports one.
          </IonNote>
        </IonItem>
      )}
    </>
  );

  // Console pane — the Python service's captured stdout/stderr for this run, and its
  // traceback when it failed. Sits under the Results content; collapsed until there
  // is a reason to look, and opens itself on failure.
  const consolePanel = (
    <div style={{ borderTop: '1px solid var(--ion-color-step-150)' }}>
      <IonItem button detail={false} lines="none" onClick={() => setLogsOpen(o => !o)}>
        <IonIcon
          slot="start"
          size="small"
          icon={logsOpen ? chevronDownOutline : chevronForwardOutline}
        />
        <IonLabel style={{ fontSize: '0.85rem' }}>Console</IonLabel>
        <IonNote slot="end" color={consoleError ? 'danger' : 'medium'} style={{ fontSize: '0.75rem' }}>
          {consoleError ? 'failed' : `${logs.length} line${logs.length === 1 ? '' : 's'}`}
        </IonNote>
      </IonItem>
      {logsOpen && (
        <div
          style={{
            maxHeight: 260,
            overflowY: 'auto',
            padding: '8px 12px',
            background: 'var(--ion-color-step-50)',
            fontFamily: 'monospace',
            fontSize: '0.72rem',
            lineHeight: 1.5,
            whiteSpace: 'pre-wrap',
          }}
        >
          {logs.map((line, i) => (
            <div key={i} style={{ display: 'flex', gap: 8 }}>
              <span style={{ opacity: 0.45, flexShrink: 0 }}>
                {new Date(line.t * 1000).toLocaleTimeString()}
              </span>
              <span>{line.text}</span>
            </div>
          ))}
          {consoleError && (
            <div style={{ color: 'var(--ion-color-danger)', marginTop: logs.length ? 8 : 0 }}>
              {consoleError}
            </div>
          )}
          {!logs.length && !consoleError && (
            <IonNote style={{ fontSize: '0.72rem' }}>
              Nothing captured for this run yet.
            </IonNote>
          )}
          <div ref={logEndRef} />
        </div>
      )}
    </div>
  );


  return (
    <SplitPageLayout
      navItems={AREA_NAV.PHYSIOLOGY}
      title="Simulator"
      rightHeader={
        pollingJobId ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 12px' }}>
            <IonSpinner name="crescent" style={{ width: 16, height: 16 }} />
            <IonNote style={{ fontSize: '0.8rem' }}>Running…</IonNote>
          </div>
        ) : undefined
      }
      leftTabs={[
        {
          label: 'Runs',
          content: (
            <ResourcePanel
              fetcher={fetchRuns}
              refreshToken={String(runVersion)}
              config={PANEL_CONFIG.MODEL_RUNS}
              selectedId={selectedRun?.id}
              getLabel={getRunLabel}
              getSubLabel={getRunSubLabel}
              onSelect={handleSelectRun}
              onAdd={openPicker}
              onDelete={handleDeleteRun}
              getBadge={getRunBadge}
            />
          ),
        },
      ]}
      right={
        <TabPanel
          activeTab={rightTab}
          onTabChange={setRightTab}
          tabs={[
            {
              label: 'Results',
              content: (
                <>
                  {!summary ? (
                    resultError ? (
                      <IonItem lines="none"><IonText color="danger">{resultError}</IonText></IonItem>
                    ) : pollingJobId ? (
                      progressPanel
                    ) : (
                      <EmptyState message="Select a completed run or start a new one" />
                    )
                  ) : (
                    <>
                      <IonItem lines="inset">
                        <IonLabel>Scenario</IonLabel>
                        <IonNote slot="end">{summary.scenario || '—'}</IonNote>
                      </IonItem>
                      <IonItem lines="inset">
                        <IonLabel>Simulated time</IonLabel>
                        <IonNote slot="end">{summary.simulated_s.toFixed(2)} s</IonNote>
                      </IonItem>
                      <IonItem lines="inset">
                        <IonLabel>Stored sampling rate</IonLabel>
                        <IonNote slot="end">{summary.rate_hz} Hz</IonNote>
                      </IonItem>
                      <IonItem lines="inset">
                        <IonLabel>Compute time</IonLabel>
                        <IonNote slot="end">
                          {selectedRun?.metadata?.duration_s != null
                            ? `${(selectedRun.metadata.duration_s as number).toFixed(2)} s`
                            : '—'}
                        </IonNote>
                      </IonItem>
                      <IonItem lines="none">
                        <IonLabel>Variables</IonLabel>
                        <IonNote slot="end">{summary.signal_count}</IonNote>
                      </IonItem>
                    </>
                  )}
                  {/* Console — what Python printed for this run, and why it failed */}
                  {consolePanel}
                </>
              ),
            },
            {
              label: 'Plots',
              content: (
                <>
                  <IonItem lines="full">
                    <IonSelect
                      label="Plot config"
                      labelPlacement="stacked"
                      value={selectedPlotConfig?.id ?? ''}
                      placeholder={plotConfigs.length ? 'Select a config…' : 'No plot configs — create one in Plot Sandbox'}
                      disabled={plotConfigs.length === 0}
                      onIonChange={e => setSelectedPlotConfig(plotConfigs.find(c => c.id === e.detail.value) ?? null)}
                    >
                      {plotConfigs.map(cfg => (
                        <IonSelectOption key={cfg.id} value={cfg.id}>{cfg.name}</IonSelectOption>
                      ))}
                    </IonSelect>
                  </IonItem>

                  <IonItem lines="full">
                    <IonSelect
                      label="Data layer"
                      labelPlacement="stacked"
                      value={selectedLayer ?? ''}
                      placeholder="Select a data layer…"
                      onIonChange={e => setSelectedLayer((e.detail.value as string) || null)}
                    >
                      <IonSelectOption value="raw">Raw</IonSelectOption>
                      {procGroupNames.map(name => (
                        <IonSelectOption key={name} value={name}>{name}</IonSelectOption>
                      ))}
                    </IonSelect>
                  </IonItem>

                  <IonItem lines="none">
                    <IonInput
                      label="From (s)" labelPlacement="stacked" type="number"
                      placeholder="start of file"
                      value={plotFrom}
                      onIonInput={e => setPlotFrom(e.detail.value ?? '')}
                    />
                    <IonInput
                      label="To (s)" labelPlacement="stacked" type="number"
                      placeholder={summary ? `end of file — ${summary.simulated_s.toFixed(0)} s` : 'end of file'}
                      value={plotTo}
                      onIonInput={e => setPlotTo(e.detail.value ?? '')}
                    />
                    <IonInput
                      label="Sampling rate (Hz)" labelPlacement="stacked" type="number"
                      placeholder={summary ? `stored rate — ${summary.rate_hz} Hz` : 'stored rate'}
                      value={plotRate}
                      onIonInput={e => setPlotRate(e.detail.value ?? '')}
                    />
                  </IonItem>

                  <div style={{ padding: '8px 16px' }}>
                    <IonButton
                      expand="block"
                      disabled={selectedRun?.status !== 'done' || !selectedPlotConfig || !selectedLayer || loadingPlotData}
                      onClick={handleLoadPlot}
                    >
                      {loadingPlotData ? <IonSpinner name="dots" /> : 'Load'}
                    </IonButton>
                  </div>

                  {selectedRun?.status !== 'done' ? (
                    <EmptyState message="Select a completed run to see plot data" />
                  ) : !selectedPlotConfig ? (
                    <EmptyState message={plotConfigs.length ? 'Select a plot config above' : 'Create a plot config in Plot Sandbox first'} />
                  ) : !selectedLayer ? (
                    <EmptyState message="Select a data layer above" />
                  ) : plotError ? (
                    <IonItem lines="none"><IonText color="danger">{plotError}</IonText></IonItem>
                  ) : loadingPlotData ? (
                    <div style={{ padding: '4px 16px' }}><IonSpinner name="dots" style={{ width: 16, height: 16 }} /></div>
                  ) : !plotData ? (
                    <EmptyState message="Press Load to fetch the plot data" />
                  ) : (() => {
                    const cfg  = selectedPlotConfig.config;
                    const axes = Object.entries(cfg.axes ?? {});
                    const rows = cfg.grid?.rows ?? 4;
                    const cols = cfg.grid?.cols ?? 2;
                    return (
                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: `repeat(${cols}, 1fr)`,
                        gridTemplateRows: `repeat(${rows}, 220px)`,
                        gap: 4,
                        padding: 8,
                        overflowY: 'auto',
                      }}>
                        {axes.map(([key, ax]) => {
                          const a = ax as any;
                          return (
                            <div
                              key={key}
                              style={{
                                gridColumn: `${(a.col ?? 0) + 1} / span ${a.colSpan ?? 1}`,
                                gridRow:    `${(a.row ?? 0) + 1} / span ${a.rowSpan ?? 1}`,
                                border: '1px solid var(--ion-border-color)',
                                borderRadius: 4,
                                overflow: 'hidden',
                              }}
                            >
                              <EChart
                                option={buildAxisOption(a, plotData)}
                                theme={theme === 'dark' ? 'dark' : undefined}
                                height="100%"
                                notMerge
                              />
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </>
              ),
            },
            {
              label: 'Process',
              content: selectedRun?.status !== 'done' ? (
                <EmptyState message="Select a completed run first" />
              ) : (
                <>
                  <IonItem lines="full">
                    <IonSelect
                      label="Processing config"
                      labelPlacement="stacked"
                      value={selectedProcForRun?.id ?? ''}
                      placeholder={procConfigs.length ? 'Select a proc config…' : 'No proc configs — create one in Processing Sandbox'}
                      disabled={procConfigs.length === 0}
                      onIonChange={e => setSelectedProcForRun(procConfigs.find(c => c.id === e.detail.value) ?? null)}
                    >
                      {procConfigs.map(c => (
                        <IonSelectOption key={c.id} value={c.id}>{c.name}</IonSelectOption>
                      ))}
                    </IonSelect>
                  </IonItem>

                  <IonItem lines="full">
                    <IonInput
                      label="Run name"
                      labelPlacement="stacked"
                      placeholder="e.g. baseline, sepsis-day1"
                      value={procRunName}
                      onIonInput={e => setProcRunName(e.detail.value ?? '')}
                      clearInput
                    />
                  </IonItem>

                  <div style={{ padding: '8px 16px' }}>
                    <IonButton
                      expand="block"
                      disabled={!selectedProcForRun || !procRunName.trim() || processingState === 'running'}
                      onClick={handleRunProcessing}
                    >
                      {processingState === 'running' ? <IonSpinner name="dots" /> : 'Run Processing'}
                    </IonButton>
                  </div>

                  {processingError && (
                    <IonItem lines="none">
                      <IonText color="danger" style={{ fontSize: '0.8rem' }}>{processingError}</IonText>
                    </IonItem>
                  )}
                  {processingState === 'done' && (
                    <IonItem lines="none">
                      <IonText color="success" style={{ fontSize: '0.8rem' }}>Processing complete</IonText>
                    </IonItem>
                  )}

                  {procGroupNames.length > 0 && (
                    <>
                      <IonItem lines="full">
                        <IonLabel><strong>Processed results</strong></IonLabel>
                      </IonItem>
                      {procGroupNames.map(name => (
                        <IonItem key={name} lines="inset">
                          <IonLabel>{name}</IonLabel>
                        </IonItem>
                      ))}
                    </>
                  )}
                </>
              ),
            },
          ]}
        />
      }
    >
      {/* Run picker — model (structure) + scenario (values) + mode */}
      <ModalShell
        isOpen={pickerOpen}
        onDismiss={() => setPickerOpen(false)}
        title="New run"
        dismissLabel="Cancel"
      >
        <ResourcePanel<ModelConfig>
          fetcher={ApiService.getModelConfigs}
          refreshToken={String(pickerVersion)}
          title="Select model"
          getLabel={cfg => cfg.name}
          getSubLabel={cfg => cfg.description ?? ''}
          selectedId={pickerSelected?.id}
          onSelect={setPickerSelected}
          emptyMessage="No models in database"
        />
        <ResourcePanel<ScenarioConfig>
          fetcher={ApiService.getScenarioConfigs}
          refreshToken={String(pickerVersion)}
          title="Select scenario"
          getLabel={sc => sc.name}
          getSubLabel={sc => sc.description ?? ''}
          selectedId={pickerScenario?.id}
          onSelect={sc => {
            setPickerScenario(sc);
            setPickerMode('baseline');
          }}
          emptyMessage="No scenarios in database"
        />
        <div style={{ padding: '0 16px' }}>
          <IonItem lines="none">
            <IonSelect
              label="Mode" labelPlacement="stacked"
              value={pickerMode}
              disabled={!pickerScenario}
              onIonChange={e => setPickerMode(e.detail.value)}
            >
              {availableModes.map(m => (
                <IonSelectOption key={m.mode} value={m.mode}>{m.label}</IonSelectOption>
              ))}
            </IonSelect>
          </IonItem>
          {pickerScenario && availableModes.length < RUN_MODES.length && (
            <IonItem lines="none">
              <IonNote>
                This scenario declares no{' '}
                {RUN_MODES.filter(m => !availableModes.some(a => a.mode === m.mode))
                  .map(m => m.mode).join(' or ')}{' '}
                stage stack, so those modes are unavailable.
              </IonNote>
            </IonItem>
          )}
          {OVERRIDE_FIELDS.map(f => (
            <IonItem lines="none" key={f.key}>
              <IonInput
                label={f.label} labelPlacement="stacked" type="number"
                placeholder={`scenario default — ${f.note}`}
                value={overrides[f.key] ?? ''}
                onIonInput={e => setOverrides(o => ({ ...o, [f.key]: e.detail.value ?? '' }))}
                clearInput
              />
            </IonItem>
          ))}
          <IonItem lines="none">
            <IonLabel position="stacked">Run name (optional)</IonLabel>
            <IonInput
              value={runName}
              placeholder="e.g. baseline, sepsis-run-1"
              onIonInput={e => setRunName(e.detail.value ?? '')}
              clearInput
            />
          </IonItem>
        </div>
        <div style={{ padding: '8px 16px' }}>
          <IonButton
            expand="block"
            disabled={!pickerSelected || !pickerScenario || running || !!pollingJobId}
            onClick={handlePickerConfirm}
          >
            {running ? <IonSpinner name="dots" /> : 'Run'}
          </IonButton>
        </div>
      </ModalShell>
    </SplitPageLayout>
  );
};

export default Simulator;
