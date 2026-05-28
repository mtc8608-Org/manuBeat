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
} as const;
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
// #region API Configuration
// Node.js backend service address. Change here if the port or host moves.
// The backend reads its own port from .env (NODE_PORT); keep these in sync.
export const API_BASE    = 'http://localhost:3000/api';
export const GQL_URL     = 'http://localhost:3000/graphql';

// REST endpoint paths (relative to API_BASE)
export const ENDPOINT = {
  LOGIN:            '/login',
  CHANGE_PASSWORD:  '/change-password',
  USERS:            '/users',
  FILES:            '/files',
  FILES_UPLOAD:     '/files/upload',
  GENERATE_CONTENT: '/generate-content',
  SURVEY_EXPORT:    '/surveys',   // + `/${id}/stats/export`
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
    title: 'Components', emptyMessage: 'Select a type to load.',
    add: { enabled: true, label: 'New Component' },
    filter: { text: { enabled: false }, type: { enabled: true, options: ['form', 'input', 'select', 'check', 'plot', 'plotGrid'] } },
  },
  FILES_LIST: {
    title: 'Files', emptyMessage: 'No files found.',
    add: { enabled: true, label: 'Upload' },
    filter: { text: { enabled: true, placeholder: 'Search files…' }, type: { enabled: false } },
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
} as const satisfies Record<string, PanelConfig>;
// #endregion
///////////////////////////////////////////////////////////////////////////////


///////////////////////////////////////////////////////////////////////////////
// #region App Routes
// Navigation paths used in Menu.tsx and App.tsx. Must match <Route path=...>.
export const ROUTE = {
  LANDING:       '/',
  SIGNIN:        '/signin',
  ACCOUNT:       '/account',
  SURVEYS:       '/folder/Surveys',
  CONFIGURATION: '/folder/Configuration',
  FILES:         '/folder/Files',
  CONTENT:       '/folder/Content',
  // [MEDICAL]
  SIMULATOR:      '/folder/Simulator',
  MODEL_SANDBOX:  '/folder/ModelSandbox',
  PLOT_SANDBOX:   '/folder/PlotSandbox',
  PROC_SANDBOX:   '/folder/ProcessingSandbox',
  HDF_INSPECTOR:  '/folder/HdfInspector',
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
    { label: 'Plot Sandbox',        route: '/folder/PlotSandbox',        icon: 'stats-chart'    },
    { label: 'Processing Sandbox',  route: '/folder/ProcessingSandbox',  icon: 'options-outline'},
    { label: 'HDF Inspector',       route: '/folder/HdfInspector',       icon: 'layers-outline' },
  ],
  BACKOFFICE: [
    { label: 'Content',       route: '/folder/Content',       icon: 'document-text' },
    { label: 'Files',         route: '/folder/Files',         icon: 'folder'        },
    { label: 'Configuration', route: '/folder/Configuration', icon: 'construct'     },
  ],
} as const;

// Section groupings — used by AppHeader nav (authenticated users only)
export const NAV_SECTIONS = [
  { label: 'Surveys',              routes: ['/folder/Surveys'],                                                                                                              link: '/folder/Surveys',   icon: 'clipboard' },
  { label: 'Physiology Simulator', routes: ['/folder/Simulator', '/folder/ModelSandbox', '/folder/PlotSandbox', '/folder/ProcessingSandbox', '/folder/HdfInspector'],       link: '/folder/Simulator', icon: 'pulse'     },
  { label: 'Backoffice',           routes: ['/folder/Content', '/folder/Files', '/folder/Configuration'],                                                                   link: '/folder/Content',   icon: 'construct', adminOnly: true },
] as const;
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
