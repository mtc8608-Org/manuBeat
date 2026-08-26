// Save a Blob to the user's disk.
//
// The browser needs the object URL to stay alive until it has started reading
// it, so the revoke is deferred rather than immediate — dropping it entirely
// leaks the blob for the lifetime of the page.
//
// Only for programmatic saves. A preview already rendered from an object URL
// (Files.tsx, PdfViewer) should keep its own URL in state and revoke it on
// unmount instead of going through here.
const REVOKE_DELAY_MS = 4000;

export const downloadBlob = (blob: Blob, filename: string) => {
  const url  = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href     = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
};

export default downloadBlob;
