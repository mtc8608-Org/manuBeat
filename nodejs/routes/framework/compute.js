const express = require('express');
const axios   = require('axios');
const { pool } = require('../../db');

const router = express.Router();

const SURVEY_QUESTIONS_CTE = `
  WITH RECURSIVE tree AS (
    SELECT sc.id, sc.type, sc.data
    FROM surveys s
    JOIN survey_components sc ON sc.id = s.component_id
    WHERE s.id = $1::uuid
    UNION ALL
    SELECT sc.id, sc.type, sc.data
    FROM survey_components sc
    JOIN survey_components_relationships scr ON scr.child_id = sc.id
    JOIN tree ON tree.id = scr.parent_id
  )
  SELECT id, type, data FROM tree
  WHERE type NOT IN ('survey', 'option')
`;

// GET /api/surveys/:id/stats/export
// Fetches questions + answers from Postgres, calls Python /compute/survey-stats/export,
// and streams the resulting CSV back to the client.
router.get('/surveys/:id/stats/export', async (req, res) => {
  try {
    const { id } = req.params;

    const [qRes, aRes] = await Promise.all([
      pool.query(SURVEY_QUESTIONS_CTE, [id]),
      pool.query('SELECT answers FROM survey_answers WHERE survey_id = $1::uuid', [id]),
    ]);

    const questions = qRes.rows.map(r => ({
      id:   r.id,
      type: r.type,
      text: r.data?.text ?? r.type,
    }));
    const answers = aRes.rows.map(r => r.answers);

    const pythonUrl = `http://${process.env.PYTHON_HOST}:${process.env.PYTHON_PORT}/compute/survey-stats/export`;
    const { data, headers } = await axios.post(
      pythonUrl,
      { questions, answers },
      { responseType: 'arraybuffer' }
    );

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', headers['content-disposition'] ?? 'attachment; filename="survey_export.csv"');
    res.send(data);
  } catch (err) {
    console.error('-> Export error:', err.message);
    res.status(500).json({ error: 'Export failed' });
  }
});

module.exports = router;
