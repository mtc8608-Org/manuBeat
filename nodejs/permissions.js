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

    // [MEDICAL] Physiology Simulator — READS only. The Simulator, Model/Plot/
    // Processing Sandbox and HDF Inspector pages sit behind PrivateRoute, so any
    // signed-in account reaches them, and this tier mirrors that.
    //
    // The writes are deliberately NOT here: model_configs / scenario_configs /
    // model_runs / plot_configs / proc_configs carry no owner column, and an
    // unowned row is a shared row — shared rows are admin-writable only
    // (ownership.js, db-schema.md). Leaving the mutations at this rung would let
    // any signed-in account delete another's configs and runs. Move them back down
    // only together with owner_id columns and ownerScope/assertOwner in the resolver.
    'modelConfigs', 'modelConfig', 'modelRuns',
    'scenarioConfigs', 'scenarioConfig',
    'plotConfigs', 'procConfigs',
  ],

  // GraphQL query/mutation field names requiring tier 'user' (or 'admin').
  // Forks add their owner-scoped domain ops here.
  user: [
    // surveys — viewing and answering needs the 'user' rung; a 'registered'
    // account can sign in and manage its own account, but not take surveys.
    // Answer reads/edits are owner-scoped in the resolver (admin sees all).
    // This is the framework's worked example of the middle rung: the nav area
    // (NAV_AREAS) and the route guard (TierRoute) declare 'user' to match.
    'surveyList',
    'surveyComponent',
    'surveyComponentList',
    'surveyComponentParents',
    'surveyAnswers',
    'submitAnswer',
    'updateAnswer',
  ],

  // Everything else requires role === 'admin'.
  // (Informational — enforcement uses the fallback rule above. List admin ops,
  // mutations and queries alike, whose admin-only status is a deliberate
  // decision worth documenting.)
  admin: [
    'roleList', 'createRole', 'updateRole', 'deleteRole',
    // component reads: only the backoffice Configuration and Content pages use
    // these, both behind AdminRoute (componentByName is the public exception).
    'component', 'componentList', 'componentParents', 'componentRelationList',
    'createComponent', 'updateComponent', 'deleteComponent',
    'createComponentRelation', 'deleteComponentRelation', 'swapComponentPositions',
    'createSurveyComponent', 'updateSurveyComponent', 'deleteSurveyComponent',
    'createSurveyComponentRelation', 'deleteSurveyComponentRelation', 'swapSurveyComponentPositions',
    'createSurvey', 'deleteAnswer',
    // [MEDICAL] writes to the shared, unowned model/scenario/plot/proc tables —
    // see the note on the medical reads in the registered tier above.
    'createModelConfig', 'updateModelConfig', 'deleteModelConfig',
    'createScenarioConfig', 'updateScenarioConfig', 'deleteScenarioConfig',
    'createModelRun', 'updateModelRun', 'deleteModelRun',
    'createPlotConfig', 'updatePlotConfig', 'deletePlotConfig',
    'createProcConfig', 'updateProcConfig', 'deleteProcConfig',
    // [SURVEYS] cross-respondent aggregate over every answer of a survey — admin only.
    'surveyStats',
    // [BEDSIDE] Data Collection — patient data is PHI, so the whole domain is
    // admin-only, queries included. The resolvers also assert admin themselves.
    'bedsideNodes', 'beds', 'patients', 'bedAssignments',
    'bedsideStreams', 'latestSegments', 'nodeHeartbeats',
    'createBed', 'updateBedsideNode', 'assignPatientToBed', 'endBedAssignment',
    'createBedsideNode', 'rotateNodeToken', 'deleteBedsideNode',
  ],
};
