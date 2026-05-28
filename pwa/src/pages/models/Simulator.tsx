// Page: Cardio-pulmonary simulation — run management and results.
// Reads/writes: model_runs table (GraphQL + REST proxy to Python).
// Authenticated (private route).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  IonButton,
  IonInput,
  IonItem,
  IonLabel,
  IonNote,
  IonSearchbar,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonText,
} from '@ionic/react';
import ReactECharts from 'echarts-for-react';
import ApiService from '../../services/Api';
import SplitPageLayout from '../../components/shell/SplitPageLayout';
import TabPanel from '../../components/shell/TabPanel';
import ResourcePanel from '../../components/shell/ResourcePanel';
import EmptyState from '../../components/shell/EmptyState';
import ModalShell from '../../components/shell/ModalShell';
import { useTheme } from '../../contexts/ThemeContext';
import { ModelConfig, ModelRun, CardioResult, CardioPlotConfig, CardioProcConfig } from '../../interfaces/types';
import { AREA_NAV, ECHARTS_PALETTE, PANEL_CONFIG } from '../../constants';


const STATUS_COLOR: Record<string, string> = {
  pending: 'medium',
  running: 'warning',
  done:    'success',
  error:   'danger',
};

const DEFAULT_RUN_PARAMS: Record<string, any> = {
  runTime: 10,
  dt0: 0.001,
  returnFrequency: 100,
};

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
  const [rightTab, setRightTab]     = useState(0); // 0=results 1=plots

  const [selectedRun, setSelectedRun] = useState<ModelRun | null>(null);

  // Model picker modal
  const [pickerOpen, setPickerOpen]         = useState(false);
  const [pickerVersion, setPickerVersion]   = useState(0);
  const [pickerSelected, setPickerSelected] = useState<ModelConfig | null>(null);
  const [runName, setRunName]               = useState('');
  const [running, setRunning]               = useState(false);

  // Polling
  const [pollingJobId, setPollingJobId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Results
  const [result, setResult]                 = useState<CardioResult | null>(null);
  const [resultError, setResultError]       = useState<string | null>(null);
  const [selectedStates, setSelectedStates] = useState<string[]>([]);
  const [stateSearch, setStateSearch]       = useState('');

  // Plots
  const [plotConfigs, setPlotConfigs]               = useState<CardioPlotConfig[]>([]);
  const [selectedPlotConfig, setSelectedPlotConfig] = useState<CardioPlotConfig | null>(null);

  // Post-processing
  const [procConfigs, setProcConfigs]                 = useState<CardioProcConfig[]>([]);
  const [procGroupNames, setProcGroupNames]           = useState<string[]>([]);
  const [selectedProcForRun, setSelectedProcForRun]   = useState<CardioProcConfig | null>(null);
  const [procRunName, setProcRunName]                 = useState('');
  const [processingState, setProcessingState]         = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [processingError, setProcessingError]         = useState<string | null>(null);
  const [selectedProcForPlot, setSelectedProcForPlot] = useState<string | null>(null);
  const [procOutputs, setProcOutputs]                 = useState<Record<string, number[]>>({});
  const [loadingProcOutputs, setLoadingProcOutputs]   = useState(false);


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
    if (selectedRun?.id === run.id) { setSelectedRun(null); setResult(null); }
    setRunVersion(v => v + 1);
  };

  const startPolling = (jobId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const status = await ApiService.getCardioStatus(jobId);
        if (status.status === 'done' || status.status === 'error') {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setPollingJobId(null);
          setRunVersion(v => v + 1);
          if (status.status === 'done') {
            setRightTab(0);
          }
        }
      } catch { /* network hiccup — keep polling */ }
    }, 2000);
  };

  const loadResult = async (run: ModelRun) => {
    setResultError(null);
    try {
      const res = await ApiService.getCardioResultByRunId(run.id);
      setResult(res);
      setSelectedStates(res.stateNames.slice(0, 4));
    } catch (err: any) {
      setResultError(err.message ?? 'Failed to load result');
    }
  };

  const executeRun = async (cfg: ModelConfig | null, params: Record<string, any>, name: string) => {
    setRunning(true);
    setResult(null);
    try {
      const modelJson = cfg?.config ?? {};
      const { job_id } = await ApiService.runCardioModel(cfg?.id ?? null, modelJson, params, name || undefined);
      setPollingJobId(job_id);
      setRunVersion(v => v + 1);
      startPolling(job_id);
    } catch (err: any) {
      setResultError(err.response?.data?.error ?? err.message ?? 'Run failed');
      setRightTab(0);
    } finally {
      setRunning(false);
    }
  };

  const openPicker = () => {
    setPickerSelected(null);
    setRunName('');
    setPickerOpen(true);
    setPickerVersion(v => v + 1);
  };

  const handlePickerConfirm = () => {
    if (!pickerSelected) return;
    setPickerOpen(false);
    executeRun(pickerSelected, DEFAULT_RUN_PARAMS, runName);
  };

  const resetProcState = () => {
    setProcGroupNames([]);
    setSelectedProcForRun(null);
    setProcRunName('');
    setSelectedProcForPlot(null);
    setProcOutputs({});
    setProcessingState('idle');
    setProcessingError(null);
  };

  const loadProcGroups = async (run: ModelRun) => {
    try {
      const names = await ApiService.getProcessedGroups(run.id);
      setProcGroupNames(names);
    } catch { /* non-fatal */ }
  };

  const handleSelectRun = async (run: ModelRun) => {
    setSelectedRun(run);
    resetProcState();
    if (run.status === 'done') {
      setRightTab(0);
      await Promise.all([loadResult(run), loadProcGroups(run)]);
    } else {
      setResult(null);
      setResultError(null);
    }
  };

  const handleRunProcessing = async () => {
    if (!selectedRun || !selectedProcForRun || !procRunName.trim()) return;
    const name = procRunName.trim();
    setProcessingState('running');
    setProcessingError(null);
    try {
      await ApiService.processRun(selectedRun.id, selectedProcForRun.id, name);
      setProcessingState('done');
      setProcGroupNames(prev => prev.includes(name) ? prev : [...prev, name]);
    } catch (err: any) {
      setProcessingState('error');
      setProcessingError(err.response?.data?.detail ?? err.message ?? 'Processing failed');
    }
  };

  const handleLoadProcOutputs = async (name: string) => {
    if (!selectedRun) return;
    setSelectedProcForPlot(name);
    setLoadingProcOutputs(true);
    setProcOutputs({});
    try {
      const outputs = await ApiService.getProcessedOutputs(selectedRun.id, name);
      setProcOutputs(outputs);
    } catch { /* empty outputs */ }
    finally { setLoadingProcOutputs(false); }
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

  const buildAxisOption = (ax: any, res: CardioResult) => {
    const left:  string[] = ax.params?.left  ?? [];
    const right: string[] = ax.params?.right ?? [];
    const tOff  = ax.options?.zeroTime ? res.t[0] : 0;
    const tAdd  = ax.options?.offset   ?? 0;
    const t     = res.t.map(v => v - tOff + tAdd);
    const hasR  = right.length > 0;
    const allYs = { ...res.ys, ...procOutputs };

    const mkSeries = (names: string[], yIdx: number, map: string) =>
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

  const stateColor = (name: string) =>
    ECHARTS_PALETTE[(result?.stateNames.indexOf(name) ?? 0) % ECHARTS_PALETTE.length];

  const chartOption = () => {
    if (!result || !selectedStates.length) return {};
    return {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
      legend: { data: selectedStates, textStyle: { color: 'inherit' } },
      dataZoom: [{ type: 'inside' }, { type: 'slider', height: 20 }],
      xAxis: { type: 'value', name: 't (s)', data: result.t, min: result.t[0], max: result.t[result.t.length - 1] },
      yAxis: { type: 'value' },
      series: selectedStates.map(name => ({
        name,
        type: 'line',
        data: result.ys[name]?.map((v, idx) => [result.t[idx], v]) ?? [],
        symbol: 'none',
        lineStyle: { color: stateColor(name) },
        itemStyle: { color: stateColor(name) },
      })),
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
              content: !result ? (
                resultError ? (
                  <IonItem lines="none"><IonText color="danger">{resultError}</IonText></IonItem>
                ) : (
                  <EmptyState message="Select a completed run or start a new one" />
                )
              ) : (
                <>
                  <IonSearchbar
                    autocapitalize="off"
                    value={stateSearch}
                    onIonInput={e => setStateSearch(e.detail.value ?? '')}
                    placeholder="Filter states…"
                    debounce={150}
                    style={{ '--box-shadow': 'none', padding: '0 4px' }}
                  />
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '4px 8px 8px' }}>
                    {result.stateNames
                      .filter(n => !stateSearch || n.toLowerCase().includes(stateSearch.toLowerCase()))
                      .map(name => {
                        const active = selectedStates.includes(name);
                        const color  = stateColor(name);
                        return (
                          <IonButton
                            key={name}
                            size="small"
                            fill={active ? 'solid' : 'outline'}
                            style={{ '--background': active ? color : 'transparent', '--border-color': color, '--color': active ? '#fff' : color } as React.CSSProperties}
                            onClick={() => setSelectedStates(prev =>
                              active ? prev.filter(s => s !== name) : [...prev, name]
                            )}
                          >
                            {name}
                          </IonButton>
                        );
                      })
                    }
                  </div>
                  <ReactECharts
                    key={selectedStates.join(',')}
                    option={chartOption()}
                    theme={theme === 'dark' ? 'dark' : undefined}
                    style={{ height: 400 }}
                    notMerge
                  />
                  <IonItem lines="none">
                    <IonNote style={{ fontSize: '0.75rem' }}>
                      {result.t.length} time-points · {result.stateNames.length} state variables
                      {result.metadata?.duration_s != null && ` · ${(result.metadata.duration_s as number).toFixed(2)} s compute`}
                    </IonNote>
                  </IonItem>
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
                      value={selectedProcForPlot ?? ''}
                      onIonChange={e => {
                        const name = e.detail.value as string;
                        if (name) handleLoadProcOutputs(name);
                        else { setSelectedProcForPlot(null); setProcOutputs({}); }
                      }}
                    >
                      <IonSelectOption value="">Raw</IonSelectOption>
                      {procGroupNames.map(name => (
                        <IonSelectOption key={name} value={name}>{name}</IonSelectOption>
                      ))}
                    </IonSelect>
                  </IonItem>

                  {loadingProcOutputs && (
                    <div style={{ padding: '4px 16px' }}><IonSpinner name="dots" style={{ width: 16, height: 16 }} /></div>
                  )}
                  {!loadingProcOutputs && Object.keys(procOutputs).length > 0 && (
                    <div style={{ padding: '2px 12px 6px', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {Object.keys(procOutputs).map(k => (
                        <span
                          key={k}
                          style={{
                            fontSize: '0.7rem',
                            padding: '1px 6px',
                            borderRadius: 10,
                            background: 'var(--ion-color-tertiary)',
                            color: 'var(--ion-color-tertiary-contrast)',
                          }}
                        >
                          {k}
                        </span>
                      ))}
                    </div>
                  )}

                  {!selectedPlotConfig ? (
                    <EmptyState message={plotConfigs.length ? 'Select a plot config above' : 'Create a plot config in Plot Sandbox first'} />
                  ) : !result ? (
                    <EmptyState message="Select a completed run to see plot data" />
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
                              <ReactECharts
                                option={buildAxisOption(a, result)}
                                theme={theme === 'dark' ? 'dark' : undefined}
                                style={{ width: '100%', height: '100%' }}
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
              content: !result ? (
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
      {/* Model picker */}
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
        <div style={{ padding: '0 16px' }}>
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
          <IonButton expand="block" disabled={!pickerSelected || running || !!pollingJobId} onClick={handlePickerConfirm}>
            {running ? <IonSpinner name="dots" /> : 'Run'}
          </IonButton>
        </div>
      </ModalShell>
    </SplitPageLayout>
  );
};

export default Simulator;
