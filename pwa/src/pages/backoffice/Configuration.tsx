// Page: Configuration — browse and edit the component trees that power the app's forms.
// Reads/writes: components + components_relationships tables (GraphQL).
// Admin-only. Browse-first: roots listed with their app usage (FORM_USAGE) and a live
// FormRenderer preview. Edit mode must be explicitly enabled — changes affect live UI.

import React, { useRef, useState } from 'react';
import { IonButton, IonIcon, IonItem, IonLabel, IonSelect, IonSelectOption, IonText, IonToggle } from '@ionic/react';
import { createOutline, lockClosedOutline, lockOpenOutline } from 'ionicons/icons';

import ApiService from '../../services/Api';
import SplitPageLayout from '../../components/shell/SplitPageLayout';
import TabPanel from '../../components/shell/TabPanel';
import ResourcePanel from '../../components/shell/ResourcePanel';
import EmptyState from '../../components/shell/EmptyState';
import ModalShell from '../../components/shell/ModalShell';
import TreeEditor, { TreeEditorHandle, LinkableGroup } from '../../components/shell/TreeEditor';
import FormRenderer from '../../components/forms/FormRenderer';
import { ComponentResults } from '../../interfaces/types';
import { APP_COMPONENT_TYPES, AREA_NAV, FORM_USAGE, PANEL_CONFIG, EDITOR_ID, TYPE } from '../../constants';


/*
 ██    ██  ████████  ██        ██████    ████████  ██████      ██████
 ██    ██  ██        ██        ██    ██  ██        ██    ██  ██
 ████████  ██████    ██        ██████    ██████    ██████      ████
 ██    ██  ██        ██        ██        ██        ██    ██        ██
 ██    ██  ████████  ████████  ██        ████████  ██    ██  ██████
                                                                       */


const COMP_ADDABLE_TYPES = APP_COMPONENT_TYPES.map(t => ({ value: t, label: t }));

const COMP_LINK_GROUPS: LinkableGroup[] = APP_COMPONENT_TYPES.map(t => ({
  label: t,
  filter: (n: ComponentResults) => n.type === t,
}));

const editorIds: Record<string, string> = {
  [TYPE.FORM]:      EDITOR_ID.DEFAULT,
  [TYPE.INPUT]:     EDITOR_ID.DEFAULT,
  [TYPE.CHECK]:     EDITOR_ID.DEFAULT,
  [TYPE.SELECT]:    EDITOR_ID.DEFAULT,
  [TYPE.PLOT]:      EDITOR_ID.PLOT,
  [TYPE.PLOT_GRID]: EDITOR_ID.DEFAULT,
};

const compFormFetcher = (type: string) =>
  ApiService.getComponentByName(editorIds[type] ?? EDITOR_ID.DEFAULT);

const compBadgeColor = (node: ComponentResults): string => {
  if (node.type === TYPE.FORM)      return 'primary';
  if (node.type === TYPE.INPUT)     return 'secondary';
  if (node.type === TYPE.CHECK)     return 'tertiary';
  if (node.type === TYPE.SELECT)    return 'success';
  if (node.type === TYPE.OPTION)    return 'medium';
  if (node.type === TYPE.PLOT)      return 'warning';
  if (node.type === TYPE.PLOT_GRID) return 'danger';
  return 'medium';
};

const getCompDefaultValues = (node: ComponentResults): Record<string, any> => ({
  name: node.name,
  type: node.type,
  data: node.data ?? {},
  options: node.options ?? {},
});

const compLinkFetcher = async (): Promise<ComponentResults[]> => {
  const results = await Promise.all(APP_COMPONENT_TYPES.map(t => ApiService.getList(t)));
  return results.flat().filter((c): c is ComponentResults & { id: string } => !!c.id);
};

// FormRenderer renders only a root's children, so wrap non-section nodes
// (leaf inputs, selects) in a synthetic form so a single field previews too.
const compPreviewTree = (node: ComponentResults): ComponentResults =>
  [TYPE.FORM, TYPE.PLOT_GRID, TYPE.PLOT].includes(node.type as any)
    ? node
    : ({ name: node.name, type: TYPE.FORM, data: { text: node.name }, children: [node] } as ComponentResults);

