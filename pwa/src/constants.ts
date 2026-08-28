// ════════════════════════════════════════════════════════════════════════════
//  constants.ts — all shared literals for the PWA frontend
//
//  Rule: if a string or number appears in more than one file, or if changing
//  it would require a DB migration / backend change, it lives here.
//
//  Things intentionally NOT here:
//    - Inline styles / spacing values  (belong in the component)
//    - Grid column sizes               (layout choice, not a shared constant)
//    - One-off strings used once       (no benefit to hoisting)
// ════════════════════════════════════════════════════════════════════════════

///////////////////////////////////////////////////////////////////////////////
// #region Content Component Types
// Types for the Content page system. These live in the `components` table
// alongside app types but are rendered by ContentRenderer, not FormRenderer.
// All content containers (including the root "Content Menu") use contentPage.
export const CONTENT_TYPE = {
  PAGE:       'contentPage',      // container — can hold child pages or cards
  HTML:       'contentHtml',      // leaf — dangerouslySetInnerHTML
  IMAGE:      'contentImage',     // leaf — <img>
  HTML_IMAGE: 'contentHtmlImage', // leaf — two-column: HTML left, image right
  LATEX:      'contentLatex',     // leaf — HTML with KaTeX math rendering
} as const;

// Names of the editor forms for each content card type.
// These forms are fetched at runtime and passed to FormRenderer in the add/edit modals.
// Source of truth: init-scripts/01-init-db.sql (e110 / e120 / e130 ranges).
export const CONTENT_EDITOR_ID = {
  HTML:       'form_content_html',
  IMAGE:      'form_content_image',
  HTML_IMAGE: 'form_content_html_image',
  LATEX:      'form_content_html',   // reuses the HTML body field (data.html)
} as const;

// Name of the root contentPage that groups all public pages (shown in Landing nav)
export const CONTENT_MENU_ID = 'content_menu';
// #endregion
///////////////////////////////////////////////////////////////////////////////


///////////////////////////////////////////////////////////////////////////////
// #region App Component Types
// Strings stored in the `type` column of the `components` table.
// Used by FormRenderer (mode="app"), Configuration, ListModal, and the
// ComponentForm editor-ID map. Must stay in sync with backend.js resolvers.
export const TYPE = {
  // form containers / sections
  FORM:      'form',
  PLOT_GRID: 'plotGrid',
  PLOT:      'plot',
  // leaf inputs
  INPUT:     'input',
  CHECK:     'check',
  SELECT:    'select',
  OPTION:    'option',
  COLOR:     'color',
} as const;

// All selectable types when creating a new app component
export const APP_COMPONENT_TYPES = [
  TYPE.FORM, TYPE.INPUT, TYPE.CHECK, TYPE.SELECT, TYPE.PLOT, TYPE.PLOT_GRID,
] as const;
// #endregion
///////////////////////////////////////////////////////////////////////////////


///////////////////////////////////////////////////////////////////////////////
// #region Survey Component Types
// Strings stored in the `type` column of the `survey_components` table.
// Used by FormRenderer (mode="survey"), Surveys page, and backend.js resolvers.
export const SURVEY_TYPE = {
  SURVEY:   'survey',    // section container (nests child questions)
  TEXT:     'text',
  NUMBER:   'number',
  DATE:     'date',
  TEXTAREA: 'textarea',
  CHECK:    'check',
  SELECT:   'select',
  OPTION:   'option',    // child of select, not a standalone field
  SCALE:    'scale',
} as const;

// Types that produce a UUID-keyed answer entry in survey mode.
// Excludes 'survey' (section) and 'option' (select child — parent select holds the key).
export const SURVEY_QUESTION_TYPES = new Set<string>([
  SURVEY_TYPE.TEXT, SURVEY_TYPE.NUMBER, SURVEY_TYPE.DATE,
  SURVEY_TYPE.TEXTAREA, SURVEY_TYPE.CHECK, SURVEY_TYPE.SELECT, SURVEY_TYPE.SCALE,
]);

