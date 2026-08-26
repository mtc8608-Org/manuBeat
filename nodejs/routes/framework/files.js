const express = require('express');
const { randomUUID } = require('crypto');
const { pool, minioClient, upload, BUCKET } = require('../../db');

const router = express.Router();

// Runs BEFORE multer so anonymous clients are rejected before the server
// buffers any multipart body into memory.
const requireAuth = (req, res, next) =>
  req.user ? next() : res.status(401).json({ error: 'Authentication required' });

// REST errors never carry the driver's message — a raw pg/MinIO error leaks
// schema and constraint names. Log the cause, return something generic
// (matches how the GraphQL layer reports failures).
const fail = (res, status, message, cause) => {
  if (cause) console.error(`${message}:`, cause.message);
  return res.status(status).json({ error: message });
};

// ONE message for "no such row" and "someone else's row" alike — splitting
// them lets an attacker walk ids and learn which are real.
const NOT_AUTHORISED = 'File not found or not authorised';

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

// Owner-scoped: a user sees only the files they uploaded; admin sees all.
router.get('/files', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  try {
    const result = req.user.tier === 'admin'
      ? await pool.query('SELECT * FROM files ORDER BY created_at DESC')
      : await pool.query('SELECT * FROM files WHERE uploaded_by = $1::uuid ORDER BY created_at DESC', [req.user.id]);
    res.json(result.rows);
  } catch (e) {
    fail(res, 500, 'Could not list files', e);
  }
});

router.post('/files/upload', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'No file provided' });
  const description = req.body?.description ?? '';
  const key = `${randomUUID()}-${file.originalname}`;
  try {
    await minioClient.putObject(BUCKET, key, file.buffer, file.size, { 'Content-Type': file.mimetype });
    let result;
    try {
      result = await pool.query(
        `INSERT INTO files (bucket, key, filename, mime_type, size, description, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [BUCKET, key, file.originalname, file.mimetype, file.size, description, req.user.id]
      );
    } catch (dbErr) {
      await minioClient.removeObject(BUCKET, key).catch(e => console.error('MinIO rollback failed:', e.message));
      if (dbErr.code === '23503' && dbErr.constraint === 'files_uploaded_by_fkey') {
        console.error('Upload error: stale JWT — user not found in DB');
        return res.status(401).json({ error: 'Session expired — please log in again' });
      }
      throw dbErr;
    }
    res.json(result.rows[0]);
  } catch (e) {
    fail(res, 500, 'Upload failed', e);
  }
});

// Tokenless ONLY for is_public content assets (see the files table comment).
// A private file requires the owner or an admin.
router.get('/files/:id/download', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM files WHERE id = $1::uuid', [req.params.id]);
    const file = result.rows[0];
    if (!file || !mayRead(file, req)) return fail(res, 404, NOT_AUTHORISED);
    await streamFile(file, res);
  } catch (e) {
    fail(res, 500, 'Download failed', e);
  }
});

// Owner or admin may edit (same rule as delete below).
// `is_public` is settable here because that is how ImagePicker publishes a file
// the admin has just chosen as a content image. It is deliberately one-way in
// practice — nothing in the app un-publishes — but an admin may clear it.
router.patch('/files/:id', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  const { description, is_public } = req.body ?? {};
  try {
    const sets   = [];
    const params = [];
    if (description !== undefined) { params.push(description ?? null); sets.push(`description = $${params.length}`); }
    if (is_public  !== undefined) { params.push(!!is_public);          sets.push(`is_public = $${params.length}`); }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });

    params.push(req.params.id);
    let where = `id = $${params.length}::uuid`;
    if (req.user.tier !== 'admin') {
      params.push(req.user.id);
      where += ` AND uploaded_by = $${params.length}::uuid`;
    }
    const result = await pool.query(
      `UPDATE files SET ${sets.join(', ')} WHERE ${where} RETURNING *`,
      params
    );
    if (!result.rows.length) return fail(res, 404, NOT_AUTHORISED);
    res.json(result.rows[0]);
  } catch (e) {
    fail(res, 500, 'Update failed', e);
  }
});

// Owner or admin may delete. Deleting the files row cascades any domain link
// tables via their ON DELETE CASCADE FKs, so links detach automatically.
router.delete('/files/:id', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  try {
    const result = await pool.query('SELECT * FROM files WHERE id = $1::uuid', [req.params.id]);
    const file = result.rows[0];
    if (!file || (req.user.tier !== 'admin' && file.uploaded_by !== req.user.id)) {
      return fail(res, 404, NOT_AUTHORISED);
    }
    await pool.query('DELETE FROM files WHERE id = $1::uuid', [req.params.id]);
    await minioClient.removeObject(BUCKET, file.key).catch(e => console.warn('MinIO removal failed (row deleted anyway):', e.message));
    res.json({ success: true });
  } catch (e) {
    fail(res, 500, 'Delete failed', e);
  }
});

// Download by MinIO key — how seeded and generated content images are referenced
// from content-card `data.src` (the key is known at seed time, the row id is not).
//
// This MUST resolve through the files table: reading MinIO directly would serve
// any object whose key is guessed, with no row to carry is_public or an owner.
router.get('/files/:key/download-by-key', async (req, res) => {
  try {
    const key = decodeURIComponent(req.params.key);
    const result = await pool.query('SELECT * FROM files WHERE key = $1 AND bucket = $2', [key, BUCKET]);
    const file = result.rows[0];
    if (!file || !mayRead(file, req)) return fail(res, 404, NOT_AUTHORISED);
    await streamFile(file, res);
  } catch (e) {
    fail(res, 500, 'Download failed', e);
  }
});

module.exports = router;
