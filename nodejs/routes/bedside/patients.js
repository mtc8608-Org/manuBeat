// [BEDSIDE] Data Collection — patient creation + per-patient data file.
//
// A patient IS a Patient Registration survey answer (survey f000). Creating a
// patient here: (1) inserts the survey answer (demographics), (2) mints an empty
// data file in MinIO + a `files` row, (3) links them via `patient_files`.
//
// File generation needs MinIO + a multi-step write, so it lives in REST (mirrors
// routes/framework/files.js). Reads + bed-linking live in the GraphQL resolver.
// All endpoints are admin-only (PHI).
const express = require('express');
const { pool, minioClient, BUCKET } = require('../../db');

const router = express.Router();

// Patient Registration survey — hardcoded seed UUID (01-init-db.sql).
const PATIENT_SURVEY_ID = 'c51c1e5f-5cc1-4b77-8832-2d10cc97f000';

const requireAdmin = (req, res) => {
  if (req.user?.role !== 'admin') {
    res.status(req.user ? 403 : 401).json({ error: req.user ? 'Admin access required' : 'Authentication required' });
    return false;
  }
  return true;
};

// POST /api/bedside/patients  { answers, filename? }
// Creates the patient (survey answer) + an empty HDF5 data file.
router.post('/bedside/patients', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const answers = req.body?.answers ?? {};
  let answerId, fileKey;
  try {
    // 1. demographics → survey answer
    const ansRes = await pool.query(
      'INSERT INTO survey_answers (survey_id, answers) VALUES ($1::uuid, $2) RETURNING id',
      [PATIENT_SURVEY_ID, JSON.stringify(answers)],
    );
    answerId = ansRes.rows[0].id;

    // 2. mint an empty data file (HDF5 structure deferred — placeholder for now)
    fileKey = `bedside/patients/${answerId}.h5`;
    const filename = (req.body?.filename ?? `patient-${answerId}.h5`).toString();
    const empty = Buffer.alloc(0);
    await minioClient.putObject(BUCKET, fileKey, empty, 0, { 'Content-Type': 'application/x-hdf5' });

    let fileRow;
    try {
      const fRes = await pool.query(
        `INSERT INTO files (bucket, key, filename, mime_type, size, description, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [BUCKET, fileKey, filename, 'application/x-hdf5', 0, 'Bedside data file (HDF5)', req.user.id],
      );
      fileRow = fRes.rows[0];
    } catch (dbErr) {
      await minioClient.removeObject(BUCKET, fileKey).catch(() => {});
      throw dbErr;
    }

    // 3. link file ↔ patient
    await pool.query(
      'INSERT INTO patient_files (patient_answer_id, file_id) VALUES ($1::uuid, $2::uuid)',
      [answerId, fileRow.id],
    );

    res.json({ patient_answer_id: answerId, file_id: fileRow.id, file_key: fileKey });
  } catch (err) {
    console.error('bedside/patients create error:', err.message);
    // best-effort rollback of the answer if a later step failed
    if (answerId) await pool.query('DELETE FROM survey_answers WHERE id = $1::uuid', [answerId]).catch(() => {});
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/bedside/patients/:answerId
// Removes the patient (survey answer → cascades patient_files + bed_assignments),
// then its data file (MinIO object + files row).
router.delete('/bedside/patients/:answerId', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { answerId } = req.params;
  try {
    const pf = await pool.query(
      `SELECT pf.file_id, f.key FROM patient_files pf
       JOIN files f ON f.id = pf.file_id
       WHERE pf.patient_answer_id = $1::uuid`,
      [answerId],
    );
    await pool.query('DELETE FROM survey_answers WHERE id = $1::uuid', [answerId]);
    if (pf.rows.length) {
      const { file_id, key } = pf.rows[0];
      await pool.query('DELETE FROM files WHERE id = $1::uuid', [file_id]).catch(e => console.error('file row delete:', e.message));
      await minioClient.removeObject(BUCKET, key).catch(e => console.error('MinIO delete:', e.message));
    }
    res.json({ success: true });
  } catch (err) {
    console.error('bedside/patients delete error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
