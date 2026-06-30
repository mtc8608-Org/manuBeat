// [BEDSIDE] Data Collection — GraphQL reads + bed linking.
//
// Patient identity = Patient Registration survey answer (survey f000). This
// resolver exposes the bedside fleet (Pis/beds), the patient list (answers joined
// with their current bed + data file), and patient↔bed assignment history.
//
// All fields are admin-only (PHI). Mutations already default to admin via the
// permissions layer; queries are NOT gated there, so we guard every resolver.
const {
  GraphQLObjectType, GraphQLList, GraphQLString, GraphQLID,
  GraphQLNonNull, GraphQLBoolean,
} = require('graphql');
const { pool } = require('../../../db');
const { GraphQLJSON } = require('../../types');

// Patient Registration survey — hardcoded seed UUID (01-init-db.sql).
const PATIENT_SURVEY_ID = 'c51c1e5f-5cc1-4b77-8832-2d10cc97f000';

const iso = v => (v ? v.toISOString() : null);

const requireAdmin = (ctx) => {
  if (ctx?.user?.role !== 'admin') throw new Error('Admin access required');
};

// ── Types ─────────────────────────────────────────────────────────────────────

const BedsideNodeType = new GraphQLObjectType({
  name: 'BedsideNode',
  fields: () => ({
    id:         { type: GraphQLID },
    name:       { type: GraphQLString },
    hostname:   { type: GraphQLString },
    ip_address: { type: GraphQLString },
    location:   { type: GraphQLString },
    status:     { type: GraphQLString },
    last_seen:  { type: GraphQLString, resolve: r => iso(r.last_seen) },
    hardware:   { type: GraphQLJSON },
    created_at: { type: GraphQLString, resolve: r => iso(r.created_at) },
    bed_label:  { type: GraphQLString },   // joined: the bed this Pi serves
  }),
});

const BedType = new GraphQLObjectType({
  name: 'Bed',
  fields: () => ({
    id:            { type: GraphQLID },
    label:         { type: GraphQLString },
    node_id:       { type: GraphQLID },
    node_name:     { type: GraphQLString },
    node_status:   { type: GraphQLString },
    node_location: { type: GraphQLString },
    created_at:    { type: GraphQLString, resolve: r => iso(r.created_at) },
  }),
});

const PatientType = new GraphQLObjectType({
  name: 'Patient',
  fields: () => ({
    id:           { type: GraphQLID },        // = survey_answers.id
    answers:      { type: GraphQLJSON },      // demographics
    submitted_at: { type: GraphQLString, resolve: r => iso(r.submitted_at) },
    file_id:      { type: GraphQLID },
    file_key:     { type: GraphQLString },
    bed_id:       { type: GraphQLID },         // current (active) bed, if any
    bed_label:    { type: GraphQLString },
    node_name:    { type: GraphQLString },
    node_status:  { type: GraphQLString },
  }),
});

const BedAssignmentType = new GraphQLObjectType({
  name: 'BedAssignment',
  fields: () => ({
    id:                { type: GraphQLID },
    patient_answer_id: { type: GraphQLID },
    bed_id:            { type: GraphQLID },
    bed_label:         { type: GraphQLString },
    started_at:        { type: GraphQLString, resolve: r => iso(r.started_at) },
    ended_at:          { type: GraphQLString, resolve: r => iso(r.ended_at) },
    active:            { type: GraphQLBoolean, resolve: r => r.ended_at == null },
  }),
});

// ── Queries ─────────────────────────────────────────────────────────────────

