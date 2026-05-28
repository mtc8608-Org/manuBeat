-- ════════════════════════════════════════════════════════════════════════════
--  03-init-medical.sql — Medical / Physiology domain schema
--
--  Tables and seeds specific to the cardio-pulmonary simulation domain:
--    · model_configs, model_runs, plot_configs, proc_configs
--    · Add Model Config form seed
--
--  Depends on: 01-init-db.sql (components table must exist first)
-- ════════════════════════════════════════════════════════════════════════════


-- #region Cardio-Pulmonary Model

CREATE TABLE model_configs (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        TEXT NOT NULL,
    description TEXT,
    config      JSONB NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE model_runs (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    config_id    UUID REFERENCES model_configs(id) ON DELETE SET NULL,
    status       TEXT NOT NULL DEFAULT 'pending',  -- pending | running | done | error
    minio_key    TEXT,
    metadata     JSONB,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ
);

CREATE TABLE plot_configs (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        TEXT NOT NULL,
    description TEXT,
    config      JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE proc_configs (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        TEXT NOT NULL,
    description TEXT,
    config      JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ── Add Model Config form (Model Sandbox) ────────────────────────────────────
-- UUID range: e4. Name hardcoded in constants.ts (FORM_ID.ADD_MODEL_CONFIG).
WITH add_model_form AS (
    INSERT INTO components (id, name, type, data, options) VALUES
        ('c51c1e5f-5cc1-4b77-8832-2d10cc97e400', 'form_add_model_config', 'form',  '{"text": "New Model"}',     '{"label": "form_add_model_config"}'),
        ('c51c1e5f-5cc1-4b77-8832-2d10cc97e401', 'model_config_name',     'input', '{"text": "Name:"}',         '{"label": "name"}'),
        ('c51c1e5f-5cc1-4b77-8832-2d10cc97e402', 'model_config_desc',     'input', '{"text": "Description:"}',  '{"label": "description"}')
    RETURNING id, name
)
INSERT INTO components_relationships (parent_id, child_id)
SELECT p.id, c.id FROM add_model_form p JOIN add_model_form c
    ON p.name = 'form_add_model_config' AND c.name IN ('model_config_name', 'model_config_desc');
-- #endregion
