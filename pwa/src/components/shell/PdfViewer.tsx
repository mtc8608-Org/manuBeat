// PdfViewer — render a PDF inline from a Blob (or a direct URL).
// - Given a Blob, it owns the object-URL lifecycle (creates on change, revokes on unmount)
// - Given a src URL, it uses it directly (e.g. an authed download endpoint)
// - Falls back to an EmptyState when there is nothing to show
// The one bespoke viewer the app needs; every other panel reuses the shell library.
import React, { useEffect, useState } from 'react';
import EmptyState from './EmptyState';

interface Props {
  /** PDF bytes to display; the component manages the object URL for it. */
  blob?: Blob | null;
  /** Alternative to blob: a ready-made URL to load directly. */
  src?: string;
  /** Viewer height (CSS value). Defaults to 75vh. */
  height?: string | number;
  /** iframe title (accessibility). */
  title?: string;
  /** Shown when there is neither a blob nor a src. */
  emptyMessage?: string;
}

const PdfViewer: React.FC<Props> = ({
  blob, src, height = '75vh', title = 'PDF', emptyMessage = 'Nothing to preview',
}) => {
  const [objectUrl, setObjectUrl] = useState('');

  useEffect(() => {
    if (!blob) { setObjectUrl(''); return; }
    const url = URL.createObjectURL(blob);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [blob]);

  const url = src ?? objectUrl;
  if (!url) return <EmptyState message={emptyMessage} />;

  return (
    <iframe
      title={title}
      src={url}
      style={{ width: '100%', height, border: '1px solid var(--ion-border-color)', borderRadius: 8 }}
    />
  );
};

export default PdfViewer;
