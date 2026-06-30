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


-- #region App Component System · tables + default seed
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

WITH inserted_components AS (
    INSERT INTO components (name, type, data, options)
    VALUES
        ('form1', 'form', '{"title": "Test Form"}', '{"label":"form1"}'),
        ('inp1', 'input', '{"text": "What is your name?"}', '{"label":"inp1"}'),
        ('sel1', 'select', '{"text": "Choose your sex:"}', '{"label":"sel1"}'),
        ('opt1', 'option', '{"text": "male"}', '{"label":"opt1"}'),
        ('opt2', 'option', '{"text": "female"}', '{"label":"opt2"}')
    RETURNING id, name
)

INSERT INTO components_relationships (parent_id, child_id)
SELECT parent.id, child.id
FROM inserted_components parent
JOIN inserted_components child ON parent.name = 'form1' AND child.name IN ('inp1', 'sel1')
UNION ALL
SELECT parent.id, child.id
FROM inserted_components parent
JOIN inserted_components child ON parent.name = 'sel1' AND child.name IN ('opt1', 'opt2');
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

-- NOTE: Physiological parameters (the former "Vital Signs" sub-survey, e013–e019)
-- were removed — the Patient Registration survey now holds demographics only.
-- Live physiological data is collected via the Data Collection domain (bedside
-- Pis streaming into per-patient HDF5 files; see init-scripts/03-init-bedside.sql).

-- Hardcoded UUID so seed-sample-surveys.sql can reference the survey by ID.
INSERT INTO surveys (id, component_id, title)
VALUES ('c51c1e5f-5cc1-4b77-8832-2d10cc97f000', 'c51c1e5f-5cc1-4b77-8832-2d10cc97e000', 'Patient Registration')
ON CONFLICT (id) DO NOTHING;
-- #endregion


-- #region Users & Auth
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user',  -- 'admin' | 'user'
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
-- Admin user is seeded at Node.js startup from ADMIN_EMAIL + ADMIN_PASSWORD env vars.
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
