// Owner-scoping primitives shared by every resolver that guards per-user rows.
//
// The framework default is admin-only (permissions.js), which protects against
// cross-ROLE access. Anything opened to the `registered`/`user` tiers must also
// guard against cross-USER access, and that happens here — see the
// owner-scoping invariant in .claude/rules/backend-api.md.
//
// Table and column names are SQL *identifiers*, so they cannot be parameterised.
// Every caller passes a string literal from its own module; never pass a value
// that originated in a GraphQL argument or request body.
const { pool } = require('../../db');

const userId  = (ctx) => ctx?.user?.id ?? null;
const isAdmin = (ctx) => ctx?.user?.tier === 'admin';

// One message for "missing" and "someone else's" alike. Distinguishing them
// turns the endpoint into an existence oracle: an attacker walking ids learns
// which ones are real from the 404-vs-403 split.
const notAuthorised = (label) => new Error(`${label} not found or not authorised`);

// Assert the caller may WRITE the row: owner or admin. A NULL owner is a shared
// seed row (see the shared NULL-owned seed pattern in .claude/rules/db-schema.md)
// and is admin-writable only.
const assertOwner = async (table, id, ctx, { column = 'owner_id', label = 'Record' } = {}) => {
  const res = await pool.query(`SELECT ${column} AS owner FROM ${table} WHERE id = $1::uuid`, [id]);
  const row = res.rows[0];
  if (!row) throw notAuthorised(label);
  if (isAdmin(ctx)) return true;
  if (row.owner && row.owner === userId(ctx)) return true;
  throw notAuthorised(label);
};

// Assert the caller may READ the row: owner, admin, or a shared NULL-owned row.
// Use this on the CHILD of any link mutation — tree assembly walks
// relationships without an owner filter, so linking a row you cannot read
// exfiltrates its content through the parent.
const assertReadable = async (table, id, ctx, { column = 'owner_id', label = 'Record' } = {}) => {
  const res = await pool.query(`SELECT ${column} AS owner FROM ${table} WHERE id = $1::uuid`, [id]);
  const row = res.rows[0];
  if (!row) throw notAuthorised(label);
  if (isAdmin(ctx) || !row.owner || row.owner === userId(ctx)) return true;
  throw notAuthorised(label);
};

// Append-ready owner filter for a SELECT/UPDATE/DELETE built with a params
// array: '' for admin (sees all), otherwise ' AND <column> = $n::uuid' with the
// caller's id pushed onto params. `column` may be alias-qualified ('sa.owner_id').
const ownerScope = (ctx, params, column = 'owner_id') => {
  if (isAdmin(ctx)) return '';
  params.push(userId(ctx));
  return ` AND ${column} = $${params.length}::uuid`;
};

module.exports = { userId, isAdmin, assertOwner, assertReadable, ownerScope, notAuthorised };
