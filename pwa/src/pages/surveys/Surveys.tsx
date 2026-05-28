// Page: Surveys — survey builder, form filler, and answer viewer.
// Reads/writes: surveys + survey_components tables (GraphQL). Answers stored per survey.
// Authenticated. Build tab visible to all; admin controls gated via isAdmin where needed.

import React, { useEffect, useRef, useState } from 'react';
import {
  IonButton,
  IonCard, IonCardContent,
  IonChip,
  IonItem, IonLabel,
  IonSpinner, IonText,
} from '@ionic/react';
import ApiService from '../../services/Api';
import SplitPageLayout from '../../components/shell/SplitPageLayout';
import TabPanel from '../../components/shell/TabPanel';
import ResourcePanel from '../../components/shell/ResourcePanel';
import FormRenderer from '../../components/forms/FormRenderer';
import ModalShell from '../../components/shell/ModalShell';
import EmptyState from '../../components/shell/EmptyState';
import DataTable, { flattenObject } from '../../components/shell/DataTable';
import TreeEditor, { TreeEditorHandle } from '../../components/shell/TreeEditor';
import { Survey, SurveyAnswer, ComponentResults } from '../../interfaces/types';
import { SURVEY_QUESTION_TYPES, SURVEY_TYPE, AREA_NAV, FORM_ID, PANEL_CONFIG, SURVEY_EDITOR_ID, SURVEY_ADDABLE_TYPES, API_BASE, ENDPOINT } from '../../constants';
import { useAuth } from '../../contexts/AuthContext';


/*
 ██    ██  ████████  ██        ██████    ████████  ██████      ██████
 ██    ██  ██        ██        ██    ██  ██        ██    ██  ██
 ████████  ██████    ██        ██████    ██████    ██████      ████
 ██    ██  ██        ██        ██        ██        ██    ██        ██
 ██    ██  ████████  ████████  ██        ████████  ██    ██  ██████
                                                                       */


const formatDate = (val: string) => {
  if (!val) return '—';
  const d = new Date(val);
  return isNaN(d.getTime()) ? val : d.toLocaleString();
};

const buildLabelMap = (node: ComponentResults, map = new Map<string, string>()): Map<string, string> => {
  if (node.id && SURVEY_QUESTION_TYPES.has(node.type)) {
    map.set(node.id, node.data?.text ?? node.name ?? node.id);
  }
  node.children?.forEach((child: ComponentResults) => buildLabelMap(child, map));
  return map;
};

const typeBadgeColor = (type: string): string => {
  if (type === SURVEY_TYPE.SURVEY)   return 'primary';
  if (type === SURVEY_TYPE.SELECT)   return 'secondary';
  if (type === SURVEY_TYPE.OPTION)   return 'light';
  if (type === SURVEY_TYPE.CHECK)    return 'success';
  if (type === SURVEY_TYPE.SCALE)    return 'warning';
  return 'medium';
};

const getQuestionDefaultValues = (node: ComponentResults) => ({
  text:        node.data?.text,
  placeholder: node.options?.placeholder,
  min:         node.options?.min,
  max:         node.options?.max,
});

const buildQuestionOptions = (type: string, values: Record<string, any>) => {
  const opts: Record<string, any> = {};
  if (values.placeholder) opts.placeholder = values.placeholder;
  if (type === SURVEY_TYPE.SCALE) {
    opts.min = Number(values.min);
    opts.max = Number(values.max);
  }
  return Object.keys(opts).length ? opts : null;
};

const surveyTreeProps = (
  formFetcher: (type: string) => Promise<ComponentResults | null | undefined>,
  parentsFetcher: (node: ComponentResults) => Promise<ComponentResults[]>,
  onDeleteNode: (node: ComponentResults) => Promise<void>,
  onSaveNode: (node: ComponentResults, values: any) => Promise<void>,
) => ({
  getLabel:         (node: ComponentResults) => node.data?.text ?? node.name,
  getBadgeLabel:    (node: ComponentResults) => node.type,
  getBadgeColor:    (node: ComponentResults) => typeBadgeColor(node.type),
  formFetcher,
  getDefaultValues: getQuestionDefaultValues,
  parentsFetcher,
  onDeleteNode,
  onSaveNode,
});

