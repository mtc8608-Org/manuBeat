// Page: Content — public content page builder (CMS).
// Reads/writes: components table (contentPage, contentHtml, contentImage, contentHtmlImage types).
// Admin-only (backoffice route). Public pages rendered by Landing.tsx via ContentRenderer.

import React, { useEffect, useRef, useState } from 'react';
import {
  IonItem,
  IonSpinner, IonText,
} from '@ionic/react';
import { documentTextOutline } from 'ionicons/icons';
import ApiService from '../../services/Api';
import type { GenNode } from '../../services/Api';
import SplitPageLayout from '../../components/shell/SplitPageLayout';
import TabPanel from '../../components/shell/TabPanel';
import ModalShell from '../../components/shell/ModalShell';
import EmptyState from '../../components/shell/EmptyState';
import ResourcePanel from '../../components/shell/ResourcePanel';
import ContentRenderer from '../../components/content/ContentRenderer';
import FormRenderer from '../../components/forms/FormRenderer';
import TreeEditor, { TreeEditorHandle } from '../../components/shell/TreeEditor';
import { useAuth } from '../../contexts/AuthContext';
import { CONTENT_TYPE, AREA_NAV, FORM_ID, CONTENT_EDITOR_ID, PANEL_CONFIG, CARD_TYPES, CONTENT_ADDABLE_TYPES } from '../../constants';
import { Component, ComponentResults } from '../../interfaces/types';


/*
 ██    ██  ████████  ██        ██████    ████████  ██████      ██████
 ██    ██  ██        ██        ██    ██  ██        ██    ██  ██
 ████████  ██████    ██        ██████    ██████    ██████      ████
 ██    ██  ██        ██        ██        ██        ██    ██        ██
 ██    ██  ████████  ████████  ██        ████████  ██    ██  ██████
                                                                       */


