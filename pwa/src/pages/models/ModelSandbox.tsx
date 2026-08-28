// Page: ModelSandbox — visual builder for cardio-pulmonary model configs.
// Reads/writes: model_configs table (GraphQL); config/metadata.json via /api/cardio/metadata.
// Every section, type, param field and derived state comes from modelSchema (authenticated).

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
} from '@ionic/react';
import ApiService from '../../services/Api';
import SplitPageLayout from '../../components/shell/SplitPageLayout';
import TabPanel from '../../components/shell/TabPanel';
import ResourcePanel from '../../components/shell/ResourcePanel';
import ModalShell from '../../components/shell/ModalShell';
import JsonViewer from '../../components/shell/JsonViewer';
import FormRenderer from '../../components/forms/FormRenderer';
import EmptyState from '../../components/shell/EmptyState';
import ModelCanvas from '../../components/charts/ModelCanvas';
import { ModelConfig, ModelMetadata, ComponentResults } from '../../interfaces/types';
import { AREA_NAV, PANEL_CONFIG, FORM_ID } from '../../constants';
import { downloadBlob } from '../../utils/download';
import {
  Finding, FieldDef, ModelJson, Section, SCHEMA,
  applyEntity, canonicalModelJson, deriveParameterStates, editValuesFor, entityId, entryType,
  inferGasExchange, membraneSpecies, membraneUsesSpeciesMap, removeEntity, sectionEntries,
  sortedStateEntries, typeOptions, validateModel,
} from './modelSchema';


/*
 ██    ██  ████████  ██        ██████    ████████  ██████      ██████
 ██    ██  ██        ██        ██    ██  ██        ██    ██  ██
 ████████  ██████    ██        ██████    ██████    ██████      ████
 ██    ██  ██        ██        ██        ██        ██    ██        ██
 ██    ██  ████████  ████████  ██        ████████  ██    ██  ██████
                                                                       */


// A brand-new model: the smallest structure the generator accepts. It carries no
// `configurations` and no `modelParams` — modelClass overwrites the first from the
// scenario before the generator runs, and nothing reads the second (volumeDistribution
// lives in the scenario's shared.twin, edited in the Scenario Sandbox).
const BLANK_MODEL: ModelJson = {
  states:      { V_Atm: 0.0, P_Atm: 760.0, T: 0.0, T0: 0.0 },
  connections: {
    resistive: {},
    membrane:  {},
    bias:      { Atm: 'Atm' },
    regions:   { Atm: [] },
    cycles:    { Atm: '' },
  },
  cycles:      {},
  compartments: {
    Atm: {
      gasRegion: 'Atmosphere',
      type:      'component',
      capacitor: { type: 'constantPressure', params: { y0: 0.0, p0: 760.0 } },
    },
  },
  reactions:   {},
  other:       {},
  calibration: {},
  control:     {},
};

// Which panel config titles the section panels. Panels are grouped into two columns so
// the eight sections stay scannable in the narrow builder column.
const PANEL_FOR: Record<Section, typeof PANEL_CONFIG[keyof typeof PANEL_CONFIG]> = {
  compartments: PANEL_CONFIG.COMPARTMENTS,
  resistive:    PANEL_CONFIG.CONNECTIONS,
  membrane:     PANEL_CONFIG.MEMBRANES,
  cycles:       PANEL_CONFIG.CYCLES,
  other:        PANEL_CONFIG.OTHER,
  reactions:    PANEL_CONFIG.REACTIONS,
  calibration:  PANEL_CONFIG.CALIBRATION,
  control:      PANEL_CONFIG.CONTROL,
};

const STRUCTURE_SECTIONS: Section[] = ['compartments', 'resistive', 'membrane', 'cycles'];
const BEHAVIOUR_SECTIONS: Section[] = ['other', 'reactions', 'calibration', 'control'];

interface SectionItem { id: string; sub: string }

