const { GraphQLList, GraphQLString, GraphQLID, GraphQLNonNull } = require('graphql');
const { pool } = require('../../../db');
const { GraphQLJSON } = require('../../types');
const {
  GraphQLObjectType,
  GraphQLBoolean,
} = require('graphql');

const ModelConfigType = new GraphQLObjectType({
  name: 'ModelConfig',
  fields: () => ({
    id:          { type: GraphQLID },
    name:        { type: GraphQLString },
    description: { type: GraphQLString },
    config:      { type: GraphQLJSON },
    // Model Sandbox canvas presentation (node positions, viewport, layer toggles).
    // Never read by the model stack — see 02-init-medical.sql.
    layout:      { type: GraphQLJSON },
    created_at:  { type: GraphQLString, resolve: r => r.created_at?.toISOString() ?? null },
  }),
});

const ModelRunType = new GraphQLObjectType({
  name: 'ModelRun',
  fields: () => ({
    id:           { type: GraphQLID },
    config_id:    { type: GraphQLID },
    scenario_id:  { type: GraphQLID },
    mode:         { type: GraphQLString },
    status:       { type: GraphQLString },
    minio_key:    { type: GraphQLString },
    metadata:     { type: GraphQLJSON },
    created_at:   { type: GraphQLString, resolve: r => r.created_at?.toISOString() ?? null },
    completed_at: { type: GraphQLString, resolve: r => r.completed_at?.toISOString() ?? null },
  }),
});

const modelQueries = {
  modelConfigs: {
    type: new GraphQLList(ModelConfigType),
    async resolve() {
      const res = await pool.query('SELECT * FROM model_configs ORDER BY created_at DESC');
      return res.rows;
    },
  },
  modelConfig: {
    type: ModelConfigType,
    args: { id: { type: new GraphQLNonNull(GraphQLID) } },
    async resolve(_, { id }) {
      const res = await pool.query('SELECT * FROM model_configs WHERE id = $1::uuid', [id]);
      return res.rows[0] ?? null;
    },
  },
  modelRuns: {
    type: new GraphQLList(ModelRunType),
    args: { config_id: { type: GraphQLID } },
    async resolve(_, { config_id }) {
      if (config_id) {
        const res = await pool.query(
          'SELECT * FROM model_runs WHERE config_id = $1::uuid ORDER BY created_at DESC',
          [config_id],
        );
        return res.rows;
      }
      const res = await pool.query('SELECT * FROM model_runs ORDER BY created_at DESC LIMIT 100');
      return res.rows;
    },
  },
};

const modelMutations = {
  createModelConfig: {
    type: ModelConfigType,
    args: {
      name:        { type: new GraphQLNonNull(GraphQLString) },
      description: { type: GraphQLString },
      config:      { type: new GraphQLNonNull(GraphQLJSON) },
    },
    async resolve(_, { name, description, config }) {
      const res = await pool.query(
        'INSERT INTO model_configs (name, description, config) VALUES ($1, $2, $3) RETURNING *',
        [name, description ?? null, JSON.stringify(config)],
      );
      return res.rows[0];
    },
  },
  updateModelConfig: {
    type: ModelConfigType,
    args: {
      id:          { type: new GraphQLNonNull(GraphQLID) },
      name:        { type: GraphQLString },
      description: { type: GraphQLString },
      config:      { type: GraphQLJSON },
      layout:      { type: GraphQLJSON },
    },
    async resolve(_, { id, name, description, config, layout }) {
      const sets = [];
      const vals = [];
      if (name        !== undefined) { vals.push(name);                   sets.push(`name = $${vals.length}`); }
      if (description !== undefined) { vals.push(description);            sets.push(`description = $${vals.length}`); }
      if (config      !== undefined) { vals.push(JSON.stringify(config)); sets.push(`config = $${vals.length}`); }
      if (layout      !== undefined) { vals.push(JSON.stringify(layout)); sets.push(`layout = $${vals.length}`); }
      if (!sets.length) throw new Error('Nothing to update');
      vals.push(id);
      const res = await pool.query(
        `UPDATE model_configs SET ${sets.join(', ')} WHERE id = $${vals.length}::uuid RETURNING *`,
        vals,
      );
      return res.rows[0] ?? null;
    },
  },
  deleteModelConfig: {
    type: GraphQLBoolean,
    args: { id: { type: new GraphQLNonNull(GraphQLID) } },
    async resolve(_, { id }) {
      await pool.query('DELETE FROM model_configs WHERE id = $1::uuid', [id]);
      return true;
    },
  },
  createModelRun: {
    type: ModelRunType,
    args: {
      config_id:   { type: new GraphQLNonNull(GraphQLID) },
      scenario_id: { type: GraphQLID },
      mode:        { type: GraphQLString },
      metadata:    { type: GraphQLJSON },
    },
    async resolve(_, { config_id, scenario_id, mode, metadata }) {
      console.log('-> Create model run', config_id, mode ?? 'baseline');
      const res = await pool.query(
        `INSERT INTO model_runs (config_id, scenario_id, mode, status, metadata)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5) RETURNING *`,
        [config_id, scenario_id ?? null, mode ?? 'baseline', 'pending',
         JSON.stringify(metadata ?? {})],
      );
      return res.rows[0];
    },
  },
  updateModelRun: {
    type: ModelRunType,
    args: {
      id:        { type: new GraphQLNonNull(GraphQLID) },
      status:    { type: GraphQLString },
      minio_key: { type: GraphQLString },
      metadata:  { type: GraphQLJSON },
    },
    async resolve(_, { id, status, minio_key, metadata }) {
      const sets = [];
      const vals = [];
      if (status    !== undefined) { vals.push(status);                   sets.push(`status = $${vals.length}`); }
      if (minio_key !== undefined) { vals.push(minio_key);                sets.push(`minio_key = $${vals.length}`); }
      if (metadata  !== undefined) { vals.push(JSON.stringify(metadata)); sets.push(`metadata = $${vals.length}`); }
      if (status === 'done' || status === 'error') {
        sets.push(`completed_at = now()`);
      }
      if (!sets.length) throw new Error('Nothing to update');
      vals.push(id);
      const res = await pool.query(
        `UPDATE model_runs SET ${sets.join(', ')} WHERE id = $${vals.length}::uuid RETURNING *`,
        vals,
      );
      return res.rows[0] ?? null;
    },
  },
  deleteModelRun: {
    type: GraphQLBoolean,
    args: { id: { type: new GraphQLNonNull(GraphQLID) } },
    async resolve(_, { id }) {
      await pool.query('DELETE FROM model_runs WHERE id = $1::uuid', [id]);
      return true;
    },
  },
};