// #endregion
///////////////////////////////////////////////////////////////////////////////


///////////////////////////////////////////////////////////////////////////////
// #region Editor Form UUIDs
// Names of component trees in the `components` table that serve as the
// edit/create forms inside ShowComponentModal (ComponentForm.tsx).
// Source of truth: init-scripts/01-init-db.sql — update here if seeds change.
export const EDITOR_ID = {
  DEFAULT: 'form_component_builder', // form / input / check / select / plotGrid
  PLOT:    'form_component_plot',    // plot component editor
} as const;
// #endregion
///////////////////////////////////////////////////////////////////////////////


///////////////////////////////////////////////////////////////////////////////
// #region Feature Form UUIDs
// Names of specific component trees that drive page features.
// Source of truth: init-scripts/01-init-db.sql — update here if seeds change.
export const FORM_ID = {
  // Files page
  FILE_DETAIL:  'form_file_detail',
  // Surveys page
  NEW_SURVEY:   'form_new_survey',
  // Content page
  NEW_PAGE:     'form_new_page',
  // [MEDICAL] — Model Sandbox
  ADD_MODEL_CONFIG: 'form_add_model_config',
  // [MEDICAL] — Scenario Sandbox
  ADD_SCENARIO_CONFIG: 'form_add_scenario_config',
} as const;
// #endregion
///////////////////////////////////////////////////////////////////////////////


///////////////////////////////////////////////////////////////////////////////
// #region [BEDSIDE] Data Collection IDs
// Patients are a first-class table (detached from surveys). The demographic form is
// an app-domain component tree (seeded in 03-init-bedside.sql); each input's
// options.label = the patients column it writes to.
export const PATIENT_FORM_COMPONENT_ID = 'c51c1e5f-5cc1-4b77-8832-2d10cc97b200'; // components root (demographic form)
// #endregion
///////////////////////////////////////////////////////////////////////////////


///////////////////////////////////////////////////////////////////////////////
// #region Survey Question Editor Form UUIDs
// Maps each SURVEY_TYPE to its editor form name (seeded in init-scripts/01-init-db.sql,
// dd00–dd08 range). Used by Surveys.tsx to load the right form per question type.
export const SURVEY_EDITOR_ID: Record<string, string> = {
  [SURVEY_TYPE.TEXT]:     'form_survey_q_text',
  [SURVEY_TYPE.NUMBER]:   'form_survey_q_text',
  [SURVEY_TYPE.TEXTAREA]: 'form_survey_q_text',
  [SURVEY_TYPE.SCALE]:    'form_survey_q_scale',
  [SURVEY_TYPE.CHECK]:    'form_survey_q_default',
  [SURVEY_TYPE.SELECT]:   'form_survey_q_default',
  [SURVEY_TYPE.OPTION]:   'form_survey_q_default',
  [SURVEY_TYPE.DATE]:     'form_survey_q_default',
  [SURVEY_TYPE.SURVEY]:   'form_survey_q_default',
} as const;
// #endregion
///////////////////////////////////////////////////////////////////////////////


///////////////////////////////////////////////////////////////////////////////
// #region User & Role Management Forms
// The user_profile shape this app seeds (01-init-db.sql d050). Rendered on the
// user Profile page; saved via upsertUserProfile. Apps replace the seeded
// fields with their own profile form but keep the form name.
export const USER_PROFILE_FORM = 'form_user_profile';

// Framework user-management forms (backoffice Users page). Source: 01-init-db.sql d000/d010.
export const USER_FORM = {
  EDITOR: 'form_user_editor',   // role select + active check (Detail column)
  CREATE: 'form_user_create',   // email / password / role (New modal)
} as const;

// Framework role-management forms (backoffice Roles page). Source: 01-init-db.sql d030/d040.
export const ROLE_FORM = {
  EDITOR: 'form_role_editor',   // tier select + description (Detail column)
  CREATE: 'form_role_create',   // name / tier / description (New modal)
} as const;

