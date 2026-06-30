// [BEDSIDE] Data Collection — GraphQL reads + bed linking + telemetry.
//
// Patients are a first-class `patients` table (detached from surveys). This
// resolver exposes the patient roster, the bedside fleet (Pis/beds), node + device
// token management, patient↔bed assignment history, and the live telemetry reads
// (streams, latest segments, heartbeats) that back the Monitor page.
//
// All fields are admin-only (PHI). Mutations default to admin via the permissions
// layer; queries are NOT gated there, so we guard every resolver.
const {
  GraphQLObjectType, GraphQLList, GraphQLString, GraphQLID,
  GraphQLNonNull, GraphQLBoolean, GraphQLInt, GraphQLFloat,
} = require('graphql');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { pool } = require('../../../db');
const { GraphQLJSON } = require('../../types');

const iso = v => (v ? v.toISOString() : null);
const ONLINE_WINDOW_MS = 30_000;
const isOnline = r => !!r.last_seen && (Date.now() - new Date(r.last_seen).getTime() < ONLINE_WINDOW_MS);

const requireAdmin = (ctx) => {
  if (ctx?.user?.role !== 'admin') throw new Error('Admin access required');
};

const newToken = () => crypto.randomBytes(24).toString('hex');

// ── Types ─────────────────────────────────────────────────────────────────────

const BedsideNodeType = new GraphQLObjectType({
  name: 'BedsideNode',
  fields: () => ({
    id:            { type: GraphQLID },
    node_key:      { type: GraphQLString },
    name:          { type: GraphQLString },
    hostname:      { type: GraphQLString },
    ip_address:    { type: GraphQLString },
    location:      { type: GraphQLString },
    status:        { type: GraphQLString },
    online:        { type: GraphQLBoolean, resolve: isOnline },
    last_seen:     { type: GraphQLString, resolve: r => iso(r.last_seen) },
    agent_version: { type: GraphQLString },
    hardware:      { type: GraphQLJSON },
    created_at:    { type: GraphQLString, resolve: r => iso(r.created_at) },
    bed_label:     { type: GraphQLString },
    token:         { type: GraphQLString },   // only populated on create / rotate
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
    id:            { type: GraphQLID },
    first_name:    { type: GraphQLString },
    last_name:     { type: GraphQLString },
    date_of_birth: { type: GraphQLString, resolve: r => (r.date_of_birth ? r.date_of_birth.toISOString().slice(0, 10) : null) },
    sex:           { type: GraphQLString },
    identifier:    { type: GraphQLString },
    email:         { type: GraphQLString },
    phone:         { type: GraphQLString },
    address:       { type: GraphQLString },
    notes:         { type: GraphQLString },
    extra:         { type: GraphQLJSON },
    created_at:    { type: GraphQLString, resolve: r => iso(r.created_at) },
    file_id:       { type: GraphQLID },
    file_key:      { type: GraphQLString },
    bed_id:        { type: GraphQLID },
    bed_label:     { type: GraphQLString },
    node_key:      { type: GraphQLString },
    node_name:     { type: GraphQLString },
    node_status:   { type: GraphQLString },
  }),
});

const BedAssignmentType = new GraphQLObjectType({
  name: 'BedAssignment',
  fields: () => ({
    id:         { type: GraphQLID },
    patient_id: { type: GraphQLID },
    bed_id:     { type: GraphQLID },
    bed_label:  { type: GraphQLString },
    started_at: { type: GraphQLString, resolve: r => iso(r.started_at) },
    ended_at:   { type: GraphQLString, resolve: r => iso(r.ended_at) },
    active:     { type: GraphQLBoolean, resolve: r => r.ended_at == null },
  }),
});

const StreamType = new GraphQLObjectType({
  name: 'BedsideStream',
  fields: () => ({
    id:           { type: GraphQLID },
    stream_id:    { type: GraphQLString },
    modality:     { type: GraphQLString },
    group:        { type: GraphQLString },
    channel:      { type: GraphQLString },
    units:        { type: GraphQLString },
    metric:       { type: GraphQLString },
    sampling_hz:  { type: GraphQLFloat },
    source:       { type: GraphQLString },
    last_seq:     { type: GraphQLFloat },
    last_time_us: { type: GraphQLFloat },
  }),
});

const SegmentType = new GraphQLObjectType({
  name: 'BedsideSegment',
  fields: () => ({
    id:            { type: GraphQLID },
    stream_id:     { type: GraphQLString },
    seq:           { type: GraphQLFloat },
    start_time_us: { type: GraphQLFloat },
    sampling_hz:   { type: GraphQLFloat },
    duration:      { type: GraphQLInt },
    samples:       { type: new GraphQLList(GraphQLFloat) },
    quality:       { type: GraphQLJSON },
  }),
});

