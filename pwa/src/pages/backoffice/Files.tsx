// Page: Files — file upload, browsing, and preview.
// Reads/writes: MinIO object storage (via Node.js REST endpoints). Metadata in postgres files table.
// Admin-only (upload/delete). All authenticated users can browse.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  IonButton, IonSpinner,
  IonItem, IonLabel,
  IonCard, IonCardContent, IonCardHeader, IonCardTitle,
  IonIcon, IonText,
  useIonViewWillEnter,
} from '@ionic/react';
import { documentOutline, trashOutline } from 'ionicons/icons';
import { FileRecord, ComponentResults } from '../../interfaces/types';
import ApiService from '../../services/Api';
import SplitPageLayout from '../../components/shell/SplitPageLayout';
import TabPanel from '../../components/shell/TabPanel';
import EmptyState from '../../components/shell/EmptyState';
import ModalShell from '../../components/shell/ModalShell';
import ResourcePanel from '../../components/shell/ResourcePanel';
import FormRenderer from '../../components/forms/FormRenderer';
import { useAuth } from '../../contexts/AuthContext';
import { FORM_ID, ENDPOINT, API_BASE, AREA_NAV, PANEL_CONFIG } from '../../constants';


/*
 ██    ██  ████████  ██        ██████    ████████  ██████      ██████
 ██    ██  ██        ██        ██    ██  ██        ██    ██  ██
 ████████  ██████    ██        ██████    ██████    ██████      ████
 ██    ██  ██        ██        ██        ██        ██    ██        ██
 ██    ██  ████████  ████████  ██        ████████  ██    ██  ██████
                                                                       */


const formatSize = (bytes: number | null) => {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatDate = (val: string) => {
  const d = new Date(val);
  return isNaN(d.getTime()) ? val : d.toLocaleDateString();
};

const mimeCategory = (mime: string | null): 'image' | 'pdf' | 'text' | 'other' => {
  if (!mime) return 'other';
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('text/')) return 'text';
  return 'other';
};

const mimeSubtype = (mime: string | null) =>
  mime ? (mime.split('/')[1] ?? mime) : 'unknown';