const prettifyName = (name: string) => {
  const s = name.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

const cardBadgeColor = (type: string) => {
  if (type === CONTENT_TYPE.HTML)       return 'primary';
  if (type === CONTENT_TYPE.IMAGE)      return 'secondary';
  if (type === CONTENT_TYPE.HTML_IMAGE) return 'tertiary';
  if (type === CONTENT_TYPE.LATEX)      return 'warning';
  return 'medium';
};

const cardBadgeLabel = (type: string) => {
  if (type === CONTENT_TYPE.HTML)       return 'HTML';
  if (type === CONTENT_TYPE.IMAGE)      return 'Image';
  if (type === CONTENT_TYPE.HTML_IMAGE) return 'HTML+Img';
  if (type === CONTENT_TYPE.LATEX)      return 'LaTeX';
  if (type === CONTENT_TYPE.PAGE)       return 'page';
  return type;
};

const cardSummary = (card: ComponentResults): string => {
  if (card.type === CONTENT_TYPE.IMAGE) {
    const src = (card.data?.src ?? '') as string;
    return src ? src.split('/').pop() ?? src : '(no image set)';
  }
  const html  = (card.data?.html ?? '') as string;
  const plain = html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  return plain.length > 90 ? plain.slice(0, 90) + '…' : plain || '(empty)';
};

const getContentDefaultValues = (node: ComponentResults): Record<string, any> => node.data ?? {};

const contentFormFetcher = async (type: string): Promise<ComponentResults | null | undefined> => {
  if (type === CONTENT_TYPE.HTML)       return ApiService.getComponentByName(CONTENT_EDITOR_ID.HTML);
  if (type === CONTENT_TYPE.IMAGE)      return ApiService.getComponentByName(CONTENT_EDITOR_ID.IMAGE);
  if (type === CONTENT_TYPE.HTML_IMAGE) return ApiService.getComponentByName(CONTENT_EDITOR_ID.HTML_IMAGE);
  if (type === CONTENT_TYPE.LATEX)      return ApiService.getComponentByName(CONTENT_EDITOR_ID.LATEX);
  if (type === CONTENT_TYPE.PAGE)       return ApiService.getComponentByName(FORM_ID.NEW_PAGE);
  return null;
};

const CONTENT_LINK_GROUPS = [
  { label: 'Pages', filter: (n: ComponentResults) => n.type === CONTENT_TYPE.PAGE },
  { label: 'Cards', filter: (n: ComponentResults) => CARD_TYPES.has(n.type) },
];

const Content: React.FC = () => {
  const { isAdmin } = useAuth();


/*
 ██████    ████████  ████████    ██████
 ██    ██  ██        ██        ██
 ██████    ██████    ██████      ████
 ██    ██  ██        ██              ██
 ██    ██  ████████  ██        ██████
                                         */


  const treeEditorRef = useRef<TreeEditorHandle>(null);
  const libEditorRef  = useRef<TreeEditorHandle>(null);


/*
   ██████  ██████████    ████    ██████████  ████████
 ██            ██      ██    ██      ██      ██
   ████        ██      ████████      ██      ██████
       ██      ██      ██    ██      ██      ██
 ██████        ██      ██    ██      ██      ████████
                                                       */


  const [contentVersion, setContentVersion] = useState(0);
  const [selectedPage, setSelectedPage]     = useState<Component | null>(null);
  const [pageLoading, setPageLoading]       = useState(false);
  const [rightTab, setRightTab]              = useState(0);

  const [genHistory, setGenHistory]     = useState<{ role: 'user'|'assistant'; content: string; display: string; nodes?: GenNode[] }[]>(() => {
    try { return JSON.parse(localStorage.getItem('gen_history') ?? '[]'); } catch { return []; }
  });
  const [genDraftNodes, setGenDraftNodes] = useState<GenNode[]>(() => {
    try { return JSON.parse(localStorage.getItem('gen_draft_nodes') ?? '[]'); } catch { return []; }
  });
  const [genFiles, setGenFiles]         = useState<File[]>([]);
  const [genInput, setGenInput]         = useState('');
  const [genPageName, setGenPageName]   = useState('');
  const [genStream, setGenStream]       = useState('');
  const [genLoading, setGenLoading]     = useState(false);
  const [genError, setGenError]         = useState('');
  const [genSaving, setGenSaving]       = useState(false);

  const [newPageOpen, setNewPageOpen]     = useState(false);
  const [newPageForm, setNewPageForm]     = useState<ComponentResults | null>(null);
  const [newPageSaving, setNewPageSaving] = useState(false);
  const [newPageError, setNewPageError]   = useState('');

  const [cardVersion, setCardVersion]         = useState(0);
  const [cardTypeFilter, setCardTypeFilter]   = useState('');
  const [cardTextFilter, setCardTextFilter]   = useState('');


/*
 ██          ████      ████    ██████
 ██        ██    ██  ██    ██  ██    ██
 ██        ██    ██  ████████  ██    ██
 ██        ██    ██  ██    ██  ██    ██
 ████████    ████    ██    ██  ██████
                                         */


  useEffect(() => {
    ApiService.getComponentByName(FORM_ID.NEW_PAGE).then(f => setNewPageForm(f ?? null));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    localStorage.setItem('gen_history', JSON.stringify(genHistory));
  }, [genHistory]);

  useEffect(() => {
    localStorage.setItem('gen_draft_nodes', JSON.stringify(genDraftNodes));
  }, [genDraftNodes]);

  const clearGenSession = () => {
    setGenHistory([]);
    setGenDraftNodes([]);
    setGenFiles([]);
    setGenInput('');
    setGenPageName('');
    setGenError('');
    localStorage.removeItem('gen_history');
    localStorage.removeItem('gen_draft_nodes');
  };

  const loadPage = async (id: string) => {
    setPageLoading(true);
    try {
      const tree = await ApiService.getComponent(id);
      setSelectedPage((tree ?? null) as Component | null);
    } catch (e) { console.error('Error loading page:', e); }
    finally { setPageLoading(false); }
  };

  const selectPage = (id: string) => {
    setRightTab(0);
    loadPage(id);
  };


/*
 ██      ██  ████████  ██          ██      ██████      ████      ██████  ████████
 ████    ██  ██        ██          ██      ██    ██  ██    ██  ██        ██
 ██  ██  ██  ██████    ██    ██    ██      ██████    ████████  ██  ████  ██████
 ██    ████  ██          ██  ██  ██        ██        ██    ██  ██    ██  ██
 ██      ██  ████████      ██  ██          ██        ██    ██    ██████  ████████
                                                                                   */


  const handleCreatePage = async (values: any) => {
    if (!values.name?.trim()) { setNewPageError('Internal name is required'); return; }
    setNewPageError('');
    setNewPageSaving(true);
    try {
      const result = await ApiService.createComponent(
        values.name.trim(), CONTENT_TYPE.PAGE,
        { text: values.title?.trim() || values.name.trim() }, {}, null
      );
      const newId = result?.data?.createComponent?.id;
      if (newId && selectedPage?.id) {
        await ApiService.createRelation(selectedPage.id, newId);
        await loadPage(selectedPage.id);
      }
      setNewPageOpen(false);
      setContentVersion(v => v + 1);
    } catch (e: any) {
      setNewPageError(e.message ?? 'Failed to create page');
    } finally {
      setNewPageSaving(false);
    }
  };


/*
 ██████████  ██████    ████████  ████████
     ██      ██    ██  ██        ██
     ██      ██████    ██████    ██████
     ██      ██    ██  ██        ██
     ██      ██    ██  ████████  ████████
                                           */


  const treeReload = async () => {
    if (selectedPage?.id) await loadPage(selectedPage.id);
  };

  const treeCreateNode = async (type: string, values: any, parentId: string) => {
    const name   = type === CONTENT_TYPE.PAGE
      ? (values.name?.trim() || `page_${Date.now()}`)
      : `${type}_${Date.now()}`;
    const data   = type === CONTENT_TYPE.PAGE
      ? { text: values.title?.trim() || name }
      : values;
    const result = await ApiService.createComponent(name, type, data, {}, null);
    const newId  = result?.data?.createComponent?.id;
    if (newId) {
      await ApiService.createRelation(parentId, newId);
      if (type === CONTENT_TYPE.PAGE) setContentVersion(v => v + 1);
    }
  };

  const treeLinkNode = async (nodeId: string, parentId: string) => {
    await ApiService.createRelation(parentId, nodeId);
  };

  const treeSaveNode = async (node: ComponentResults, values: any) => {
    await ApiService.updateComponent(
      node.id!, node.name, node.type, values, node.options
    );
  };

  const treeUnlink = async (nodeId: string, parentId: string, nodeType: string) => {
    await ApiService.deleteRelation(parentId, nodeId);
    if (CARD_TYPES.has(nodeType)) {
      await ApiService.deleteComponent(nodeId);
    }
  };


/*
   ████████  ████████  ██      ██  ████████  ██████      ████    ████████  ████████
 ██          ██        ████    ██  ██        ██    ██  ██    ██      ██    ██
 ██    ████  ██████    ██  ██  ██  ██████    ██████    ████████      ██    ██████
 ██    ██    ██        ██    ████  ██        ██    ██  ██    ██      ██    ██
   ████████  ████████  ██      ██  ████████  ██    ██  ██    ██      ██    ████████
                                                                                     */


  const handleGenerate = async () => {
    if (genLoading) return;
    if (genFiles.length === 0 && !genInput.trim() && genHistory.length === 0) {
      setGenError('Select a .tex file or type some instructions first.');
      return;
    }
    setGenError('');
    setGenStream('');
    setGenDraftNodes([]);
    setGenLoading(true);
    const receivedNodes: GenNode[] = [];
    try {
      const apiHistory = genHistory.map(({ role, content }) => ({ role, content }));
      const result = await ApiService.generateContent(
        genFiles, apiHistory, genInput.trim(),
        (text) => setGenStream(prev => prev + text),
        (node) => { receivedNodes.push(node); setGenDraftNodes(prev => [...prev, node]); },
      );
      setGenHistory(prev => [
        ...prev,
        { role: 'user',      content: result.userMessage, display: result.userSummary },
        { role: 'assistant', content: result.assistantRaw, display: result.message, nodes: result.nodes },
      ]);
      if (result.nodes.length > 0) setGenDraftNodes(result.nodes);
      setGenStream('');
      setGenFiles([]);
      setGenInput('');
    } catch (e: any) {
      if (receivedNodes.length > 0) {
        setGenError(`Stream interrupted after ${receivedNodes.length} card${receivedNodes.length !== 1 ? 's' : ''} — partial result saved below.`);
      } else {
        setGenError(e.message ?? 'Generation failed');
      }
    } finally {
      setGenLoading(false);
    }
  };

  const handleGenSave = async () => {
    if (genDraftNodes.length === 0) return;
    const pageName = genPageName.trim() || `generated_${Date.now()}`;
    setGenSaving(true);
    try {
      const pageResult = await ApiService.createComponent(
        pageName, CONTENT_TYPE.PAGE, { text: pageName }, {}, null
      );
      const pageId = pageResult?.data?.createComponent?.id;
      if (!pageId) throw new Error('Failed to create page');
      for (const node of genDraftNodes) {
        const r = await ApiService.createComponent(node.name, node.type, node.data, node.options ?? {}, null);
        const nodeId = r?.data?.createComponent?.id;
        if (nodeId) await ApiService.createRelation(pageId, nodeId);
      }
      setContentVersion(v => v + 1);
      setGenDraftNodes([]);
      setGenHistory([]);
      setGenFiles([]);
      setGenInput('');
      setGenPageName('');
      await loadPage(pageId);
      setRightTab(0);
    } catch (e: any) {
      setGenError(e.message ?? 'Save failed');
    } finally {
      setGenSaving(false);
    }
  };

/*
 ██        ██████  ██████    ██████      ████    ██████    ██      ██
 ██          ██    ██    ██  ██    ██  ██    ██  ██    ██    ██  ██
 ██          ██    ██████    ██████    ████████  ██████        ██
 ██          ██    ██    ██  ██    ██  ██    ██  ██    ██      ██
 ████████  ██████  ██████    ██    ██  ██    ██  ██    ██      ██
                                                                       */


  const libReload = async () => {
    setCardVersion(v => v + 1);
    if (selectedPage?.id) await loadPage(selectedPage.id);
  };

  const libSaveNode = async (node: ComponentResults, values: any) => {
    await ApiService.updateComponent(node.id!, node.name, node.type, values, node.options);
  };

  const libDeleteNode = async (node: ComponentResults) => {
    await ApiService.deleteComponent(node.id!);
  };

  const treeLinkFetcher = async (): Promise<ComponentResults[]> => {
    const [pages, htmlCards, imgCards, htmlImgCards] = await Promise.all([
      ApiService.getList(CONTENT_TYPE.PAGE),
      ApiService.getList(CONTENT_TYPE.HTML),
      ApiService.getList(CONTENT_TYPE.IMAGE),
      ApiService.getList(CONTENT_TYPE.HTML_IMAGE),
    ]);
    return [...pages, ...htmlCards, ...imgCards, ...htmlImgCards]
      .filter((p): p is ComponentResults & { id: string } => !!p.id);
  };


/*
 ██████    ████████  ██      ██  ██████    ████████  ██████
 ██    ██  ██        ████    ██  ██    ██  ██        ██    ██
 ██████    ██████    ██  ██  ██  ██    ██  ██████    ██████
 ██    ██  ██        ██    ████  ██    ██  ██        ██    ██
 ██    ██  ████████  ██      ██  ██████    ████████  ██    ██
                                                               */


  return (
    <SplitPageLayout
      navItems={AREA_NAV.BACKOFFICE}
      title="Backoffice"
      rightHeader={
        <div style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--ion-color-medium)' }}>
          <strong style={{ color: 'var(--ion-text-color)' }}>Content CMS</strong>
          {' — '}build and manage the public pages shown in the landing section.
          {' '}Each page holds content cards: <strong>HTML</strong> text, <strong>Image</strong>, <strong>HTML + Image</strong> (two-column), or <strong>LaTeX</strong> (KaTeX math).
          {' '}Use <strong>Build</strong> to add/reorder cards on a page, <strong>Preview</strong> to see how it renders, and <strong>AI Import</strong> to convert a LaTeX file into a page automatically.
        </div>
      }
      hidden={
        <TreeEditor
          ref={libEditorRef}
          root={null}
          onReload={libReload}
          isContainer={() => false}
          addableTypes={[]}
          formFetcher={contentFormFetcher}
          getDefaultValues={getContentDefaultValues}
          getLabel={node => cardSummary(node)}
          getBadgeLabel={node => cardBadgeLabel(node.type)}
          getBadgeColor={node => cardBadgeColor(node.type)}
          onCreateNode={async () => {}}
          onLinkNode={async () => {}}
          onUnlink={async () => {}}
          onSaveNode={libSaveNode}
          onDeleteNode={libDeleteNode}
          parentsFetcher={node => ApiService.getComponentParents(node.id!)}
        />
      }
      leftTabs={[
        {
          label: 'Pages',
          content: (
            <ResourcePanel
              fetcher={async () => {
                const list = await ApiService.getList(CONTENT_TYPE.PAGE);
                return list.filter((p): p is ComponentResults & { id: string } => !!p.id);
              }}
              refreshToken={contentVersion}
              config={PANEL_CONFIG.CONTENT_PAGES}
              selectedId={selectedPage?.id}
              getLabel={p => (p.data?.text as string) || p.name}
              getIcon={() => documentTextOutline}
              onSelect={p => selectPage(p.id)}
              onAdd={isAdmin ? () => { setNewPageError(''); setNewPageOpen(true); } : undefined}
            />
          ),
        },
        {
          label: 'Cards',
          content: (
            <ResourcePanel
              config={PANEL_CONFIG.CONTENT_CARDS}
              fetcher={async () => {
                const [html, img, htmlImg] = await Promise.all([
                  ApiService.getList(CONTENT_TYPE.HTML),
                  ApiService.getList(CONTENT_TYPE.IMAGE),
                  ApiService.getList(CONTENT_TYPE.HTML_IMAGE),
                ]);
                return [...html, ...img, ...htmlImg]
                  .filter((c): c is ComponentResults & { id: string } => !!c.id);
              }}
              refreshToken={cardVersion}
              getLabel={(c: ComponentResults) => prettifyName(c.name)}
              getBadge={(c: ComponentResults) => ({ label: cardBadgeLabel(c.type), color: cardBadgeColor(c.type) })}
              onSelect={(c: ComponentResults) => libEditorRef.current?.openEdit(c)}
              filterFn={(c: ComponentResults, text: string, typeValue: string) =>
                (!typeValue || c.type === typeValue) &&
                (!text || cardSummary(c).toLowerCase().includes(text.toLowerCase()))
              }
              filter={{
                typeValue: cardTypeFilter,
                onTypeChange: setCardTypeFilter,
                text: cardTextFilter,
                onTextChange: setCardTextFilter,
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
              label: 'Build',
              keepMounted: true,
              content: (
                <>
                  {pageLoading && (
                    <IonItem lines="none">
                      <IonSpinner slot="start" name="dots" />&nbsp;Loading…
                    </IonItem>
                  )}
                  {!pageLoading && !selectedPage && <EmptyState message="Select a page to begin" />}
                  {/* TreeEditor stays mounted so its ref remains valid on the Preview tab */}
                  <div style={{ display: !pageLoading && !!selectedPage ? 'block' : 'none' }}>
                    <TreeEditor
                      ref={treeEditorRef}
                      root={selectedPage as unknown as ComponentResults}
                      onReload={treeReload}
                      isContainer={() => false}
                      getLabel={node => {
                        if (node.type === CONTENT_TYPE.PAGE) return (node.data?.text as string) || node.name;
                        return cardSummary(node);
                      }}
                      getBadgeLabel={node => cardBadgeLabel(node.type)}
                      getBadgeColor={node => {
                        if (node.type === CONTENT_TYPE.PAGE) return 'medium';
                        return cardBadgeColor(node.type);
                      }}
                      formFetcher={contentFormFetcher}
                      addableTypes={isAdmin ? CONTENT_ADDABLE_TYPES : []}
                      getDefaultValues={getContentDefaultValues}
                      linkableFetcher={treeLinkFetcher}
                      linkableGroups={CONTENT_LINK_GROUPS}
                      onCreateNode={treeCreateNode}
                      onLinkNode={treeLinkNode}
                      onSaveNode={treeSaveNode}
                      onUnlink={treeUnlink}
                      onMoveNode={async (nodeId, swapWithId, parentId) => { await ApiService.swapComponentPositions(parentId, nodeId, swapWithId); }}
                      parentsFetcher={node => ApiService.getComponentParents(node.id!)}
                      onDeleteNode={async node => {
                        if (selectedPage?.id) await ApiService.deleteRelation(selectedPage.id, node.id!);
                        await ApiService.deleteComponent(node.id!);
                      }}
                      addLabel="Add"
                      emptyMessage="No children yet."
                    />
                  </div>
                </>
              ),
            },
            {
              label: 'Preview',
              content: pageLoading ? (
                <IonItem lines="none">
                  <IonSpinner slot="start" name="dots" />&nbsp;Loading…
                </IonItem>
              ) : !selectedPage ? (
                <EmptyState message="Select a page to preview" />
              ) : (
                <ContentRenderer
                  page={selectedPage}
                  isAdmin={isAdmin}
                  onEditCard={card => treeEditorRef.current?.openEdit(card as unknown as ComponentResults)}
                  onDeleteCard={async (cardId: string) => {
                    if (selectedPage?.id) {
                      await ApiService.deleteRelation(selectedPage.id, cardId);
                      await ApiService.deleteComponent(cardId);
                      await loadPage(selectedPage.id);
                    }
                  }}
                />
              ),
            },
            {
              label: 'AI Import',
              content: (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{
                    padding: '12px 14px', borderRadius: 8,
                    background: 'var(--ion-color-light)', fontSize: 13, lineHeight: 1.6,
                  }}>
                    <strong>AI Import</strong> lets you turn LaTeX files and images into content pages automatically.
                    Upload a <code>.tex</code> file (with optional images), add any instructions, and Claude will
                    generate a set of HTML and image cards ready to publish. Once you're happy with the result,
                    save them as a new page in one click.
                    <br />
                    <span style={{ color: 'var(--ion-color-medium)', fontSize: 12 }}>
                      Requires an Anthropic API key — add yours in Account → Integrations.
                    </span>
                  </div>
                  {(genHistory.length > 0 || genLoading) && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                      {genHistory.map((msg, i) => (
                        <div key={i}>
                          <div style={{
                            padding: '6px 12px', borderRadius: 8,
                            background: msg.role === 'user' ? 'var(--ion-color-light)' : 'var(--ion-color-primary-tint)',
                            display: 'inline-block', maxWidth: '85%', fontSize: 13,
                            fontStyle: msg.role === 'user' ? 'italic' : 'normal',
                          }}>
                            {msg.display}
                          </div>
                          {msg.role === 'assistant' && msg.nodes && msg.nodes.length > 0 && i === genHistory.length - 1 && (
                            <div style={{ marginTop: 8 }}>
                              <ContentRenderer
                                page={{
                                  name: 'preview', type: CONTENT_TYPE.PAGE, data: {}, options: {},
                                  children: msg.nodes.map(n => ({ ...n, options: n.options ?? {}, children: [] })),
                                }}
                                isAdmin={false}
                              />
                            </div>
                          )}
                        </div>
                      ))}
                      {genLoading && (
                        <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid var(--ion-color-medium)' }}>
                          <div style={{
                            padding: '4px 10px', fontSize: 11, fontWeight: 600,
                            background: 'var(--ion-color-light)', display: 'flex', alignItems: 'center', gap: 6,
                          }}>
                            <IonSpinner name="dots" style={{ width: 14, height: 14 }} />
                            Generating…
                          </div>
                          <pre style={{
                            margin: 0, padding: '8px 12px', fontSize: 11,
                            maxHeight: 180, overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                            background: 'var(--ion-background-color)', color: 'var(--ion-color-medium)',
                          }}>
                            {genStream.slice(-1200)}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                  {(genHistory.length > 0 || genDraftNodes.length > 0) && (
                    <button onClick={clearGenSession} style={{
                      alignSelf: 'flex-end', padding: '4px 12px', borderRadius: 6,
                      border: '1px solid var(--ion-color-medium)', background: 'transparent',
                      color: 'var(--ion-color-medium)', fontSize: 12, cursor: 'pointer',
                    }}>
                      Clear session
                    </button>
                  )}
                  <label style={{
                    display: 'block', padding: 24, borderRadius: 8, textAlign: 'center',
                    border: '2px dashed var(--ion-color-medium)', cursor: 'pointer',
                  }}>
                    <input type="file" multiple accept=".tex,image/*" style={{ display: 'none' }}
                      onChange={e => setGenFiles(Array.from(e.target.files ?? []))} />
                    {genFiles.length > 0 ? genFiles.map(f => f.name).join(', ') : 'Click to select .tex + images'}
                  </label>
                  {genError && <IonText color="danger" style={{ fontSize: 13 }}>{genError}</IonText>}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <textarea rows={2}
                      placeholder={genHistory.length === 0 ? 'Optional instructions…' : 'Refine the result…'}
                      value={genInput} onChange={e => setGenInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleGenerate(); }}
                      style={{
                        flex: 1, borderRadius: 8, padding: '8px 10px', resize: 'none', fontSize: 14,
                        border: '1px solid var(--ion-color-medium)', background: 'var(--ion-background-color)',
                        color: 'var(--ion-text-color)',
                      }}
                    />
                    <button onClick={handleGenerate} disabled={genLoading} style={{
                      padding: '0 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
                      background: 'var(--ion-color-primary)', color: '#fff', fontWeight: 600,
                    }}>
                      {genLoading ? '…' : genHistory.length === 0 ? 'Generate' : 'Refine'}
                    </button>
                  </div>
                  {genDraftNodes.length > 0 && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input type="text" placeholder="Page name (optional)" value={genPageName}
                        onChange={e => setGenPageName(e.target.value)}
                        style={{
                          flex: 1, borderRadius: 8, padding: '8px 10px', fontSize: 14,
                          border: '1px solid var(--ion-color-medium)', background: 'var(--ion-background-color)',
                          color: 'var(--ion-text-color)',
                        }}
                      />
                      <button onClick={handleGenSave} disabled={genSaving} style={{
                        padding: '0 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
                        background: 'var(--ion-color-success)', color: '#fff', fontWeight: 600, fontSize: 14,
                      }}>
                        {genSaving ? 'Saving…' : `Save ${genDraftNodes.length} card${genDraftNodes.length !== 1 ? 's' : ''} to new page`}
                      </button>
                    </div>
                  )}
                </div>
              ),
            },
          ]}
        />
      }
    >
      {/* ═══════════════════════════════════════════════════════════
           Modals                                                    */}
      <ModalShell isOpen={newPageOpen} onDismiss={() => setNewPageOpen(false)} title="New Content Page">
        {newPageError && (
          <IonItem lines="none">
            <IonText color="danger">{newPageError}</IonText>
          </IonItem>
        )}
        {newPageForm && (
          <FormRenderer
            component={newPageForm}
            onSubmit={handleCreatePage}
            submitLabel={newPageSaving ? 'Creating…' : 'Create Page'}
          />
        )}
      </ModalShell>
    </SplitPageLayout>
  );
};

export default Content;
