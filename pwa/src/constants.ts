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
} as const;

// Section groupings — used by AppHeader nav (authenticated users only).
// The User area is deliberately absent: it is reached via the header person icon.
export const NAV_SECTIONS = [
  { label: 'Surveys',    routes: ['/folder/Surveys'],                                             link: '/folder/Surveys',       icon: 'clipboard'  },
  { label: 'Backoffice', routes: ['/folder/Content', '/folder/Files', '/folder/Configuration', '/folder/Users', '/folder/Roles'],   link: '/folder/Content',       icon: 'construct',  adminOnly: true },
] as const;
// #endregion
///////////////////////////////////////////////////////////////////////////////


///////////////////////////////////////////////////////////////////////////////
// #region Misc
export const DEFAULT_COLOR = '#5470c6';
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