const Surveys: React.FC = () => {


/*
 ██████    ████████  ████████    ██████
 ██    ██  ██        ██        ██
 ██████    ██████    ██████      ████
 ██    ██  ██        ██              ██
 ██    ██  ████████  ██        ██████
                                         */


  const { isAdmin } = useAuth();

  const buildEditorRef = useRef<TreeEditorHandle>(null);
  const libEditorRef   = useRef<TreeEditorHandle>(null);


/*
   ██████  ██████████    ████    ██████████  ████████
 ██            ██      ██    ██      ██      ██
   ████        ██      ████████      ██      ██████
       ██      ██      ██    ██      ██      ██
 ██████        ██      ██    ██      ██      ████████
                                                       */


  const [surveyVersion, setSurveyVersion]   = useState(0);
  const [selectedSurvey, setSelectedSurvey] = useState<Survey | null>(null);
  const [formComponent, setFormComponent]   = useState<ComponentResults | null>(null);
  const [labelMap, setLabelMap]             = useState<Map<string, string>>(new Map());
  const [rightTab, setRightTab]              = useState(0);

  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted]   = useState(false);

  const [editingAnswer, setEditingAnswer]   = useState<SurveyAnswer | null>(null);
  const [answerEditOpen, setAnswerEditOpen] = useState(false);
  const [saving, setSaving]                 = useState(false);
  const [answerRefreshToken, setAnswerRefreshToken] = useState(0);

  const [newSurveyModal, setNewSurveyModal]       = useState(false);
  const [newSurveyForm, setNewSurveyForm]         = useState<ComponentResults | null>(null);
  const [newSurveyCreating, setNewSurveyCreating] = useState(false);

  const [questionVersion, setQuestionVersion] = useState(0);
  const [qTypeFilter, setQTypeFilter]         = useState('');
  const [qTextFilter, setQTextFilter]         = useState('');

  const [stats, setStats]             = useState<any | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);


