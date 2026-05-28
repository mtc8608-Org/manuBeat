const {
  GraphQLList,
  GraphQLString,
  GraphQLID,
  GraphQLBoolean,
} = require('graphql');
const { pool } = require('../../../db');
const {
  ComponentType,
  ComponentRelationType,
  ComponentInputType,
  PlotType,
  GraphQLJSON,
} = require('../../types');
const {
  postComponent,
  updateComponent,
  deleteComponent,
  deleteComponentRelation,
  relateComponents,
} = require('../../helpers/components');

const queries = {
  component: {
    type: new GraphQLList(ComponentType),
    args: { id: { type: GraphQLString } },
    async resolve(_, { id }) {
      console.log('-> Get component by id:', id);
      try {
        const res = await pool.query('SELECT * FROM components WHERE id = $1::uuid', [id]);
        if (res.rows.length) return res.rows;
        throw new Error('Component not found');
      } catch (error) {
        console.error(error);
        throw new Error('Error fetching component');
      }
    },
  },
  componentByName: {
    type: ComponentType,
    args: { name: { type: GraphQLString } },
    async resolve(_, { name }) {
      const res = await pool.query('SELECT * FROM components WHERE name = $1', [name]);
      return res.rows[0] || null;
    },
  },
  componentList: {
    type: new GraphQLList(ComponentType),
    args: { type: { type: GraphQLString } },
    async resolve(_, { type }) {
      console.log('-> Get component List by type:', type);
      try {
        const res = await pool.query('SELECT * FROM components WHERE type = $1::text', [type]);
        return res.rows;
      } catch (error) {
        console.error(error);
        throw new Error('Error fetching component');
      }
    },
  },
  componentParents: {
    type: new GraphQLList(ComponentType),
    args: { child_id: { type: GraphQLID } },
    async resolve(_, { child_id }) {
      console.log('-> Get component parents for child:', child_id);
      const res = await pool.query(
        `SELECT c.* FROM components_relationships cr
         JOIN components c ON cr.parent_id = c.id
         WHERE cr.child_id = $1::uuid`,
        [child_id]
      );
      return res.rows;
    },
  },
  componentRelationList: {
    type: new GraphQLList(ComponentRelationType),
    async resolve() {
      console.log('-> Get component Relations List');
      try {
        const res = await pool.query('SELECT * FROM components_relationships');
        if (res.rows.length) {
          for (let row of res.rows) {
            const parentRes = await pool.query('SELECT name FROM components WHERE id = $1::uuid', [row.parent_id]);
            row.parent_name = parentRes.rows[0].name;
            const childRes = await pool.query('SELECT name FROM components WHERE id = $1::uuid', [row.child_id]);
            row.child_name = childRes.rows[0].name;
          }
          return res.rows;
        }
        throw new Error('Component not found');
      } catch (error) {
        console.error(error);
        throw new Error('Error fetching component');
      }
    },
  },
  plotList: {
    type: new GraphQLList(PlotType),
    async resolve() {
      console.log('-> Get plot list');
      try {
        const res = await pool.query('SELECT * FROM plots ORDER BY updated_at DESC');
        return res.rows;
      } catch (error) {
        console.error(error);
        throw new Error('Error fetching plots');
      }
    },
  },
};

const mutations = {
  createComponent: {
    type: ComponentType,
    args: {
      name:     { type: GraphQLString },
      type:     { type: GraphQLString },
      data:     { type: GraphQLJSON },
      options:  { type: GraphQLJSON },
      children: { type: new GraphQLList(ComponentInputType) },
    },
    resolve(_, args) {
      console.log('############Create component:', args.name);
      return postComponent(args.name, args.type, args.data, args.options, args.children);
    },
  },
  updateComponent: {
    type: ComponentType,
    args: {
      id:      { type: GraphQLID },
      name:    { type: GraphQLString },
      type:    { type: GraphQLString },
      data:    { type: GraphQLJSON },
      options: { type: GraphQLJSON },
    },
    resolve(_, args) {
      return updateComponent(args.id, args.name, args.type, args.data, args.options);
    },
  },
  deleteComponent: {
    type: GraphQLBoolean,
    args: { id: { type: GraphQLID } },
    resolve(_, args) {
      return deleteComponent(args.id);
    },
  },
  deleteComponentRelation: {
    type: GraphQLBoolean,
    args: {
      parent_id: { type: GraphQLID },
      child_id:  { type: GraphQLID },
    },
    resolve(_, args) {
      return deleteComponentRelation(args.parent_id, args.child_id);
    },
  },
  createComponentRelation: {
    type: GraphQLBoolean,
    args: {
      parent_id: { type: GraphQLID },
      child_id:  { type: GraphQLID },
    },
    resolve(_, args) {
      console.log('-> Tying to Relate components:', args.parent_id, ' and ', args.child_id);
      return relateComponents(args.parent_id, args.child_id);
    },
  },
  swapComponentPositions: {
    type: GraphQLBoolean,
    args: {
      parent_id:  { type: GraphQLID },
      child_id_a: { type: GraphQLID },
      child_id_b: { type: GraphQLID },
    },
    async resolve(_, { parent_id, child_id_a, child_id_b }) {
      const res = await pool.query(
        'SELECT child_id, position FROM components_relationships WHERE parent_id=$1::uuid AND child_id IN ($2::uuid, $3::uuid)',
        [parent_id, child_id_a, child_id_b]
      );
      if (res.rows.length !== 2) return false;
      const byId = Object.fromEntries(res.rows.map(r => [r.child_id, r.position]));
      await pool.query(
        'UPDATE components_relationships SET position=$1 WHERE parent_id=$2::uuid AND child_id=$3::uuid',
        [byId[child_id_b], parent_id, child_id_a]
      );
      await pool.query(
        'UPDATE components_relationships SET position=$1 WHERE parent_id=$2::uuid AND child_id=$3::uuid',
        [byId[child_id_a], parent_id, child_id_b]
      );
      return true;
    },
  },
  createPlot: {
    type: PlotType,
    args: {
      name:   { type: GraphQLString },
      config: { type: GraphQLJSON },
    },
    async resolve(_, args) {
      console.log('-> Create plot:', args.name);
      try {
        const res = await pool.query(
          'INSERT INTO plots (name, config) VALUES ($1, $2::jsonb) RETURNING *',
          [args.name, JSON.stringify(args.config ?? {})]
        );
        return res.rows[0];
      } catch (error) {
        console.error(error);
        throw new Error('Error creating plot');
      }
    },
  },
  updatePlot: {
    type: PlotType,
    args: {
      id:     { type: GraphQLID },
      name:   { type: GraphQLString },
      config: { type: GraphQLJSON },
    },
    async resolve(_, args) {
      console.log('-> Update plot:', args.id);
      try {
        const res = await pool.query(
          'UPDATE plots SET name=$1, config=$2::jsonb, updated_at=NOW() WHERE id=$3::uuid RETURNING *',
          [args.name, JSON.stringify(args.config), args.id]
        );
        return res.rows[0];
      } catch (error) {
        console.error(error);
        throw new Error('Error updating plot');
      }
    },
  },
  deletePlot: {
    type: GraphQLBoolean,
    args: { id: { type: GraphQLID } },
    async resolve(_, { id }) {
      console.log('-> Delete plot:', id);
      try {
        await pool.query('DELETE FROM plots WHERE id = $1::uuid', [id]);
        return true;
      } catch (error) {
        console.error(error);
        throw new Error('Error deleting plot');
      }
    },
  },
};

module.exports = { queries, mutations };
