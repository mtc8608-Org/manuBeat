// Page: HDF5 file inspector — browse run HDF5 structure, load and plot datasets,
// repack files, and download compound datasets as CSV.
// Reads: model_runs (done), HDF5 tree/dataset via Python proxy.
// Authenticated (private route).

import React, { useCallback, useEffect, useState } from 'react';
import {
  IonButton,
  IonIcon,
  IonItem,
  IonLabel,
  IonNote,
  IonSpinner,
  IonText,
} from '@ionic/react';
import {
  chevronDownOutline,
  chevronForwardOutline,
  documentOutline,
  folderOpenOutline,
  folderOutline,
  refreshOutline,
  trashOutline,
} from 'ionicons/icons';
import ReactECharts from 'echarts-for-react';
import ApiService from '../../services/Api';
import SplitPageLayout from '../../components/shell/SplitPageLayout';
import TabPanel from '../../components/shell/TabPanel';
import ResourcePanel from '../../components/shell/ResourcePanel';
import DataTable from '../../components/shell/DataTable';
import JsonViewer from '../../components/shell/JsonViewer';
import EmptyState from '../../components/shell/EmptyState';
import { useTheme } from '../../contexts/ThemeContext';
import { HdfDataset, HdfNode, ModelRun } from '../../interfaces/types';
import { AREA_NAV, PANEL_CONFIG } from '../../constants';


// ── Helpers ────────────────────────────────────────────────────────────────────

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return '—';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDuration(s: number | null | undefined): string {
  if (s == null) return '—';
  if (s < 60) return `${s.toFixed(2)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${(s % 60).toFixed(1)}s`;
}


// ── Tree node component ────────────────────────────────────────────────────────

interface TreeNodeProps {
  node:     HdfNode;
  onLoad:   (path: string) => void;
  onDelete: (path: string) => void;
  loading:  string | null;
  deleting: string | null;
  depth:    number;
}

