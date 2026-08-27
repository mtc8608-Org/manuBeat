// [SURVEYS] Aggregate statistics over a survey's submitted answers.
//
// manuBeat-owned. This lived in the framework's `resolvers/framework/survey.js`
// until manuSpine removed its stats layer (2026-07-04); the Stats tab is one of
// this app's features, so the query moved here instead of being patched back
// into a framework file — see CLAUDE.md "Framework upstream".
//
// Node owns all data access: it flattens the question tree with a recursive CTE,
// reads the raw answers, and posts a self-contained payload to Python, which owns
// all computation and knows nothing about the schema.
//
// Admin-only (permissions.js): this reads EVERY respondent's answers at once, so
// it deliberately sits outside the owner-scoped `surveyAnswers` query — a
// cross-respondent aggregate is not something an answer's owner may run.
const { GraphQLNonNull, GraphQLID } = require('graphql');
const axios = require('axios');
const { pool } = require('../../../db');
const { GraphQLJSON } = require('../../types');

// Every answer-producing node in the tree: containers (`survey`) and select
// children (`option`) are excluded, leaves at any depth are kept.
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
  ORDER BY type
`;

// Shared by the resolver and the CSV export route (routes/surveys/stats.js).
async function loadSurveyPayload(surveyId) {
  const [qRes, aRes] = await Promise.all([
    pool.query(SURVEY_QUESTIONS_CTE, [surveyId]),
    pool.query('SELECT answers FROM survey_answers WHERE survey_id = $1::uuid', [surveyId]),
  ]);
  return {
    questions: qRes.rows.map(r => ({ id: r.id, type: r.type, text: r.data?.text ?? r.type })),
    answers:   aRes.rows.map(r => r.answers),
  };
}

const queries = {
  surveyStats: {
    type: GraphQLJSON,
    args: { survey_id: { type: new GraphQLNonNull(GraphQLID) } },
    async resolve(_, { survey_id }) {
      console.log('-> Survey stats for:', survey_id);
      const payload = await loadSurveyPayload(survey_id);
      const pythonUrl = `http://${process.env.PYTHON_HOST}:${process.env.PYTHON_PORT}/surveys/stats`;
      const { data } = await axios.post(pythonUrl, payload);
      return data;
    },
  },
};

module.exports = { queries, mutations: {}, loadSurveyPayload };