// The fixed permissions ladder (nodejs/permissions.js). Roles alias onto one
// of these tiers; the set is code, never edited at runtime.
export const ROLE_TIERS = ['registered', 'user', 'admin'] as const;
export type RoleTier = typeof ROLE_TIERS[number];

// Rung index on the ladder above; -1 for anything unrecognised. Comparisons are
// `>=` against a required rung, so an unknown tier ranks below every rung and
// fails closed (nothing shown) rather than open.
export const tierRank = (tier: string | null | undefined): number =>
  ROLE_TIERS.indexOf(tier as RoleTier);
// #endregion
///////////////////////////////////////////////////////////////////////////////


///////////////////////////////////////////////////////////////////////////////
// #region Form Usage Registry
// Component-tree name → the app UI it powers. Trees are bound to pages only
// by fetch-by-name calls in code (the constant groups above), so this registry
// is the single place that records the binding for display — the Configuration
// page shows it so admins can tell what each tree drives before touching it.
// Keep in sync when adding a form constant; forks append entries // [MY DOMAIN]
export const FORM_USAGE: Record<string, string> = {
  [EDITOR_ID.DEFAULT]:            'Configuration — component editor modal',
  [EDITOR_ID.PLOT]:               'Configuration — plot editor modal',
  [CONTENT_EDITOR_ID.HTML]:       'Content — HTML / LaTeX card editor',
  [CONTENT_EDITOR_ID.IMAGE]:      'Content — image card editor',
  [CONTENT_EDITOR_ID.HTML_IMAGE]: 'Content — HTML+image card editor',
  [FORM_ID.FILE_DETAIL]:          'Files — detail form',
  [FORM_ID.NEW_SURVEY]:           'Surveys — new survey modal',
  [FORM_ID.NEW_PAGE]:             'Content — new page modal',
  form_survey_q_text:             'Surveys — question editor (text / number / textarea)',
  form_survey_q_scale:            'Surveys — question editor (scale)',
  form_survey_q_default:          'Surveys — question editor (select / check / date / section)',
  [USER_PROFILE_FORM]:            'Profile — user profile form',
  [USER_FORM.EDITOR]:             'Users — detail editor',
  [USER_FORM.CREATE]:             'Users — new user modal',
  [ROLE_FORM.EDITOR]:             'Roles — detail editor',
  [ROLE_FORM.CREATE]:             'Roles — new role modal',
  // [MEDICAL]
  [FORM_ID.ADD_MODEL_CONFIG]:     'Model Sandbox — new model config modal',
  [FORM_ID.ADD_SCENARIO_CONFIG]:  'Scenario Sandbox — new scenario config modal',
  // [BEDSIDE] fetched by UUID (PATIENT_FORM_COMPONENT_ID), registered by name
  form_patient_demographics:      'Patients — demographics form',
};
// #endregion
///////////////////////////////////////////////////////////////////////////////


///////////////////////////////////////////////////////////////////////////////
// #region API Configuration
// Backend URLs are origin-relative: the app always talks to the origin that
// served it. In dev the vite proxy (vite.config.ts) forwards /api and
// /graphql to the nodejs container; in prod Caddy does the same. One build
// artifact works on any host — never reintroduce an absolute host here.
export const API_BASE    = '/api';
export const GQL_URL     = '/graphql';
// [BEDSIDE] Live telemetry hub. The one absolute host left in this file: the
// vite proxy above forwards only /api and /graphql, so the browser dials the
// nodejs container directly. Deployment-blocking — behind Caddy this must
// become origin-relative (wss:// + window.location.host) and /ws/bedside must
// be proxied. Fix before the bedside Monitor ships.
export const WS_BASE     = 'ws://localhost:3000';

