// Framework user resolvers — the caller's own account surface.
// Every operation here is self-scoping: no owner argument exists, the subject
// is always resolved from the JWT (ctx.user), so an ownership violation is
// unexpressible. Admin user management is REST (routes/framework/auth.js).
const { GraphQLList, GraphQLString, GraphQLBoolean, GraphQLNonNull } = require('graphql');
const { pool } = require('../../../db');
const { UserType, UserProfileType, UserSecretType, GraphQLJSON } = require('../../types');
const { setUserSecret, clearUserSecret, listUserSecrets } = require('../../../lib/secrets');

const userId = (ctx) => ctx?.user?.id ?? null;

const queries = {
  me: {
    type: UserType,
    async resolve(_, __, context) {
      if (!context.user) throw new Error('Not authenticated');
      const res = await pool.query('SELECT * FROM users WHERE id = $1::uuid', [context.user.id]);
      return res.rows[0] ?? null;
    },
  },
  userProfile: {
    type: UserProfileType,
    async resolve(_, __, ctx) {
      const uid = userId(ctx);
      if (!uid) return null;
      const res = await pool.query('SELECT owner_id, data FROM user_profile WHERE owner_id = $1::uuid', [uid]);
      return res.rows[0] || { owner_id: uid, data: {} };
    },
  },
  // Registry ⋈ per-user status — metadata only, the raw value never leaves the server.
  userSecrets: {
    type: new GraphQLList(UserSecretType),
    async resolve(_, __, ctx) {
      const uid = userId(ctx);
      if (!uid) throw new Error('Authentication required');
      return listUserSecrets(uid);
    },
  },
};

const mutations = {
  // The caller's own profile; upserted by owner_id (one row per user).
  upsertUserProfile: {
    type: UserProfileType,
    args: { data: { type: GraphQLJSON } },
    async resolve(_, { data }, ctx) {
      const uid = userId(ctx);
      if (!uid) throw new Error('Authentication required');
      const res = await pool.query(
        `INSERT INTO user_profile (owner_id, data) VALUES ($1::uuid, $2::jsonb)
         ON CONFLICT (owner_id) DO UPDATE SET data = EXCLUDED.data
         RETURNING owner_id, data`,
        [uid, data ?? {}]
      );
      return res.rows[0];
    },
  },
  setUserSecret: {
    type: UserSecretType,
    args: {
      name:  { type: new GraphQLNonNull(GraphQLString) },
      value: { type: new GraphQLNonNull(GraphQLString) },
    },
    async resolve(_, { name, value }, ctx) {
      console.log('-> Set user secret', name);
      const uid = userId(ctx);
      if (!uid) throw new Error('Authentication required');
      await setUserSecret(uid, name, value);
      const list = await listUserSecrets(uid);
      return list.find(s => s.name === name);
    },
  },
  clearUserSecret: {
    type: GraphQLBoolean,
    args: { name: { type: new GraphQLNonNull(GraphQLString) } },
    async resolve(_, { name }, ctx) {
      console.log('-> Clear user secret', name);
      const uid = userId(ctx);
      if (!uid) throw new Error('Authentication required');
      await clearUserSecret(uid, name);
      return true;
    },
  },
};

module.exports = { queries, mutations };