const HdfTreeNode: React.FC<TreeNodeProps> = ({ node, onLoad, onDelete, loading, deleting, depth }) => {
  const [open, setOpen] = useState(depth < 2);
  const isGroup    = node.type === 'group';
  const isLoading  = loading === node.path;
  const isDeleting = deleting === node.path;

  const attrEntries = Object.entries(node.attrs ?? {});

  return (
    <div style={{ marginLeft: depth * 16, fontFamily: 'monospace', fontSize: '0.82rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, minHeight: 28 }}>
        {isGroup ? (
          <IonButton fill="clear" size="small" style={{ '--padding-start': 0, '--padding-end': 0 }}
            onClick={() => setOpen(o => !o)}>
            <IonIcon icon={open ? chevronDownOutline : chevronForwardOutline} slot="icon-only" style={{ fontSize: '0.75rem' }} />
          </IonButton>
        ) : (
          <span style={{ width: 28, display: 'inline-block' }} />
        )}

        <IonIcon
          icon={isGroup ? (open ? folderOpenOutline : folderOutline) : documentOutline}
          style={{ color: isGroup ? 'var(--ion-color-warning)' : 'var(--ion-color-success)', flexShrink: 0 }}
        />

        <span style={{ color: isGroup ? 'var(--ion-color-primary)' : 'inherit' }}>
          {node.name || '/'}
        </span>

        {!isGroup && node.shape !== undefined && (
          <IonNote style={{ fontSize: '0.72rem', marginLeft: 4 }}>
            [{node.shape.join(' × ')}] {node.dtype}
          </IonNote>
        )}

        {!isGroup && (
          isLoading
            ? <IonSpinner name="dots" style={{ width: 14, height: 14 }} />
            : <IonButton fill="clear" size="small" onClick={() => onLoad(node.path)}
                style={{ '--padding-start': '4px', '--padding-end': '4px', fontSize: '0.72rem' }}>
                Load
              </IonButton>
        )}
        {!isGroup && (
          isDeleting
            ? <IonSpinner name="dots" style={{ width: 14, height: 14 }} />
            : <IonButton fill="clear" size="small" color="danger" onClick={() => onDelete(node.path)}
                style={{ '--padding-start': '4px', '--padding-end': '4px' }}>
                <IonIcon icon={trashOutline} style={{ fontSize: '0.8rem' }} />
              </IonButton>
        )}
      </div>

      {/* attrs inline, small */}
      {attrEntries.length > 0 && (depth === 0 || (isGroup && open)) && (
        <div style={{ marginLeft: 28, color: 'var(--ion-color-medium)', fontSize: '0.70rem', marginBottom: 4 }}>
          {attrEntries.map(([k, v]) => (
            <span key={k} style={{ marginRight: 12 }}>
              <strong>{k}:</strong> {String(v).slice(0, 80)}
            </span>
          ))}
        </div>
      )}

      {isGroup && open && node.children?.map(child => (
        <HdfTreeNode key={child.path} node={child} onLoad={onLoad} onDelete={onDelete}
          loading={loading} deleting={deleting} depth={depth + 1} />
      ))}
    </div>
  );
};


// ── Dataset viewer ─────────────────────────────────────────────────────────────

const MAX_CHART_POINTS = 5000;

function decimateArray(arr: number[], maxPts: number): number[] {
  if (arr.length <= maxPts) return arr;
  const step = Math.ceil(arr.length / maxPts);
  return arr.filter((_, i) => i % step === 0);
}

interface DataViewProps {
  path:    string;
  dataset: HdfDataset;
  isDark:  boolean;
}

const DataView: React.FC<DataViewProps> = ({ path, dataset, isDark }) => {
  const textColor = isDark ? '#e0e0e0' : '#333';

  if (dataset.type === 'string') {
    return <JsonViewer value={dataset.data as string} height="60vh" />;
  }

  if (dataset.type === 'compound') {
    type CompoundRow = { id: string } & Record<string, string>;
    const fields = dataset.fields ?? [];
    const n      = (dataset.data[fields[0]] as any[])?.length ?? 0;
    const rows: CompoundRow[] = Array.from({ length: n }, (_, i) => {
      const row: CompoundRow = { id: String(i) };
      fields.forEach(f => {
        const v = (dataset.data[f] as any[])[i];
        row[f] = typeof v === 'number' ? v.toPrecision(6) : String(v);
      });
      return row;
    });
    return (
      <DataTable<CompoundRow>
        fetcher={async () => rows}
        leadingCols={[{ label: '#', format: r => r.id }]}
        flattenRow={({ id: _id, ...rest }) => rest as Record<string, string>}
        refreshToken={1}
        exportFilename={path.split('/').pop() ?? 'compound'}
        title=""
      />
    );
  }

  // numeric
  const flat = (dataset.data as number[][]).flat ? (dataset.data as number[]) : [dataset.data as number];
  const shape = dataset.shape ?? [];
  const is1D  = shape.length === 1;

  if (!is1D || flat.length === 0) {
    return <IonText color="medium"><p style={{ padding: 12 }}>Shape {JSON.stringify(shape)} — raw preview not available</p></IonText>;
  }

  const plotData = decimateArray(flat, MAX_CHART_POINTS);
  const stats    = {
    min:  Math.min(...flat).toPrecision(6),
    max:  Math.max(...flat).toPrecision(6),
    mean: (flat.reduce((a, b) => a + b, 0) / flat.length).toPrecision(6),
    n:    flat.length,
  };

  const option = {
    backgroundColor: 'transparent',
    textStyle: { color: textColor },
    tooltip: { trigger: 'axis' as const },
    xAxis: { type: 'category' as const, show: false },
    yAxis: { type: 'value' as const, scale: true, axisLabel: { color: textColor } },
    series: [{
      type: 'line',
      data: plotData,
      symbol: 'none',
      lineStyle: { width: 1 },
    }],
    grid: { left: 60, right: 12, top: 12, bottom: 12 },
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 24, padding: '8px 12px', fontSize: '0.75rem', color: 'var(--ion-color-medium)' }}>
        <span><strong>n:</strong> {stats.n}</span>
        <span><strong>min:</strong> {stats.min}</span>
        <span><strong>max:</strong> {stats.max}</span>
        <span><strong>mean:</strong> {stats.mean}</span>
        {flat.length > MAX_CHART_POINTS && <span>(chart shows 1 in {Math.ceil(flat.length / MAX_CHART_POINTS)} points)</span>}
      </div>
      <ReactECharts option={option} style={{ height: 280 }} />
    </div>
  );
};