const HeartbeatType = new GraphQLObjectType({
  name: 'NodeHeartbeat',
  fields: () => ({
    id:              { type: GraphQLID },
    ts_ms:           { type: GraphQLFloat },
    cpu_temp_c:      { type: GraphQLFloat },
    disk_free_bytes: { type: GraphQLFloat },
    buffer_pending:  { type: GraphQLInt },
    last_sample_us:  { type: GraphQLJSON },
    agent_version:   { type: GraphQLString },
    received_at:     { type: GraphQLString, resolve: r => iso(r.received_at) },
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
        `SELECT p.*,
                pf.file_id, f.key AS file_key,
                ba.bed_id, b.label AS bed_label,
                n.node_key, n.name AS node_name, n.status AS node_status
         FROM patients p
         LEFT JOIN patient_files pf ON pf.patient_id = p.id
         LEFT JOIN files f          ON f.id = pf.file_id
         LEFT JOIN bed_assignments ba ON ba.patient_id = p.id AND ba.ended_at IS NULL
         LEFT JOIN beds b           ON b.id = ba.bed_id
         LEFT JOIN bedside_nodes n  ON n.id = b.node_id
         ORDER BY p.created_at DESC`,
      );
      return res.rows;
    },
  },
  bedAssignments: {
    type: new GraphQLList(BedAssignmentType),
    args: { patient_id: { type: GraphQLID } },
    async resolve(_, { patient_id }, ctx) {
      requireAdmin(ctx);
      const where = patient_id ? 'WHERE ba.patient_id = $1::uuid' : '';
      const res = await pool.query(
        `SELECT ba.*, b.label AS bed_label
         FROM bed_assignments ba
         LEFT JOIN beds b ON b.id = ba.bed_id
         ${where}
         ORDER BY ba.started_at DESC`,
        patient_id ? [patient_id] : [],
      );
      return res.rows;
    },
  },
  bedsideStreams: {
    type: new GraphQLList(StreamType),
    args: { node_id: { type: new GraphQLNonNull(GraphQLID) } },
    async resolve(_, { node_id }, ctx) {
      requireAdmin(ctx);
      const res = await pool.query(
        `SELECT id, stream_id, modality, "group", channel, units, metric,
                sampling_hz, source, last_seq, last_time_us
         FROM bedside_streams WHERE node_id = $1::uuid ORDER BY stream_id`,
        [node_id],
      );
      return res.rows;
    },
  },
  latestSegments: {
    type: new GraphQLList(SegmentType),
    args: {
      node_id:   { type: new GraphQLNonNull(GraphQLID) },
      stream_id: { type: GraphQLString },
      limit:     { type: GraphQLInt },
    },
    async resolve(_, { node_id, stream_id, limit }, ctx) {
      requireAdmin(ctx);
      const lim = Math.min(limit ?? 50, 500);
      const params = [node_id];
      let streamFilter = '';
      if (stream_id) { params.push(stream_id); streamFilter = `AND stream_id = $${params.length}`; }
      params.push(lim);
      const res = await pool.query(
        `SELECT * FROM (
           SELECT id, stream_id, seq, start_time_us, sampling_hz, duration, samples, quality
           FROM bedside_segments
           WHERE node_id = $1::uuid ${streamFilter}
           ORDER BY seq DESC LIMIT $${params.length}
         ) s ORDER BY seq ASC`,
        params,
      );
      return res.rows;
    },
  },
  nodeHeartbeats: {
    type: new GraphQLList(HeartbeatType),
    args: { node_id: { type: new GraphQLNonNull(GraphQLID) }, limit: { type: GraphQLInt } },
    async resolve(_, { node_id, limit }, ctx) {
      requireAdmin(ctx);
      const res = await pool.query(
        `SELECT * FROM node_heartbeats WHERE node_id = $1::uuid
         ORDER BY received_at DESC LIMIT $2`,
        [node_id, Math.min(limit ?? 20, 200)],
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
  createBedsideNode: {
    type: BedsideNodeType,
    args: {
      name:     { type: new GraphQLNonNull(GraphQLString) },
      node_key: { type: new GraphQLNonNull(GraphQLString) },
      location: { type: GraphQLString },
      hostname: { type: GraphQLString },
    },
    async resolve(_, { name, node_key, location, hostname }, ctx) {
      requireAdmin(ctx);
      const token = newToken();
      const token_hash = await bcrypt.hash(token, 10);
      const res = await pool.query(
        `INSERT INTO bedside_nodes (name, node_key, location, hostname, token_hash)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [name, node_key, location ?? null, hostname ?? null, token_hash],
      );
      return { ...res.rows[0], token };   // plaintext shown once
    },
  },
  rotateNodeToken: {
    type: BedsideNodeType,
    args: { id: { type: new GraphQLNonNull(GraphQLID) } },
    async resolve(_, { id }, ctx) {
      requireAdmin(ctx);
      const token = newToken();
      const token_hash = await bcrypt.hash(token, 10);
      const res = await pool.query(
        'UPDATE bedside_nodes SET token_hash = $2 WHERE id = $1::uuid RETURNING *',
        [id, token_hash],
      );
      if (!res.rows[0]) throw new Error('Node not found');
      return { ...res.rows[0], token };
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
  deleteBedsideNode: {
    type: GraphQLBoolean,
    args: { id: { type: new GraphQLNonNull(GraphQLID) } },
    async resolve(_, { id }, ctx) {
      requireAdmin(ctx);
      await pool.query('DELETE FROM bedside_nodes WHERE id = $1::uuid', [id]);
      return true;
    },
  },
  assignPatientToBed: {
    type: BedAssignmentType,
    args: {
      patient_id: { type: new GraphQLNonNull(GraphQLID) },
      bed_id:     { type: new GraphQLNonNull(GraphQLID) },
    },
    async resolve(_, { patient_id, bed_id }, ctx) {
      requireAdmin(ctx);
      await pool.query(
        `UPDATE bed_assignments SET ended_at = now()
         WHERE ended_at IS NULL AND (patient_id = $1::uuid OR bed_id = $2::uuid)`,
        [patient_id, bed_id],
      );
      const res = await pool.query(
        'INSERT INTO bed_assignments (patient_id, bed_id) VALUES ($1::uuid, $2::uuid) RETURNING *',
        [patient_id, bed_id],
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
