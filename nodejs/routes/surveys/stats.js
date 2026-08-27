// [SURVEYS] CSV export of a survey's answers.
//
// manuBeat-owned. Lived in the framework's `routes/framework/compute.js` until
// manuSpine removed its stats layer (2026-07-04); moved here rather than patched
// back into a framework file — see CLAUDE.md "Framework upstream".
//
// REST rather than GraphQL because the response is a binary/text stream with a
// Content-Disposition, which GraphQL handles badly (same reasoning as
// routes/framework/files.js). Node reads the data, Python renders the CSV.
//
// Admin-only, matching the `surveyStats` tier in permissions.js: this returns
// every respondent's answers in one file. REST enforces its own auth — the
// GraphQL gate does not see this route.
const express = require('express');
const axios   = require('axios');
const { loadSurveyPayload } = require('../../schema/resolvers/surveys/stats');

const router = express.Router();

// GET /api/surveys/:id/stats/export → text/csv
router.get('/surveys/:id/stats/export', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  if (req.user.tier !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  try {
    console.log('-> Survey stats export for:', req.params.id);
    const payload = await loadSurveyPayload(req.params.id);

    const pythonUrl = `http://${process.env.PYTHON_HOST}:${process.env.PYTHON_PORT}/surveys/stats/export`;
    const { data, headers } = await axios.post(pythonUrl, payload, { responseType: 'arraybuffer' });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', headers['content-disposition'] ?? 'attachment; filename="survey_export.csv"');
    res.send(data);
  } catch (err) {
    console.error('-> Survey export error:', err.message);
    res.status(500).json({ error: 'Export failed' });
  }
});

module.exports = router;