/** The one-line summary under each entry — enough to tell entries apart without opening. */
function subLabel(section: Section, entry: any): string {
  const type = entryType(section, entry);
  switch (section) {
    case 'resistive':
    case 'membrane':    return `${entry?.from} → ${entry?.to}  (${type})`;
    case 'cycles':      return `${type} · ${entry?.params?.duration ?? 0}s`;
    case 'calibration':
    case 'control':     return `${type} ← ${entry?.params?.varTarget ?? entry?.params?.xAxis ?? '—'}`;
    default:            return type;
  }
}

/** Build the throwaway FormRenderer tree a modal renders. The form system is tree-driven,
 *  so a locally-built tree is how a page gets a form whose shape is computed, not seeded. */
function buildLocalForm(key: string, fields: FieldDef[], selectKinds: Set<string>): ComponentResults {
  return {
    name: `local_${key}`,
    type: 'form',
    data: { text: '' },
    options: {},
    children: fields.map(f => ({
      name:     `f_${f.name}`,
      type:     selectKinds.has(f.kind) ? 'select' : f.kind === 'number' ? 'number' : 'input',
      data:     { text: f.note ? `${f.label} — ${f.note}` : f.label },
      options:  { label: f.name, placeholder: f.kind === 'number' ? '0' : '' },
      children: [],
    })),
  };
}

/** Field kinds rendered as a dropdown; everything else is a text/number input. */
const SELECT_KINDS = new Set(['select', 'compartmentRef', 'cycleRef', 'gasRegionRef', 'parameterRef']);

/** List-valued params (reactants, ratios, stateSummation's states) are edited as
 *  comma-separated text; buildParams splits them back on submit. */
const formValues = (values: Record<string, any>): Record<string, any> =>
  Object.fromEntries(Object.entries(values).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : v]));

const opt = (values: string[]) => values.map(v => ({ value: v, label: v }));


const ModelSandbox: React.FC = () => {


/*
   ██████  ██████████    ████    ██████████  ████████
 ██            ██      ██    ██      ██      ██
   ████        ██      ████████      ██      ██████
       ██      ██      ██    ██      ██      ██
 ██████        ██      ██    ██      ██      ████████
                                                       */


  // Model list
  const [version, setVersion]               = useState(0);
  const [selectedConfig, setSelectedConfig] = useState<ModelConfig | null>(null);

  // Working model — local edit buffer loaded from selectedConfig.config
  const [workingModel, setWorkingModel]     = useState<ModelJson | null>(null);

  // config/metadata.json — the gas-region and species table every picker resolves against
  const [metadata, setMetadata]             = useState<ModelMetadata | null>(null);

  // New model modal
  const [newModalOpen, setNewModalOpen] = useState(false);
  const [newForm, setNewForm]           = useState<ComponentResults | null>(null);
  const [newError, setNewError]         = useState<string | null>(null);

  // Import JSON
  const importInputRef                  = useRef<HTMLInputElement>(null);
  const [importError, setImportError]   = useState<string | null>(null);

  // One selection per section — drives panel highlight and the canvas
  const [selected, setSelected]         = useState<Partial<Record<Section, string | null>>>({});

  // The single add/edit modal, shared by all eight sections
  const [modalSection, setModalSection] = useState<Section | null>(null);
  const [modalType, setModalType]       = useState('');
  const [modalValues, setModalValues]   = useState<Record<string, any>>({});
  const [modalEditing, setModalEditing] = useState<string | null>(null);
  const [modalError, setModalError]     = useState<string | null>(null);
  // Membrane only: the per-species diffusion/solubility map, edited outside the form tree
  const [speciesDraft, setSpeciesDraft] = useState<Record<string, Record<string, number>>>({});

  // Save state
  const [saving, setSaving]       = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);


/*
 ██          ████      ████    ██████
 ██        ██    ██  ██    ██  ██    ██
 ██        ██    ██  ████████  ██    ██
 ██        ██    ██  ██    ██  ██    ██
 ████████    ████    ██    ██  ██████
                                         */


  const fetchConfigs = useCallback(() => ApiService.getModelConfigs(), []);

  useEffect(() => {
    setWorkingModel(selectedConfig ? JSON.parse(JSON.stringify(selectedConfig.config)) : null);
    setSelected({});
  }, [selectedConfig?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    ApiService.getComponentByName(FORM_ID.ADD_MODEL_CONFIG).then(f => setNewForm(f ?? null));
    ApiService.getCardioMetadata().then(setMetadata).catch(() => setMetadata(null));
  }, []);


