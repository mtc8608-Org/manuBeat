// TreeEditor — an interactive editor for a component tree.
// - Lists all children of a root node
// - Add new nodes (by creating or linking an existing one)
// - Move nodes up / down to reorder them
// - Unlink a child or open it in an edit modal
// - Exposes an imperative handle so parents can trigger edit from outside
import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import {
  IonCard, IonCardContent, IonCardHeader, IonCardTitle,
  IonItem, IonLabel, IonButtons, IonButton, IonIcon, IonBadge,
  IonList, IonSegment, IonSegmentButton, IonSelect, IonSelectOption,
  IonSpinner,
} from '@ionic/react';
import { addOutline, createOutline, unlinkOutline, linkOutline, chevronUpOutline, chevronDownOutline } from 'ionicons/icons';
import { ComponentResults } from '../../interfaces/types';
import EmptyState from './EmptyState';
import ModalShell from './ModalShell';
import FormRenderer from '../forms/FormRenderer';

export interface LinkableGroup {
  label: string;
  filter: (node: ComponentResults) => boolean;
}

export interface AddableType {
  value: string;
  label: string;
}

export interface TreeEditorHandle {
  openEdit: (node: ComponentResults) => void;
}

export interface TreeEditorProps {
  root:             ComponentResults | null;
  onReload:         () => Promise<void>;
  isContainer:      (node: ComponentResults) => boolean;
  getLabel:         (node: ComponentResults) => string;
  getBadgeLabel:    (node: ComponentResults) => string;
  getBadgeColor:    (node: ComponentResults) => string;
  formFetcher:      (type: string) => Promise<ComponentResults | null | undefined>;
  addableTypes:     AddableType[];
  getDefaultValues: (node: ComponentResults) => Record<string, any>;
  onCreateNode:     (type: string, values: any, parentId: string, childCount: number) => Promise<void>;
  onLinkNode:       (nodeId: string, parentId: string, childCount: number) => Promise<void>;
  onSaveNode:       (node: ComponentResults, values: any) => Promise<void>;
  onUnlink:         (nodeId: string, parentId: string, nodeType: string) => Promise<void>;
  onMoveNode?:      (nodeId: string, swapWithId: string, parentId: string) => Promise<void>;
  parentsFetcher?:  (node: ComponentResults) => Promise<ComponentResults[]>;
  onDeleteNode?:    (node: ComponentResults) => Promise<void>;
  linkableFetcher?: () => Promise<ComponentResults[]>;
  linkableGroups?:  LinkableGroup[];
  editExtra?:       (node: ComponentResults, onClose: () => void, onReload: () => Promise<void>) => React.ReactNode;
  headerActions?:   React.ReactNode;
  addLabel?:        string;
  emptyMessage?:    string;
  title?:           string;
  readOnly?:        boolean;
  rootEditable?:    boolean;   // show an Edit button on the root header (opens openEdit(root))
}

