// ── Role-based access configuration ──────────────────────────────────────────
// Controls which GraphQL operations are accessible without admin privileges.
//
// Rules (evaluated in order):
//   public — no token required
//   user   — any valid JWT required (any role)
//   admin  — role must be 'admin' (everything not listed above defaults here)
//
// To open an operation, add its name to the appropriate list.
// Mutation names are included here even though all mutations currently require
// admin — keeping them explicit makes future role changes easier.

module.exports = {
  // GraphQL query field names accessible without any token
  public: [
    'componentByName',
    'surveyList',
    'surveyComponent',
    'surveyComponentList',
    'surveyComponentParents',
    'surveyAnswers',
  ],

  // GraphQL query/mutation field names accessible with any valid token
  user: [
    'me',
    'submitAnswer',
    'updateAnswer',
  ],

  // Everything else requires role === 'admin'.
  // (Informational — enforcement uses the fallback rule above. Only list real mutations.)
  admin: [
    'surveyStats',
    'createComponent', 'updateComponent', 'deleteComponent',
    'createComponentRelation', 'deleteComponentRelation',
    'createSurveyComponent', 'updateSurveyComponent', 'deleteSurveyComponent',
    'createSurveyComponentRelation', 'deleteSurveyComponentRelation',
    'createSurvey', 'updateSurvey', 'deleteSurvey', 'deleteAnswer',
    // [BEDSIDE] Data Collection
    'createBed', 'updateBedsideNode', 'assignPatientToBed', 'endBedAssignment',
    'createBedsideNode', 'rotateNodeToken', 'deleteBedsideNode',
  ],
};