// Default browse view: root components (never a child in any relation) — the
// entry points the app fetches by name. Known-usage roots first, then alphabetical.
const compRootsFetcher = async (): Promise<(ComponentResults & { id: string })[]> => {
  const [all, rels] = await Promise.all([compLinkFetcher(), ApiService.getRelationsList()]);
  const childIds = new Set(rels.map((r: any) => r.child_id));
  return (all as (ComponentResults & { id: string })[])
    .filter(c => !childIds.has(c.id))
    .sort((a, b) =>
      (FORM_USAGE[a.name] ? 0 : 1) - (FORM_USAGE[b.name] ? 0 : 1)
      || a.name.localeCompare(b.name)
    );
};

const Configuration: React.FC = () => {


/*
 ██████    ████████  ████████    ██████
 ██    ██  ██        ██        ██
 ██████    ██████    ██████      ████
 ██    ██  ██        ██              ██
 ██    ██  ████████  ██        ██████
                                         */


  const treeRef = useRef<TreeEditorHandle>(null);


/*
   ██████  ██████████    ████    ██████████  ████████
 ██            ██      ██    ██      ██      ██
   ████        ██      ████████      ██      ██████
       ██      ██      ██    ██      ██      ██
 ██████        ██      ██    ██      ██      ████████
                                                       */


  const [hasFormData, setHasFormData] = useState(false);
  const [formData, setFormData] = useState({} as ComponentResults);
  const [listType, setListType] = useState('');   // '' = roots view (default browse mode)
  const [configVersion, setConfigVersion] = useState(0);
  const [relListVersion, setRelListVersion] = useState(0);

  const [isEditMode, setIsEditMode]     = useState(false);
  const [warnOpen, setWarnOpen]         = useState(false);

  const [newCompOpen, setNewCompOpen]   = useState(false);
  const [newCompType, setNewCompType]   = useState<string>(APP_COMPONENT_TYPES[0]);
  const [newCompForm, setNewCompForm]   = useState<ComponentResults | null>(null);

  const handleEditModeToggle = () => {
    if (isEditMode) { setIsEditMode(false); return; }
    setWarnOpen(true);
  };
  const confirmEditMode = () => { setWarnOpen(false); setIsEditMode(true); };

  const updateStates = (data: any, list: boolean) => {
    setHasFormData(true);
    setFormData(data);
    if (list) setConfigVersion(v => v + 1);
  };


/*
   ██████  ██      ██  ██████          ████      ██    ██  ████████  ██████    ██      ██
 ██        ████  ████  ██    ██      ██    ██    ██    ██  ██        ██    ██    ██  ██
 ██        ██  ██  ██  ██    ██      ██  ████    ██    ██  ██████    ██████        ██
 ██        ██      ██  ██    ██      ██    ██    ██    ██  ██        ██    ██      ██
   ██████  ██      ██  ██████          ████  ██    ████    ████████  ██    ██      ██
                                                                                           */


  const useComponent = async (id: string) => {
    const data = await ApiService.getComponent(id);
    if (data) updateStates(data, true);
  };

  const deleteDbComponent = async (id: string) => {
    await ApiService.deleteComponent(id);
    setConfigVersion(v => v + 1);
  };

  const deleteDbRelation = async (parent_id: string, child_id: string) => {
    await ApiService.deleteRelation(parent_id, child_id);
    setRelListVersion(v => v + 1);
  };

  const reloadFormData = async () => {
    const data = await ApiService.getComponent(formData.id as string);
    if (data) updateStates(data, false);
  };


/*
 ██      ██  ████████  ██          ██        ██████    ████    ██      ██  ██████
 ████    ██  ██        ██          ██      ██        ██    ██  ████  ████  ██    ██
 ██  ██  ██  ██████    ██    ██    ██      ██        ██    ██  ██  ██  ██  ██████
 ██    ████  ██          ██  ██  ██        ██        ██    ██  ██      ██  ██
 ██      ██  ████████      ██  ██            ██████    ████    ██      ██  ██
                                                                                     */


  const openNewComp = async (type: string = newCompType) => {
    setNewCompType(type);
    setNewCompForm(null);
    setNewCompOpen(true);
    const form = await compFormFetcher(type);
    setNewCompForm(form ?? null);
  };

  const handleNewCompTypeChange = async (type: string) => {
    setNewCompType(type);
    setNewCompForm(null);
    const form = await compFormFetcher(type);
    setNewCompForm(form ?? null);
  };

  const handleCreateComponent = async (values: any) => {
    await ApiService.createComponent(
      values.name ?? `${newCompType}_${Date.now()}`,
      newCompType,
      values.data ?? {},
      values.options ?? {},
      null
    );
    setNewCompOpen(false);
    setConfigVersion(v => v + 1);
  };


/*
 ██████████  ██████    ████████  ████████      ████████  ██████    ██████  ██████████    ████    ██████
     ██      ██    ██  ██        ██            ██        ██    ██    ██        ██      ██    ██  ██    ██
     ██      ██████    ██████    ██████        ██████    ██    ██    ██        ██      ██    ██  ██████
     ██      ██    ██  ██        ██            ██        ██    ██    ██        ██      ██    ██  ██    ██
     ██      ██    ██  ████████  ████████      ████████  ██████    ██████      ██        ████    ██    ██
                                                                                                           */


  const compCreateNode = async (type: string, values: any, parentId: string) => {
    const result = await ApiService.createComponent(
      values.name ?? `${type}_${Date.now()}`, type,
      values.data ?? {}, values.options ?? {}, null
    );
    const newId = result?.data?.createComponent?.id;
    if (newId && parentId) await ApiService.createRelation(parentId, newId);
  };

  const compLinkNode = async (nodeId: string, parentId: string) => {
    await ApiService.createRelation(parentId, nodeId);
  };

  const compSaveNode = async (node: ComponentResults, values: any) => {
    await ApiService.updateComponent(
      node.id!, values.name ?? node.name, node.type,
      values.data ?? {}, values.options ?? {}
    );
  };

  const compUnlink = async (nodeId: string, parentId: string) => {
    await ApiService.deleteRelation(parentId, nodeId);
    setRelListVersion(v => v + 1);
  };


/*
 ██████    ████████  ██      ██  ██████    ████████  ██████
 ██    ██  ██        ████    ██  ██    ██  ██        ██    ██
 ██████    ██████    ██  ██  ██  ██    ██  ██████    ██████
 ██    ██  ██        ██    ████  ██    ██  ██        ██    ██
 ██    ██  ████████  ██      ██  ██████    ████████  ██    ██
                                                               */


  return (
    <SplitPageLayout navItems={AREA_NAV.BACKOFFICE} title="Backoffice" leftSize="4"
      rightHeader={
        <IonItem color={isEditMode ? 'warning' : undefined} lines="none">
          <IonIcon slot="start" icon={isEditMode ? lockOpenOutline : lockClosedOutline} />
          <IonLabel>{isEditMode ? 'Edit mode — changes affect live UI' : 'Editing disabled'}</IonLabel>
          <IonToggle slot="end" checked={isEditMode} onIonChange={handleEditModeToggle} color="dark" />
        </IonItem>
      }
      leftTabs={[
        {
          label: 'Components',
          content: (
            <ResourcePanel
              fetcher={() => listType
                ? ApiService.getList(listType).then(
                    list => list.filter((item): item is ComponentResults & { id: string } => !!item.id)
                  )
                : compRootsFetcher()
              }
              refreshToken={`${listType}-${configVersion}-${relListVersion}`}
              config={PANEL_CONFIG.CONFIG_COMPONENTS}
              selectedId={formData?.id}
              getLabel={item => item.name}
              getSubLabel={item => FORM_USAGE[item.name]}
              getBadge={item => ({ label: item.type, color: compBadgeColor(item) })}
              onSelect={item => useComponent(item.id)}
              onDelete={isEditMode ? item => deleteDbComponent(item.id) : undefined}
              onAdd={isEditMode ? () => openNewComp(listType || APP_COMPONENT_TYPES[0]) : undefined}
              filter={{ types: APP_COMPONENT_TYPES, typeValue: listType, onTypeChange: setListType }}
            />
          ),
        },
        ...(isEditMode ? [{
          label: 'Relations',
          content: (
            <ResourcePanel
              fetcher={() => ApiService.getRelationsList().then((raw: any[]) =>
                raw.map(item => ({
                  id: `${item.parent_id}-${item.child_id}`,
                  name: `${item.parent_name} -> ${item.child_name}`,
                  parent_id: item.parent_id,
                  child_id: item.child_id,
                }))
              )}
              refreshToken={`relations-${relListVersion}`}
              title="Component Relations"
              getLabel={(item: any) => item.name}
              onSelect={() => {}}
              onDelete={(item: any) => deleteDbRelation(item.parent_id, item.child_id)}
              emptyMessage="No relations"
            />
          ),
        }] : []),
      ]}
      right={
        <TabPanel tabs={[{
          label: 'Preview',
          content: !hasFormData ? (
            <EmptyState message="Select a component to preview the UI it renders" />
          ) : (
            <>
              {/* ═══════════════════════════════════════════════════════════
                   Preview                                                   */}
              {FORM_USAGE[formData.name] && (
                <IonItem lines="none">
                  <IonText color="medium">Used by: {FORM_USAGE[formData.name]}</IonText>
                </IonItem>
              )}
              <FormRenderer key={formData.id} component={compPreviewTree(formData)} />
            </>
          ),
        }, {
          label: 'Tree',
          content: !hasFormData ? (
            <EmptyState message="Select a component to edit" />
          ) : (
            <TreeEditor
              readOnly={!isEditMode}
              ref={treeRef}
              root={formData}
              onReload={reloadFormData}
              title={formData.name}
              isContainer={node => [TYPE.FORM, TYPE.PLOT_GRID, TYPE.SELECT].includes(node.type as any)}
              getLabel={node => node.name}
              getBadgeLabel={node => node.type}
              getBadgeColor={compBadgeColor}
              formFetcher={compFormFetcher}
              addableTypes={COMP_ADDABLE_TYPES}
              getDefaultValues={getCompDefaultValues}
              linkableFetcher={compLinkFetcher}
              linkableGroups={COMP_LINK_GROUPS}
              onCreateNode={compCreateNode}
              onLinkNode={compLinkNode}
              onSaveNode={compSaveNode}
              onUnlink={compUnlink}
              onMoveNode={async (nodeId, swapWithId, parentId) => { await ApiService.swapComponentPositions(parentId, nodeId, swapWithId); }}
              parentsFetcher={node => ApiService.getComponentParents(node.id!)}
              onDeleteNode={async node => { await ApiService.deleteComponent(node.id!); }}
              headerActions={
                <IonButton size="small" fill="clear" color="warning"
                  onClick={() => treeRef.current?.openEdit(formData)}
                >
                  <IonIcon icon={createOutline} />
                </IonButton>
              }
              addLabel="Add Child"
              emptyMessage="No children yet."
            />
          ),
        }]} />
      }
    >
      {/* ═══════════════════════════════════════════════════════════
           Modals                                                    */}
      <ModalShell isOpen={newCompOpen} onDismiss={() => setNewCompOpen(false)} title="New Component">
        <IonItem lines="full">
          <IonSelect
            label="Type" labelPlacement="stacked"
            value={newCompType}
            onIonChange={e => handleNewCompTypeChange(e.detail.value)}
          >
            {APP_COMPONENT_TYPES.map(t => (
              <IonSelectOption key={t} value={t}>{t}</IonSelectOption>
            ))}
          </IonSelect>
        </IonItem>
        {newCompForm && (
          <FormRenderer
            key={newCompType}
            component={newCompForm}
            onSubmit={handleCreateComponent}
            submitLabel="Create"
          />
        )}
      </ModalShell>

      <ModalShell isOpen={warnOpen} onDismiss={() => setWarnOpen(false)} title="Enable Edit Mode" dismissLabel="Cancel">
        <IonItem lines="none">
          <IonText color="warning" style={{ whiteSpace: 'normal', padding: '8px 0' }}>
            This page modifies the component definitions that power the app's forms and UI.
            Incorrect changes can silently break forms across the application. Proceed carefully.
          </IonText>
        </IonItem>
        <IonButton expand="block" color="warning" style={{ margin: 16 }} onClick={confirmEditMode}>
          I understand — enable editing
        </IonButton>
      </ModalShell>
    </SplitPageLayout>
  );
};

export default Configuration;
