// Page: Model Library — alphabetical, searchable index of all model_configs.
// Clicking a model navigates to Simulator with that model pre-selected.

import React, { useEffect, useMemo, useState } from 'react';
import {
  IonBadge,
  IonItem,
  IonLabel,
  IonNote,
  IonSearchbar,
  IonSpinner,
} from '@ionic/react';
import { useHistory } from 'react-router-dom';
import SplitPageLayout from '../../components/shell/SplitPageLayout';
import EmptyState from '../../components/shell/EmptyState';
import ApiService from '../../services/Api';
import { ModelConfig } from '../../interfaces/types';
import { AREA_NAV, ROUTE } from '../../constants';

// ── Display name & category lookup ──────────────────────────────────────────

const DISPLAY: Record<string, { label: string; category: string }> = {
  // Healthy baselines
  'model_Hr_test':      { label: 'Cardiovascular System — Healthy Baseline',       category: 'Healthy Baselines' },
  'model_Hr_csf_icp':   { label: 'Cardiovascular + CSF / ICP — Healthy Baseline',  category: 'Healthy Baselines' },

  // Cardiovascular disease
  'model_Hr_arterial_stiffening':    { label: 'Arterial Stiffening (Age-Related / Atherosclerosis)',  category: 'Cardiovascular Disease' },
  'model_Hr_aortic_stenosis':        { label: 'Aortic Stenosis',                                      category: 'Cardiovascular Disease' },
  'model_Hr_bradycardia':            { label: 'Bradycardia (Sinus)',                                  category: 'Cardiovascular Disease' },
  'model_Hr_cardiogenic_shock':      { label: 'Cardiogenic Shock',                                    category: 'Cardiovascular Disease' },
  'model_Hr_heart_failure_diastolic':{ label: 'Heart Failure — Diastolic (HFpEF)',                   category: 'Cardiovascular Disease' },
  'model_Hr_heart_failure_systolic': { label: 'Heart Failure — Systolic (HFrEF)',                    category: 'Cardiovascular Disease' },
  'model_Hr_hypertension_mild':      { label: 'Hypertension (Mild)',                                  category: 'Cardiovascular Disease' },
  'model_Hr_hypertension_severe':    { label: 'Hypertension (Severe)',                               category: 'Cardiovascular Disease' },
  'model_Hr_hypovolemia':            { label: 'Hypovolaemia / Haemorrhage',                          category: 'Cardiovascular Disease' },
  'model_Hr_pulmonary_hypertension': { label: 'Pulmonary Arterial Hypertension',                     category: 'Cardiovascular Disease' },
  'model_Hr_septic_shock':           { label: 'Septic Shock / Vasodilatory Shock',                   category: 'Cardiovascular Disease' },
  'model_Hr_tachycardia':            { label: 'Tachycardia (Sinus)',                                  category: 'Cardiovascular Disease' },

  // Cerebrovascular disease
  'model_Hr_csf_icp_acute_ischemic_stroke':    { label: 'Acute Ischaemic Stroke — Large Vessel Occlusion',  category: 'Cerebrovascular Disease' },
  'model_Hr_csf_icp_carotid_stenosis_mild':    { label: 'Carotid / Cerebral Stenosis (Mild)',              category: 'Cerebrovascular Disease' },
  'model_Hr_csf_icp_carotid_stenosis_moderate':{ label: 'Carotid / Cerebral Stenosis (Moderate)',          category: 'Cerebrovascular Disease' },
  'model_Hr_csf_icp_carotid_stenosis_severe':  { label: 'Carotid / Cerebral Stenosis (Severe)',            category: 'Cerebrovascular Disease' },
  'model_Hr_csf_icp_vasospasm':                { label: 'Cerebral Vasospasm (Post-SAH)',                   category: 'Cerebrovascular Disease' },

  // CSF / ICP disorders
  'model_Hr_csf_icp_cerebral_edema':              { label: 'Cerebral Oedema / Mass Effect',                         category: 'CSF & ICP Disorders' },
  'model_Hr_csf_icp_chiari_malformation':          { label: 'Chiari Malformation (Craniospinal Obstruction)',        category: 'CSF & ICP Disorders' },
  'model_Hr_csf_icp_communicating_hydrocephalus':  { label: 'Communicating Hydrocephalus',                          category: 'CSF & ICP Disorders' },
  'model_Hr_csf_icp_decompensated_ich':            { label: 'Decompensated Intracranial Hypertension / Herniation', category: 'CSF & ICP Disorders' },
  'model_Hr_csf_icp_iih':                          { label: 'Idiopathic Intracranial Hypertension (IIH / Pseudotumour Cerebri)', category: 'CSF & ICP Disorders' },
  'model_Hr_csf_icp_nph':                          { label: 'Normal Pressure Hydrocephalus (NPH)',                  category: 'CSF & ICP Disorders' },
  'model_Hr_csf_icp_obstructive_hydrocephalus':    { label: 'Obstructive Hydrocephalus (Aqueductal Stenosis)',      category: 'CSF & ICP Disorders' },

  // CBF/CBV — Acute
  'model_cbf_hypertensive_encephalopathy_acute':          { label: 'Hypertensive Encephalopathy / PRES (Acute)',                 category: 'Cerebral Blood Flow — Acute' },
  'model_cbf_lvo_anticoagulated_acute':                   { label: 'LVO — Anticoagulation Present (Acute)',                     category: 'Cerebral Blood Flow — Acute' },
  'model_cbf_lvo_aortic_dissection_acute':                { label: 'LVO — Aortic Dissection / Cerebral Malperfusion (Acute)',   category: 'Cerebral Blood Flow — Acute' },
  'model_cbf_lvo_contraindicated_gi_bleed_anaemia_acute': { label: 'LVO — GI Bleed + Anaemia, tPA Contraindicated (Acute)',    category: 'Cerebral Blood Flow — Acute' },
  'model_cbf_lvo_contraindicated_recent_surgery_acute':   { label: 'LVO — Recent Surgery, tPA Contraindicated (Acute)',        category: 'Cerebral Blood Flow — Acute' },
  'model_cbf_lvo_contraindicated_thrombocytopenia_acute': { label: 'LVO — Thrombocytopenia, tPA Contraindicated (Acute)',      category: 'Cerebral Blood Flow — Acute' },
  'model_cbf_lvo_m1_acute':                               { label: 'LVO — M1 Occlusion, Standard (Acute)',                     category: 'Cerebral Blood Flow — Acute' },
  'model_cbf_lvo_m1_hypertensive_acute':                  { label: 'LVO — M1 Occlusion + Severe Hypertension (Acute)',         category: 'Cerebral Blood Flow — Acute' },
  'model_cbf_lvo_m1_sickle_cell_acute':                   { label: 'LVO — M1 Occlusion, Sickle Cell Disease (Acute)',          category: 'Cerebral Blood Flow — Acute' },
  'model_cbf_lvo_m1_wakeup_extended_acute':               { label: 'LVO — Wake-Up / Unknown Onset, M1 (Acute)',                category: 'Cerebral Blood Flow — Acute' },
  'model_cbf_lvo_pregnancy_acute':                        { label: 'LVO — Pregnancy (Acute)',                                  category: 'Cerebral Blood Flow — Acute' },
  'model_cbf_minor_stroke_acute':                         { label: 'Minor / Lacunar Stroke (Acute)',                           category: 'Cerebral Blood Flow — Acute' },
  'model_cbf_moderate_stroke_hypertension_dm_acute':      { label: 'Moderate MCA Stroke — Hypertension + Diabetes (Acute)',    category: 'Cerebral Blood Flow — Acute' },
  'model_cbf_moderate_stroke_no_comorbidities_acute':     { label: 'Moderate MCA Stroke — No Comorbidities (Acute)',           category: 'Cerebral Blood Flow — Acute' },
  'model_cbf_normal_reference':                           { label: 'Normal CBF / CBV — Reference (Healthy Baseline / Mimic)', category: 'Cerebral Blood Flow — Acute' },
  'model_cbf_posterior_fossa_stroke_acute':               { label: 'Posterior Fossa / Vertebrobasilar Stroke (Acute)',         category: 'Cerebral Blood Flow — Acute' },

  // CBF/CBV — Post-treatment & progression
  'model_cbf_mimic_resolved_2d':                          { label: 'Stroke Mimic — Resolved (Day 2–3)',                                       category: 'Cerebral Blood Flow — Progression (Day 2–3)' },
  'model_cbf_post_thrombectomy_sickle_cell_exchange_2d':  { label: 'Post-Thrombectomy + Exchange Transfusion, Sickle Cell (Day 2–3)',         category: 'Cerebral Blood Flow — Progression (Day 2–3)' },
  'model_cbf_post_thrombectomy_successful_2d':            { label: 'Post-Thrombectomy — Successful Recanalization (Day 2–3)',                 category: 'Cerebral Blood Flow — Progression (Day 2–3)' },
  'model_cbf_post_thrombectomy_tpa_ci_2d':                { label: 'Post-Thrombectomy — tPA Contraindicated, LVO (Day 2–3)',                 category: 'Cerebral Blood Flow — Progression (Day 2–3)' },
  'model_cbf_post_tpa_full_recanalisation_2d':            { label: 'Post-tPA — Full Recanalization (Day 2–3)',                               category: 'Cerebral Blood Flow — Progression (Day 2–3)' },
  'model_cbf_post_tpa_partial_recanalisation_2d':         { label: 'Post-tPA — Partial Recanalization (Day 2–3)',                            category: 'Cerebral Blood Flow — Progression (Day 2–3)' },
  'model_cbf_untreated_lvo_established_infarct_2d':       { label: 'Untreated LVO — Established Infarct (Day 2–3)',                          category: 'Cerebral Blood Flow — Progression (Day 2–3)' },
  'model_cbf_untreated_lvo_haemorrhagic_transformation_2d':{ label: 'Untreated LVO — Haemorrhagic Transformation (Day 2–3)',                 category: 'Cerebral Blood Flow — Progression (Day 2–3)' },
  'model_cbf_untreated_lvo_malignant_edema_2d':           { label: 'Untreated LVO — Malignant Oedema (Day 2–3)',                             category: 'Cerebral Blood Flow — Progression (Day 2–3)' },
  'model_cbf_untreated_moderate_stroke_evolution_2d':     { label: 'Untreated Moderate Stroke — Evolution (Day 2–3)',                        category: 'Cerebral Blood Flow — Progression (Day 2–3)' },
};

