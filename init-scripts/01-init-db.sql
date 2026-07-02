-- ════════════════════════════════════════════════════════════════════════════
--  01-init-db.sql — Framework schema
--
--  Tables and seeds that belong to the reusable framework layer:
--    · App component system (components / components_relationships)
--    · Survey system (survey_components, surveys, survey_answers)
--    · Users & auth
--    · Content CMS (files, content editor forms)
--
--  Domain-specific tables live in 02-init-finance.sql / 03-init-medical.sql.
-- ════════════════════════════════════════════════════════════════════════════


-- #region Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp"; -- Enables UUID functions
-- #endregion


-- #region App Component System · tables
CREATE TABLE components (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL UNIQUE,
    type VARCHAR(50),
    data JSONB,
    options JSONB
);

CREATE TABLE components_relationships (
    parent_id UUID,
    child_id  UUID,
    position  INT NOT NULL DEFAULT 0,
    CONSTRAINT fk_parent FOREIGN KEY (parent_id) REFERENCES components (id),
    CONSTRAINT fk_child  FOREIGN KEY (child_id)  REFERENCES components (id),
    PRIMARY KEY (parent_id, child_id)
);
-- #endregion


-- #region Component Editor Forms · d8b0 (plot) · d8c8 (default)
-- Editor templates fetched by ShowComponentModal when a component is edited.
-- Each form covers one or more component types; selected by name in ComponentForm.tsx.

-- Plot component editor — same field layout as form_component_builder
INSERT INTO components (id, name, type, data, options) VALUES
  ('c51c1e5f-5cc1-4b77-8832-2d10cc97d8b0', 'form_component_plot', 'form', '{"text": "Plot Component"}', '{"label": "form_component_plot"}');
-- Shares the same child nodes as form_component_builder (linked after that CTE runs)

WITH editor_components AS (
    INSERT INTO components (id, name, type, data, options)
    VALUES
        ('c51c1e5f-5cc1-4b77-8832-2d10cc97d8c8', 'form_component_builder',  'form',  '{"text": "Component Builder"}',   '{"label": "form_component_builder"}'),
        ('c51c1e5f-5cc1-4b77-8832-2d10cc97d8c9', 'input_name',              'check', '{"text": "name: "}',              '{"label": "name"}'),
        ('c51c1e5f-5cc1-4b77-8832-2d10cc97d8ca', 'input_type',              'input', '{"text": "type: "}',              '{"label": "type"}'),
        ('c51c1e5f-5cc1-4b77-8832-2d10cc97d8cb', 'form_component_data',     'form',  '{"text": "Component data: "}',    '{"label": "data"}'),
        ('c51c1e5f-5cc1-4b77-8832-2d10cc97d8cc', 'input_text',              'input', '{"text": "text: "}',              '{"label": "text"}'),
        ('c51c1e5f-5cc1-4b77-8832-2d10cc97d8cd', 'form_component_options',  'form',  '{"text": "Component options: "}', '{"label": "options"}'),
        ('c51c1e5f-5cc1-4b77-8832-2d10cc97d8ce', 'input_label',             'input', '{"text": "label: "}',             '{"label": "label"}')
    RETURNING id, name
)
INSERT INTO components_relationships (parent_id, child_id)
SELECT p.id, c.id FROM editor_components p JOIN editor_components c
    ON p.name = 'form_component_builder' AND c.name IN ('input_name','input_type','form_component_data','form_component_options')
UNION ALL
SELECT p.id, c.id FROM editor_components p JOIN editor_components c
    ON p.name = 'form_component_data' AND c.name = 'input_text'
UNION ALL
SELECT p.id, c.id FROM editor_components p JOIN editor_components c
    ON p.name = 'form_component_options' AND c.name = 'input_label';

-- Link form_component_plot to the same children (UUIDs inlined — CTE above is out of scope here)
INSERT INTO components_relationships (parent_id, child_id) VALUES
  ('c51c1e5f-5cc1-4b77-8832-2d10cc97d8b0', 'c51c1e5f-5cc1-4b77-8832-2d10cc97d8c9'),
  ('c51c1e5f-5cc1-4b77-8832-2d10cc97d8b0', 'c51c1e5f-5cc1-4b77-8832-2d10cc97d8ca'),
  ('c51c1e5f-5cc1-4b77-8832-2d10cc97d8b0', 'c51c1e5f-5cc1-4b77-8832-2d10cc97d8cb'),
  ('c51c1e5f-5cc1-4b77-8832-2d10cc97d8b0', 'c51c1e5f-5cc1-4b77-8832-2d10cc97d8cd');
-- #endregion


