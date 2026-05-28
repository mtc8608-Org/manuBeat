// ImagePicker — an image selector used inside forms.
// - Lists all previously uploaded images from the media library
// - Upload a new image directly from your device
// - Returns the selected image URL back to the parent field
import React, { useEffect, useRef, useState } from 'react';
import { IonIcon, IonSpinner } from '@ionic/react';
import { checkmarkOutline, cloudUploadOutline } from 'ionicons/icons';
import ApiService from '../../services/Api';
import { FileRecord } from '../../interfaces/types';
import { API_BASE } from '../../constants';

export const fileDownloadUrl = (id: string) => `${API_BASE}/files/${id}/download`;

interface ImagePickerProps {
  value: string;
  onChange: (url: string) => void;
}

const ImagePicker: React.FC<ImagePickerProps> = ({ value, onChange }) => {
  const [files, setFiles]         = useState<FileRecord[]>([]);
  const [uploading, setUploading] = useState(false);
  const inputRef                  = useRef<HTMLInputElement>(null);

  const loadFiles = () =>
    ApiService.getFiles().then(setFiles).catch(console.error);

  useEffect(() => { loadFiles(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      await ApiService.uploadFile(file);
      await loadFiles();
    } catch (err) {
      console.error('Upload failed', err);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const imageFiles = files.filter(f => f.mime_type?.startsWith('image/'));

  return (
    <div style={{ border: '1px solid var(--ion-border-color, #ccc)', borderRadius: 6, overflow: 'hidden' }}>
      {/* Upload strip */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 10px',
        borderBottom: '1px solid var(--ion-border-color, #ccc)',
        background: 'var(--ion-color-light, #f4f5f8)',
      }}>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={handleUpload}
        />
        <button
          type="button"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '3px 10px', fontSize: 13, cursor: 'pointer',
            border: '1px solid var(--ion-border-color, #ccc)', borderRadius: 4,
            background: 'var(--ion-color-light)', color: 'inherit',
          }}
        >
          {uploading
            ? <><IonSpinner name="dots" style={{ width: 14, height: 14 }} /> Uploading…</>
            : <><IonIcon icon={cloudUploadOutline} style={{ fontSize: 14 }} /> Upload image</>
          }
        </button>
      </div>

      {/* File grid */}
      {imageFiles.length === 0 ? (
        <div style={{ padding: 16, textAlign: 'center', color: 'var(--ion-color-medium)', fontSize: 13 }}>
          No images yet — upload one above.
        </div>
      ) : (
        <div style={{ maxHeight: 240, overflowY: 'auto' }}>
          {imageFiles.map(f => {
            const url      = fileDownloadUrl(f.id);
            const selected = value === url;
            return (
              <div
                key={f.id}
                onClick={() => onChange(url)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 12px', cursor: 'pointer',
                  background: selected ? 'var(--ion-color-primary-tint, #d0e8ff)' : undefined,
                  borderBottom: '1px solid var(--ion-border-color, #eee)',
                }}
              >
                <img
                  src={url}
                  alt={f.filename}
                  style={{ width: 52, height: 52, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }}
                  onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  <div style={{ fontWeight: selected ? 600 : 400, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {f.filename}
                  </div>
                  {f.mime_type && (
                    <div style={{ fontSize: 11, color: 'var(--ion-color-medium)' }}>{f.mime_type}</div>
                  )}
                </div>
                {selected && <IonIcon icon={checkmarkOutline} color="primary" />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ImagePicker;
