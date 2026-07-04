// ── Role-based access configuration ──────────────────────────────────────────
// Controls which GraphQL operations are accessible without admin privileges.
// Applied identically to queries AND mutations (schema/index.js):
//   public     — no token required (read-only, see the invariant below)
//   registered — any valid JWT required (any role)
//   user       — tier must be 'user' or 'admin'
//   admin      — tier must be 'admin'; EVERYTHING not listed above defaults here
//
// The public tier exists ONLY so the seeded Landing/CMS content renders for
// anonymous visitors. The invariant is: `componentByName` stays its only
// entry — never add another operation, and never a mutation. Beyond it,
// anonymous visitors get only the REST /login and /register endpoints (and
// the tokenless file-download streams, which exist because <img> tags cannot
// carry the auth header).
//
// Checks compare the caller's *tier*, not the role name: roles live in the
// `roles` table and each aliases onto one of these three tiers (backoffice
// Roles page). The tier is resolved at login and carried in the JWT.
//
// A query left out of all lists is admin-only, same as a mutation — so a new
// operation is locked down by default. Opening one to lower tiers is a
// deliberate act of adding its name here. In-resolver owner-scoping is still
// required for anything in the `registered`/`user` tiers (a user must not see
// others' rows).
//
// The `admin` list below is informational only (the fallback enforces it);
// keep query names that are conceptually admin here so intent is documented.

module.exports = {
  // GraphQL query field names accessible without any token — see the invariant
  // above: `componentByName` only, forever.
  public: [
    // seeded form/content trees fetched by name (Landing content for
    // anonymous visitors, FormRenderer on every page)
    'componentByName',
  ],

  // GraphQL query/mutation field names accessible with any valid token
  registered: [
    'me',
    // account self-service — resolvers scope by the caller's JWT, no owner argument
    'userProfile',
    'upsertUserProfile',
    'userSecrets',
    'setUserSecret',
    'clearUserSecret',
    // surveys — viewing and answering is open to every signed-in account;
    // answer reads/edits are owner-scoped in the resolver (admin sees all)
    'surveyList',
    'surveyComponent',
    'surveyComponentList',
    'surveyComponentParents',
    'surveyAnswers',
    'submitAnswer',
    'updateAnswer',
  ],

  // GraphQL query/mutation field names requiring role 'user' (or 'admin').
  // Empty in the framework — forks add their owner-scoped domain ops here.
  user: [],

  // Everything else requires role === 'admin'.
  // (Informational — enforcement uses the fallback rule above. Only list real mutations.)
  admin: [
    'surveyStats',
    'roleList', 'createRole', 'updateRole', 'deleteRole',
    'createComponent', 'updateComponent', 'deleteComponent',
    'createComponentRelation', 'deleteComponentRelation', 'swapComponentPositions',
    'createSurveyComponent', 'updateSurveyComponent', 'deleteSurveyComponent',
    'createSurveyComponentRelation', 'deleteSurveyComponentRelation', 'swapSurveyComponentPositions',
    'createSurvey', 'deleteAnswer',
  ],
};