const Files: React.FC = () => {
  const { isAdmin, logout } = useAuth();


/*
 ██████    ████████  ████████    ██████
 ██    ██  ██        ██        ██
 ██████    ██████    ██████      ████
 ██    ██  ██        ██              ██
 ██    ██  ████████  ██        ██████
                                         */


  const prevUrlRef = useRef<string | null>(null);


/*
   ██████  ██████████    ████    ██████████  ████████
 ██            ██      ██    ██      ██      ██
   ████        ██      ████████      ██      ██████
       ██      ██      ██    ██      ██      ██
 ██████        ██      ██    ██      ██      ████████
                                                       */


  const [fileVersion, setFileVersion] = useState(0);
  const [files, setFiles]             = useState<FileRecord[]>([]);
  const [search, setSearch]           = useState('');
  const [fileType, setFileType]       = useState('');
  const [selected, setSelected]       = useState<FileRecord | null>(null);
  const [formTree, setFormTree]       = useState<ComponentResults | null>(null);

  const [previewUrl, setPreviewUrl]         = useState<string | null>(null);
  const [previewText, setPreviewText]       = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [uploadOpen, setUploadOpen]   = useState(false);
  const [uploadFile, setUploadFile]   = useState<File | null>(null);
  const [uploadDesc, setUploadDesc]   = useState('');
  const [uploading, setUploading]     = useState(false);
  const [uploadError, setUploadError] = useState('');


/*
 ██          ████      ████    ██████
 ██        ██    ██  ██    ██  ██    ██
 ██        ██    ██  ████████  ██    ██
 ██        ██    ██  ██    ██  ██    ██
 ████████    ████    ██    ██  ██████
                                         */


  useEffect(() => {
    ApiService.getComponentByName(FORM_ID.FILE_DETAIL).then(form => { if (form) setFormTree(form); });
  }, []);

  useEffect(() => {
    ApiService.getFiles().then(setFiles).catch(console.error);
  }, [fileVersion]);

  useIonViewWillEnter(() => setFileVersion(v => v + 1));

  const typeOptions = useMemo(
    () => [...new Set(files.map(f => mimeSubtype(f.mime_type)))].sort(),
    [files],
  );


/*
 ██████    ██████    ████████  ██      ██  ██████  ████████  ██          ██
 ██    ██  ██    ██  ██        ██      ██    ██    ██        ██          ██
 ██████    ██████    ██████    ██      ██    ██    ██████    ██    ██    ██
 ██        ██    ██  ██          ██  ██      ██    ██          ██  ██  ██
 ██        ██    ██  ████████      ██      ██████  ████████      ██  ██
                                                                             */


  const revokePreview = () => {
    if (prevUrlRef.current) { URL.revokeObjectURL(prevUrlRef.current); prevUrlRef.current = null; }
    setPreviewUrl(null);
    setPreviewText(null);
  };

  const loadPreview = async (file: FileRecord) => {
    revokePreview();
    const cat = mimeCategory(file.mime_type);
    if (cat === 'other') return;
    setPreviewLoading(true);
    try {
      const token = localStorage.getItem('auth_token');
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch(`${API_BASE}${ENDPOINT.FILES}/${file.id}/download`, { headers });
      if (!res.ok) return;
      if (cat === 'text') {
        setPreviewText(await res.text());
      } else {
        const blob = await res.blob();
        const url  = URL.createObjectURL(blob);
        prevUrlRef.current = url;
        setPreviewUrl(url);
      }
    } catch (e) {
      console.error('Preview error:', e);
    } finally {
      setPreviewLoading(false);
    }
  };


/*
 ██    ██    ████    ██      ██  ██████    ██        ████████  ██████      ██████
 ██    ██  ██    ██  ████    ██  ██    ██  ██        ██        ██    ██  ██
 ████████  ████████  ██  ██  ██  ██    ██  ██        ██████    ██████      ████
 ██    ██  ██    ██  ██    ████  ██    ██  ██        ██        ██    ██        ██
 ██    ██  ██    ██  ██      ██  ██████    ████████  ████████  ██    ██  ██████
                                                                                   */


  const handleSelect = (file: FileRecord) => {
    setSelected(file);
    loadPreview(file);
  };

  const handleDescSave = async (values: any) => {
    if (!selected) return;
    await ApiService.patchFile(selected.id, { description: values.description ?? '' });
    const updated = { ...selected, description: values.description ?? '' };
    setSelected(updated);
  };

  const handleDelete = async () => {
    if (!selected) return;
    try {
      await ApiService.deleteFile(selected.id);
      revokePreview();
      setSelected(null);
      setFileVersion(v => v + 1);
    } catch (e) { console.error('Delete error:', e); }
  };

  const handleUpload = async () => {
    if (!uploadFile) return;
    setUploadError('');
    setUploading(true);
    try {
      await ApiService.uploadFile(uploadFile, uploadDesc);
      setUploadOpen(false);
      setUploadFile(null);
      setUploadDesc('');
      setFileVersion(v => v + 1);
    } catch (e: any) {
      if (e.status === 401) { logout(); return; }
      setUploadError(e.message ?? 'Upload failed');
    } finally {
      setUploading(false);
    }
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
      leftTabs={[{
        label: 'Files',
        content: (
          <ResourcePanel
            data={files}
            config={PANEL_CONFIG.FILES_LIST}
            selectedId={selected?.id}
            getLabel={f => f.filename}
            getSubLabel={f => `${formatSize(f.size)} · ${formatDate(f.created_at)}`}
            getIcon={() => documentOutline}
            getBadge={f => f.mime_type ? { label: mimeSubtype(f.mime_type), color: 'medium' } : null}
            onSelect={handleSelect}
            onAdd={() => { setUploadError(''); setUploadOpen(true); }}
            filterFn={(f, text, type) =>
              f.filename.toLowerCase().includes(text.toLowerCase()) &&
              (!type || mimeSubtype(f.mime_type) === type)}
            filter={{
              text: search,
              onTextChange: setSearch,
              types: typeOptions,
              typeValue: fileType,
              onTypeChange: setFileType,
            }}
          />
        ),
      }]}
      right={
        <TabPanel tabs={[{
          label: 'Detail',
          content: !selected ? (
            <EmptyState message="Select a file to view details" />
          ) : (
          <>
            {/* ═══════════════════════════════════════════════════════════
                 Metadata                                                   */}
            <IonCard>
              <IonCardHeader>
                <IonItem lines="none">
                  <IonCardTitle slot="start">Metadata</IonCardTitle>
                  {isAdmin && (
                    <IonButton slot="end" color="danger" fill="outline" size="small"
                      onClick={handleDelete}
                    >
                      <IonIcon slot="start" icon={trashOutline} />Delete
                    </IonButton>
                  )}
                </IonItem>
              </IonCardHeader>
              <IonCardContent>
                {[
                  { label: 'Filename', value: selected.filename },
                  { label: 'Type',     value: selected.mime_type ?? '—' },
                  { label: 'Size',     value: formatSize(selected.size) },
                  { label: 'Uploaded', value: formatDate(selected.created_at) },
                ].map(row => (
                  <IonItem key={row.label} lines="full">
                    <IonLabel>
                      <p style={{ fontSize: 12, color: 'var(--ion-color-medium)' }}>{row.label}</p>
                      <p>{row.value}</p>
                    </IonLabel>
                  </IonItem>
                ))}
              </IonCardContent>
            </IonCard>

            {/* ═══════════════════════════════════════════════════════════
                 Description                                                */}
            {formTree && (
              <div style={{ marginTop: 12 }}>
                <FormRenderer
                  component={formTree}
                  mode="app"
                  defaultValues={{ description: selected.description ?? '' }}
                  onSubmit={handleDescSave}
                  submitLabel="Save Description"
                />
              </div>
            )}

            {/* ═══════════════════════════════════════════════════════════
                 Preview                                                    */}
            <IonCard style={{ marginTop: 12 }}>
              <IonCardHeader><IonCardTitle>Preview</IonCardTitle></IonCardHeader>
              <IonCardContent>
                {previewLoading && (
                  <div style={{ textAlign: 'center', padding: 24 }}><IonSpinner /></div>
                )}
                {!previewLoading && (() => {
                  const cat = mimeCategory(selected.mime_type);
                  if (cat === 'image' && previewUrl) return (
                    <>
                      <img src={previewUrl} alt={selected.filename}
                        style={{ maxWidth: '100%', maxHeight: 500, display: 'block', margin: '0 auto' }} />
                      <div style={{ textAlign: 'center', marginTop: 12 }}>
                        <a href={previewUrl} download={selected.filename}>
                          <IonButton size="small" fill="outline">Download</IonButton>
                        </a>
                      </div>
                    </>
                  );
                  if (cat === 'pdf' && previewUrl) return (
                    <>
                      <iframe src={previewUrl} title={selected.filename}
                        width="100%" height="600px" style={{ border: 'none', display: 'block' }} />
                      <div style={{ textAlign: 'center', marginTop: 12 }}>
                        <a href={previewUrl} download={selected.filename}>
                          <IonButton size="small" fill="outline">Download</IonButton>
                        </a>
                      </div>
                    </>
                  );
                  if (cat === 'text' && previewText) return (
                    <pre style={{ overflow: 'auto', maxHeight: 400, fontSize: 12, margin: 0 }}>
                      {previewText}
                    </pre>
                  );
                  return (
                    <div style={{ textAlign: 'center', padding: 24 }}>
                      <IonIcon icon={documentOutline}
                        style={{ fontSize: 48, color: 'var(--ion-color-medium)' }} />
                      <p style={{ color: 'var(--ion-color-medium)', marginTop: 8 }}>
                        No preview available
                      </p>
                    </div>
                  );
                })()}
              </IonCardContent>
            </IonCard>
          </>
          ),
        }]} />
      }
    >
      {/* ═══════════════════════════════════════════════════════════
           Modals                                                    */}
      <ModalShell isOpen={uploadOpen} onDismiss={() => setUploadOpen(false)} title="Upload File" dismissLabel="Close">
        <div style={{ padding: 16 }}>
          {uploadError && (
            <IonItem lines="none" style={{ marginBottom: 8 }}>
              <IonText color="danger">{uploadError}</IonText>
            </IonItem>
          )}
          <IonItem lines="full">
            <IonLabel position="stacked">File</IonLabel>
            <input
              type="file"
              style={{ marginTop: 8, marginBottom: 8 }}
              onChange={e => setUploadFile(e.target.files?.[0] ?? null)}
            />
          </IonItem>
          <IonItem lines="full">
            <IonLabel position="stacked">Description (optional)</IonLabel>
            <textarea
              rows={3}
              style={{
                width: '100%', marginTop: 8,
                background: 'transparent', border: 'none', outline: 'none',
                color: 'var(--ion-text-color)', fontSize: '1rem', resize: 'vertical',
              }}
              value={uploadDesc}
              onChange={e => setUploadDesc(e.target.value)}
            />
          </IonItem>
          <IonButton
            expand="block"
            style={{ marginTop: 16 }}
            disabled={!uploadFile || uploading}
            onClick={handleUpload}
          >
            {uploading ? <IonSpinner name="dots" /> : 'Upload'}
          </IonButton>
        </div>
      </ModalShell>
    </SplitPageLayout>
  );
};

export default Files;
