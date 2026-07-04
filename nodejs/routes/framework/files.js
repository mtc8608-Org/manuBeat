const express = require('express');
const { randomUUID } = require('crypto');
const { pool, minioClient, upload, BUCKET } = require('../../db');

const router = express.Router();

// Runs BEFORE multer so anonymous clients are rejected before the server
// buffers any multipart body into memory.
const requireAuth = (req, res, next) =>
  req.user ? next() : res.status(401).json({ error: 'Authentication required' });

// Owner-scoped: a user sees only the files they uploaded; admin sees all.
router.get('/files', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  try {
    const result = req.user.tier === 'admin'
      ? await pool.query('SELECT * FROM files ORDER BY created_at DESC')
      : await pool.query('SELECT * FROM files WHERE uploaded_by = $1::uuid ORDER BY created_at DESC', [req.user.id]);
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
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
    console.error('Upload error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

router.get('/files/:id/download', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM files WHERE id = $1::uuid', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'File not found' });
    const file = result.rows[0];
    if (file.mime_type) res.setHeader('Content-Type', file.mime_type);
    res.setHeader('Content-Disposition', `inline; filename="${file.filename}"`);
    const stream = await minioClient.getObject(BUCKET, file.key);
    stream.pipe(res);
  } catch (e) {
    console.error('Download error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Owner or admin may edit (same rule as delete below).
router.patch('/files/:id', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  const { description } = req.body ?? {};
  try {
    const scope = req.user.tier === 'admin' ? '' : ' AND uploaded_by = $3::uuid';
    const params = [description ?? null, req.params.id];
    if (scope) params.push(req.user.id);
    const result = await pool.query(
      `UPDATE files SET description = $1 WHERE id = $2::uuid${scope} RETURNING *`,
      params
    );
    if (!result.rows.length) return res.status(404).json({ error: 'File not found or not authorised' });
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Owner or admin may delete. Deleting the files row cascades any domain link
// tables via their ON DELETE CASCADE FKs, so links detach automatically.
router.delete('/files/:id', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  try {
    const result = await pool.query('SELECT * FROM files WHERE id = $1::uuid', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'File not found' });
    const file = result.rows[0];
    if (req.user.tier !== 'admin' && file.uploaded_by !== req.user.id) {
      return res.status(403).json({ error: 'Not authorised for this file' });
    }
    await pool.query('DELETE FROM files WHERE id = $1::uuid', [req.params.id]);
    await minioClient.removeObject(BUCKET, file.key).catch(e => console.warn('MinIO removal failed (row deleted anyway):', e.message));
    res.json({ success: true });
  } catch (e) {
    console.error('Delete error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Download by MinIO key (used for generated content images — no DB record required)
router.get('/files/:key/download-by-key', async (req, res) => {
  try {
    const key = decodeURIComponent(req.params.key);
    const stat = await minioClient.statObject(BUCKET, key);
    if (stat.metaData?.['content-type']) res.setHeader('Content-Type', stat.metaData['content-type']);
    const stream = await minioClient.getObject(BUCKET, key);
    stream.pipe(res);
  } catch (e) {
    console.error('download-by-key error:', e.message);
    res.status(404).json({ error: 'File not found' });
  }
});

module.exports = router;