// REST endpoint paths (relative to API_BASE)
export const ENDPOINT = {
  LOGIN:            '/login',
  CHANGE_PASSWORD:  '/change-password',
  USERS:            '/users',
  FILES:            '/files',
  FILES_UPLOAD:     '/files/upload',
  GENERATE_CONTENT: '/generate-content',
  // [SURVEYS]
  SURVEY_EXPORT:    '/surveys',   // + `/${id}/stats/export`
  // [BEDSIDE]
  BEDSIDE_PATIENTS: '/bedside/patients',
} as const;
// #endregion
///////////////////////////////////////////////////////////////////////////////


///////////////////////////////////////////////////////////////////////////////
// #region Panel Configurations
// Static display config for each ResourcePanel in the app.
import type { PanelConfig } from './interfaces/types';

export const PANEL_CONFIG = {
  SURVEYS_LIST: {
    title: 'Surveys', emptyMessage: 'No surveys yet.',
    add: { enabled: true, label: 'New Survey' },
    filter: { text: { enabled: false }, type: { enabled: false } },
  },
  QUESTIONS_LIBRARY: {
    title: 'Questions', emptyMessage: 'No questions match.',
    add: { enabled: false, label: '' },
    filter: {
      text: { enabled: true,  placeholder: 'Search…' },
      type: { enabled: true,  options: ['text', 'number', 'textarea', 'check', 'scale', 'select'] },
    },
  },
  CONFIG_COMPONENTS: {
    title: 'Components', emptyMessage: 'No components yet.',
    add: { enabled: true, label: 'New Component' },
    filter: { text: { enabled: false }, type: { enabled: true, allLabel: 'Forms', options: ['input', 'select', 'check', 'plot', 'plotGrid'] } },
  },
  FILES_LIST: {
    title: 'Files', emptyMessage: 'No files found.',
    add: { enabled: true, label: 'Upload' },
    filter: { text: { enabled: true, placeholder: 'Search files…' }, type: { enabled: true } },
  },
  CONTENT_PAGES: {
    title: 'Pages', emptyMessage: 'No pages yet.',
    add: { enabled: true, label: 'New Page' },
    filter: { text: { enabled: false }, type: { enabled: false } },
  },
  CONTENT_CARDS: {
    title: 'Cards', emptyMessage: 'No cards yet.',
    add: { enabled: false, label: '' },
    filter: {
      text: { enabled: true, placeholder: 'Search…' },
      type: { enabled: true, options: ['contentHtml', 'contentImage', 'contentHtmlImage', 'contentLatex'] },
    },
  },
  USERS: {
    title: 'Users', emptyMessage: 'No users found.',
    add: { enabled: true, label: 'New user' },
    filter: {
      text: { enabled: true, placeholder: 'Search by email…' },
      type: { enabled: true, options: ['user', 'admin', 'registered'] },
    },
  },
  ROLES: {
    title: 'Roles', emptyMessage: 'No roles found.',
    add: { enabled: true, label: 'New role' },
    filter: { text: { enabled: false }, type: { enabled: false } },
  },
  // [MEDICAL]
  MODEL_CONFIGS: {
    title: 'Configurations', emptyMessage: 'No configs yet.',
    add: { enabled: true, label: 'New Config' },
    filter: { text: { enabled: false }, type: { enabled: false } },
  },
  MODEL_RUNS: {
    title: 'Runs', emptyMessage: 'No runs yet.',
    add: { enabled: true, label: 'New Run' },
    filter: { text: { enabled: false }, type: { enabled: false } },
  },
  SCENARIO_CONFIGS: {
    title: 'Scenarios', emptyMessage: 'No scenarios yet.',
    add: { enabled: true, label: 'New Scenario' },
    filter: { text: { enabled: false }, type: { enabled: false } },
  },
  SCENARIO_STAGES: {
    title: 'Stages', emptyMessage: 'No stages in this section.',
    add: { enabled: true, label: 'Add Stage' },
    filter: { text: { enabled: false }, type: { enabled: false } },
  },
  COMPARTMENTS: {
    title: 'Compartments', emptyMessage: 'No compartments yet.',
    add: { enabled: true, label: 'Add' },
    filter: { text: { enabled: false }, type: { enabled: false } },
  },
  CONNECTIONS: {
    title: 'Connections', emptyMessage: 'No connections yet.',
    add: { enabled: true, label: 'Add' },
    filter: { text: { enabled: false }, type: { enabled: false } },
  },
  CYCLES: {
    title: 'Cycles', emptyMessage: 'No cycles yet.',
    add: { enabled: true, label: 'Add' },
    filter: { text: { enabled: false }, type: { enabled: false } },
  },
  OTHER: {
    title: 'Other', emptyMessage: 'No other entries yet.',
    add: { enabled: true, label: 'Add' },
    filter: { text: { enabled: false }, type: { enabled: false } },
  },
  MEMBRANES: {
    title: 'Membranes', emptyMessage: 'No membranes yet.',
    add: { enabled: true, label: 'Add' },
    filter: { text: { enabled: false }, type: { enabled: false } },
  },
  REACTIONS: {
    title: 'Reactions', emptyMessage: 'No reactions yet.',
    add: { enabled: true, label: 'Add' },
    filter: { text: { enabled: false }, type: { enabled: false } },
  },
  CALIBRATION: {
    title: 'Calibration', emptyMessage: 'No calibration controllers yet.',
    add: { enabled: true, label: 'Add' },
    filter: { text: { enabled: false }, type: { enabled: false } },
  },
  CONTROL: {
    title: 'Control', emptyMessage: 'No control controllers yet.',
    add: { enabled: true, label: 'Add' },
    filter: { text: { enabled: false }, type: { enabled: false } },
  },
  PLOT_CONFIGS: {
    title: 'Plot Configs', emptyMessage: 'No configs yet.',
    add: { enabled: true, label: 'New Config' },
    filter: { text: { enabled: false }, type: { enabled: false } },
  },
  PLOT_AXES: {
    title: 'Axes', emptyMessage: 'No axes yet.',
    add: { enabled: true, label: 'Add Axis' },
    filter: { text: { enabled: false }, type: { enabled: false } },
  },
  PROC_CONFIGS: {
    title: 'Processing Configs', emptyMessage: 'No configs yet.',
    add: { enabled: true, label: 'New Config' },
    filter: { text: { enabled: false }, type: { enabled: false } },
  },
  PROC_STAGES: {
    title: 'Stages', emptyMessage: 'No stages yet.',
    add: { enabled: true, label: 'Add Stage' },
    filter: { text: { enabled: false }, type: { enabled: false } },
  },
  PROC_OPS: {
    title: 'Operations', emptyMessage: 'Select a stage.',
    add: { enabled: true, label: 'Add Op' },
    filter: { text: { enabled: false }, type: { enabled: false } },
  },
  // [BEDSIDE] Data Collection
  PATIENTS: {
    title: 'Patients', emptyMessage: 'No patients yet.',
    add: { enabled: true, label: 'New Patient' },
    filter: { text: { enabled: true, placeholder: 'Search patients…' }, type: { enabled: false } },
  },
  BEDSIDE_DEVICES: {
    title: 'Devices', emptyMessage: 'No devices yet.',
    add: { enabled: true, label: 'New Device' },
    filter: { text: { enabled: false }, type: { enabled: false } },
  },
} as const satisfies Record<string, PanelConfig>;
// #endregion
///////////////////////////////////////////////////////////////////////////////


