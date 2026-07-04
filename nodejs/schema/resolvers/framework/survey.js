const {
  GraphQLList,
  GraphQLString,
  GraphQLID,
  GraphQLBoolean,
  GraphQLFloat,
  GraphQLNonNull,
} = require('graphql');
const { pool } = require('../../../db');
const {
  SurveyComponentType,
  SurveyComponentInputType,
  SurveyType,
  SurveyAnswerType,
  GraphQLJSON,
} = require('../../types');
const { postSurveyComponent } = require('../../helpers/survey');

const queries = {
  surveyComponent: {
    type: new GraphQLList(SurveyComponentType),
    args: { id: { type: GraphQLString } },
    async resolve(_, { id }) {
      console.log('-> Get survey component by id:', id);
      const res = await pool.query('SELECT * FROM survey_components WHERE id = $1::uuid', [id]);
      if (!res.rows.length) throw new Error('Survey component not found');
      return res.rows;
    },
  },
  surveyComponentList: {
    type: new GraphQLList(SurveyComponentType),
    args: { type: { type: GraphQLString } },
    async resolve(_, { type }) {
      console.log('-> Get survey component list by type:', type);
      const query  = type ? 'SELECT * FROM survey_components WHERE type = $1::text ORDER BY name' : 'SELECT * FROM survey_components ORDER BY name';
      const params = type ? [type] : [];
      const res = await pool.query(query, params);
      return res.rows;
    },
  },
  surveyComponentParents: {
    type: new GraphQLList(SurveyComponentType),
    args: { child_id: { type: GraphQLID } },
    async resolve(_, { child_id }) {
      console.log('-> Get survey component parents for child:', child_id);
      const res = await pool.query(
        `SELECT sc.* FROM survey_components sc
         JOIN survey_components_relationships scr ON scr.parent_id = sc.id
         WHERE scr.child_id = $1::uuid`,
        [child_id]
      );
      return res.rows;
    },
  },
  surveyList: {
    type: new GraphQLList(SurveyType),
    async resolve() {
      console.log('-> Get survey list');
      const res = await pool.query('SELECT * FROM surveys WHERE is_active = true ORDER BY created_at DESC');
      return res.rows;
    },
  },
  // Admin sees every answer; a regular user sees only their own submissions.
  surveyAnswers: {
    type: new GraphQLList(SurveyAnswerType),
    args: {
      survey_id: { type: GraphQLID },
      filter:    { type: GraphQLJSON },
    },
    async resolve(_, { survey_id, filter }, ctx) {
      console.log('-> Get survey answers for:', survey_id, 'filter:', filter);
      const cols = `sa.id, sa.survey_id, sa.owner_id, u.email AS owner_email, sa.answers,
        to_char(sa.submitted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS submitted_at`;
      const clauses = ['sa.survey_id = $1::uuid'];
      const params  = [survey_id];
      if (ctx?.user?.tier !== 'admin') {
        params.push(ctx?.user?.id);
        clauses.push(`sa.owner_id = $${params.length}::uuid`);
      }
      if (filter && Object.keys(filter).length > 0) {
        params.push(JSON.stringify(filter));
        clauses.push(`sa.answers @> $${params.length}::jsonb`);
      }
      const res = await pool.query(
        `SELECT ${cols} FROM survey_answers sa
         JOIN users u ON u.id = sa.owner_id
         WHERE ${clauses.join(' AND ')} ORDER BY sa.submitted_at DESC`,
        params
      );
      return res.rows;
    },
  },
};

