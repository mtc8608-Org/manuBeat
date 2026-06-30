// Page: Patients — the patient roster for the Data Collection area (admin only).
//
// Patients are a first-class record (detached from surveys). The demographic form
// is an app-domain component tree (form_patient_demographics) whose input keys =
// the patients columns; FormRenderer (mode="app") collects them and createPatient
// writes the columns + mints an empty HDF5 data file.
//
// Reuses: SplitPageLayout, ResourcePanel, ModalShell, FormRenderer (app mode),
// DataTable (assignment history), DetailList, EmptyState.
import React, { useEffect, useState } from 'react';
import {
  IonBadge, IonButton, IonButtons, IonCard, IonCardContent, IonCardHeader,
  IonCardTitle, IonIcon, IonItem, IonLabel, IonSelect, IonSelectOption, IonSpinner,
  useIonViewWillEnter,
} from '@ionic/react';
import { downloadOutline, exitOutline } from 'ionicons/icons';
import ApiService from '../../services/Api';
import SplitPageLayout from '../../components/shell/SplitPageLayout';
import ResourcePanel from '../../components/shell/ResourcePanel';
import ModalShell from '../../components/shell/ModalShell';
import EmptyState from '../../components/shell/EmptyState';
import DetailList from '../../components/shell/DetailList';
import DataTable from '../../components/shell/DataTable';
import FormRenderer from '../../components/forms/FormRenderer';
import { Patient, Bed, BedAssignment, ComponentResults } from '../../interfaces/types';
import { AREA_NAV, PANEL_CONFIG, API_BASE, ENDPOINT, PATIENT_FORM_COMPONENT_ID } from '../../constants';

// Demographic columns shown in the detail view (label + patients column key).
const DEMOGRAPHIC_FIELDS: Array<{ key: keyof Patient; label: string }> = [
  { key: 'first_name',    label: 'First name' },
  { key: 'last_name',     label: 'Last name' },
  { key: 'date_of_birth', label: 'Date of birth' },
  { key: 'sex',           label: 'Sex' },
  { key: 'identifier',    label: 'Hospital number' },
  { key: 'email',         label: 'Email' },
  { key: 'phone',         label: 'Phone' },
  { key: 'address',       label: 'Address' },
  { key: 'notes',         label: 'Notes' },
];