///////////////////////////////////////////////////////////////////////////////
// #region App Routes
// Navigation paths used in Menu.tsx and App.tsx. Must match <Route path=...>.
export const ROUTE = {
  LANDING:       '/',
  SIGNIN:        '/signin',
  PROFILE:       '/folder/Profile',
  ACCOUNT:       '/folder/Account',
  SETTINGS:      '/folder/Settings',
  SURVEYS:       '/folder/Surveys',
  CONFIGURATION: '/folder/Configuration',
  FILES:         '/folder/Files',
  CONTENT:       '/folder/Content',
  USERS:         '/folder/Users',
  ROLES:         '/folder/Roles',
  // [MEDICAL]
  SIMULATOR:      '/folder/Simulator',
  MODEL_SANDBOX:  '/folder/ModelSandbox',
  SCENARIO_SANDBOX: '/folder/ScenarioSandbox',
  PLOT_SANDBOX:   '/folder/PlotSandbox',
  PROC_SANDBOX:   '/folder/ProcessingSandbox',
  HDF_INSPECTOR:  '/folder/HdfInspector',
  // [BEDSIDE] Data Collection
  PATIENTS:       '/folder/Patients',
  DEVICES:        '/folder/Devices',
  MONITOR:        '/folder/Monitor',
} as const;