const CATEGORY_ORDER = [
  'Healthy Baselines',
  'Cardiovascular Disease',
  'Cerebrovascular Disease',
  'CSF & ICP Disorders',
  'Cerebral Blood Flow — Acute',
  'Cerebral Blood Flow — Progression (Day 2–3)',
];

const CATEGORY_COLOR: Record<string, string> = {
  'Healthy Baselines':                          'success',
  'Cardiovascular Disease':                     'danger',
  'Cerebrovascular Disease':                    'warning',
  'CSF & ICP Disorders':                        'tertiary',
  'Cerebral Blood Flow — Acute':                'primary',
  'Cerebral Blood Flow — Progression (Day 2–3)':'medium',
};

function getDisplay(name: string): { label: string; category: string } {
  return DISPLAY[name] ?? {
    label: name.replace(/^model_/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    category: 'Other',
  };
}

// ── Component ────────────────────────────────────────────────────────────────

const ModelLibrary: React.FC = () => {
  const history = useHistory();
  const [models, setModels]   = useState<ModelConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');

  useEffect(() => {
    ApiService.getModelConfigs().then(m => { setModels(m); setLoading(false); });
  }, []);

  const enriched = useMemo(() =>
    models.map(m => ({ ...m, ...getDisplay(m.name) })),
    [models]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return q ? enriched.filter(m =>
      m.label.toLowerCase().includes(q) ||
      m.category.toLowerCase().includes(q) ||
      (m.description ?? '').toLowerCase().includes(q)
    ) : enriched;
  }, [enriched, search]);

  // Group → letter → models
  type Enriched = typeof enriched[0];
  const grouped = useMemo(() => {
    const byCategory: Record<string, Enriched[]> = {};
    for (const m of filtered) {
      if (!byCategory[m.category]) byCategory[m.category] = [];
      byCategory[m.category].push(m);
    }
    // Sort within each category alphabetically by label
    for (const cat of Object.keys(byCategory))
      byCategory[cat].sort((a, b) => a.label.localeCompare(b.label));
    // Return in prescribed order, then any unknown categories alphabetically
    const ordered = [
      ...CATEGORY_ORDER.filter(c => byCategory[c]),
      ...Object.keys(byCategory).filter(c => !CATEGORY_ORDER.includes(c)).sort(),
    ];
    return ordered.map(cat => ({ cat, items: byCategory[cat] }));
  }, [filtered]);

  // Build alphabetical index within each category
  type AlphaGroup = { letter: string; items: Enriched[] };
  type CatBlock = { cat: string; letters: AlphaGroup[] };
  const alphabetical: CatBlock[] = useMemo(() =>
    grouped.map(({ cat, items }) => {
      const byLetter: Record<string, Enriched[]> = {};
      for (const m of items) {
        const l = m.label[0].toUpperCase();
        if (!byLetter[l]) byLetter[l] = [];
        byLetter[l].push(m);
      }
      const letters = Object.keys(byLetter).sort()
        .map(letter => ({ letter, items: byLetter[letter] }));
      return { cat, letters };
    }),
    [grouped]);

  const handleSelect = (m: ModelConfig) => {
    history.push(ROUTE.SIMULATOR, { autoRun: m });
  };

  return (
    <SplitPageLayout navItems={AREA_NAV.PHYSIOLOGY} title="Model Library">
      <div style={{ padding: '8px 0 4px' }}>
        <IonSearchbar
          autocapitalize="off"
          value={search}
          onIonInput={e => setSearch(e.detail.value ?? '')}
          placeholder="Search models, categories, or descriptions…"
          debounce={150}
          style={{ '--box-shadow': 'none' }}
        />
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}>
          <IonSpinner name="crescent" />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState message="No models match that search" />
      ) : (
        alphabetical.map(({ cat, letters }) => (
          <div key={cat} style={{ marginBottom: 24 }}>
            {/* Category header */}
            <div style={{
              padding: '6px 16px 4px',
              fontSize: '0.7rem',
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: `var(--ion-color-${CATEGORY_COLOR[cat] ?? 'medium'})`,
              borderBottom: `2px solid var(--ion-color-${CATEGORY_COLOR[cat] ?? 'medium'})`,
              marginBottom: 4,
            }}>
              {cat}
            </div>

            {letters.map(({ letter, items }) => (
              <div key={letter}>
                {/* Alphabet divider */}
                <div style={{
                  padding: '2px 16px',
                  fontSize: '0.65rem',
                  fontWeight: 700,
                  color: 'var(--ion-color-medium)',
                  background: 'var(--ion-background-color)',
                  borderBottom: '1px solid var(--ion-border-color)',
                  letterSpacing: '0.1em',
                }}>
                  {letter}
                </div>

                {items.map(m => (
                  <IonItem
                    key={m.id}
                    button
                    detail={true}
                    onClick={() => handleSelect(m)}
                    lines="inset"
                  >
                    <IonLabel>
                      <h2 style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: 2 }}>
                        {m.label}
                      </h2>
                      {m.description && (
                        <IonNote style={{ fontSize: '0.75rem', display: 'block', marginTop: 2, lineHeight: 1.4 }}>
                          {m.description.length > 140
                            ? m.description.slice(0, 140) + '…'
                            : m.description}
                        </IonNote>
                      )}
                    </IonLabel>
                    <IonBadge slot="end" color={CATEGORY_COLOR[m.category] ?? 'medium'}
                      style={{ fontSize: '0.65rem', marginLeft: 8, whiteSpace: 'nowrap' }}>
                      {m.category.split('—')[0].trim().split(' ').slice(-1)[0]}
                    </IonBadge>
                  </IonItem>
                ))}
              </div>
            ))}
          </div>
        ))
      )}
    </SplitPageLayout>
  );
};

export default ModelLibrary;