/*
 ██      ██    ████    ██████    ████████  ██
 ███    ███  ██    ██  ██    ██  ██        ██
 ██ ████ ██  ██    ██  ██    ██  ██████    ██
 ██  ██  ██  ██    ██  ██    ██  ██        ██
 ██      ██    ████    ██████    ████████  ████████
                                                     */


  const gasExchange = workingModel ? inferGasExchange(workingModel) : false;

  const compartmentNames = useMemo(
    () => Object.keys(workingModel?.compartments ?? {}), [workingModel]);

  const cycleNames = useMemo(
    () => Object.keys(workingModel?.cycles ?? {}), [workingModel]);

  const parameterStates = useMemo(
    () => (workingModel ? deriveParameterStates(workingModel, metadata, gasExchange) : []),
    [workingModel, metadata, gasExchange]);

  const findings: Finding[] = useMemo(
    () => (workingModel ? validateModel(workingModel, metadata) : []),
    [workingModel, metadata]);

  const itemsFor = useCallback((section: Section): SectionItem[] =>
    sectionEntries(workingModel ?? {}, section).map(([id, entry]) => ({ id, sub: subLabel(section, entry) })),
    [workingModel]);


/*
 ██    ██    ████    ██      ██  ██████    ██        ████████  ██████      ██████
 ██    ██  ██    ██  ████    ██  ██    ██  ██        ██        ██    ██  ██
 ████████  ████████  ██  ██  ██  ██    ██  ██        ██████    ██████      ████
 ██    ██  ██    ██  ██    ████  ██    ██  ██        ██        ██    ██        ██
 ██    ██  ██    ██  ██      ██  ██████    ████████  ████████  ██    ██  ██████
                                                                                   */


  // ── New model ──────────────────────────────────────────────────────────────

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
      const created = await ApiService.createModelConfig(name, desc, BLANK_MODEL);
      setSelectedConfig(created);
      setVersion(v => v + 1);
      setNewModalOpen(false);
    } catch (err: any) {
      setNewError(err.message ?? 'Failed to create');
    }
  };

  const handleDelete = async (cfg: ModelConfig) => {
    await ApiService.deleteModelConfig(cfg.id);
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
      const created = await ApiService.createModelConfig(name, '', json);
      setSelectedConfig(created);
      setVersion(v => v + 1);
    } catch (e) {
      setImportError((e as Error).message);
    }
  };

  // ── The one entity modal, for all eight sections ───────────────────────────

  /** Opening for an existing id prefills from the entry: its meta fields (which live on
   *  the entry body or in the connections maps) plus its `params`. */
  const openEntityModal = (section: Section, id?: string) => {
    const types = Object.keys(SCHEMA[section].types);
    setModalSection(section);
    setModalError(null);
    setSpeciesDraft({});

    if (!id) {
      setModalEditing(null);
      setModalType(types[0]);
      setModalValues({});
      return;
    }

    const entry = Object.fromEntries(sectionEntries(workingModel ?? {}, section))[id];
    const type  = entryType(section, entry);
    setModalEditing(id);
    setModalType(types.includes(type) ? type : types[0]);
    setModalValues(formValues(editValuesFor(workingModel ?? {}, section, id, entry)));
    if (section === 'membrane') setSpeciesDraft(entry?.params ?? {});
    setSelected(s => ({ ...s, [section]: id }));
  };

  const submitEntity = (values: Record<string, any>) => {
    if (!modalSection || !workingModel) return;
    const payload = modalSection === 'membrane' ? { ...values, speciesParams: speciesDraft } : values;
    const { model, error } = applyEntity(workingModel, metadata, modalSection, modalType, payload, modalEditing);
    if (error) { setModalError(error); return; }
    setWorkingModel(model);
    setSelected(s => ({ ...s, [modalSection]: entityId(modalSection, modalType, payload) }));
    setModalSection(null);
  };

  const removeEntityAt = (section: Section, id: string) => {
    if (!workingModel) return;
    const { model, dependants } = removeEntity(workingModel, metadata, section, id);
    if (dependants.length > 0) {
      setSaveError(`Cannot remove "${id}" — still referenced by ${dependants.join(', ')}.`);
      return;
    }
    setSaveError(null);
    setWorkingModel(model);
    setSelected(s => (s[section] === id ? { ...s, [section]: null } : s));
  };

  // ── States ─────────────────────────────────────────────────────────────────

  const handleStateChange = (key: string, raw: string) => {
    const value = parseFloat(raw);
    setWorkingModel(prev => (prev ? { ...prev, states: { ...prev.states, [key]: Number.isFinite(value) ? value : 0 } } : prev));
  };

  // ── Save model ─────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!selectedConfig || !workingModel) return;
    setSaving(true); setSaveError(null);
    try {
      // Save what the JSON viewer and the download show — one canonical shape everywhere.
      const updated = await ApiService.updateModelConfig(selectedConfig.id, { config: canonicalModelJson(workingModel) });
      setSelectedConfig(updated);
    } catch (err: any) {
      setSaveError(err.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  };


/*
 ██████    ████████  ██      ██  ██████    ████████  ██████
 ██    ██  ██        ████    ██  ██    ██  ██        ██    ██
 ██████    ██████    ██  ██  ██  ██    ██  ██████    ██████
 ██    ██  ██        ██    ████  ██    ██  ██        ██    ██
 ██    ██  ████████  ██      ██  ██████    ████████  ██    ██
                                                               */


  const jsonPreview = workingModel ? JSON.stringify(canonicalModelJson(workingModel), null, 2) : '';

  const handleDownload = () => {
    if (!workingModel || !selectedConfig) return;
    const blob = new Blob([jsonPreview], { type: 'application/json' });
    downloadBlob(blob, `${selectedConfig.name}.json`);
  };

  const stateEntries = sortedStateEntries(workingModel?.states ?? {});

  const modalFields: FieldDef[] = modalSection
    ? [...SCHEMA[modalSection].meta, ...(SCHEMA[modalSection].types[modalType]?.fields ?? [])]
    : [];

  /** Dropdown choices per field kind, all derived from the model or metadata — never a
   *  second hard-coded list. */
  const injectedOptions = useMemo(() => {
    const out: Record<string, { value: string; label: string }[]> = {};
    for (const f of modalFields) {
      if (f.kind === 'compartmentRef') out[f.name] = opt(compartmentNames);
      else if (f.kind === 'cycleRef')      out[f.name] = [{ value: '', label: 'None' }, ...opt(cycleNames)];
      else if (f.kind === 'gasRegionRef')  out[f.name] = opt(Object.keys(metadata?.gasRegions ?? {}));
      else if (f.kind === 'parameterRef')  out[f.name] = opt(parameterStates);
      else if (f.options)                  out[f.name] = f.options;
    }
    return out;
  }, [modalFields, compartmentNames, cycleNames, metadata, parameterStates]);

  // The species a membrane can actually carry: present in BOTH endpoints' gas regions.
  const modalSpecies = modalSection === 'membrane' && workingModel
    ? membraneSpecies({
        key: String(modalValues.name ?? ''), params: {}, model: workingModel, meta: metadata,
        gas: gasExchange, from: modalValues.from, to: modalValues.to,
      })
    : [];

  const sectionPanel = (section: Section) => (
    <ResourcePanel<SectionItem>
      key={section}
      data={itemsFor(section)}
      config={PANEL_FOR[section]}
      selectedId={selected[section] ?? null}
      getLabel={i => i.id}
      getSubLabel={i => i.sub}
      onSelect={i => openEntityModal(section, i.id)}
      onDelete={i => removeEntityAt(section, i.id)}
      onAdd={selectedConfig ? () => openEntityModal(section) : undefined}
      collapsible
    />
  );

  return (
    <SplitPageLayout
      navItems={AREA_NAV.PHYSIOLOGY}
      title="Model Sandbox"
      rightHeader={
        selectedConfig && workingModel ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px' }}>
            <IonNote style={{ fontSize: '0.75rem' }}>
              {gasExchange ? 'gas exchange + metabolism' : 'cardiovascular only'}
            </IonNote>
            {saveError && <IonText color="danger" style={{ fontSize: '0.8rem' }}>{saveError}</IonText>}
            <IonButton size="small" disabled={saving} onClick={handleSave}>
              {saving ? <IonSpinner name="dots" /> : 'Save'}
            </IonButton>
          </div>
        ) : undefined
      }
      leftTabs={[{
        label: 'Configurations',
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
              config={PANEL_CONFIG.MODEL_CONFIGS}
              selectedId={selectedConfig?.id}
              getLabel={c => c.name}
              onSelect={setSelectedConfig}
              onDelete={handleDelete}
              onAdd={openNewModal}
            />
          </>
        ),
      }]}
      hidden={
        <input
          ref={importInputRef}
          type="file"
          accept=".json"
          style={{ display: 'none' }}
          onChange={handleImportFile}
        />
      }
      right={
        <TabPanel tabs={[
          {
            label: 'Builder',
            content: (
              <>
                {/* ═══════════════════════════════════════════════════════════
                     Section panels · states · JSON                            */}
                <IonGrid>
                  <IonRow>
                    <IonCol size="3">
                      {STRUCTURE_SECTIONS.map(sectionPanel)}
                    </IonCol>
                    <IonCol size="3">
                      {BEHAVIOUR_SECTIONS.map(sectionPanel)}
                    </IonCol>
                    <IonCol size="3">
                      {/* ═══════════════════════════════════════════════════════════
                           Initial states                                            */}
                      <IonItem lines="full">
                        <IonLabel style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                          Initial States ({stateEntries.length})
                        </IonLabel>
                      </IonItem>
                      <div style={{ overflowY: 'auto', maxHeight: 320 }}>
                        {stateEntries.length === 0
                          ? <IonNote style={{ padding: '8px 16px', display: 'block' }}>No states yet</IonNote>
                          : stateEntries.map(([key, val]) => (
                            <IonItem key={key} lines="full" style={{ '--min-height': '36px' }}>
                              <IonLabel style={{ fontSize: '0.75rem', fontFamily: 'monospace' }}>{key}</IonLabel>
                              <IonInput
                                slot="end"
                                type="number"
                                value={String(val)}
                                style={{ textAlign: 'right', maxWidth: 90, fontSize: '0.8rem' }}
                                onIonBlur={e => handleStateChange(key, (e.target as HTMLIonInputElement).value as string)}
                              />
                            </IonItem>
                          ))
                        }
                      </div>

                      {/* ═══════════════════════════════════════════════════════════
                           Structural findings                                       */}
                      <IonItem lines="full">
                        <IonLabel style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                          Checks ({findings.length})
                        </IonLabel>
                      </IonItem>
                      <div style={{ overflowY: 'auto', maxHeight: 240 }}>
                        {!workingModel
                          ? <IonNote style={{ padding: '8px 16px', display: 'block' }}>No model selected</IonNote>
                          : findings.length === 0
                            ? <IonNote style={{ padding: '8px 16px', display: 'block' }}>Structure is consistent</IonNote>
                            : findings.map((f, i) => (
                              <IonItem key={i} lines="full" style={{ '--min-height': '32px' }}>
                                <IonText color={f.level === 'error' ? 'danger' : 'warning'} style={{ fontSize: '0.72rem' }}>
                                  {f.message}
                                </IonText>
                              </IonItem>
                            ))
                        }
                      </div>
                    </IonCol>
                    <IonCol size="3">
                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
                        <IonButton size="small" fill="outline" disabled={!workingModel} onClick={handleDownload}>
                          Download
                        </IonButton>
                      </div>
                      <JsonViewer value={workingModel ? canonicalModelJson(workingModel) : {}} />
                    </IonCol>
                  </IonRow>
                </IonGrid>

                {/* ═══════════════════════════════════════════════════════════
                     Canvas                                                    */}
                <IonGrid>
                  <IonRow>
                    <IonCol size="12">
                      <ModelCanvas
                        modelJson={workingModel}
                        selectedNode={selected.compartments ?? null}
                        onSelectNode={name => openEntityModal('compartments', name)}
                      />
                    </IonCol>
                  </IonRow>
                </IonGrid>
              </>
            ),
          },
        ]} />
      }
    >
      {/* ═══════════════════════════════════════════════════════════
           New model modal                                           */}
      <ModalShell
        isOpen={newModalOpen}
        onDismiss={() => setNewModalOpen(false)}
        title="New Model"
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

      {/* ═══════════════════════════════════════════════════════════
           Entity modal — one modal for all eight sections           */}
      <ModalShell
        isOpen={modalSection !== null}
        onDismiss={() => setModalSection(null)}
        title={`${modalEditing ? 'Edit' : 'Add'} ${modalSection ? SCHEMA[modalSection].label.replace(/s$/, '') : ''}`}
        dismissLabel="Cancel"
      >
        {modalSection && (
          <>
            <IonItem lines="full">
              <IonSelect
                label="Type"
                labelPlacement="stacked"
                value={modalType}
                // The type decides which states an entry owns, so changing it on an
                // existing entry would silently re-key the state vector. Delete and re-add.
                disabled={modalEditing !== null}
                onIonChange={e => setModalType(e.detail.value)}
              >
                {typeOptions(modalSection).map(t => (
                  <IonSelectOption key={t.value} value={t.value}>{t.label}</IonSelectOption>
                ))}
              </IonSelect>
            </IonItem>

            {modalError && <IonText color="danger" style={{ padding: '4px 16px', display: 'block' }}>{modalError}</IonText>}

            {/* Per-species diffusion / solubility, for the membrane types that use it. */}
            {modalSection === 'membrane' && membraneUsesSpeciesMap(modalType) && (
              <>
                <IonItem lines="full">
                  <IonLabel style={{ fontWeight: 600, fontSize: '0.85rem' }}>Species</IonLabel>
                </IonItem>
                {modalSpecies.length === 0 ? (
                  <IonNote style={{ padding: '8px 16px', display: 'block', fontSize: '0.75rem' }}>
                    {modalEditing
                      ? 'The two endpoints’ gas regions share no species, so this membrane exchanges nothing.'
                      : 'Add the membrane first, then reopen it — the species list is the overlap of the two endpoints’ gas regions.'}
                  </IonNote>
                ) : modalSpecies.map(species => (
                  <IonItem key={species} lines="full" style={{ '--min-height': '40px' }}>
                    <IonLabel style={{ fontSize: '0.75rem', fontFamily: 'monospace' }}>{species}</IonLabel>
                    {(['diffusion', 'solubility'] as const).map(field => (
                      <IonInput
                        key={field}
                        slot="end"
                        type="number"
                        placeholder={field}
                        value={String(speciesDraft[species]?.[field] ?? '')}
                        style={{ textAlign: 'right', maxWidth: 110, fontSize: '0.8rem' }}
                        onIonBlur={e => {
                          const v = parseFloat((e.target as HTMLIonInputElement).value as string);
                          setSpeciesDraft(prev => ({
                            ...prev,
                            [species]: { ...prev[species], [field]: Number.isFinite(v) ? v : 0 },
                          }));
                        }}
                      />
                    ))}
                  </IonItem>
                ))}
              </>
            )}

            <FormRenderer
              key={`${modalSection}_${modalType}_${modalEditing ?? 'new'}`}
              component={buildLocalForm(`${modalSection}_${modalType}`, modalFields, SELECT_KINDS)}
              defaultValues={modalValues}
              injectedOptions={injectedOptions}
              onSubmit={submitEntity}
              submitLabel={modalEditing ? 'Save' : 'Add'}
            />
          </>
        )}
        {!modalSection && <EmptyState message="No section selected" />}
      </ModalShell>
    </SplitPageLayout>
  );
};

export default ModelSandbox;