// #endregion
///////////////////////////////////////////////////////////////////////////////


///////////////////////////////////////////////////////////////////////////////
// #region Area Navigation
// Left-sidebar nav items per authenticated area. Consumed by AreaShell.
export const AREA_NAV = {
  SURVEYS: [
    { label: 'Surveys', route: '/folder/Surveys', icon: 'clipboard' },
  ],
  // [MEDICAL]
  PHYSIOLOGY: [
    { label: 'Simulator',           route: '/folder/Simulator',          icon: 'pulse'          },
    { label: 'Model Sandbox',       route: '/folder/ModelSandbox',       icon: 'git-network'    },
    // 'trending-up' is already in the shared icons.ts registry — picking a
    // registered name keeps this addition inside the fork's own constants.ts
    // rather than patching framework code for one icon import.
    { label: 'Scenario Sandbox',    route: '/folder/ScenarioSandbox',    icon: 'trending-up'    },
    { label: 'Plot Sandbox',        route: '/folder/PlotSandbox',        icon: 'stats-chart'    },
    { label: 'Processing Sandbox',  route: '/folder/ProcessingSandbox',  icon: 'options-outline'},
    { label: 'HDF Inspector',       route: '/folder/HdfInspector',       icon: 'layers-outline' },
  ],
  BACKOFFICE: [
    { label: 'Content',       route: '/folder/Content',       icon: 'document-text' },
    { label: 'Files',         route: '/folder/Files',         icon: 'folder'        },
    { label: 'Configuration', route: '/folder/Configuration', icon: 'construct'     },
    { label: 'Users',         route: '/folder/Users',         icon: 'people'        },
    { label: 'Roles',         route: '/folder/Roles',         icon: 'key'           },
  ],
  USER: [
    { label: 'Profile',  route: '/folder/Profile',  icon: 'person'   },
    { label: 'Account',  route: '/folder/Account',  icon: 'key'      },
    { label: 'Settings', route: '/folder/Settings', icon: 'settings' },
  ],
  // [BEDSIDE] Data Collection
  DATA_COLLECTION: [
    { label: 'Patients', route: '/folder/Patients', icon: 'bed'           },
    { label: 'Devices',  route: '/folder/Devices',  icon: 'hardware-chip' },
    { label: 'Monitor',  route: '/folder/Monitor',  icon: 'pulse'         },
  ],
} as const;