// Scenario = the VALUES half of a run (twin targets, integration numerics, the
// baseline/calibration/control stage stacks). Same CRUD shape as model_configs
// because the Scenario Sandbox is the Model Sandbox with a different table.
const ScenarioConfigType = new GraphQLObjectType({
  name: 'ScenarioConfig',
  fields: () => ({
    id:          { type: GraphQLID },
    name:        { type: GraphQLString },
    description: { type: GraphQLString },
    config:      { type: GraphQLJSON },
    created_at:  { type: GraphQLString, resolve: r => r.created_at?.toISOString() ?? null },
  }),
});

const scenarioQueries = {
  scenarioConfigs: {
    type: new GraphQLList(ScenarioConfigType),
    async resolve() {
      const res = await pool.query('SELECT * FROM scenario_configs ORDER BY created_at DESC');
      return res.rows;
    },
  },
  scenarioConfig: {
    type: ScenarioConfigType,
    args: { id: { type: new GraphQLNonNull(GraphQLID) } },
    async resolve(_, { id }) {
      const res = await pool.query('SELECT * FROM scenario_configs WHERE id = $1::uuid', [id]);
      return res.rows[0] ?? null;
    },
  },
};

const scenarioMutations = {
  createScenarioConfig: {
    type: ScenarioConfigType,
    args: {
      name:        { type: new GraphQLNonNull(GraphQLString) },
      description: { type: GraphQLString },
      config:      { type: new GraphQLNonNull(GraphQLJSON) },
    },
    async resolve(_, { name, description, config }) {
      console.log('-> Create scenario config', name);
      const res = await pool.query(
        'INSERT INTO scenario_configs (name, description, config) VALUES ($1, $2, $3) RETURNING *',
        [name, description ?? null, JSON.stringify(config)],
      );
      return res.rows[0];
    },
  },
  updateScenarioConfig: {
    type: ScenarioConfigType,
    args: {
      id:          { type: new GraphQLNonNull(GraphQLID) },
      name:        { type: GraphQLString },
      description: { type: GraphQLString },
      config:      { type: GraphQLJSON },
    },
    async resolve(_, { id, name, description, config }) {
      console.log('-> Update scenario config', id);
      const sets = [];
      const vals = [];
      if (name        !== undefined) { vals.push(name);                   sets.push(`name = $${vals.length}`); }
      if (description !== undefined) { vals.push(description);            sets.push(`description = $${vals.length}`); }
      if (config      !== undefined) { vals.push(JSON.stringify(config)); sets.push(`config = $${vals.length}`); }
      if (!sets.length) throw new Error('Nothing to update');
      vals.push(id);
      const res = await pool.query(
        `UPDATE scenario_configs SET ${sets.join(', ')} WHERE id = $${vals.length}::uuid RETURNING *`,
        vals,
      );
      return res.rows[0] ?? null;
    },
  },
  deleteScenarioConfig: {
    type: GraphQLBoolean,
    args: { id: { type: new GraphQLNonNull(GraphQLID) } },
    async resolve(_, { id }) {
      console.log('-> Delete scenario config', id);
      await pool.query('DELETE FROM scenario_configs WHERE id = $1::uuid', [id]);
      return true;
    },
  },
};

const PlotConfigType = new GraphQLObjectType({
  name: 'PlotConfig',
  fields: () => ({
    id:          { type: GraphQLID },
    name:        { type: GraphQLString },
    description: { type: GraphQLString },
    config:      { type: GraphQLJSON },
    created_at:  { type: GraphQLString, resolve: r => r.created_at?.toISOString() ?? null },
  }),
});