const TreeEditor = forwardRef<TreeEditorHandle, TreeEditorProps>(({
  root, onReload,
  isContainer, getLabel, getBadgeLabel, getBadgeColor,
  formFetcher, addableTypes, getDefaultValues,
  parentsFetcher, onDeleteNode,
  linkableFetcher, linkableGroups,
  onCreateNode, onLinkNode, onSaveNode, onUnlink, onMoveNode,
  editExtra, headerActions,
  addLabel = 'Add', emptyMessage = 'Nothing here yet.',
  title, readOnly = false, rootEditable = false,
}, ref) => {
  const formCache = useRef<Record<string, ComponentResults | null>>({});

  // ── Add modal ────────────────────────────────────────────────────────────────
  const [addOpen, setAddOpen]                 = useState(false);
  const [addParentId, setAddParentId]         = useState('');
  const [addChildCount, setAddChildCount]     = useState(0);
  const [addTab, setAddTab]                   = useState<'new' | 'link'>('new');
  const [newType, setNewType]                 = useState(addableTypes[0]?.value ?? '');
  const [addForm, setAddForm]                 = useState<ComponentResults | null>(null);
  const [addFormLoading, setAddFormLoading]   = useState(false);
  const [linkList, setLinkList]               = useState<ComponentResults[]>([]);
  const [linkLoading, setLinkLoading]         = useState(false);
  const [activeLinkGroup, setActiveLinkGroup] = useState(0);

  // ── Edit modal ───────────────────────────────────────────────────────────────
  const [editOpen, setEditOpen]               = useState(false);
  const [editTarget, setEditTarget]           = useState<ComponentResults | null>(null);
  const [editForm, setEditForm]               = useState<ComponentResults | null>(null);
  const [editFormLoading, setEditFormLoading] = useState(false);
  const [parents, setParents]                 = useState<ComponentResults[]>([]);
  const [parentsLoading, setParentsLoading]   = useState(false);

  // ── Form cache ───────────────────────────────────────────────────────────────
  const getForm = async (type: string): Promise<ComponentResults | null> => {
    if (type in formCache.current) return formCache.current[type];
    const form = await formFetcher(type);
    formCache.current[type] = form ?? null;
    return formCache.current[type];
  };

  // ── Open add modal ───────────────────────────────────────────────────────────
  const openAdd = async (parentId: string, childCount: number) => {
    const firstType = addableTypes[0]?.value ?? '';
    setAddParentId(parentId);
    setAddChildCount(childCount);
    setAddTab('new');
    setNewType(firstType);
    setLinkList([]);
    setActiveLinkGroup(0);
    setAddOpen(true);

    setAddFormLoading(true);
    setLinkLoading(true);
    const [form, links] = await Promise.all([
      firstType ? getForm(firstType) : Promise.resolve(null),
      linkableFetcher ? linkableFetcher() : Promise.resolve([]),
    ]);
    setAddForm(form);
    setLinkList(links);
    setAddFormLoading(false);
    setLinkLoading(false);
  };

  const handleTypeChange = async (type: string) => {
    setNewType(type);
    setAddForm(null);
    setAddFormLoading(true);
    const form = await getForm(type);
    setAddForm(form);
    setAddFormLoading(false);
  };

  // ── Open edit modal ──────────────────────────────────────────────────────────
  const openEdit = async (node: ComponentResults) => {
    setEditTarget(node);
    setEditForm(null);
    setParents([]);
    setEditOpen(true);
    setEditFormLoading(true);
    setParentsLoading(!!parentsFetcher);

    const [form, fetchedParents] = await Promise.all([
      getForm(node.type),
      parentsFetcher ? parentsFetcher(node) : Promise.resolve([]),
    ]);
    setEditForm(form);
    setParents(fetchedParents);
    setEditFormLoading(false);
    setParentsLoading(false);
  };

  useImperativeHandle(ref, () => ({ openEdit }));

  // ── Action handlers ──────────────────────────────────────────────────────────
  const handleCreate = async (values: any) => {
    await onCreateNode(newType, values, addParentId, addChildCount);
    await onReload();
    setAddOpen(false);
  };

  const handleLink = async (nodeId: string) => {
    await onLinkNode(nodeId, addParentId, addChildCount);
    await onReload();
    setAddOpen(false);
  };

  const handleSave = async (values: any) => {
    if (!editTarget) return;
    await onSaveNode(editTarget, values);
    await onReload();
    setEditOpen(false);
  };

  const handleDelete = async () => {
    if (!editTarget || !onDeleteNode) return;
    await onDeleteNode(editTarget);
    await onReload();
    setEditOpen(false);
  };

  const handleUnlink = async (nodeId: string, parentId: string, nodeType: string) => {
    await onUnlink(nodeId, parentId, nodeType);
    await onReload();
  };

  const handleMove = async (nodeId: string, swapWithId: string, parentId: string) => {
    if (!onMoveNode) return;
    await onMoveNode(nodeId, swapWithId, parentId);
    await onReload();
  };

  // ── Recursive tree node ──────────────────────────────────────────────────────
  const renderNode = (
    node: ComponentResults,
    parentId: string,
    siblings: ComponentResults[],
    index: number,
    depth = 0,
  ): React.ReactNode => {
    const childCount = node.children?.length ?? 0;
    const container  = isContainer(node);
    const n          = siblings.length;
    return (
      <div key={node.id} style={{ marginLeft: depth * 24, marginBottom: 2 }}>
        <IonItem lines="full">
          <IonBadge slot="start" color={getBadgeColor(node)}
            style={{ minWidth: 64, textAlign: 'center' }}
          >
            {getBadgeLabel(node)}
          </IonBadge>
          <IonLabel style={{ marginLeft: 8 }}>{getLabel(node)}</IonLabel>
          {!readOnly && (
            <IonButtons slot="end">
              {onMoveNode && n > 1 && (
                <>
                  <IonButton size="small" fill="clear" color="medium"
                    onClick={() => handleMove(node.id!, siblings[(index - 1 + n) % n].id!, parentId)}
                  >
                    <IonIcon icon={chevronUpOutline} />
                  </IonButton>
                  <IonButton size="small" fill="clear" color="medium"
                    onClick={() => handleMove(node.id!, siblings[(index + 1) % n].id!, parentId)}
                  >
                    <IonIcon icon={chevronDownOutline} />
                  </IonButton>
                </>
              )}
              {container && (
                <IonButton size="small" fill="clear" color="success"
                  onClick={() => openAdd(node.id!, childCount)}
                >
                  <IonIcon icon={addOutline} />
                </IonButton>
              )}
              <IonButton size="small" fill="clear" color="warning"
                onClick={() => openEdit(node)}
              >
                <IonIcon icon={createOutline} />
              </IonButton>
              <IonButton size="small" fill="clear" color="danger"
                onClick={() => handleUnlink(node.id!, parentId, node.type)}
              >
                <IonIcon icon={unlinkOutline} />
              </IonButton>
            </IonButtons>
          )}
        </IonItem>
        {node.children?.map((child: ComponentResults, i: number) =>
          renderNode(child, node.id!, node.children!, i, depth + 1)
        )}
      </div>
    );
  };

  // ── Link tab content ─────────────────────────────────────────────────────────
  const renderLinkContent = () => {
    if (linkLoading) {
      return <div style={{ padding: 24, textAlign: 'center' }}><IonSpinner /></div>;
    }
    const groups = linkableGroups ?? [{ label: 'All', filter: () => true }];
    const items  = linkList.filter(groups[activeLinkGroup]?.filter ?? (() => true));

    return (
      <IonCard>
        <IonCardContent>
          {groups.length > 1 && (
            <IonSegment
              value={String(activeLinkGroup)}
              onIonChange={e => setActiveLinkGroup(Number(e.detail.value))}
              style={{ marginBottom: 8 }}
            >
              {groups.map((g, i) => (
                <IonSegmentButton key={i} value={String(i)}>
                  <IonLabel>{g.label}</IonLabel>
                </IonSegmentButton>
              ))}
            </IonSegment>
          )}
          <IonList>
            {items.length === 0 && <EmptyState message="Nothing to link." />}
            {items.map(c => (
              <IonItem key={c.id} button detail={false} lines="full"
                onClick={() => handleLink(c.id!)}
              >
                <IonBadge slot="start" color={getBadgeColor(c)}
                  style={{ minWidth: 64, textAlign: 'center' }}
                >
                  {getBadgeLabel(c)}
                </IonBadge>
                <IonLabel style={{ marginLeft: 8 }}>{getLabel(c)}</IonLabel>
              </IonItem>
            ))}
          </IonList>
        </IonCardContent>
      </IonCard>
    );
  };

  const hasLinks = !!(linkableFetcher || linkableGroups);

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <>
      <IonCard>
        <IonCardHeader>
          <IonItem lines="none">
            <IonCardTitle slot="start">{title ?? root?.data?.text}</IonCardTitle>
            {!readOnly && (
              <IonButtons slot="end">
                {headerActions}
                {root && rootEditable && (
                  <IonButton size="small" fill="outline"
                    onClick={() => openEdit(root)}
                  >
                    <IonIcon slot="start" icon={createOutline} />
                    Edit
                  </IonButton>
                )}
                {root && (
                  <IonButton size="small" color="success"
                    onClick={() => openAdd(root.id!, root.children?.length ?? 0)}
                  >
                    <IonIcon slot="start" icon={addOutline} />
                    {addLabel}
                  </IonButton>
                )}
              </IonButtons>
            )}
          </IonItem>
        </IonCardHeader>
        <IonCardContent>
          {!root && (
            <IonItem lines="none">
              <IonSpinner slot="start" name="dots" />
              <IonLabel>&nbsp;Loading…</IonLabel>
            </IonItem>
          )}
          {root && (root.children?.length ?? 0) === 0 && (
            <EmptyState message={emptyMessage} />
          )}
          {root?.children?.map((child: ComponentResults, i: number) =>
            renderNode(child, root.id!, root.children!, i, 0)
          )}
        </IonCardContent>
      </IonCard>

      {/* ── Add modal ─────────────────────────────────────────────────────────── */}
      <ModalShell isOpen={addOpen} onDismiss={() => setAddOpen(false)} title={addLabel}>
        {hasLinks && (
          <IonSegment
            value={addTab}
            onIonChange={e => setAddTab(e.detail.value as 'new' | 'link')}
            style={{ marginBottom: 16 }}
          >
            <IonSegmentButton value="new"><IonLabel>New</IonLabel></IonSegmentButton>
            <IonSegmentButton value="link">
              <IonIcon icon={linkOutline} style={{ marginRight: 4 }} />
              <IonLabel>Link Existing</IonLabel>
            </IonSegmentButton>
          </IonSegment>
        )}

        {addTab === 'new' && (
          <>
            {addableTypes.length > 1 && (
              <IonItem lines="full">
                <IonSelect
                  label="Type" labelPlacement="stacked"
                  value={newType}
                  onIonChange={e => handleTypeChange(e.detail.value)}
                >
                  {addableTypes.map(t => (
                    <IonSelectOption key={t.value} value={t.value}>{t.label}</IonSelectOption>
                  ))}
                </IonSelect>
              </IonItem>
            )}
            {addFormLoading && (
              <div style={{ padding: 24, textAlign: 'center' }}><IonSpinner /></div>
            )}
            {!addFormLoading && addForm && (
              <FormRenderer
                key={`${newType}-add`}
                component={addForm}
                onSubmit={handleCreate}
                submitLabel="Add"
              />
            )}
          </>
        )}

        {addTab === 'link' && renderLinkContent()}
      </ModalShell>

      {/* ── Edit modal ────────────────────────────────────────────────────────── */}
      <ModalShell
        isOpen={editOpen}
        onDismiss={() => setEditOpen(false)}
        title={editTarget ? `Edit — ${getBadgeLabel(editTarget)}` : 'Edit'}
        dismissLabel="Close"
      >
        {editFormLoading && (
          <div style={{ padding: 24, textAlign: 'center' }}><IonSpinner /></div>
        )}
        {!editFormLoading && editForm && editTarget && (
          <FormRenderer
            key={editTarget.id}
            component={editForm}
            defaultValues={getDefaultValues(editTarget)}
            onSubmit={handleSave}
            submitLabel="Save Changes"
          />
        )}

        {/* ── Used in ─────────────────────────────────────────────────────── */}
        {parentsFetcher && editTarget && (
          <IonCard style={{ marginTop: 12 }}>
            <IonCardHeader>
              <IonCardTitle>
                Used in ({parentsLoading ? '…' : parents.length})
              </IonCardTitle>
            </IonCardHeader>
            <IonCardContent>
              {parentsLoading && (
                <div style={{ textAlign: 'center', padding: 12 }}><IonSpinner /></div>
              )}
              {!parentsLoading && parents.length === 0 && (
                <EmptyState message="Not used anywhere." />
              )}
              {!parentsLoading && parents.map(p => (
                <IonItem key={p.id} lines="full">
                  <IonBadge slot="start" color={getBadgeColor(p)}
                    style={{ minWidth: 64, textAlign: 'center' }}
                  >
                    {getBadgeLabel(p)}
                  </IonBadge>
                  <IonLabel style={{ marginLeft: 8 }}>{getLabel(p)}</IonLabel>
                </IonItem>
              ))}
            </IonCardContent>
          </IonCard>
        )}

        {/* ── Danger zone ─────────────────────────────────────────────────── */}
        {onDeleteNode && editTarget && (
          <IonCard style={{ marginTop: 12 }}>
            <IonCardHeader><IonCardTitle>Danger Zone</IonCardTitle></IonCardHeader>
            <IonCardContent>
              {!parentsLoading && parents.length > 0 && (
                <IonItem lines="none">
                  <IonLabel color="warning" style={{ whiteSpace: 'normal' }}>
                    Used in {parents.length} place{parents.length !== 1 ? 's' : ''}.
                    Deleting removes it from all of them.
                  </IonLabel>
                </IonItem>
              )}
              <IonButton expand="block" color="danger" style={{ marginTop: 8 }}
                onClick={handleDelete}
              >
                Delete
              </IonButton>
            </IonCardContent>
          </IonCard>
        )}

        {editTarget && editExtra?.(editTarget, () => setEditOpen(false), onReload)}
      </ModalShell>
    </>
  );
});

export default TreeEditor;