// ── Page ───────────────────────────────────────────────────────────────────────

const HdfInspector: React.FC = () => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  // ── STATE ──────────────────────────────────────────────────────────────────

  const [runsVersion] = useState(0);
  const [selectedRun, setSelectedRun] = useState<ModelRun | null>(null);
  const [allRuns, setAllRuns] = useState<ModelRun[]>([]);

  const [tree,        setTree]        = useState<HdfNode | null>(null);
  const [treeLoading, setTreeLoading] = useState(false);

  const [loadingPath,    setLoadingPath]    = useState<string | null>(null);
  const [deletingPath,   setDeletingPath]   = useState<string | null>(null);
  const [loadedDataset,  setLoadedDataset]  = useState<{ path: string; dataset: HdfDataset } | null>(null);

  const [rightTab,   setRightTab]   = useState(0);
  const [repacking,  setRepacking]  = useState(false);

  // ── LOAD ───────────────────────────────────────────────────────────────────

  const fetchRuns = useCallback(
    () => ApiService.getModelRuns().then(data => {
      const done = data.filter(r => r.status === 'done');
      setAllRuns(done);
      return done;
    }),
    [],
  );

  useEffect(() => {
    if (!selectedRun) return;
    setTreeLoading(true);
    setTree(null);
    setLoadedDataset(null);
    setRightTab(0);
    ApiService.getHdf5Tree(selectedRun.id)
      .then(setTree)
      .catch(console.error)
      .finally(() => setTreeLoading(false));
  }, [selectedRun]);

  // ── HANDLERS ───────────────────────────────────────────────────────────────

  const handleLoadDataset = async (path: string) => {
    if (!selectedRun) return;
    setLoadingPath(path);
    try {
      const dataset = await ApiService.getHdf5Dataset(selectedRun.id, path);
      setLoadedDataset({ path, dataset });
      setRightTab(1);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingPath(null);
    }
  };

  const handleDeleteDataset = async (path: string) => {
    if (!selectedRun) return;
    setDeletingPath(path);
    try {
      await ApiService.deleteHdf5Dataset(selectedRun.id, path);
      const t = await ApiService.getHdf5Tree(selectedRun.id);
      setTree(t);
      if (loadedDataset?.path === path) setLoadedDataset(null);
    } catch (e) {
      console.error(e);
    } finally {
      setDeletingPath(null);
    }
  };

  const handleRepack = async () => {
    if (!selectedRun) return;
    setRepacking(true);
    try {
      await ApiService.repackHdf5(selectedRun.id);
      const t = await ApiService.getHdf5Tree(selectedRun.id);
      setTree(t);
    } catch (e) {
      console.error(e);
    } finally {
      setRepacking(false);
    }
  };

  // ── RENDER ─────────────────────────────────────────────────────────────────

  const runLabel    = (r: ModelRun) => r.metadata?.name || new Date(r.created_at).toLocaleString();
  const runSubLabel = (r: ModelRun) => r.metadata?.name ? new Date(r.created_at).toLocaleString() : '';

  const rightHeader = selectedRun ? (
    <IonButton
      fill="outline" size="small"
      disabled={repacking}
      onClick={handleRepack}
    >
      {repacking ? <IonSpinner name="dots" slot="start" style={{ width: 14, height: 14 }} /> : <IonIcon icon={refreshOutline} slot="start" />}
      Repack
    </IonButton>
  ) : undefined;

  const treeContent = (
    <div style={{ padding: '8px 0', overflowY: 'auto', height: '100%' }}>
      {treeLoading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
          <IonSpinner />
        </div>
      )}
      {!treeLoading && !tree && !selectedRun && (
        <EmptyState message="Select a completed run to inspect its HDF5 file" />
      )}
      {!treeLoading && !tree && selectedRun && (
        <EmptyState message="No HDF5 tree loaded" />
      )}
      {tree && (
        <HdfTreeNode node={tree} onLoad={handleLoadDataset} onDelete={handleDeleteDataset}
          loading={loadingPath} deleting={deletingPath} depth={0} />
      )}
    </div>
  );

  // ── Stats content ─────────────────────────────────────────────────────────

  const totalDuration  = allRuns.reduce((a, r) => a + (r.metadata?.duration_s      ?? 0), 0);
  const totalBytes     = allRuns.reduce((a, r) => a + (r.metadata?.file_size_bytes  ?? 0), 0);
  const avgDuration    = allRuns.length ? totalDuration / allRuns.length : 0;
  const avgBytes       = allRuns.length ? totalBytes    / allRuns.length : 0;
  const maxRss         = allRuns.reduce<number | null>((acc, r) => {
    const v = r.metadata?.max_rss_mb;
    if (v == null) return acc;
    return acc == null ? v : Math.max(acc, v);
  }, null);

  const statRow = (label: string, value: string | number) => (
    <IonItem key={label} lines="inset">
      <IonLabel color="medium">{label}</IonLabel>
      <IonNote slot="end" style={{ fontFamily: 'monospace' }}>{value}</IonNote>
    </IonItem>
  );

  const statsContent = (
    <div style={{ overflowY: 'auto', height: '100%' }}>
      {selectedRun && (
        <>
          <IonItem lines="full">
            <IonLabel><strong>Selected run</strong></IonLabel>
            <IonNote slot="end">{runLabel(selectedRun)}</IonNote>
          </IonItem>
          {statRow('Duration',    formatDuration(selectedRun.metadata?.duration_s))}
          {statRow('File size',   formatBytes(selectedRun.metadata?.file_size_bytes))}
          {statRow('Peak memory', selectedRun.metadata?.max_rss_mb != null ? `${selectedRun.metadata.max_rss_mb} MB` : '—')}
          {statRow('State count', selectedRun.metadata?.state_count ?? '—')}
        </>
      )}

      <IonItem lines="full" style={{ marginTop: selectedRun ? 16 : 0 }}>
        <IonLabel><strong>All completed runs</strong></IonLabel>
        <IonNote slot="end">{allRuns.length} run{allRuns.length !== 1 ? 's' : ''}</IonNote>
      </IonItem>
      {allRuns.length === 0 ? (
        <EmptyState message="No completed runs yet" />
      ) : (
        <>
          {statRow('Total compute', formatDuration(totalDuration))}
          {statRow('Total storage', formatBytes(totalBytes))}
          {statRow('Avg duration',  formatDuration(avgDuration))}
          {statRow('Avg file size', formatBytes(avgBytes))}
          {statRow('Peak RSS seen', maxRss != null ? `${maxRss} MB` : '—')}
        </>
      )}
    </div>
  );

  const dataContent = (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      {!loadedDataset ? (
        <EmptyState message="Click 'Load' on any dataset in the Tree tab" />
      ) : (
        <>
          <IonItem lines="full">
            <IonLabel>
              <IonNote style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{loadedDataset.path}</IonNote>
            </IonLabel>
          </IonItem>
          <DataView path={loadedDataset.path} dataset={loadedDataset.dataset} isDark={isDark} />
        </>
      )}
    </div>
  );

  return (
    <SplitPageLayout
      navItems={AREA_NAV.PHYSIOLOGY}
      title="HDF Inspector"
      rightHeader={rightHeader}
      leftTabs={[{
        label: 'Runs',
        content: (
          <ResourcePanel<ModelRun>
            fetcher={fetchRuns}
            refreshToken={String(runsVersion)}
            config={PANEL_CONFIG.MODEL_RUNS}
            selectedId={selectedRun?.id}
            getLabel={runLabel}
            getSubLabel={runSubLabel}
            onSelect={setSelectedRun}
          />
        ),
      }]}
      right={
        <TabPanel
          activeTab={rightTab}
          onTabChange={setRightTab}
          tabs={[
            { label: 'Tree',  content: treeContent },
            { label: 'Data',  content: dataContent  },
            { label: 'Stats', content: statsContent,
              actions: (
                <IonButton fill="clear" size="small" onClick={() => fetchRuns()}>
                  <IonIcon icon={refreshOutline} slot="icon-only" />
                </IonButton>
              ),
            },
          ]}
        />
      }
    />
  );
};

export default HdfInspector;