const plotQueries = {
  plotConfigs: {
    type: new GraphQLList(PlotConfigType),
    async resolve() {
      const res = await pool.query('SELECT * FROM plot_configs ORDER BY created_at DESC');
      return res.rows;
    },
  },
};

const plotMutations = {
  createPlotConfig: {
    type: PlotConfigType,
    args: {
      name:        { type: new GraphQLNonNull(GraphQLString) },
      description: { type: GraphQLString },
      config:      { type: new GraphQLNonNull(GraphQLJSON) },
    },
    async resolve(_, { name, description, config }) {
      const res = await pool.query(
        'INSERT INTO plot_configs (name, description, config) VALUES ($1, $2, $3) RETURNING *',
        [name, description ?? null, JSON.stringify(config)],
      );
      return res.rows[0];
    },
  },
  updatePlotConfig: {
    type: PlotConfigType,
    args: {
      id:          { type: new GraphQLNonNull(GraphQLID) },
      name:        { type: GraphQLString },
      description: { type: GraphQLString },
      config:      { type: GraphQLJSON },
    },
    async resolve(_, { id, name, description, config }) {
      const sets = [];
      const vals = [];
      if (name        !== undefined) { vals.push(name);                   sets.push(`name = $${vals.length}`); }
      if (description !== undefined) { vals.push(description);            sets.push(`description = $${vals.length}`); }
      if (config      !== undefined) { vals.push(JSON.stringify(config)); sets.push(`config = $${vals.length}`); }
      if (!sets.length) throw new Error('Nothing to update');
      vals.push(id);
      const res = await pool.query(
        `UPDATE plot_configs SET ${sets.join(', ')} WHERE id = $${vals.length}::uuid RETURNING *`,
        vals,
      );
      return res.rows[0] ?? null;
    },
  },
  deletePlotConfig: {
    type: GraphQLBoolean,
    args: { id: { type: new GraphQLNonNull(GraphQLID) } },
    async resolve(_, { id }) {
      await pool.query('DELETE FROM plot_configs WHERE id = $1::uuid', [id]);
      return true;
    },
  },
};

const ProcConfigType = new GraphQLObjectType({
  name: 'ProcConfig',
  fields: () => ({
    id:          { type: GraphQLID },
    name:        { type: GraphQLString },
    description: { type: GraphQLString },
    config:      { type: GraphQLJSON },
    created_at:  { type: GraphQLString, resolve: r => r.created_at?.toISOString() ?? null },
  }),
});

const procQueries = {
  procConfigs: {
    type: new GraphQLList(ProcConfigType),
    async resolve() {
      const res = await pool.query('SELECT * FROM proc_configs ORDER BY created_at DESC');
      return res.rows;
    },
  },
};

const procMutations = {
  createProcConfig: {
    type: ProcConfigType,
    args: {
      name:        { type: new GraphQLNonNull(GraphQLString) },
      description: { type: GraphQLString },
      config:      { type: new GraphQLNonNull(GraphQLJSON) },
    },
    async resolve(_, { name, description, config }) {
      const res = await pool.query(
        'INSERT INTO proc_configs (name, description, config) VALUES ($1, $2, $3) RETURNING *',
        [name, description ?? null, JSON.stringify(config)],
      );
      return res.rows[0];
    },
  },
  updateProcConfig: {
    type: ProcConfigType,
    args: {
      id:          { type: new GraphQLNonNull(GraphQLID) },
      name:        { type: GraphQLString },
      description: { type: GraphQLString },
      config:      { type: GraphQLJSON },
    },
    async resolve(_, { id, name, description, config }) {
      const sets = [];
      const vals = [];
      if (name        !== undefined) { vals.push(name);                   sets.push(`name = $${vals.length}`); }
      if (description !== undefined) { vals.push(description);            sets.push(`description = $${vals.length}`); }
      if (config      !== undefined) { vals.push(JSON.stringify(config)); sets.push(`config = $${vals.length}`); }
      if (!sets.length) throw new Error('Nothing to update');
      vals.push(id);
      const res = await pool.query(
        `UPDATE proc_configs SET ${sets.join(', ')} WHERE id = $${vals.length}::uuid RETURNING *`,
        vals,
      );
      return res.rows[0] ?? null;
    },
  },
  deleteProcConfig: {
    type: GraphQLBoolean,
    args: { id: { type: new GraphQLNonNull(GraphQLID) } },
    async resolve(_, { id }) {
      await pool.query('DELETE FROM proc_configs WHERE id = $1::uuid', [id]);
      return true;
    },
  },
};

const queries   = { ...modelQueries,   ...scenarioQueries,   ...plotQueries,   ...procQueries };
const mutations = { ...modelMutations, ...scenarioMutations, ...plotMutations, ...procMutations };

module.exports = {
  queries, mutations,
  ModelConfigType, ScenarioConfigType, ModelRunType, PlotConfigType, ProcConfigType,
};
