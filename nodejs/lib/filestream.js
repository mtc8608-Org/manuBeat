// Serving a stored file safely — the read-authorisation rule and the response
// headers that go with it.
//
// This lives in lib/ rather than inside routes/framework/files.js because it is
// not framework-only: any DOMAIN route that streams a `files` row (a generated
// PDF, an uploaded artifact) needs exactly these headers, and a route that
// re-implements them drifts — the framework path gets hardened and the domain
// copy silently does not. Require this instead of hand-rolling a MinIO pipe.
const { minioClient, BUCKET } = require('../db');

// Content assets (is_public) stream to anyone; everything else is owner-or-admin.
const mayRead = (file, req) =>
  file.is_public || (req.user && (req.user.tier === 'admin' || file.uploaded_by === req.user.id));

// Only these render inline. Anything else downloads as an attachment, so an
// uploaded .html or scripted .svg cannot execute on the app origin — where the
// JWT lives in localStorage.
const INLINE_MIMES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'application/pdf',
]);

// Stream a files row from MinIO with safe disposition headers.
const streamFile = async (file, res) => {
  const inline = file.mime_type && INLINE_MIMES.has(file.mime_type);
  if (file.mime_type) res.setHeader('Content-Type', file.mime_type);
  // Never let the browser second-guess the declared type.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader(
    'Content-Disposition',
    `${inline ? 'inline' : 'attachment'}; filename="${file.filename.replace(/"/g, '')}"`
  );
  const stream = await minioClient.getObject(file.bucket ?? BUCKET, file.key);
  stream.pipe(res);
};

module.exports = { mayRead, INLINE_MIMES, streamFile };