// ── The single navigation source ──────────────────────────────────────────────
// One entry per authenticated area, carrying everything the three nav surfaces
// need: the drawer (Menu), the top-bar sections (AppHeader) and the in-page rail
// (AreaShell, via the AREA_NAV items above). Adding an area is ONE entry here
// plus its route in App.tsx — never hand-edit Menu.tsx or NAV_SECTIONS again.
//
//   title  — heading in the drawer and label in the top bar
//   tier   — MINIMUM rung on the ROLE_TIERS ladder that may see the area. Every
//            nav surface compares the caller's rung with `hasTier(area.tier)`,
//            so all three rungs are expressible: 'registered' (any account),
//            'user', 'admin'. Mirror what permissions.js grants the area's
//            operations — nav is presentation, permissions.js is the gate.
//   header — whether it gets a top-bar section button. The User area is false:
//            it is reached via the header person icon instead.
// Forks append their own areas here with a // [MY DOMAIN] comment.
export const NAV_AREAS = [
  { key: 'SURVEYS',    title: 'Surveys',    tier: 'user',       header: true,  items: AREA_NAV.SURVEYS    },
  // [MEDICAL] 'registered': the model/plot/proc ops sit in that tier in
  // permissions.js, and the pages are behind PrivateRoute — any signed-in
  // account reaches them.
  { key: 'PHYSIOLOGY', title: 'Physiology Simulator', tier: 'registered', header: true, items: AREA_NAV.PHYSIOLOGY },
  // [BEDSIDE] 'admin': patient data is PHI — the whole domain is admin-only in
  // permissions.js and every page is behind AdminRoute.
  { key: 'DATA_COLLECTION', title: 'Data Collection', tier: 'admin', header: true, items: AREA_NAV.DATA_COLLECTION },
  { key: 'BACKOFFICE', title: 'Backoffice', tier: 'admin',      header: true,  items: AREA_NAV.BACKOFFICE },
  { key: 'USER',       title: 'Account',    tier: 'registered', header: false, items: AREA_NAV.USER       },
] as const;

// Section groupings for AppHeader — derived, never hand-maintained.
// `link` is where the section button navigates (its first page); `routes` is
// every path that counts as "inside" the section for active-state matching.
export const NAV_SECTIONS = NAV_AREAS
  .filter(a => a.header)
  .map(a => ({
    label:  a.title,
    routes: a.items.map(i => i.route) as readonly string[],
    link:   a.items[0].route as string,
    tier:   a.tier as RoleTier,
  }));
// #endregion
///////////////////////////////////////////////////////////////////////////////


///////////////////////////////////////////////////////////////////////////////
// #region Chart / Visualisation
// ECharts default color sequence, used by Simulator and PlotSandbox to assign series colors.
export const ECHARTS_PALETTE = [
  '#5470c6', '#91cc75', '#fac858', '#ee6666',
  '#73c0de', '#3ba272', '#fc8452',
] as const;

export const DEFAULT_COLOR = ECHARTS_PALETTE[0]; // '#5470c6'
// #endregion
///////////////////////////////////////////////////////////////////////////////


///////////////////////////////////////////////////////////////////////////////
// #region Content Helpers
// Leaf card types (excludes contentPage containers).
export const CARD_TYPES = new Set<string>([
  CONTENT_TYPE.HTML, CONTENT_TYPE.IMAGE, CONTENT_TYPE.HTML_IMAGE, CONTENT_TYPE.LATEX,
]);

// Types that can be added as children inside a content page tree.
export const CONTENT_ADDABLE_TYPES = [
  { value: CONTENT_TYPE.HTML,       label: 'HTML Text'    },
  { value: CONTENT_TYPE.IMAGE,      label: 'Image'        },
  { value: CONTENT_TYPE.HTML_IMAGE, label: 'HTML + Image' },
  { value: CONTENT_TYPE.LATEX,      label: 'LaTeX'        },
  { value: CONTENT_TYPE.PAGE,       label: 'Sub-page'     },
];
// #endregion
///////////////////////////////////////////////////////////////////////////////


///////////////////////////////////////////////////////////////////////////////
// #region Survey Helpers
// Types selectable when adding a question inside a survey (excludes survey itself).
export const SURVEY_ADDABLE_TYPES = [
  SURVEY_TYPE.TEXT, SURVEY_TYPE.NUMBER, SURVEY_TYPE.DATE,
  SURVEY_TYPE.TEXTAREA, SURVEY_TYPE.CHECK, SURVEY_TYPE.SELECT, SURVEY_TYPE.SCALE,
].map(t => ({ value: t, label: t }));
// #endregion
///////////////////////////////////////////////////////////////////////////////
