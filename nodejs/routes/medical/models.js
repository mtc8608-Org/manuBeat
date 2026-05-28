const express = require('express');
const axios   = require('axios');
const { pool } = require('../../db');

const router = express.Router();
const PYTHON = () => `http://python:${process.env.PYTHON_PORT}`;

// POST /api/cardio/run
// Creates a model_run row, fires the Python job, returns job_id + run_id.
router.post('/cardio/run', async (req, res) => {
  const { config_id, model_json, simulation_params, name } = req.body;
  let runId;
  try {
    const runRes = await pool.query(
      'INSERT INTO model_runs (config_id, status) VALUES ($1::uuid, $2) RETURNING id',
      [config_id ?? null, 'pending'],
    );
    runId = runRes.rows[0].id;

    const pythonRes = await axios.post(
      `${PYTHON()}/cardio/run`,
      { run_id: runId, model_json, simulation_params },
      { timeout: 10000 },
    );
    const { job_id } = pythonRes.data;
    const minio_key = `cardio/runs/${runId}.hdf5`;

    await pool.query(
      'UPDATE model_runs SET status = $1, minio_key = $2, metadata = $3 WHERE id = $4::uuid',
      ['running', minio_key, JSON.stringify({ job_id, name: name ?? null }), runId],
    );

    res.json({ run_id: runId, job_id, status: 'running' });
  } catch (err) {
    console.error('cardio/run error:', err.message);
    if (runId) {
      await pool.query(
        'UPDATE model_runs SET status = $1, completed_at = now() WHERE id = $2::uuid',
        ['error', runId],
      ).catch(() => {});
    }
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cardio/status/:jobId
// Polls Python for job status and syncs it to model_runs.
router.get('/cardio/status/:jobId', async (req, res) => {
  try {
    const pythonRes = await axios.get(
      `${PYTHON()}/cardio/status/${req.params.jobId}`,
      { timeout: 5000 },
    );
    const job = pythonRes.data;

    if (job.status === 'done' || job.status === 'error') {
      await pool.query(
        `UPDATE model_runs
         SET status = $1, completed_at = now(),
             metadata = metadata || $2::jsonb
         WHERE metadata->>'job_id' = $3`,
        [
          job.status,
          JSON.stringify({
              duration_s:      job.duration_s,
              state_count:     job.state_count,
              file_size_bytes: job.file_size_bytes ?? null,
              max_rss_mb:      job.max_rss_mb      ?? null,
            }),
          req.params.jobId,
        ],
      );
    }

    res.json(job);
  } catch (err) {
    console.error('cardio/status error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cardio/result/:jobId
// Fetches the result from Python (uses in-memory job registry).
router.get('/cardio/result/:jobId', async (req, res) => {
  try {
    const pythonRes = await axios.get(
      `${PYTHON()}/cardio/result/${req.params.jobId}`,
      { timeout: 30000 },
    );
    res.json(pythonRes.data);
  } catch (err) {
    console.error('cardio/result error:', err.message);
    const status = err.response?.status ?? 500;
    res.status(status).json({ error: err.message });
  }
});

// GET /api/cardio/result-by-run/:runId
// Fetches result directly by DB run_id — survives Python restarts.
router.get('/cardio/result-by-run/:runId', async (req, res) => {
  try {
    const pythonRes = await axios.get(
      `${PYTHON()}/cardio/result-by-run/${req.params.runId}`,
      { timeout: 30000 },
    );
    res.json(pythonRes.data);
  } catch (err) {
    console.error('cardio/result-by-run error:', err.message);
    const status = err.response?.status ?? 500;
    res.status(status).json({ error: err.message });
  }
});

// GET /api/cardio/model/:filename
router.get('/cardio/model/:filename', async (req, res) => {
  try {
    const pythonRes = await axios.get(`${PYTHON()}/cardio/model/${req.params.filename}`, { timeout: 5000 });
    res.json(pythonRes.data);
  } catch (err) {
    const status = err.response?.status ?? 500;
    res.status(status).json({ error: err.message });
  }
});

// GET /api/cardio/configs
router.get('/cardio/configs', async (req, res) => {
  try {
    const pythonRes = await axios.get(`${PYTHON()}/cardio/configs`, { timeout: 5000 });
    res.json(pythonRes.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cardio/hdf5/tree/:runId
router.get('/cardio/hdf5/tree/:runId', async (req, res) => {
  try {
    const pythonRes = await axios.get(
      `${PYTHON()}/cardio/hdf5/tree/${req.params.runId}`,
      { timeout: 30000 },
    );
    res.json(pythonRes.data);
  } catch (err) {
    console.error('cardio/hdf5/tree error:', err.message);
    const status = err.response?.status ?? 500;
    res.status(status).json({ error: err.message });
  }
});

// GET /api/cardio/hdf5/dataset/:runId?path=...&start=...&end=...
router.get('/cardio/hdf5/dataset/:runId', async (req, res) => {
  try {
    const params = new URLSearchParams();
    if (req.query.path)  params.set('path',  req.query.path);
    if (req.query.start) params.set('start', req.query.start);
    if (req.query.end)   params.set('end',   req.query.end);
    const pythonRes = await axios.get(
      `${PYTHON()}/cardio/hdf5/dataset/${req.params.runId}?${params}`,
      { timeout: 30000 },
    );
    res.json(pythonRes.data);
  } catch (err) {
    console.error('cardio/hdf5/dataset error:', err.message);
    const status = err.response?.status ?? 500;
    res.status(status).json({ error: err.message });
  }
});

// DELETE /api/cardio/hdf5/dataset/:runId  { path }
router.delete('/cardio/hdf5/dataset/:runId', async (req, res) => {
  try {
    const pythonRes = await axios.delete(
      `${PYTHON()}/cardio/hdf5/dataset/${req.params.runId}`,
      { data: req.body, timeout: 30000 },
    );
    res.json(pythonRes.data);
  } catch (err) {
    console.error('cardio/hdf5/dataset delete error:', err.message);
    const status = err.response?.status ?? 500;
    res.status(status).json({ error: err.message });
  }
});

// POST /api/cardio/hdf5/repack/:runId
router.post('/cardio/hdf5/repack/:runId', async (req, res) => {
  try {
    const pythonRes = await axios.post(
      `${PYTHON()}/cardio/hdf5/repack/${req.params.runId}`,
      {},
      { timeout: 60000 },
    );
    res.json(pythonRes.data);
  } catch (err) {
    console.error('cardio/hdf5/repack error:', err.message);
    const status = err.response?.status ?? 500;
    res.status(status).json({ error: err.message });
  }
});

// GET /api/cardio/processed-groups/:runId
router.get('/cardio/processed-groups/:runId', async (req, res) => {
  try {
    const pythonRes = await axios.get(
      `${PYTHON()}/cardio/processed-groups/${req.params.runId}`,
      { timeout: 30000 },
    );
    res.json(pythonRes.data);
  } catch (err) {
    console.error('cardio/processed-groups error:', err.message);
    const status = err.response?.status ?? 500;
    res.status(status).json({ error: err.message });
  }
});

// GET /api/cardio/processed/:runId/:procConfigId
router.get('/cardio/processed/:runId/:procConfigId', async (req, res) => {
  try {
    const pythonRes = await axios.get(
      `${PYTHON()}/cardio/processed/${req.params.runId}/${req.params.procConfigId}`,
      { timeout: 60000 },
    );
    res.json(pythonRes.data);
  } catch (err) {
    console.error('cardio/processed error:', err.message);
    const status = err.response?.status ?? 500;
    res.status(status).json({ error: err.message });
  }
});

// POST /api/cardio/process/:runId
// Reads proc_config from DB and sends to Python.
router.post('/cardio/process/:runId', async (req, res) => {
  const { proc_config_id, proc_run_name } = req.body;
  try {
    if (!proc_run_name?.trim()) {
      return res.status(400).json({ error: 'proc_run_name is required' });
    }
    const cfgRes = await pool.query(
      'SELECT name, config FROM proc_configs WHERE id = $1::uuid',
      [proc_config_id],
    );
    if (!cfgRes.rows.length) {
      return res.status(404).json({ error: 'proc_config not found' });
    }
    const { name: proc_config_name, config: proc_config } = cfgRes.rows[0];
    const pythonRes = await axios.post(
      `${PYTHON()}/cardio/process/${req.params.runId}`,
      { proc_run_name: proc_run_name.trim(), proc_config_id, proc_config_name, proc_config },
      { timeout: 120000 },
    );
    res.json(pythonRes.data);
  } catch (err) {
    console.error('cardio/process error:', err.message);
    const status = err.response?.status ?? 500;
    res.status(status).json({ error: err.message });
  }
});

module.exports = router;