const mutations = {
  createSurveyComponent: {
    type: SurveyComponentType,
    args: {
      name:     { type: new GraphQLNonNull(GraphQLString) },
      type:     { type: GraphQLString },
      data:     { type: GraphQLJSON },
      options:  { type: GraphQLJSON },
      children: { type: new GraphQLList(SurveyComponentInputType) },
    },
    resolve(_, { name, type, data, options, children }) {
      console.log('-> Create survey component:', name);
      return postSurveyComponent(name, type, data, options, children);
    },
  },
  updateSurveyComponent: {
    type: SurveyComponentType,
    args: {
      id:      { type: new GraphQLNonNull(GraphQLID) },
      name:    { type: GraphQLString },
      type:    { type: GraphQLString },
      data:    { type: GraphQLJSON },
      options: { type: GraphQLJSON },
    },
    async resolve(_, { id, name, type, data, options }) {
      console.log('-> Update survey component:', id);
      const res = await pool.query(
        'UPDATE survey_components SET name=$1, type=$2, data=$3::json, options=$4::json WHERE id=$5::uuid RETURNING *',
        [name, type, data, options, id]
      );
      return res.rows[0];
    },
  },
  deleteSurveyComponent: {
    type: GraphQLBoolean,
    args: { id: { type: GraphQLID } },
    async resolve(_, { id }) {
      console.log('-> Delete survey component:', id);
      await pool.query('DELETE FROM survey_components WHERE id = $1::uuid', [id]);
      return true;
    },
  },
  createSurveyComponentRelation: {
    type: GraphQLBoolean,
    args: {
      parent_id: { type: GraphQLID },
      child_id:  { type: GraphQLID },
      position:  { type: GraphQLFloat },
    },
    async resolve(_, { parent_id, child_id, position }) {
      console.log('-> Relate survey components:', parent_id, '->', child_id);
      await pool.query(
        'INSERT INTO survey_components_relationships (parent_id, child_id, position) VALUES ($1::uuid, $2::uuid, $3) ON CONFLICT DO NOTHING',
        [parent_id, child_id, position ?? 0]
      );
      return true;
    },
  },
  deleteSurveyComponentRelation: {
    type: GraphQLBoolean,
    args: {
      parent_id: { type: GraphQLID },
      child_id:  { type: GraphQLID },
    },
    async resolve(_, { parent_id, child_id }) {
      console.log('-> Unrelate survey components:', parent_id, '->', child_id);
      await pool.query(
        'DELETE FROM survey_components_relationships WHERE parent_id=$1::uuid AND child_id=$2::uuid',
        [parent_id, child_id]
      );
      return true;
    },
  },
  swapSurveyComponentPositions: {
    type: GraphQLBoolean,
    args: {
      parent_id:  { type: GraphQLID },
      child_id_a: { type: GraphQLID },
      child_id_b: { type: GraphQLID },
    },
    async resolve(_, { parent_id, child_id_a, child_id_b }) {
      const res = await pool.query(
        'SELECT child_id, position FROM survey_components_relationships WHERE parent_id=$1::uuid AND child_id IN ($2::uuid, $3::uuid)',
        [parent_id, child_id_a, child_id_b]
      );
      if (res.rows.length !== 2) return false;
      const byId = Object.fromEntries(res.rows.map(r => [r.child_id, r.position]));
      await pool.query(
        'UPDATE survey_components_relationships SET position=$1 WHERE parent_id=$2::uuid AND child_id=$3::uuid',
        [byId[child_id_b], parent_id, child_id_a]
      );
      await pool.query(
        'UPDATE survey_components_relationships SET position=$1 WHERE parent_id=$2::uuid AND child_id=$3::uuid',
        [byId[child_id_a], parent_id, child_id_b]
      );
      return true;
    },
  },
  createSurvey: {
    type: SurveyType,
    args: {
      component_id: { type: GraphQLID },
      title:        { type: GraphQLString },
    },
    async resolve(_, { component_id, title }) {
      console.log('-> Create survey:', title);
      const res = await pool.query(
        'INSERT INTO surveys (component_id, title) VALUES ($1::uuid, $2) RETURNING *',
        [component_id, title]
      );
      return res.rows[0];
    },
  },
  submitAnswer: {
    type: SurveyAnswerType,
    args: {
      survey_id: { type: GraphQLID },
      answers:   { type: GraphQLJSON },
    },
    async resolve(_, { survey_id, answers }, ctx) {
      console.log('-> Submit answer for survey:', survey_id);
      const res = await pool.query(
        `INSERT INTO survey_answers (survey_id, owner_id, answers) VALUES ($1::uuid, $2::uuid, $3::jsonb)
         RETURNING id, survey_id, owner_id, answers,
           to_char(submitted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS submitted_at`,
        [survey_id, ctx?.user?.id, JSON.stringify(answers)]
      );
      return res.rows[0];
    },
  },
  updateAnswer: {
    type: SurveyAnswerType,
    args: {
      id:      { type: GraphQLID },
      answers: { type: GraphQLJSON },
    },
    async resolve(_, { id, answers }, ctx) {
      console.log('-> Update answer:', id);
      const params = [JSON.stringify(answers), id];
      const scope  = ctx?.user?.tier === 'admin' ? '' : ` AND owner_id = $${params.length + 1}::uuid`;
      if (scope) params.push(ctx?.user?.id);
      const res = await pool.query(
        `UPDATE survey_answers SET answers = $1::jsonb WHERE id = $2::uuid${scope}
         RETURNING id, survey_id, owner_id, answers,
           to_char(submitted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS submitted_at`,
        params
      );
      if (!res.rows[0]) throw new Error('Answer not found or not authorised');
      return res.rows[0];
    },
  },
  deleteAnswer: {
    type: GraphQLBoolean,
    args: { id: { type: GraphQLID } },
    async resolve(_, { id }) {
      console.log('-> Delete answer:', id);
      await pool.query('DELETE FROM survey_answers WHERE id = $1::uuid', [id]);
      return true;
    },
  },
};

module.exports = { queries, mutations };
