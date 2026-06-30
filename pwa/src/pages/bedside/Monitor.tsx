// Page: Monitor — live bedside waveforms (admin only, Data Collection area).
//
// Pick a node → subscribe to its segment stream over WebSocket (with an initial
// backfill from latestSegments) → render a rolling echarts line per stream. The Pi
// dials home to /api/bedside/ingest; the server broadcasts each persisted segment
// here. Sample timestamps are reconstructed from start_time_us + i / sampling_hz.
//
// Reuses: SplitPageLayout, ResourcePanel, EmptyState.
import React, { useEffect, useRef, useState } from 'react';
import { IonBadge, useIonViewWillEnter } from '@ionic/react';
import ReactECharts from 'echarts-for-react';
import ApiService from '../../services/Api';
import SplitPageLayout from '../../components/shell/SplitPageLayout';
import ResourcePanel from '../../components/shell/ResourcePanel';
import EmptyState from '../../components/shell/EmptyState';
import { BedsideNode, BedsideStream, BedsideSegment } from '../../interfaces/types';
import { AREA_NAV, PANEL_CONFIG } from '../../constants';

const MAX_POINTS = 1500;   // rolling window per stream

type Buffer = { t: number[]; v: number[] };

const Monitor: React.FC = () => {
  const [nodes, setNodes]       = useState<BedsideNode[]>([]);
  const [selected, setSelected] = useState<BedsideNode | null>(null);
  const [streams, setStreams]   = useState<BedsideStream[]>([]);
  const [, setTick]             = useState(0);  // forces periodic re-render

  const buffersRef = useRef<Record<string, Buffer>>({});
  const wsRef      = useRef<WebSocket | null>(null);

  const loadNodes = async () => {
    const n = await ApiService.getBedsideNodes();
    setNodes(n);
    setSelected(prev => (prev ? n.find(x => x.id === prev.id) ?? prev : null));
  };
  useEffect(() => { loadNodes(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useIonViewWillEnter(() => { loadNodes(); });

  // Keep the node list / online badges fresh without a manual reload.
  useEffect(() => {
    const iv = setInterval(() => { loadNodes(); }, 5000);
    return () => clearInterval(iv);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pushSegment = (seg: Pick<BedsideSegment, 'stream_id' | 'start_time_us' | 'sampling_hz' | 'samples'>) => {
    if (!seg.samples?.length) return;
    const buf = (buffersRef.current[seg.stream_id] ??= { t: [], v: [] });
    const t0 = seg.start_time_us / 1e6;
    for (let i = 0; i < seg.samples.length; i++) {
      buf.t.push(t0 + i / seg.sampling_hz);
      buf.v.push(seg.samples[i]);
    }
    if (buf.t.length > MAX_POINTS) {
      buf.t.splice(0, buf.t.length - MAX_POINTS);
      buf.v.splice(0, buf.v.length - MAX_POINTS);
    }
  };

  // (re)subscribe whenever the selected node changes
  useEffect(() => {
    wsRef.current?.close();
    wsRef.current = null;
    buffersRef.current = {};
    setStreams([]);
    if (!selected) return;

    let cancelled = false;
    (async () => {
      const s = await ApiService.getBedsideStreams(selected.id);
      if (cancelled) return;
      setStreams(s);
      // backfill recent history per stream
      const segs = await ApiService.getLatestSegments(selected.id, undefined, 40);
      segs.forEach(pushSegment);
      if (cancelled) return;
      // live updates
      if (selected.node_key) {
        wsRef.current = ApiService.subscribeBedside(selected.node_key, (msg) => {
          if (msg.type === 'segment') pushSegment(msg);
        });
      }
    })();

    return () => { cancelled = true; wsRef.current?.close(); wsRef.current = null; };
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // periodic redraw (decoupled from the message rate)
  useEffect(() => {
    const iv = setInterval(() => setTick(t => t + 1), 250);
    return () => clearInterval(iv);
  }, []);

  const chartOption = (stream: BedsideStream) => {
    const buf = buffersRef.current[stream.stream_id] ?? { t: [], v: [] };
    const data = buf.t.map((t, i) => [t, buf.v[i]]);
    return {
      animation: false,
      grid: { left: 56, right: 16, top: 28, bottom: 28 },
      title: { text: `${stream.modality ?? stream.stream_id}${stream.units ? ` (${stream.units})` : ''}`, textStyle: { fontSize: 13 }, left: 8, top: 4 },
      xAxis: { type: 'value', scale: true, name: 's', axisLabel: { formatter: (v: number) => v.toFixed(0) } },
      yAxis: { type: 'value', scale: true },
      series: [{ type: 'line', showSymbol: false, sampling: 'lttb', data, lineStyle: { width: 1 } }],
    };
  };

  const renderDetail = () => {
    if (!selected) return <EmptyState message="Select a node to view live data" />;
    if (!selected.node_key) return <EmptyState message="This node has not dialled in yet (no node key)." />;
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px 12px' }}>
          <strong>{selected.name}</strong>
          <IonBadge color={selected.online ? 'success' : 'medium'}>{selected.online ? 'online' : 'offline'}</IonBadge>
          <span style={{ color: 'var(--ion-color-medium)', fontSize: 13 }}>{streams.length} stream(s)</span>
        </div>
        {streams.length === 0 ? (
          <EmptyState message="Waiting for streams… (is the agent running and dialling in?)" />
        ) : (
          streams.map(s => (
            <ReactECharts key={s.id} option={chartOption(s)} notMerge style={{ height: 220, width: '100%' }} />
          ))
        )}
      </div>
    );
  };

  return (
    <SplitPageLayout
      navItems={AREA_NAV.DATA_COLLECTION}
      title="Data Collection"
      left={
        <ResourcePanel<BedsideNode>
          data={nodes}
          config={PANEL_CONFIG.BEDSIDE_DEVICES}
          selectedId={selected?.id}
          getLabel={n => n.name}
          getSubLabel={n => n.node_key ?? ''}
          getBadge={n => ({ label: n.online ? 'online' : 'offline', color: n.online ? 'success' : 'medium' })}
          onSelect={setSelected}
        />
      }
      right={renderDetail()}
    />
  );
};

export default Monitor;