-- #region Survey System · tables + Patient Registration seed
-- ╔══════════════════════════════════════════════════════════════════════════════╗
-- ║                          SURVEY SYSTEM                                      ║
-- ╚══════════════════════════════════════════════════════════════════════════════╝
--
-- Mirrors the app component system but is fully separate.
-- Same tree logic (nodes + relationships), same JSONB shape.
--
-- Survey component types:
--   survey   — container / section  (like app 'form')
--   text     — free-text input      (like app 'input')
--   number   — numeric input
--   date     — date picker
--   select   — dropdown             (like app 'select')
--   check    — boolean checkbox     (like app 'check')
--   textarea — multi-line text
--   scale    — numeric rating scale (options.min / options.max)
--   option   — child of select      (like app 'option')
--
-- Answers are keyed by survey_component UUID, enabling cross-survey queries:
--   SELECT answers->>'<uuid>' FROM survey_answers WHERE answers ? '<uuid>'

-- ── Tables ────────────────────────────────────────────────────────────────────

CREATE TABLE survey_components (
    id      UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    name    VARCHAR(255) NOT NULL UNIQUE,
    type    VARCHAR(50),
    data    JSONB,
    options JSONB
);

-- position orders questions within a survey/section
CREATE TABLE survey_components_relationships (
    parent_id UUID        NOT NULL REFERENCES survey_components(id) ON DELETE CASCADE,
    child_id  UUID        NOT NULL REFERENCES survey_components(id) ON DELETE CASCADE,
    position  INT         NOT NULL DEFAULT 0,
    PRIMARY KEY (parent_id, child_id)
);

