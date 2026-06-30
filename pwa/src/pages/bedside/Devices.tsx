// Page: Devices — the bedside Pi fleet + beds (admin only, Data Collection area).
//
// Static for now: lists the registered bedside_nodes (Raspberry Pis) and the beds
// they serve. Connecting to a live Pi (heartbeats / status) comes later.
//
// Reuses: SplitPageLayout, ResourcePanel, DetailList, JsonViewer, EmptyState.
import React, { useEffect, useState } from 'react';
import { useIonViewWillEnter } from '@ionic/react';
import ApiService from '../../services/Api';
import SplitPageLayout from '../../components/shell/SplitPageLayout';
import ResourcePanel from '../../components/shell/ResourcePanel';
import DetailList from '../../components/shell/DetailList';
import EmptyState from '../../components/shell/EmptyState';
import JsonViewer from '../../components/shell/JsonViewer';
import { BedsideNode, Bed } from '../../interfaces/types';
import { AREA_NAV, PANEL_CONFIG } from '../../constants';

const statusColor = (status?: string | null): string =>
  status === 'online' ? 'success' : status === 'unknown' ? 'warning' : 'medium';

const fmtDate = (v?: string | null) => {
  if (!v) return 'never';
  const d = new Date(v);
  return isNaN(d.getTime()) ? v : d.toLocaleString();
};

const Devices: React.FC = () => {
  const [nodes, setNodes]       = useState<BedsideNode[]>([]);
  const [beds, setBeds]         = useState<Bed[]>([]);
  const [selected, setSelected] = useState<BedsideNode | null>(null);

  const load = async () => {
    const [n, b] = await Promise.all([ApiService.getBedsideNodes(), ApiService.getBeds()]);
    setNodes(n);
    setBeds(b);
    setSelected(prev => (prev ? n.find(x => x.id === prev.id) ?? null : null));
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useIonViewWillEnter(() => { load(); });

  const renderDetail = () => {
    if (!selected) return <EmptyState message="Select a device to view details" />;
    return (
      <>
        <DetailList
          title={selected.name}
          rows={[
            { label: 'Status',     value: selected.status },
            { label: 'Bed served', value: selected.bed_label ?? 'Not linked to a bed' },
            { label: 'Hostname',   value: selected.hostname ?? '' },
            { label: 'IP address', value: selected.ip_address ?? '' },
            { label: 'Location',   value: selected.location ?? '' },
            { label: 'Last seen',  value: fmtDate(selected.last_seen) },
            { label: 'Registered', value: fmtDate(selected.created_at) },
          ]}
        />
        <div style={{ padding: '0 4px 8px', fontSize: 12, color: 'var(--ion-color-medium)' }}>Hardware</div>
        <JsonViewer value={selected.hardware ?? {}} />
      </>
    );
  };

  return (
    <SplitPageLayout
      navItems={AREA_NAV.DATA_COLLECTION}
      title="Data Collection"
      left={
        <>
          <ResourcePanel<BedsideNode>
            data={nodes}
            config={PANEL_CONFIG.BEDSIDE_DEVICES}
            selectedId={selected?.id}
            getLabel={n => n.name}
            getSubLabel={n => n.location ?? n.hostname ?? ''}
            getBadge={n => ({ label: n.status, color: statusColor(n.status) })}
            onSelect={setSelected}
          />
          <DetailList
            title={`Beds (${beds.length})`}
            rows={beds.map(b => ({
              label: b.label,
              value: b.node_name ? `${b.node_name} · ${b.node_status}` : 'No Pi linked',
            }))}
            emptyMessage="No beds configured"
          />
        </>
      }
      right={renderDetail()}
    />
  );
};

export default Devices;
