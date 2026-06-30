// [BEDSIDE] Data Collection — patient creation + per-patient data file.
//
// A patient is a first-class `patients` row (detached from the survey system).
// Creating a patient here: (1) inserts the demographics (real columns + extra),
// (2) mints an empty data file in MinIO + a `files` row, (3) links them via
// `patient_files`.
//
// The demographic form is rendered by FormRenderer (app component tree
// form_patient_demographics); its field keys = the columns below. Unknown keys
// fall into `extra`. File generation needs MinIO + a multi-step write, so it lives
// in REST (mirrors routes/framework/files.js). Reads + bed-linking live in the
// GraphQL resolver. All endpoints are admin-only (PHI).
const express = require('express');
const { pool, minioClient, BUCKET } = require('../../db');

const router = express.Router();

// Demographic columns the form maps onto; anything else goes to `extra`.
const PATIENT_COLUMNS = [
  'first_name', 'last_name', 'date_of_birth', 'sex',
  'identifier', 'email', 'phone', 'address', 'notes',
];
const DATE_COLUMNS = new Set(['date_of_birth']);

const requireAdmin = (req, res) => {
  if (req.user?.role !== 'admin') {
    res.status(req.user ? 403 : 401).json({ error: req.user ? 'Admin access required' : 'Authentication required' });
    return false;
  }
  return true;
};

// Split a flat {key: value} demographics object into known columns + extra.
const splitDemographics = (demographics = {}) => {
  const cols = {}, extra = {};
  for (const [k, v] of Object.entries(demographics)) {
    if (PATIENT_COLUMNS.includes(k)) {
      cols[k] = (DATE_COLUMNS.has(k) && v === '') ? null : v;  // empty date → NULL
    } else {
      extra[k] = v;
    }
  }
  return { cols, extra };
};

// POST /api/bedside/patients  { demographics: { first_name, ... } }
// Creates the patient row + an empty HDF5 data file.
router.post('/bedside/patients', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { cols, extra } = splitDemographics(req.body?.demographics ?? req.body?.answers ?? {});
  let patientId, fileKey;
  try {
    // 1. demographics → patients row
    const names = [...Object.keys(cols), 'extra'];
    const vals  = [...Object.values(cols), JSON.stringify(extra)];
    const ph    = vals.map((_, i) => `$${i + 1}`);
    const ins = await pool.query(
      `INSERT INTO patients (${names.join(', ')}) VALUES (${ph.join(', ')}) RETURNING id`,
      vals,
    );
    patientId = ins.rows[0].id;

    // 2. mint an empty data file (HDF5 structure deferred — placeholder for now)
    fileKey = `bedside/patients/${patientId}.h5`;
    const filename = (req.body?.filename ?? `patient-${patientId}.h5`).toString();
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
      'INSERT INTO patient_files (patient_id, file_id) VALUES ($1::uuid, $2::uuid)',
      [patientId, fileRow.id],
    );

    res.json({ patient_id: patientId, file_id: fileRow.id, file_key: fileKey });
  } catch (err) {
    console.error('bedside/patients create error:', err.message);
    if (patientId) await pool.query('DELETE FROM patients WHERE id = $1::uuid', [patientId]).catch(() => {});
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/bedside/patients/:patientId
// Removes the patient (cascades patient_files + bed_assignments), then its data file.
router.delete('/bedside/patients/:patientId', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { patientId } = req.params;
  try {
    const pf = await pool.query(
      `SELECT pf.file_id, f.key FROM patient_files pf
       JOIN files f ON f.id = pf.file_id
       WHERE pf.patient_id = $1::uuid`,
      [patientId],
    );
    await pool.query('DELETE FROM patients WHERE id = $1::uuid', [patientId]);
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
