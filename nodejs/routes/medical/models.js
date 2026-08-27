const express = require('express');
const axios   = require('axios');
const { pool } = require('../../db');

const router = express.Router();
const PYTHON = () => `http://python:${process.env.PYTHON_PORT}`;

// REST enforces its own auth — the GraphQL gate never sees these routes
// (backend-api.md). Applied as router-level middleware rather than per handler
// so a new endpoint added to this file cannot ship unguarded: every route below
// runs after it. The rung mirrors the `registered` tier that this domain's
// GraphQL ops carry in permissions.js, which in turn mirrors the PrivateRoute
// the Simulator / Sandbox / HdfInspector pages sit behind.
//
// Without this the whole file was tokenless: an anonymous caller could launch
// unbounded Python simulation jobs, read any run's HDF5 datasets, and delete
// them. Never remove it; tighten it if the pages ever move behind AdminRoute.
router.use('/cardio', (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  next();
});

// Second rung, applied per handler below. The two destructive HDF5 endpoints
// mutate or erase another account's run data on a shared, unowned store, so
// they sit at admin — matching where the medical write mutations live in
// permissions.js. Everything else (reads, POST /cardio/run) stays at the
// router-level guard so any signed-in account can still run simulations.
const requireAdmin = (req, res, next) => {
  if (req.user?.tier !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
};

// POST /api/cardio/run
// Creates a model_run row, fires the Python job, returns job_id + run_id.
//
// A run is model (structure) + scenario (values) + mode. Node owns every DB read —
// Python holds no credentials — so both configs are fetched here and POSTed in the
// body. The client may send scenario_json inline (the Simulator's unsaved edits);
// otherwise scenario_id is resolved against scenario_configs.
router.post('/cardio/run', async (req, res) => {
  const { config_id, model_json, scenario_id, scenario_json, mode, simulation_params, name } = req.body;
  const runMode = mode ?? 'baseline';
  let runId;
  try {
    let scenario = scenario_json;
    let scenarioName = '';
    if (scenario_id) {
      const scRes = await pool.query(
        'SELECT name, config FROM scenario_configs WHERE id = $1::uuid', [scenario_id],
      );
      if (!scRes.rows.length) return res.status(404).json({ error: 'scenario_config not found' });
      scenarioName = scRes.rows[0].name;
      scenario = scenario ?? scRes.rows[0].config;
    }
    if (!scenario) {
      return res.status(400).json({ error: 'scenario_id or scenario_json is required' });
    }

    let modelName = '';
    if (config_id) {
      const mcRes = await pool.query(
        'SELECT name FROM model_configs WHERE id = $1::uuid', [config_id],
      );
      modelName = mcRes.rows[0]?.name ?? '';
    }

    const runRes = await pool.query(
      `INSERT INTO model_runs (config_id, scenario_id, mode, status)
       VALUES ($1::uuid, $2::uuid, $3, $4) RETURNING id`,
      [config_id ?? null, scenario_id ?? null, runMode, 'pending'],
    );
    runId = runRes.rows[0].id;

    const pythonRes = await axios.post(
      `${PYTHON()}/cardio/run`,
      { run_id: runId, model_json, scenario_json: scenario, mode: runMode,
        model_name: modelName, scenario_name: scenarioName, simulation_params },
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

// GET /api/cardio/scenarios — the scenario JSONs shipped on disk in python/config.
// The app reads scenario_configs from Postgres; these two expose the disk originals
// the seeds were generated from, for diffing a DB row against the shipped file.
router.get('/cardio/scenarios', async (req, res) => {
  try {
    const pythonRes = await axios.get(`${PYTHON()}/cardio/scenarios`, { timeout: 5000 });
    res.json(pythonRes.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cardio/scenario/:filename
router.get('/cardio/scenario/:filename', async (req, res) => {
  try {
    const pythonRes = await axios.get(`${PYTHON()}/cardio/scenario/${req.params.filename}`, { timeout: 5000 });
    res.json(pythonRes.data);
  } catch (err) {
    const status = err.response?.status ?? 500;
    res.status(status).json({ error: err.message });
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
router.delete('/cardio/hdf5/dataset/:runId', requireAdmin, async (req, res) => {
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
router.post('/cardio/hdf5/repack/:runId', requireAdmin, async (req, res) => {
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