CREATE TABLE surveys (
    id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    component_id UUID        NOT NULL REFERENCES survey_components(id),
    title        TEXT        NOT NULL,
    is_active    BOOLEAN     NOT NULL DEFAULT true,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE survey_answers (
    id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    survey_id    UUID        NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
    answers      JSONB       NOT NULL DEFAULT '{}',
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- GIN index enables fast UUID-keyed containment queries across all surveys
CREATE INDEX idx_survey_answers_gin ON survey_answers USING GIN (answers);


-- ── Seed: Patient Registration survey ─────────────────────────────────────────
-- UUID range: e000–e012  (prefix c51c1e5f-5cc1-4b77-8832-2d10cc97e0XX)
-- Address is a sub-survey (type=survey), demonstrating nested sections.
-- Each leaf question UUID becomes the key in survey_answers.answers.

WITH reg AS (
    INSERT INTO survey_components (id, name, type, data, options) VALUES
        ('c51c1e5f-5cc1-4b77-8832-2d10cc97e000', 'surv_registration',       'survey',   '{"text": "Patient Registration"}', '{}'),
        ('c51c1e5f-5cc1-4b77-8832-2d10cc97e001', 'surv_reg_first_name',     'text',     '{"text": "First name"}',           '{"required": true}'),
        ('c51c1e5f-5cc1-4b77-8832-2d10cc97e002', 'surv_reg_last_name',      'text',     '{"text": "Last name"}',            '{"required": true}'),
        ('c51c1e5f-5cc1-4b77-8832-2d10cc97e003', 'surv_reg_email',          'text',     '{"text": "Email"}',                '{"required": true}'),
        ('c51c1e5f-5cc1-4b77-8832-2d10cc97e004', 'surv_reg_phone',          'text',     '{"text": "Phone"}',                '{}'),
        ('c51c1e5f-5cc1-4b77-8832-2d10cc97e005', 'surv_reg_dob',            'date',     '{"text": "Date of birth"}',        '{"required": true}'),
        ('c51c1e5f-5cc1-4b77-8832-2d10cc97e006', 'surv_reg_sex',            'select',   '{"text": "Sex"}',                  '{}'),
        ('c51c1e5f-5cc1-4b77-8832-2d10cc97e007', 'surv_reg_sex_male',       'option',   '{"text": "Male"}',                 '{}'),
        ('c51c1e5f-5cc1-4b77-8832-2d10cc97e008', 'surv_reg_sex_female',     'option',   '{"text": "Female"}',               '{}'),
        ('c51c1e5f-5cc1-4b77-8832-2d10cc97e009', 'surv_reg_sex_other',      'option',   '{"text": "Other"}',                '{}'),
        ('c51c1e5f-5cc1-4b77-8832-2d10cc97e00a', 'surv_reg_sex_pnts',       'option',   '{"text": "Prefer not to say"}',    '{}'),
        ('c51c1e5f-5cc1-4b77-8832-2d10cc97e00b', 'surv_reg_nationality',    'text',     '{"text": "Nationality"}',          '{}'),
        ('c51c1e5f-5cc1-4b77-8832-2d10cc97e00c', 'surv_reg_address',        'survey',   '{"text": "Address"}',              '{}'),
        ('c51c1e5f-5cc1-4b77-8832-2d10cc97e00d', 'surv_reg_street',         'text',     '{"text": "Street"}',               '{}'),
        ('c51c1e5f-5cc1-4b77-8832-2d10cc97e00e', 'surv_reg_city',           'text',     '{"text": "City"}',                 '{}'),
        ('c51c1e5f-5cc1-4b77-8832-2d10cc97e00f', 'surv_reg_postal_code',    'text',     '{"text": "Postal code"}',          '{}'),
        ('c51c1e5f-5cc1-4b77-8832-2d10cc97e010', 'surv_reg_country',        'text',     '{"text": "Country"}',              '{}'),
        ('c51c1e5f-5cc1-4b77-8832-2d10cc97e011', 'surv_reg_emergency',      'text',     '{"text": "Emergency contact"}',    '{}'),
        ('c51c1e5f-5cc1-4b77-8832-2d10cc97e012', 'surv_reg_notes',          'textarea', '{"text": "Medical notes"}',        '{}')
    RETURNING id, name
)
INSERT INTO survey_components_relationships (parent_id, child_id, position)
SELECT p.id, c.id, pos.ord FROM reg p JOIN reg c ON true
    JOIN (VALUES
        ('surv_registration', 'surv_reg_first_name',  1),
        ('surv_registration', 'surv_reg_last_name',   2),
        ('surv_registration', 'surv_reg_email',       3),
        ('surv_registration', 'surv_reg_phone',       4),
        ('surv_registration', 'surv_reg_dob',         5),
        ('surv_registration', 'surv_reg_sex',         6),
        ('surv_registration', 'surv_reg_nationality', 7),
        ('surv_registration', 'surv_reg_address',     8),
        ('surv_registration', 'surv_reg_emergency',   9),
        ('surv_registration', 'surv_reg_notes',      10),
        ('surv_reg_sex',      'surv_reg_sex_male',    1),
        ('surv_reg_sex',      'surv_reg_sex_female',  2),
        ('surv_reg_sex',      'surv_reg_sex_other',   3),
        ('surv_reg_sex',      'surv_reg_sex_pnts',    4),
        ('surv_reg_address',  'surv_reg_street',      1),
        ('surv_reg_address',  'surv_reg_city',        2),
        ('surv_reg_address',  'surv_reg_postal_code', 3),
        ('surv_reg_address',  'surv_reg_country',     4)
    ) AS pos(parent_name, child_name, ord)
    ON p.name = pos.parent_name AND c.name = pos.child_name;

-- ── Vital Signs section — appended to Patient Registration ───────────────────
-- UUID range: e013–e019  (prefix c51c1e5f-5cc1-4b77-8832-2d10cc97e0XX)
-- Added as a nested sub-survey ("Vital Signs") at position 11, mirroring the
-- Address section pattern. These numeric fields are processed by the Python
-- compute engine (pandas) on the Vitals analytics page.

INSERT INTO survey_components (id, name, type, data, options) VALUES
  ('c51c1e5f-5cc1-4b77-8832-2d10cc97e013', 'surv_reg_vitals', 'survey', '{"text": "Vital Signs"}',                        '{}'),
  ('c51c1e5f-5cc1-4b77-8832-2d10cc97e014', 'surv_reg_spo2',   'number', '{"text": "SpO2 (%)"}',                           '{"placeholder": "95–100"}'),
  ('c51c1e5f-5cc1-4b77-8832-2d10cc97e015', 'surv_reg_hr',     'number', '{"text": "Heart Rate (bpm)"}',                   '{"placeholder": "60–100"}'),
  ('c51c1e5f-5cc1-4b77-8832-2d10cc97e016', 'surv_reg_sbp',    'number', '{"text": "Systolic BP (mmHg)"}',                 '{"placeholder": "90–140"}'),
  ('c51c1e5f-5cc1-4b77-8832-2d10cc97e017', 'surv_reg_dbp',    'number', '{"text": "Diastolic BP (mmHg)"}',                '{"placeholder": "60–90"}'),
  ('c51c1e5f-5cc1-4b77-8832-2d10cc97e018', 'surv_reg_temp',   'number', '{"text": "Temperature (°C)"}',                   '{"placeholder": "36.1–37.5"}'),
  ('c51c1e5f-5cc1-4b77-8832-2d10cc97e019', 'surv_reg_rr',     'number', '{"text": "Respiratory Rate (breaths/min)"}',     '{"placeholder": "12–20"}')
ON CONFLICT (id) DO NOTHING;

INSERT INTO survey_components_relationships (parent_id, child_id, position) VALUES
  ('c51c1e5f-5cc1-4b77-8832-2d10cc97e000', 'c51c1e5f-5cc1-4b77-8832-2d10cc97e013', 11),
  ('c51c1e5f-5cc1-4b77-8832-2d10cc97e013', 'c51c1e5f-5cc1-4b77-8832-2d10cc97e014',  1),
  ('c51c1e5f-5cc1-4b77-8832-2d10cc97e013', 'c51c1e5f-5cc1-4b77-8832-2d10cc97e015',  2),
  ('c51c1e5f-5cc1-4b77-8832-2d10cc97e013', 'c51c1e5f-5cc1-4b77-8832-2d10cc97e016',  3),
  ('c51c1e5f-5cc1-4b77-8832-2d10cc97e013', 'c51c1e5f-5cc1-4b77-8832-2d10cc97e017',  4),
  ('c51c1e5f-5cc1-4b77-8832-2d10cc97e013', 'c51c1e5f-5cc1-4b77-8832-2d10cc97e018',  5),
  ('c51c1e5f-5cc1-4b77-8832-2d10cc97e013', 'c51c1e5f-5cc1-4b77-8832-2d10cc97e019',  6)
ON CONFLICT DO NOTHING;

-- Hardcoded UUID so seed-sample-surveys.sql can reference the survey by ID.
INSERT INTO surveys (id, component_id, title)
VALUES ('c51c1e5f-5cc1-4b77-8832-2d10cc97f000', 'c51c1e5f-5cc1-4b77-8832-2d10cc97e000', 'Patient Registration')
ON CONFLICT (id) DO NOTHING;
-- #endregion


-- #region Users & Auth · roles + user_profile + user_secrets · editor forms d000/d010/d030/d040/d050
-- Role catalogue. A role maps a name to a permissions *tier* — the fixed
-- three-rung ladder enforced by nodejs/permissions.js + schema/index.js
-- ('registered' < 'user' < 'admin'). New roles are aliases into that ladder:
-- they never grant finer-grained access than their tier. The tier is resolved
-- at login and embedded in the JWT, so tier/role changes apply on next login.
-- is_system rows are the three the code relies on: name and tier immutable,
-- never deletable. Managed in the backoffice Roles page.
CREATE TABLE roles (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT UNIQUE NOT NULL,
  tier        TEXT NOT NULL DEFAULT 'registered',  -- 'registered' | 'user' | 'admin'
  description TEXT,
  is_system   BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO roles (id, name, tier, description, is_system) VALUES
  ('c51c1e5f-5cc1-4b77-8832-2d10cc97d020', 'admin',      'admin',      'Full access: backoffice, user management, every operation.', true),
  ('c51c1e5f-5cc1-4b77-8832-2d10cc97d021', 'user',       'user',       'Full app user: everything a registered account can do, plus the user-tier operations (surveys).', true),
  ('c51c1e5f-5cc1-4b77-8832-2d10cc97d022', 'registered', 'registered', 'Self-registered account: own profile and self-service operations only.', true);

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user' REFERENCES roles(name) ON UPDATE CASCADE,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
-- Admin user is seeded at Node.js startup from ADMIN_EMAIL + ADMIN_PASSWORD env vars.

-- Per-user display data (framework table; each app defines the *shape* via its
-- seeded FormRenderer form). owner_id is UNIQUE (not the PK) and nullable so an
-- app can seed a sample profile NULL and re-stamp it to the admin at startup
-- (backend.js). New users get their row on first save.
CREATE TABLE user_profile (
    id       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,  -- NULL = unclaimed seed
    data     JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Per-user keychain. One row per (user, secret name); names are validated
-- against nodejs/secrets-registry.js — adding a key is a registry entry, never
-- a migration. Write-only over the API: the raw value is encrypted here and
-- only ever decrypted inside nodejs/lib/secrets.js. Never seeded (owner_id NOT
-- NULL — no unclaimed row, unlike user_profile).
CREATE TABLE user_secrets (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,          -- registry-validated, e.g. 'anthropic_api_key'
    ciphertext  BYTEA NOT NULL,         -- nonce || auth tag || AES-256-GCM ciphertext
    last4       TEXT,                   -- computed once at write time, for masked display
    key_version SMALLINT NOT NULL DEFAULT 1,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (owner_id, name)
);
CREATE INDEX idx_user_secrets_owner ON user_secrets(owner_id);

-- User editor form (backoffice Users page, Detail column). Email is shown
-- read-only by the page itself; the form covers the two PATCHable fields.
-- The role select has no seeded option children: Users.tsx injects the live
-- roles table via FormRenderer's injectedOptions.
INSERT INTO components (id, name, type, data, options) VALUES
  ('c51c1e5f-5cc1-4b77-8832-2d10cc97d000', 'form_user_editor',     'form',   '{"text": "User"}',     '{"label": "form_user_editor"}'),
  ('c51c1e5f-5cc1-4b77-8832-2d10cc97d001', 'user_edit_role',       'select', '{"text": "Role"}',     '{"label": "role"}'),
  ('c51c1e5f-5cc1-4b77-8832-2d10cc97d004', 'user_edit_active',     'check',  '{"text": "Active"}',   '{"label": "is_active"}');
INSERT INTO components_relationships (parent_id, child_id, position) VALUES
  ('c51c1e5f-5cc1-4b77-8832-2d10cc97d000', 'c51c1e5f-5cc1-4b77-8832-2d10cc97d001', 1),
  ('c51c1e5f-5cc1-4b77-8832-2d10cc97d000', 'c51c1e5f-5cc1-4b77-8832-2d10cc97d004', 2);

-- User create form (backoffice Users page, New modal). Role options are
-- injected at runtime, same as the editor form above.
INSERT INTO components (id, name, type, data, options) VALUES
  ('c51c1e5f-5cc1-4b77-8832-2d10cc97d010', 'form_user_create',    'form',   '{"text": "New User"}', '{"label": "form_user_create"}'),
  ('c51c1e5f-5cc1-4b77-8832-2d10cc97d011', 'user_new_email',      'input',  '{"text": "Email"}',    '{"label": "email"}'),
  ('c51c1e5f-5cc1-4b77-8832-2d10cc97d012', 'user_new_password',   'input',  '{"text": "Password"}', '{"label": "password"}'),
  ('c51c1e5f-5cc1-4b77-8832-2d10cc97d013', 'user_new_role',       'select', '{"text": "Role"}',     '{"label": "role"}');
INSERT INTO components_relationships (parent_id, child_id, position) VALUES
  ('c51c1e5f-5cc1-4b77-8832-2d10cc97d010', 'c51c1e5f-5cc1-4b77-8832-2d10cc97d011', 1),
  ('c51c1e5f-5cc1-4b77-8832-2d10cc97d010', 'c51c1e5f-5cc1-4b77-8832-2d10cc97d012', 2),
  ('c51c1e5f-5cc1-4b77-8832-2d10cc97d010', 'c51c1e5f-5cc1-4b77-8832-2d10cc97d013', 3);

-- Role editor form (backoffice Roles page, Detail column). Name is shown
-- read-only by the page; tier is disabled for system roles page-side (and
-- rejected server-side).
INSERT INTO components (id, name, type, data, options) VALUES
  ('c51c1e5f-5cc1-4b77-8832-2d10cc97d030', 'form_role_editor',          'form',     '{"text": "Role"}',        '{"label": "form_role_editor"}'),
  ('c51c1e5f-5cc1-4b77-8832-2d10cc97d031', 'role_edit_tier',            'select',   '{"text": "Tier"}',        '{"label": "tier"}'),
  ('c51c1e5f-5cc1-4b77-8832-2d10cc97d032', 'role_edit_tier_registered', 'option',   '{"text": "registered"}',  '{"label": "registered"}'),
  ('c51c1e5f-5cc1-4b77-8832-2d10cc97d033', 'role_edit_tier_user',       'option',   '{"text": "user"}',        '{"label": "user"}'),
  ('c51c1e5f-5cc1-4b77-8832-2d10cc97d034', 'role_edit_tier_admin',      'option',   '{"text": "admin"}',       '{"label": "admin"}'),
  ('c51c1e5f-5cc1-4b77-8832-2d10cc97d035', 'role_edit_description',     'textarea', '{"text": "Description"}', '{"label": "description"}');
INSERT INTO components_relationships (parent_id, child_id, position) VALUES
  ('c51c1e5f-5cc1-4b77-8832-2d10cc97d030', 'c51c1e5f-5cc1-4b77-8832-2d10cc97d031', 1),
  ('c51c1e5f-5cc1-4b77-8832-2d10cc97d030', 'c51c1e5f-5cc1-4b77-8832-2d10cc97d035', 2),
  ('c51c1e5f-5cc1-4b77-8832-2d10cc97d031', 'c51c1e5f-5cc1-4b77-8832-2d10cc97d032', 1),
  ('c51c1e5f-5cc1-4b77-8832-2d10cc97d031', 'c51c1e5f-5cc1-4b77-8832-2d10cc97d033', 2),
  ('c51c1e5f-5cc1-4b77-8832-2d10cc97d031', 'c51c1e5f-5cc1-4b77-8832-2d10cc97d034', 3);

-- Role create form (backoffice Roles page, New modal).
INSERT INTO components (id, name, type, data, options) VALUES
  ('c51c1e5f-5cc1-4b77-8832-2d10cc97d040', 'form_role_create',         'form',     '{"text": "New Role"}',    '{"label": "form_role_create"}'),
  ('c51c1e5f-5cc1-4b77-8832-2d10cc97d041', 'role_new_name',            'input',    '{"text": "Name"}',        '{"label": "name"}'),
  ('c51c1e5f-5cc1-4b77-8832-2d10cc97d042', 'role_new_tier',            'select',   '{"text": "Tier"}',        '{"label": "tier"}'),
  ('c51c1e5f-5cc1-4b77-8832-2d10cc97d043', 'role_new_tier_registered', 'option',   '{"text": "registered"}',  '{"label": "registered"}'),
  ('c51c1e5f-5cc1-4b77-8832-2d10cc97d044', 'role_new_tier_user',       'option',   '{"text": "user"}',        '{"label": "user"}'),
  ('c51c1e5f-5cc1-4b77-8832-2d10cc97d045', 'role_new_tier_admin',      'option',   '{"text": "admin"}',       '{"label": "admin"}'),
  ('c51c1e5f-5cc1-4b77-8832-2d10cc97d046', 'role_new_description',     'textarea', '{"text": "Description"}', '{"label": "description"}');
INSERT INTO components_relationships (parent_id, child_id, position) VALUES
  ('c51c1e5f-5cc1-4b77-8832-2d10cc97d040', 'c51c1e5f-5cc1-4b77-8832-2d10cc97d041', 1),
  ('c51c1e5f-5cc1-4b77-8832-2d10cc97d040', 'c51c1e5f-5cc1-4b77-8832-2d10cc97d042', 2),
  ('c51c1e5f-5cc1-4b77-8832-2d10cc97d040', 'c51c1e5f-5cc1-4b77-8832-2d10cc97d046', 3),
  ('c51c1e5f-5cc1-4b77-8832-2d10cc97d042', 'c51c1e5f-5cc1-4b77-8832-2d10cc97d043', 1),
  ('c51c1e5f-5cc1-4b77-8832-2d10cc97d042', 'c51c1e5f-5cc1-4b77-8832-2d10cc97d044', 2),
  ('c51c1e5f-5cc1-4b77-8832-2d10cc97d042', 'c51c1e5f-5cc1-4b77-8832-2d10cc97d045', 3);

-- User profile form (user area Profile page). Minimal generic starter shape —
-- each app replaces these fields with its own profile form (keep the form name;
-- the frontend fetches it via USER_PROFILE_FORM in constants.ts).
INSERT INTO components (id, name, type, data, options) VALUES
  ('c51c1e5f-5cc1-4b77-8832-2d10cc97d050', 'form_user_profile', 'form',  '{"text": "Profile"}',       '{"label": "form_user_profile"}'),
  ('c51c1e5f-5cc1-4b77-8832-2d10cc97d051', 'profile_name',      'input', '{"text": "Name"}',          '{"label": "name"}'),
  ('c51c1e5f-5cc1-4b77-8832-2d10cc97d052', 'profile_email',     'input', '{"text": "Contact email"}', '{"label": "email"}'),
  ('c51c1e5f-5cc1-4b77-8832-2d10cc97d053', 'profile_website',   'input', '{"text": "Website"}',       '{"label": "website"}');
INSERT INTO components_relationships (parent_id, child_id, position) VALUES
  ('c51c1e5f-5cc1-4b77-8832-2d10cc97d050', 'c51c1e5f-5cc1-4b77-8832-2d10cc97d051', 1),
  ('c51c1e5f-5cc1-4b77-8832-2d10cc97d050', 'c51c1e5f-5cc1-4b77-8832-2d10cc97d052', 2),
  ('c51c1e5f-5cc1-4b77-8832-2d10cc97d050', 'c51c1e5f-5cc1-4b77-8832-2d10cc97d053', 3);
-- #endregion


-- #region Content System · card editors (html / image / html+img) + files + survey + page forms
-- ╔══════════════════════════════════════════════════════════════════════════════╗
-- ║                        CONTENT SYSTEM                                       ║
-- ╚══════════════════════════════════════════════════════════════════════════════╝
--
-- Content component types (stored in the shared `components` table):
--   contentPage      — container; can hold child pages or card leaves
--                      (the root "Content Menu" at a000 is also contentPage)
--   contentHtml      — leaf, stores data.html (raw HTML string)
--   contentImage     — leaf, stores data.src + data.alt
--   contentHtmlImage — leaf, stores data.html + data.src (two-column layout)
--
-- These editor forms drive the Add Card / Edit Card modals in Content.tsx.
-- UUIDs are hardcoded in constants.ts (CONTENT_EDITOR_ID).

-- ── contentHtml editor ────────────────────────────────────────────────────────
WITH html_editor AS (
    INSERT INTO components (id, name, type, data, options)
    VALUES
        ('c51c1e5f-5cc1-4b77-8832-2d10cc97e110', 'form_content_html',  'form',      '{"text": "HTML Content"}', '{"label": "form_content_html"}'),
        ('c51c1e5f-5cc1-4b77-8832-2d10cc97e111', 'content_html_body',  'richtext',  '{"text": "HTML:"}',        '{"label": "html"}')
    RETURNING id, name
)
INSERT INTO components_relationships (parent_id, child_id)
SELECT p.id, c.id FROM html_editor p JOIN html_editor c
    ON p.name = 'form_content_html' AND c.name = 'content_html_body';

-- ── contentImage editor ───────────────────────────────────────────────────────
WITH image_editor AS (
    INSERT INTO components (id, name, type, data, options)
    VALUES
        ('c51c1e5f-5cc1-4b77-8832-2d10cc97e120', 'form_content_image', 'form',       '{"text": "Image"}',     '{"label": "form_content_image"}'),
        ('c51c1e5f-5cc1-4b77-8832-2d10cc97e121', 'content_image_src',  'filepicker', '{"text": "Image:"}',    '{"label": "src"}'),
        ('c51c1e5f-5cc1-4b77-8832-2d10cc97e122', 'content_image_alt',  'input',      '{"text": "Alt text:"}', '{"label": "alt"}')
    RETURNING id, name
)
INSERT INTO components_relationships (parent_id, child_id)
SELECT p.id, c.id FROM image_editor p JOIN image_editor c
    ON p.name = 'form_content_image' AND c.name IN ('content_image_src', 'content_image_alt');

-- ── contentHtmlImage editor ───────────────────────────────────────────────────
WITH html_image_editor AS (
    INSERT INTO components (id, name, type, data, options)
    VALUES
        ('c51c1e5f-5cc1-4b77-8832-2d10cc97e130', 'form_content_html_image', 'form',       '{"text": "HTML + Image"}', '{"label": "form_content_html_image"}'),
        ('c51c1e5f-5cc1-4b77-8832-2d10cc97e131', 'content_hi_html',         'richtext',  '{"text": "HTML:"}',        '{"label": "html"}'),
        ('c51c1e5f-5cc1-4b77-8832-2d10cc97e132', 'content_hi_src',          'filepicker','{"text": "Image:"}',       '{"label": "src"}')
    RETURNING id, name
)
INSERT INTO components_relationships (parent_id, child_id)
SELECT p.id, c.id FROM html_image_editor p JOIN html_image_editor c
    ON p.name = 'form_content_html_image' AND c.name IN ('content_hi_html', 'content_hi_src');

-- ── Files ─────────────────────────────────────────────────────────────────────

CREATE TABLE files (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket      TEXT NOT NULL DEFAULT 'uploads',
  key         TEXT NOT NULL,
  filename    TEXT NOT NULL,
  mime_type   TEXT,
  size        BIGINT,
  description TEXT,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(bucket, key)
);

-- ── File detail form ──────────────────────────────────────────────────────────
-- Rendered by FormRenderer in Files.tsx when a file is selected.
-- UUID is hardcoded in constants.ts (FORM_ID.FILE_DETAIL).

WITH file_form AS (
    INSERT INTO components (id, name, type, data, options)
    VALUES
        ('c51c1e5f-5cc1-4b77-8832-2d10cc97df00', 'form_file_detail',  'form',     '{"text": "File Details"}',  '{"label": "form_file_detail"}'),
        ('c51c1e5f-5cc1-4b77-8832-2d10cc97df01', 'file_description',  'textarea', '{"text": "Description:"}',  '{"label": "description"}')
    RETURNING id, name
)
INSERT INTO components_relationships (parent_id, child_id)
SELECT p.id, c.id FROM file_form p JOIN file_form c
    ON p.name = 'form_file_detail' AND c.name = 'file_description';

-- ── New Survey form ──────────────────────────────────────────────────────────
-- Rendered by FormRenderer in Surveys.tsx's New Survey modal.
-- UUID is hardcoded in constants.ts (FORM_ID.NEW_SURVEY).

WITH new_survey_form AS (
    INSERT INTO components (id, name, type, data, options)
    VALUES
        ('c51c1e5f-5cc1-4b77-8832-2d10cc97db00', 'form_new_survey', 'form',  '{"text": "New Survey"}',    '{"label": "form_new_survey"}'),
        ('c51c1e5f-5cc1-4b77-8832-2d10cc97db01', 'survey_title',    'input', '{"text": "Survey title:"}', '{"label": "title"}')
    RETURNING id, name
)
INSERT INTO components_relationships (parent_id, child_id)
SELECT p.id, c.id FROM new_survey_form p JOIN new_survey_form c
    ON p.name = 'form_new_survey' AND c.name = 'survey_title';


-- ── Survey question editor forms ──────────────────────────────────────────────
-- Form A (dd00): label + placeholder — for text / number / textarea
-- Form B (dd03): label + min + max   — for scale
-- Form C (dd07): label only          — for check / select / option / date / survey
-- UUIDs are hardcoded in constants.ts (SURVEY_EDITOR_ID).

WITH surv_q_text_form AS (
    INSERT INTO components (id, name, type, data, options)
    VALUES
        ('c51c1e5f-5cc1-4b77-8832-2d10cc97dd00', 'form_survey_q_text',  'form',  '{"text": "Question"}',       '{"label": "form_survey_q_text"}'),
        ('c51c1e5f-5cc1-4b77-8832-2d10cc97dd01', 'surv_q_label',        'input', '{"text": "Question text:"}', '{"label": "text"}'),
        ('c51c1e5f-5cc1-4b77-8832-2d10cc97dd02', 'surv_q_placeholder',  'input', '{"text": "Placeholder:"}',   '{"label": "placeholder"}')
    RETURNING id, name
)
INSERT INTO components_relationships (parent_id, child_id)
SELECT p.id, c.id FROM surv_q_text_form p JOIN surv_q_text_form c
    ON p.name = 'form_survey_q_text' AND c.name IN ('surv_q_label', 'surv_q_placeholder');

WITH surv_q_scale_form AS (
    INSERT INTO components (id, name, type, data, options)
    VALUES
        ('c51c1e5f-5cc1-4b77-8832-2d10cc97dd03', 'form_survey_q_scale',       'form',  '{"text": "Scale Question"}', '{"label": "form_survey_q_scale"}'),
        ('c51c1e5f-5cc1-4b77-8832-2d10cc97dd04', 'surv_q_scale_label',        'input', '{"text": "Question text:"}', '{"label": "text"}'),
        ('c51c1e5f-5cc1-4b77-8832-2d10cc97dd05', 'surv_q_scale_min',          'input', '{"text": "Min:"}',           '{"label": "min"}'),
        ('c51c1e5f-5cc1-4b77-8832-2d10cc97dd06', 'surv_q_scale_max',          'input', '{"text": "Max:"}',           '{"label": "max"}')
    RETURNING id, name
)
INSERT INTO components_relationships (parent_id, child_id)
SELECT p.id, c.id FROM surv_q_scale_form p JOIN surv_q_scale_form c
    ON p.name = 'form_survey_q_scale' AND c.name IN ('surv_q_scale_label', 'surv_q_scale_min', 'surv_q_scale_max');

WITH surv_q_default_form AS (
    INSERT INTO components (id, name, type, data, options)
    VALUES
        ('c51c1e5f-5cc1-4b77-8832-2d10cc97dd07', 'form_survey_q_default',  'form',  '{"text": "Question"}',       '{"label": "form_survey_q_default"}'),
        ('c51c1e5f-5cc1-4b77-8832-2d10cc97dd08', 'surv_q_default_label',   'input', '{"text": "Question text:"}', '{"label": "text"}')
    RETURNING id, name
)
INSERT INTO components_relationships (parent_id, child_id)
SELECT p.id, c.id FROM surv_q_default_form p JOIN surv_q_default_form c
    ON p.name = 'form_survey_q_default' AND c.name = 'surv_q_default_label';


-- ── New Content Page form ─────────────────────────────────────────────────────
-- Rendered by FormRenderer in Content.tsx's New Page modal.
-- UUID is hardcoded in constants.ts (FORM_ID.NEW_PAGE).

WITH new_page_form AS (
    INSERT INTO components (id, name, type, data, options)
    VALUES
        ('c51c1e5f-5cc1-4b77-8832-2d10cc97dc00', 'form_new_page', 'form',  '{"text": "New Content Page"}', '{"label": "form_new_page"}'),
        ('c51c1e5f-5cc1-4b77-8832-2d10cc97dc01', 'page_name',     'input', '{"text": "Internal name:"}',   '{"label": "name"}'),
        ('c51c1e5f-5cc1-4b77-8832-2d10cc97dc02', 'page_title',    'input', '{"text": "Display title:"}',   '{"label": "title"}')
    RETURNING id, name
)
INSERT INTO components_relationships (parent_id, child_id)
SELECT p.id, c.id FROM new_page_form p JOIN new_page_form c
    ON p.name = 'form_new_page' AND c.name IN ('page_name', 'page_title');


-- Content menu, page links, and position assignments live in seed-content.sql.
-- #endregion