const queries = {
  bedsideNodes: {
    type: new GraphQLList(BedsideNodeType),
    async resolve(_, __, ctx) {
      requireAdmin(ctx);
      const res = await pool.query(
        `SELECT n.*, b.label AS bed_label
         FROM bedside_nodes n
         LEFT JOIN beds b ON b.node_id = n.id
         ORDER BY n.name`,
      );
      return res.rows;
    },
  },
  beds: {
    type: new GraphQLList(BedType),
    async resolve(_, __, ctx) {
      requireAdmin(ctx);
      const res = await pool.query(
        `SELECT b.*, n.name AS node_name, n.status AS node_status, n.location AS node_location
         FROM beds b
         LEFT JOIN bedside_nodes n ON n.id = b.node_id
         ORDER BY b.label`,
      );
      return res.rows;
    },
  },
  patients: {
    type: new GraphQLList(PatientType),
    async resolve(_, __, ctx) {
      requireAdmin(ctx);
      const res = await pool.query(
        `SELECT sa.id, sa.answers, sa.submitted_at,
                pf.file_id, f.key AS file_key,
                ba.bed_id, b.label AS bed_label,
                n.name AS node_name, n.status AS node_status
         FROM survey_answers sa
         LEFT JOIN patient_files pf ON pf.patient_answer_id = sa.id
         LEFT JOIN files f          ON f.id = pf.file_id
         LEFT JOIN bed_assignments ba ON ba.patient_answer_id = sa.id AND ba.ended_at IS NULL
         LEFT JOIN beds b           ON b.id = ba.bed_id
         LEFT JOIN bedside_nodes n  ON n.id = b.node_id
         WHERE sa.survey_id = $1::uuid
         ORDER BY sa.submitted_at DESC`,
        [PATIENT_SURVEY_ID],
      );
      return res.rows;
    },
  },
  bedAssignments: {
    type: new GraphQLList(BedAssignmentType),
    args: { patient_answer_id: { type: GraphQLID } },
    async resolve(_, { patient_answer_id }, ctx) {
      requireAdmin(ctx);
      const where = patient_answer_id ? 'WHERE ba.patient_answer_id = $1::uuid' : '';
      const res = await pool.query(
        `SELECT ba.*, b.label AS bed_label
         FROM bed_assignments ba
         LEFT JOIN beds b ON b.id = ba.bed_id
         ${where}
         ORDER BY ba.started_at DESC`,
        patient_answer_id ? [patient_answer_id] : [],
      );
      return res.rows;
    },
  },
};

// ── Mutations ───────────────────────────────────────────────────────────────

const mutations = {
  createBed: {
    type: BedType,
    args: {
      label:   { type: new GraphQLNonNull(GraphQLString) },
      node_id: { type: GraphQLID },
    },
    async resolve(_, { label, node_id }, ctx) {
      requireAdmin(ctx);
      const res = await pool.query(
        'INSERT INTO beds (label, node_id) VALUES ($1, $2::uuid) RETURNING *',
        [label, node_id ?? null],
      );
      return res.rows[0];
    },
  },
  updateBedsideNode: {
    type: BedsideNodeType,
    args: {
      id:         { type: new GraphQLNonNull(GraphQLID) },
      name:       { type: GraphQLString },
      hostname:   { type: GraphQLString },
      ip_address: { type: GraphQLString },
      location:   { type: GraphQLString },
      status:     { type: GraphQLString },
      hardware:   { type: GraphQLJSON },
    },
    async resolve(_, { id, ...fields }, ctx) {
      requireAdmin(ctx);
      const sets = [], vals = [];
      for (const [k, v] of Object.entries(fields)) {
        if (v === undefined) continue;
        vals.push(k === 'hardware' ? JSON.stringify(v) : v);
        sets.push(`${k} = $${vals.length}`);
      }
      if (!sets.length) throw new Error('Nothing to update');
      vals.push(id);
      const res = await pool.query(
        `UPDATE bedside_nodes SET ${sets.join(', ')} WHERE id = $${vals.length}::uuid RETURNING *`,
        vals,
      );
      return res.rows[0] ?? null;
    },
  },
  assignPatientToBed: {
    type: BedAssignmentType,
    args: {
      patient_answer_id: { type: new GraphQLNonNull(GraphQLID) },
      bed_id:            { type: new GraphQLNonNull(GraphQLID) },
    },
    async resolve(_, { patient_answer_id, bed_id }, ctx) {
      requireAdmin(ctx);
      // Close any active assignment for this patient OR this bed, then open a new one.
      await pool.query(
        `UPDATE bed_assignments SET ended_at = now()
         WHERE ended_at IS NULL AND (patient_answer_id = $1::uuid OR bed_id = $2::uuid)`,
        [patient_answer_id, bed_id],
      );
      const res = await pool.query(
        'INSERT INTO bed_assignments (patient_answer_id, bed_id) VALUES ($1::uuid, $2::uuid) RETURNING *',
        [patient_answer_id, bed_id],
      );
      return res.rows[0];
    },
  },
  endBedAssignment: {
    type: GraphQLBoolean,
    args: { id: { type: new GraphQLNonNull(GraphQLID) } },
    async resolve(_, { id }, ctx) {
      requireAdmin(ctx);
      await pool.query(
        'UPDATE bed_assignments SET ended_at = now() WHERE id = $1::uuid AND ended_at IS NULL',
        [id],
      );
      return true;
    },
  },
};

module.exports = { queries, mutations };
