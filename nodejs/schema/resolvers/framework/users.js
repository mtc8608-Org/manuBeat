const { pool } = require('../../../db');
const { UserType } = require('../../types');

const queries = {
  me: {
    type: UserType,
    async resolve(_, __, context) {
      if (!context.user) throw new Error('Not authenticated');
      const res = await pool.query('SELECT * FROM users WHERE id = $1::uuid', [context.user.id]);
      return res.rows[0] ?? null;
    },
  },
};

module.exports = { queries };
