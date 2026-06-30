// Page: Devices — the bedside Pi fleet + beds (admin only, Data Collection area).
//
// Register a bedside node (which mints a one-time device token to bake into the
// SD card via manuEdge `./run flash`), see live online status from heartbeats,
// rotate tokens, and inspect hardware. Beds are listed alongside.
//
// Reuses: SplitPageLayout, ResourcePanel, ModalShell, DetailList, JsonViewer, EmptyState.
import React, { useEffect, useState } from 'react';
import {
  IonButton, IonButtons, IonIcon, IonInput, IonItem, IonLabel, IonBadge,
  IonCard, IonCardContent, IonCardHeader, IonCardTitle, useIonViewWillEnter,
} from '@ionic/react';
import { copyOutline, keyOutline, trashOutline } from 'ionicons/icons';
import ApiService from '../../services/Api';
import SplitPageLayout from '../../components/shell/SplitPageLayout';
import ResourcePanel from '../../components/shell/ResourcePanel';
import ModalShell from '../../components/shell/ModalShell';
import DetailList from '../../components/shell/DetailList';
import EmptyState from '../../components/shell/EmptyState';
import JsonViewer from '../../components/shell/JsonViewer';
import { BedsideNode, Bed } from '../../interfaces/types';
import { AREA_NAV, PANEL_CONFIG } from '../../constants';

const onlineColor = (n: BedsideNode) => (n.online ? 'success' : 'medium');
const onlineLabel = (n: BedsideNode) => (n.online ? 'online' : 'offline');

const fmtDate = (v?: string | null) => {
  if (!v) return 'never';
  const d = new Date(v);
  return isNaN(d.getTime()) ? v : d.toLocaleString();
};

const Devices: React.FC = () => {
  const [nodes, setNodes]       = useState<BedsideNode[]>([]);
  const [beds, setBeds]         = useState<Bed[]>([]);
  const [selected, setSelected] = useState<BedsideNode | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm]       = useState({ name: '', node_key: '', location: '' });
  // a freshly minted token to display once (keyed by node_key)
  const [token, setToken]     = useState<{ node_key: string; value: string } | null>(null);

  const load = async () => {
    const [n, b] = await Promise.all([ApiService.getBedsideNodes(), ApiService.getBeds()]);
    setNodes(n);
    setBeds(b);
    setSelected(prev => (prev ? n.find(x => x.id === prev.id) ?? null : null));
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useIonViewWillEnter(() => { load(); });

  // Auto-refresh so online/offline status updates without a manual reload.
  useEffect(() => {
    const iv = setInterval(() => { load(); }, 5000);
    return () => clearInterval(iv);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCreate = async () => {
    if (!form.name || !form.node_key) return;
    const node = await ApiService.createBedsideNode(form.name, form.node_key, form.location || undefined);
    setAddOpen(false);
    setForm({ name: '', node_key: '', location: '' });
    if (node?.token) setToken({ node_key: node.node_key ?? form.node_key, value: node.token });
    await load();
  };

  const handleRotate = async (n: BedsideNode) => {
    const res = await ApiService.rotateNodeToken(n.id);
    if (res?.token) setToken({ node_key: n.node_key ?? n.name, value: res.token });
  };

  const handleDelete = async (n: BedsideNode) => {
    await ApiService.deleteBedsideNode(n.id);
    if (selected?.id === n.id) setSelected(null);
    await load();
  };

  const copy = (v: string) => navigator.clipboard?.writeText(v);

  const renderDetail = () => {
    if (!selected) return <EmptyState message="Select a device to view details" />;
    return (
      <>
        <DetailList
          title={selected.name}
          rows={[
            { label: 'Status',     value: <IonBadge color={onlineColor(selected)}>{onlineLabel(selected)}</IonBadge> },
            { label: 'Node key',   value: selected.node_key ?? '' },
            { label: 'Agent',      value: selected.agent_version ?? '—' },
            { label: 'Bed served', value: selected.bed_label ?? 'Not linked to a bed' },
            { label: 'Hostname',   value: selected.hostname ?? '' },
            { label: 'IP address', value: selected.ip_address ?? '' },
            { label: 'Location',   value: selected.location ?? '' },
            { label: 'Last seen',  value: fmtDate(selected.last_seen) },
            { label: 'Registered', value: fmtDate(selected.created_at) },
          ]}
        />
        <IonButtons style={{ padding: '0 8px 8px' }}>
          <IonButton size="small" fill="outline" onClick={() => handleRotate(selected)}>
            <IonIcon slot="start" icon={keyOutline} />Rotate token
          </IonButton>
          <IonButton size="small" color="danger" fill="outline" onClick={() => handleDelete(selected)}>
            <IonIcon slot="start" icon={trashOutline} />Delete
          </IonButton>
        </IonButtons>
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
            getSubLabel={n => n.node_key ?? n.location ?? n.hostname ?? ''}
            getBadge={n => ({ label: onlineLabel(n), color: onlineColor(n) })}
            onSelect={setSelected}
            onAdd={() => setAddOpen(true)}
            onDelete={handleDelete}
          />
          <DetailList
            title={`Beds (${beds.length})`}
            rows={beds.map(b => ({
              label: b.label,
              value: b.node_name ? `${b.node_name}` : 'No Pi linked',
            }))}
            emptyMessage="No beds configured"
          />
        </>
      }
      right={renderDetail()}
    >
      {/* New device */}
      <ModalShell isOpen={addOpen} onDismiss={() => setAddOpen(false)} title="Register Bedside Node">
        <IonItem>
          <IonInput label="Name" labelPlacement="stacked" placeholder="e.g. ICU Bed 1 Pi"
            value={form.name} onIonInput={e => setForm({ ...form, name: e.detail.value ?? '' })} />
        </IonItem>
        <IonItem>
          <IonInput label="Node key (agent node_id)" labelPlacement="stacked" placeholder="e.g. bedside-01"
            value={form.node_key} onIonInput={e => setForm({ ...form, node_key: e.detail.value ?? '' })} />
        </IonItem>
        <IonItem>
          <IonInput label="Location (optional)" labelPlacement="stacked" placeholder="e.g. ICU - Bed 1"
            value={form.location} onIonInput={e => setForm({ ...form, location: e.detail.value ?? '' })} />
        </IonItem>
        <IonButtons style={{ marginTop: 16 }}>
          <IonButton expand="block" onClick={handleCreate} disabled={!form.name || !form.node_key}>
            Create &amp; generate token
          </IonButton>
        </IonButtons>
      </ModalShell>

      {/* One-time token reveal */}
      <ModalShell isOpen={!!token} onDismiss={() => setToken(null)} title="Device token (shown once)">
        {token && (
          <IonCard>
            <IonCardHeader>
              <IonCardTitle style={{ fontSize: '1rem' }}>Token for {token.node_key}</IonCardTitle>
            </IonCardHeader>
            <IonCardContent>
              <p style={{ color: 'var(--ion-color-medium)', fontSize: 13 }}>
                Copy this now — it cannot be shown again. Bake it into the SD card as the
                enrollment token (manuEdge <code>./run flash</code>).
              </p>
              <IonItem lines="none">
                <IonLabel style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{token.value}</IonLabel>
                <IonButton slot="end" fill="clear" onClick={() => copy(token.value)}>
                  <IonIcon slot="icon-only" icon={copyOutline} />
                </IonButton>
              </IonItem>
            </IonCardContent>
          </IonCard>
        )}
      </ModalShell>
    </SplitPageLayout>
  );
};

export default Devices;