const patientName = (p: Patient): string => {
  const name = `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim();
  return name || '(unnamed patient)';
};

const statusColor = (status?: string | null): string =>
  status === 'online' ? 'success' : status === 'unknown' ? 'warning' : 'medium';

const fmtDate = (v?: string | null) => {
  if (!v) return '—';
  const d = new Date(v);
  return isNaN(d.getTime()) ? v : d.toLocaleString();
};

const Patients: React.FC = () => {
  const [formComponent, setFormComponent] = useState<ComponentResults | null>(null);

  const [patients, setPatients]      = useState<Patient[]>([]);
  const [selected, setSelected]      = useState<Patient | null>(null);
  const [beds, setBeds]              = useState<Bed[]>([]);
  const [assignments, setAssignments] = useState<BedAssignment[]>([]);
  const [search, setSearch]          = useState('');
  const [bedChoice, setBedChoice]    = useState<string>('');

  const [addOpen, setAddOpen]   = useState(false);
  const [creating, setCreating] = useState(false);

  // ── data loading ────────────────────────────────────────────────────────────
  useEffect(() => {
    ApiService.getComponent(PATIENT_FORM_COMPONENT_ID).then(tree => {
      if (tree) setFormComponent(tree);
    });
  }, []);

  const loadPatients = async () => {
    const list = await ApiService.getPatients();
    setPatients(list);
    setSelected(prev => (prev ? list.find(p => p.id === prev.id) ?? null : null));
  };
  const loadBeds = async () => setBeds(await ApiService.getBeds());

  useEffect(() => { loadPatients(); loadBeds(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useIonViewWillEnter(() => { loadPatients(); loadBeds(); });

  useEffect(() => {
    if (!selected) { setAssignments([]); setBedChoice(''); return; }
    ApiService.getBedAssignments(selected.id).then(setAssignments);
    setBedChoice(selected.bed_id ?? '');
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── actions ───────────────────────────────────────────────────────────────
  const handleCreate = async (values: Record<string, any>) => {
    setCreating(true);
    try {
      await ApiService.createPatient(values);
      setAddOpen(false);
      await loadPatients();
    } catch (e) { console.error('create patient:', e); }
    finally { setCreating(false); }
  };

  const handleDelete = async (p: Patient) => {
    await ApiService.deletePatient(p.id);
    if (selected?.id === p.id) setSelected(null);
    await loadPatients();
  };

  const handleAssign = async () => {
    if (!selected || !bedChoice) return;
    await ApiService.assignPatientToBed(selected.id, bedChoice);
    await loadPatients();
    setAssignments(await ApiService.getBedAssignments(selected.id));
  };

  const handleDischarge = async () => {
    if (!selected) return;
    const active = assignments.find(a => a.active);
    if (!active) return;
    await ApiService.endBedAssignment(active.id);
    await loadPatients();
    setAssignments(await ApiService.getBedAssignments(selected.id));
  };

  // ── detail rows ─────────────────────────────────────────────────────────────
  const demographicRows = selected
    ? DEMOGRAPHIC_FIELDS
        .map(f => ({ label: f.label, value: (selected[f.key] as any) ?? '' }))
        .filter(r => r.value !== '' && r.value != null)
    : [];

  const renderDetail = () => {
    if (!selected) return <EmptyState message="Select a patient to view details" />;

    return (
      <>
        {/* Bed assignment */}
        <IonCard>
          <IonCardHeader style={{ padding: '8px 12px' }}>
            <IonCardTitle style={{ fontSize: '1rem' }}>Bed</IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            <IonItem lines="none">
              <IonLabel>
                Current bed:&nbsp;
                {selected.bed_label
                  ? <strong>{selected.bed_label}</strong>
                  : <span style={{ color: 'var(--ion-color-medium)' }}>Not assigned</span>}
                {selected.node_name && (
                  <IonBadge slot="end" color={statusColor(selected.node_status)} style={{ marginLeft: 8 }}>
                    {selected.node_name} · {selected.node_status}
                  </IonBadge>
                )}
              </IonLabel>
            </IonItem>
            <IonItem lines="none">
              <IonSelect
                label="Assign to bed"
                labelPlacement="stacked"
                placeholder="Select a bed"
                value={bedChoice}
                onIonChange={e => setBedChoice(e.detail.value)}
              >
                {beds.map(b => (
                  <IonSelectOption key={b.id} value={b.id}>
                    {b.label}{b.node_name ? ` (${b.node_name})` : ''}
                  </IonSelectOption>
                ))}
              </IonSelect>
            </IonItem>
            <IonButtons style={{ marginTop: 8 }}>
              <IonButton
                size="small" color="primary" fill="solid"
                disabled={!bedChoice || bedChoice === selected.bed_id}
                onClick={handleAssign}
              >
                {selected.bed_id ? 'Move' : 'Assign'}
              </IonButton>
              {selected.bed_id && (
                <IonButton size="small" color="medium" onClick={handleDischarge}>
                  <IonIcon slot="start" icon={exitOutline} />Discharge
                </IonButton>
              )}
            </IonButtons>
          </IonCardContent>
        </IonCard>

        {/* Data file */}
        <DetailList
          title="Data File"
          rows={[
            { label: 'File key', value: selected.file_key ?? '' },
            {
              label: 'Download',
              value: selected.file_id ? (
                <IonButton
                  size="small" fill="outline"
                  href={`${API_BASE}${ENDPOINT.FILES}/${selected.file_id}/download`}
                  target="_blank"
                >
                  <IonIcon slot="start" icon={downloadOutline} />HDF5
                </IonButton>
              ) : <span style={{ color: 'var(--ion-color-medium)' }}>No file</span>,
            },
          ]}
        />

        {/* Demographics */}
        <DetailList title="Demographics" rows={demographicRows} emptyMessage="No demographics recorded" />

        {/* Assignment history */}
        <DataTable<BedAssignment>
          key={selected.id}
          title="Bed History"
          fetcher={async () => assignments}
          flattenRow={a => ({
            bed:     a.bed_label ?? '—',
            started: fmtDate(a.started_at),
            ended:   a.ended_at ? fmtDate(a.ended_at) : 'active',
          })}
          exportFilename={`${patientName(selected)}_bed_history`}
        />
      </>
    );
  };

  return (
    <SplitPageLayout
      navItems={AREA_NAV.DATA_COLLECTION}
      title="Data Collection"
      left={
        <ResourcePanel<Patient>
          data={patients}
          config={PANEL_CONFIG.PATIENTS}
          selectedId={selected?.id}
          getLabel={patientName}
          getSubLabel={p => p.bed_label ? `Bed: ${p.bed_label}` : 'No bed'}
          getBadge={p => p.node_status ? { label: p.node_status, color: statusColor(p.node_status) } : null}
          onSelect={setSelected}
          onAdd={() => setAddOpen(true)}
          onDelete={handleDelete}
          filter={{ text: search, onTextChange: setSearch, textPlaceholder: 'Search patients…' }}
          filterFn={(p, text) => !text || patientName(p).toLowerCase().includes(text.toLowerCase())}
        />
      }
      right={renderDetail()}
    >
      <ModalShell isOpen={addOpen} onDismiss={() => setAddOpen(false)} title="New Patient">
        {!formComponent ? (
          <IonItem lines="none"><IonSpinner slot="start" name="dots" /><IonLabel>&nbsp;Loading form…</IonLabel></IonItem>
        ) : (
          <FormRenderer
            mode="app"
            component={formComponent}
            onSubmit={handleCreate}
            submitLabel={creating ? 'Creating…' : 'Create Patient'}
          />
        )}
      </ModalShell>
    </SplitPageLayout>
  );
};

export default Patients;