/*
 ██          ████      ████    ██████
 ██        ██    ██  ██    ██  ██    ██
 ██        ██    ██  ████████  ██    ██
 ██        ██    ██  ██    ██  ██    ██
 ████████    ████    ██    ██  ██████
                                         */


  useEffect(() => {
    ApiService.getComponentByName(FORM_ID.NEW_SURVEY).then(f => setNewSurveyForm(f ?? null));
  }, []);

  const STATS_TAB = 3;
  useEffect(() => {
    if (!isAdmin || rightTab !== STATS_TAB || !selectedSurvey) return;
    let cancelled = false;
    setStats(null);
    setStatsLoading(true);
    ApiService.getSurveyStats(selectedSurvey.id).then(data => {
      if (!cancelled) { setStats(data); setStatsLoading(false); }
    });
    return () => { cancelled = true; };
  }, [selectedSurvey?.id, rightTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const reloadTree = async (componentId: string) => {
    const tree = await ApiService.getSurveyComponent(componentId);
    if (!tree) return;
    setFormComponent(tree);
    setLabelMap(buildLabelMap(tree));
  };

  const selectSurvey = async (survey: Survey) => {
    setSelectedSurvey(survey);
    setFormComponent(null);
    setSubmitted(false);
    setRightTab(0);
    try { await reloadTree(survey.component_id); }
    catch (e) { console.error('Error loading survey form:', e); }
  };


/*
 ████████  ██████  ██        ██
 ██          ██    ██        ██
 ██████      ██    ██        ██
 ██          ██    ██        ██
 ██        ██████  ████████  ████████
                                       */


  const handleSubmit = async (values: any) => {
    if (!selectedSurvey) return;
    setSubmitting(true);
    try { await ApiService.submitAnswer(selectedSurvey.id, values); setSubmitted(true); }
    catch (e) { console.error('Error submitting answer:', e); }
    finally { setSubmitting(false); }
  };


/*
   ████    ██      ██    ██████  ██          ██  ████████  ██████      ██████
 ██    ██  ████    ██  ██        ██          ██  ██        ██    ██  ██
 ████████  ██  ██  ██    ████    ██    ██    ██  ██████    ██████      ████
 ██    ██  ██    ████        ██    ██  ██  ██    ██        ██    ██        ██
 ██    ██  ██      ██  ██████        ██  ██      ████████  ██    ██  ██████
                                                                               */


  const openAnswerEdit = (answer: SurveyAnswer) => {
    setEditingAnswer(answer);
    setAnswerEditOpen(true);
  };

  const handleAnswerEditSubmit = async (values: any) => {
    if (!editingAnswer) return;
    setSaving(true);
    try {
      await ApiService.updateAnswer(editingAnswer.id, values);
      setAnswerEditOpen(false);
      setAnswerRefreshToken(v => v + 1);
    } catch (e) { console.error('Error updating answer:', e); }
    finally { setSaving(false); }
  };

  const handleAnswerDelete = async (id: string) => {
    await ApiService.deleteAnswer(id);
  };


/*
 ██      ██  ████████  ██          ██        ██████  ██    ██  ██████    ██      ██  ████████  ██      ██
 ████    ██  ██        ██          ██      ██        ██    ██  ██    ██  ██      ██  ██          ██  ██
 ██  ██  ██  ██████    ██    ██    ██        ████    ██    ██  ██████    ██      ██  ██████        ██
 ██    ████  ██          ██  ██  ██              ██  ██    ██  ██    ██    ██  ██    ██            ██
 ██      ██  ████████      ██  ██          ██████      ████    ██    ██      ██      ████████      ██
                                                                                                           */


  const handleCreateSurvey = async (values: any) => {
    if (!values.title?.trim()) return;
    setNewSurveyCreating(true);
    try {
      const compRes = await ApiService.createSurveyComponent(
        `survey_${Date.now()}`, SURVEY_TYPE.SURVEY,
        { text: values.title.trim() }, null, []
      );
      const rootId = compRes?.data?.createSurveyComponent?.id;
      if (rootId) {
        await ApiService.createSurvey(rootId, values.title.trim());
        setSurveyVersion(v => v + 1);
      }
    } catch (e) { console.error('Error creating survey:', e); }
    finally { setNewSurveyCreating(false); }
    setNewSurveyModal(false);
  };


/*
 ██████████  ██████    ████████  ████████
     ██      ██    ██  ██        ██
     ██      ██████    ██████    ██████
     ██      ██    ██  ██        ██
     ██      ██    ██  ████████  ████████
                                           */


  const treeReload = async () => {
    if (selectedSurvey) await reloadTree(selectedSurvey.component_id);
  };

  const treeSaveNode = async (node: ComponentResults, values: any) => {
    const data    = { text: values.text?.trim() };
    const options = buildQuestionOptions(node.type, values);
    await ApiService.updateSurveyComponent(node.id!, node.name, node.type, data, options);
    setQuestionVersion(v => v + 1);
  };

  const treeDeleteNode = async (node: ComponentResults) => {
    await ApiService.deleteSurveyComponent(node.id!);
    setQuestionVersion(v => v + 1);
  };

  const treeFormFetcher    = (type: string) => ApiService.getComponentByName(SURVEY_EDITOR_ID[type]);
  const treeParentsFetcher = (node: ComponentResults) => ApiService.getSurveyComponentParents(node.id!);

  const sharedProps = surveyTreeProps(treeFormFetcher, treeParentsFetcher, treeDeleteNode, treeSaveNode);


/*
 ██████    ████████  ██      ██  ██████    ████████  ██████
 ██    ██  ██        ████    ██  ██    ██  ██        ██    ██
 ██████    ██████    ██  ██  ██  ██    ██  ██████    ██████
 ██    ██  ██        ██    ████  ██    ██  ██        ██    ██
 ██    ██  ████████  ██      ██  ██████    ████████  ██    ██
                                                               */


  return (
    <SplitPageLayout
      navItems={AREA_NAV.SURVEYS}
      title="Surveys"
      hidden={
        <TreeEditor
          ref={libEditorRef}
          root={null}
          onReload={treeReload}
          isContainer={() => false}
          addableTypes={[]}
          onCreateNode={async () => {}}
          onLinkNode={async () => {}}
          onUnlink={async () => {}}
          {...sharedProps}
        />
      }
      leftTabs={[
        {
          label: 'Surveys',
          content: (
            <ResourcePanel
              fetcher={ApiService.getSurveys}
              refreshToken={surveyVersion}
              config={PANEL_CONFIG.SURVEYS_LIST}
              selectedId={selectedSurvey?.id}
              getLabel={(s: Survey) => s.title}
              onSelect={selectSurvey}
              onAdd={() => setNewSurveyModal(true)}
            />
          ),
        },
        {
          label: 'Questions',
          content: (
            <ResourcePanel
              config={PANEL_CONFIG.QUESTIONS_LIBRARY}
              fetcher={async () => {
                const all = await ApiService.getSurveyComponentList();
                return all
                  .filter(q => q.type !== SURVEY_TYPE.SURVEY && q.type !== SURVEY_TYPE.OPTION)
                  .filter((q): q is ComponentResults & { id: string } => !!q.id);
              }}
              refreshToken={questionVersion}
              getLabel={(q: ComponentResults) => q.data?.text ?? q.name ?? ''}
              getBadge={(q: ComponentResults) => ({ label: q.type, color: typeBadgeColor(q.type) })}
              onSelect={q => libEditorRef.current?.openEdit(q)}
              filterFn={(q: ComponentResults, text: string, typeValue: string) =>
                (!typeValue || q.type === typeValue) &&
                (!text || (q.data?.text ?? q.name ?? '').toLowerCase().includes(text.toLowerCase()))
              }
              filter={{
                types: Array.from(SURVEY_QUESTION_TYPES),
                typeValue: qTypeFilter,
                onTypeChange: setQTypeFilter,
                text: qTextFilter,
                onTextChange: setQTextFilter,
                textPlaceholder: 'Search…',
              }}
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
              label: 'Fill Form',
              content: !selectedSurvey ? (
                <EmptyState message="Select a survey to begin" />
              ) : submitted ? (
                <IonCard>
                  <IonCardContent>
                    <IonText color="success"><p>Submitted successfully!</p></IonText>
                    <IonButton onClick={() => setSubmitted(false)}>Fill Again</IonButton>
                  </IonCardContent>
                </IonCard>
              ) : !formComponent ? (
                <IonItem lines="none">
                  <IonSpinner slot="start" name="dots" />
                  <IonLabel>&nbsp;Loading form…</IonLabel>
                </IonItem>
              ) : (
                <FormRenderer
                  mode="survey"
                  key={selectedSurvey.id}
                  component={formComponent}
                  onSubmit={handleSubmit}
                  submitLabel={submitting ? 'Submitting…' : 'Submit'}
                />
              ),
            },
            {
              label: 'Answers',
              content: !selectedSurvey ? (
                <EmptyState message="Select a survey to begin" />
              ) : (
                <DataTable<SurveyAnswer>
                  key={selectedSurvey.id}
                  title="Answers"
                  fetcher={filter => ApiService.getSurveyAnswers(selectedSurvey.id, filter)}
                  flattenRow={a => flattenObject(a.answers)}
                  leadingCols={[{ label: 'Submitted', format: a => formatDate(a.submitted_at) }]}
                  labelMap={labelMap}
                  exportFilename={`${selectedSurvey.title}_answers`}
                  refreshToken={answerRefreshToken}
                  onEdit={openAnswerEdit}
                  onDelete={handleAnswerDelete}
                />
              ),
            },
            {
              label: 'Build',
              content: !selectedSurvey ? (
                <EmptyState message="Select a survey to begin" />
              ) : (
                <TreeEditor
                  ref={buildEditorRef}
                  root={formComponent}
                  onReload={treeReload}
                  isContainer={node => node.type === SURVEY_TYPE.SURVEY}
                  addableTypes={SURVEY_ADDABLE_TYPES}
                  linkableFetcher={ApiService.getSurveyComponentList}
                  linkableGroups={[
                    { label: 'Questions', filter: c => c.type !== SURVEY_TYPE.SURVEY },
                    { label: 'Surveys',   filter: c => c.type === SURVEY_TYPE.SURVEY },
                  ]}
                  onCreateNode={async (type, values, parentId, childCount) => {
                    const data    = { text: values.text?.trim() };
                    const options = buildQuestionOptions(type, values);
                    const res     = await ApiService.createSurveyComponent(
                      `q_${Date.now()}`, type, data, options, []
                    );
                    const newComp = res?.data?.createSurveyComponent;
                    if (newComp) {
                      await ApiService.createSurveyComponentRelation(parentId, newComp.id, childCount + 1);
                    }
                  }}
                  onLinkNode={async (nodeId, parentId, childCount) => {
                    await ApiService.createSurveyComponentRelation(parentId, nodeId, childCount + 1);
                  }}
                  onUnlink={async (nodeId, parentId) => {
                    await ApiService.deleteSurveyComponentRelation(parentId, nodeId);
                  }}
                  onMoveNode={async (nodeId, swapWithId, parentId) => { await ApiService.swapSurveyComponentPositions(parentId, nodeId, swapWithId); }}
                  addLabel="Add Question"
                  emptyMessage="No questions yet — click Add Question to start."
                  {...sharedProps}
                />
              ),
            },
            ...(isAdmin ? [{
              label: 'Stats',
              actions: selectedSurvey && (
                <IonButton
                  size="small" fill="outline"
                  href={`${API_BASE}${ENDPOINT.SURVEY_EXPORT}/${selectedSurvey.id}/stats/export`}
                  target="_blank"
                >
                  Export CSV
                </IonButton>
              ),
              content: !selectedSurvey ? (
                <EmptyState message="Select a survey to begin" />
              ) : statsLoading ? (
                <IonItem lines="none">
                  <IonSpinner slot="start" name="dots" />
                  <IonLabel>&nbsp;Computing via Python…</IonLabel>
                </IonItem>
              ) : !stats ? (
                <EmptyState message="No answers yet" />
              ) : (
                <div style={{ padding: '0 4px' }}>
                  <IonText color="medium" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                    {stats.total_responses} response{stats.total_responses !== 1 ? 's' : ''} · computed by {stats.engine}
                  </IonText>

                  {(stats.columns ?? []).map((col: any) => {
                    const isAbnormal = col.abnormal_count > 0;
                    return (
                      <IonCard key={col.id} style={isAbnormal ? { borderLeft: '3px solid var(--ion-color-danger)' } : {}}>
                        <IonCardContent>
                          <div style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <strong style={{ fontSize: 14 }}>{col.question}</strong>
                            <IonChip color="medium" style={{ height: 20, fontSize: 11 }}>
                              <IonLabel>{col.type}</IonLabel>
                            </IonChip>
                            {isAbnormal && (
                              <IonChip color="danger" style={{ height: 20, fontSize: 11 }}>
                                <IonLabel>{col.abnormal_count} abnormal</IonLabel>
                              </IonChip>
                            )}
                          </div>

                          {/* Numeric: full pandas describe() output */}
                          {col.type === 'number' && col.count > 0 && (
                            <>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px 12px', fontSize: 12, marginBottom: 6 }}>
                                {[
                                  ['n',      col.count],
                                  ['mean',   col.mean],
                                  ['std',    col.std],
                                  ['min',    col.min],
                                  ['25%',    col.p25],
                                  ['median', col.p50],
                                  ['75%',    col.p75],
                                  ['max',    col.max],
                                ].map(([label, val]) => (
                                  <div key={label as string}>
                                    <IonText color="medium" style={{ fontSize: 10 }}>{label}</IonText>
                                    <div><strong>{val}</strong></div>
                                  </div>
                                ))}
                              </div>
                              {col.clinical_range && (
                                <IonText color="medium" style={{ fontSize: 11 }}>
                                  Normal range: {col.clinical_range.low}–{col.clinical_range.high}
                                  {col.outlier_count > 0 && ` · ${col.outlier_count} IQR outlier${col.outlier_count !== 1 ? 's' : ''}: ${col.outliers.join(', ')}`}
                                </IonText>
                              )}
                            </>
                          )}

                          {/* Check */}
                          {col.type === 'check' && (
                            <IonText style={{ fontSize: 13 }}>
                              <span style={{ color: 'var(--ion-color-success)' }}>{col.true_pct}%</span> Yes ({col.true_count}/{col.count})
                              &nbsp;·&nbsp;{(100 - col.true_pct).toFixed(1)}% No
                            </IonText>
                          )}

                          {/* Categorical / text */}
                          {col.counts && col.count > 0 && (
                            <div style={{ fontSize: 13 }}>
                              {Object.entries(col.counts as Record<string, number>).map(([val, count]) => (
                                <div key={val} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                                  <span>{val || '(empty)'}</span>
                                  <IonText color="medium">{count}</IonText>
                                </div>
                              ))}
                            </div>
                          )}
                        </IonCardContent>
                      </IonCard>
                    );
                  })}
                </div>
              ),
            }] : []),
          ]}
        />
      }
    >
      {/* ═══════════════════════════════════════════════════════════
           Modals                                                    */}
      <ModalShell isOpen={newSurveyModal} onDismiss={() => setNewSurveyModal(false)} title="New Survey">
        {newSurveyForm && (
          <FormRenderer
            component={newSurveyForm}
            onSubmit={handleCreateSurvey}
            submitLabel={newSurveyCreating ? 'Creating…' : 'Create Survey'}
          />
        )}
      </ModalShell>

      <ModalShell isOpen={answerEditOpen} onDismiss={() => setAnswerEditOpen(false)} title="Edit Answer" dismissLabel="Close">
        {answerEditOpen && formComponent && editingAnswer && (
          <FormRenderer
            mode="survey"
            key={editingAnswer.id}
            component={formComponent}
            defaultValues={editingAnswer.answers}
            onSubmit={handleAnswerEditSubmit}
            submitLabel={saving ? 'Saving…' : 'Save Changes'}
          />
        )}
      </ModalShell>
    </SplitPageLayout>
  );
};

export default Surveys;
