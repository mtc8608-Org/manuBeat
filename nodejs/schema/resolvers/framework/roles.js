// Framework role resolvers — the roles catalogue (backoffice Roles page).
// A role aliases a name onto a permissions tier; the tier ladder itself
// ('registered' < 'user' < 'admin') is fixed in permissions.js/schema/index.js.
// Every operation here is admin-only via the permissions.js fallback.
// Tier changes reach a user's JWT on their next login.
const { GraphQLList, GraphQLString, GraphQLNonNull, GraphQLBoolean, GraphQLID } = require('graphql');
const { pool } = require('../../../db');
const { RoleType } = require('../../types');

const TIERS = ['registered', 'user', 'admin'];

const ROLE_COLS = `
  r.id, r.name, r.tier, r.description, r.is_system,
  to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
  (SELECT COUNT(*) FROM users u WHERE u.role = r.name)::text AS users
`.trim();

const queries = {
  roleList: {
    type: new GraphQLList(RoleType),
    async resolve() {
      console.log('-> Role list');
      const res = await pool.query(`SELECT ${ROLE_COLS} FROM roles r ORDER BY r.is_system DESC, r.name`);
      return res.rows;
    },
  },
};

const mutations = {
  createRole: {
    type: RoleType,
    args: {
      name:        { type: new GraphQLNonNull(GraphQLString) },
      tier:        { type: new GraphQLNonNull(GraphQLString) },
      description: { type: GraphQLString },
    },
    async resolve(_, { name, tier, description }) {
      console.log('-> Create role', name);
      if (!/^[a-z][a-z0-9_-]*$/.test(name)) throw new Error('Role name must be lowercase letters, digits, _ or -');
      if (!TIERS.includes(tier)) throw new Error(`Tier must be one of: ${TIERS.join(', ')}`);
      try {
        const res = await pool.query(
          `WITH ins AS (
             INSERT INTO roles (name, tier, description) VALUES ($1, $2, $3) RETURNING *
           ) SELECT ${ROLE_COLS} FROM ins r`,
          [name, tier, description ?? null]
        );
        return res.rows[0];
      } catch (e) {
        if (e.code === '23505') throw new Error('A role with that name already exists');
        throw e;
      }
    },
  },

  // Name is immutable (it is stored on users rows and inside issued JWTs);
  // tier is immutable on system roles (the code relies on their semantics).
  updateRole: {
    type: RoleType,
    args: {
      id:          { type: new GraphQLNonNull(GraphQLID) },
      tier:        { type: GraphQLString },
      description: { type: GraphQLString },
    },
    async resolve(_, { id, tier, description }) {
      console.log('-> Update role', id);
      const cur = await pool.query('SELECT * FROM roles WHERE id = $1::uuid', [id]);
      const role = cur.rows[0];
      if (!role) throw new Error('Role not found');
      if (tier !== undefined && tier !== null && tier !== role.tier) {
        if (!TIERS.includes(tier)) throw new Error(`Tier must be one of: ${TIERS.join(', ')}`);
        if (role.is_system) throw new Error('System role tiers cannot be changed');
      }
      const res = await pool.query(
        `WITH upd AS (
           UPDATE roles SET tier = COALESCE($2, tier), description = COALESCE($3, description)
           WHERE id = $1::uuid RETURNING *
         ) SELECT ${ROLE_COLS} FROM upd r`,
        [id, tier ?? null, description ?? null]
      );
      return res.rows[0];
    },
  },

  deleteRole: {
    type: GraphQLBoolean,
    args: { id: { type: new GraphQLNonNull(GraphQLID) } },
    async resolve(_, { id }) {
      console.log('-> Delete role', id);
      const cur = await pool.query('SELECT * FROM roles WHERE id = $1::uuid', [id]);
      const role = cur.rows[0];
      if (!role) throw new Error('Role not found');
      if (role.is_system) throw new Error('System roles cannot be deleted');
      const inUse = await pool.query('SELECT COUNT(*) FROM users WHERE role = $1', [role.name]);
      const count = parseInt(inUse.rows[0].count, 10);
      if (count > 0) throw new Error(`Cannot delete: ${count} user(s) still have this role`);
      await pool.query('DELETE FROM roles WHERE id = $1::uuid', [id]);
      return true;
    },
  },
};

module.exports = { queries, mutations };
