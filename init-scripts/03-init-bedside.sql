-- ════════════════════════════════════════════════════════════════════════════
--  03-init-bedside.sql — Data Collection (bedside telemetry) domain schema
--
--  Patients are now a FIRST-CLASS table (detached from the survey system): real
--  columns for demographics + an `extra` JSONB for ad-hoc fields. The demographic
--  form is still rendered with the shared FormRenderer, driven by an app-domain
--  component tree (seeded below) whose inputs' options.label = the column name.
--
--  Domain entities:
--    · patients        — demographics (real columns) + per-patient HDF5 file
--    · bedside_nodes   — the Raspberry Pis (edge agents); identity + device token
--    · beds            — physical beds, each served by one Pi
--    · bed_assignments — patient ↔ bed history (encounters)
--    · bedside_streams — registry of streams a node produces
--    · bedside_segments— hot store: one row per contiguous segment (= HDF5 index row)
--    · bedside_events  — episodic / annotation records
--    · node_heartbeats — health pings (online status, temp, disk, backlog)
--
--  No patient/node/bed SEED rows — everything is created fresh from the UI.
--  Depends on: 01-init-db.sql (files, components tables).
--  UUID convention: framework prefix c51c1e5f-5cc1-4b77-8832-2d10cc97XXXX,
--  bedside sub-ranges: form b2XX.
-- ════════════════════════════════════════════════════════════════════════════


-- #region Data Collection

-- ── Patients (first-class; demographics as real columns) ─────────────────────
CREATE TABLE patients (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    first_name    TEXT,
    last_name     TEXT,
    date_of_birth DATE,
    sex           TEXT,
    identifier    TEXT,          -- hospital number / MRN
    email         TEXT,
    phone         TEXT,
    address       TEXT,
    notes         TEXT,
    extra         JSONB NOT NULL DEFAULT '{}',   -- ad-hoc fields before they get a column
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── The bedside Raspberry Pis (edge agents) ──────────────────────────────────
-- node_key = the stable id the agent sends (agent.toml node_id). token_hash is a
-- bcrypt hash of the device token (plaintext shown once on create/rotate).
CREATE TABLE bedside_nodes (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    node_key      TEXT UNIQUE,                      -- agent identifier (e.g. "bedside-01")
    name          TEXT NOT NULL,
    hostname      TEXT,
    ip_address    TEXT,
    location      TEXT,
    status        TEXT NOT NULL DEFAULT 'offline',  -- online | offline | unknown
    last_seen     TIMESTAMPTZ,
    agent_version TEXT,
    token_hash    TEXT,                             -- bcrypt(device token)
    hardware      JSONB NOT NULL DEFAULT '{}',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Physical beds — one Pi per bed ───────────────────────────────────────────
CREATE TABLE beds (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    label      TEXT NOT NULL UNIQUE,
    node_id    UUID UNIQUE REFERENCES bedside_nodes(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Patient ↔ bed history (encounters) ───────────────────────────────────────
CREATE TABLE bed_assignments (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    bed_id     UUID NOT NULL REFERENCES beds(id)     ON DELETE CASCADE,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at   TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_active_bed     ON bed_assignments (bed_id)     WHERE ended_at IS NULL;
CREATE UNIQUE INDEX uq_active_patient ON bed_assignments (patient_id) WHERE ended_at IS NULL;

-- ── Per-patient data file (HDF5 stream target) ───────────────────────────────
CREATE TABLE patient_files (
    patient_id UUID PRIMARY KEY REFERENCES patients(id) ON DELETE CASCADE,
    file_id    UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Stream registry (one row per node+stream the agent reports) ───────────────
CREATE TABLE bedside_streams (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    node_id      UUID NOT NULL REFERENCES bedside_nodes(id) ON DELETE CASCADE,
    stream_id    TEXT NOT NULL,
    modality     TEXT,
    "group"      TEXT,
    channel      TEXT,
    units        TEXT,
    metric       TEXT,
    sampling_hz  DOUBLE PRECISION,
    source       TEXT,
    last_seq     BIGINT,
    last_time_us BIGINT,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (node_id, stream_id)
);

-- ── Hot store: one row per contiguous segment (= one HDF5 Index Table row) ────
CREATE TABLE bedside_segments (
    id            BIGSERIAL PRIMARY KEY,
    node_id       UUID NOT NULL REFERENCES bedside_nodes(id) ON DELETE CASCADE,
    stream_id     TEXT NOT NULL,
    seq           BIGINT NOT NULL,
    start_time_us BIGINT NOT NULL,
    sampling_hz   DOUBLE PRECISION NOT NULL,
    duration      INTEGER NOT NULL,
    samples       REAL[] NOT NULL,
    quality       JSONB NOT NULL DEFAULT '[]',
    received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (node_id, stream_id, seq)   -- idempotent backfill / dedupe
);
CREATE INDEX idx_segments_stream ON bedside_segments (node_id, stream_id, seq DESC);

-- ── Episodic / annotation events ─────────────────────────────────────────────
CREATE TABLE bedside_events (
    id          BIGSERIAL PRIMARY KEY,
    node_id     UUID NOT NULL REFERENCES bedside_nodes(id) ON DELETE CASCADE,
    kind        TEXT,            -- episodic | annotation
    code        TEXT,
    ts_ms       BIGINT,
    duration_ms BIGINT,
    comment     TEXT,
    value       DOUBLE PRECISION,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Health pings ─────────────────────────────────────────────────────────────
CREATE TABLE node_heartbeats (
    id              BIGSERIAL PRIMARY KEY,
    node_id         UUID NOT NULL REFERENCES bedside_nodes(id) ON DELETE CASCADE,
    ts_ms           BIGINT,
    cpu_temp_c      DOUBLE PRECISION,
    disk_free_bytes BIGINT,
    buffer_pending  INTEGER,
    last_sample_us  JSONB,
    agent_version   TEXT,
    received_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_heartbeats_node ON node_heartbeats (node_id, received_at DESC);


-- ── Seed: Patient Demographics form (app component tree) ─────────────────────
-- Rendered by FormRenderer (mode="app"): each input's options.label = the patients
-- column it writes to. Add a field later = add a column + add an input here.
INSERT INTO components (id, name, type, data, options) VALUES
    ('c51c1e5f-5cc1-4b77-8832-2d10cc97b200', 'form_patient_demographics', 'form',     '{"text": "Patient Demographics"}', '{}'),
    ('c51c1e5f-5cc1-4b77-8832-2d10cc97b201', 'pd_first_name',             'input',    '{"text": "First name"}',           '{"label": "first_name", "required": true}'),
    ('c51c1e5f-5cc1-4b77-8832-2d10cc97b202', 'pd_last_name',              'input',    '{"text": "Last name"}',            '{"label": "last_name", "required": true}'),
    ('c51c1e5f-5cc1-4b77-8832-2d10cc97b203', 'pd_date_of_birth',          'date',     '{"text": "Date of birth"}',        '{"label": "date_of_birth"}'),
    ('c51c1e5f-5cc1-4b77-8832-2d10cc97b204', 'pd_sex',                    'select',   '{"text": "Sex"}',                  '{"label": "sex"}'),
    ('c51c1e5f-5cc1-4b77-8832-2d10cc97b205', 'pd_sex_male',               'option',   '{"text": "Male"}',                 '{}'),
    ('c51c1e5f-5cc1-4b77-8832-2d10cc97b206', 'pd_sex_female',             'option',   '{"text": "Female"}',               '{}'),
    ('c51c1e5f-5cc1-4b77-8832-2d10cc97b207', 'pd_sex_other',              'option',   '{"text": "Other"}',                '{}'),
    ('c51c1e5f-5cc1-4b77-8832-2d10cc97b208', 'pd_identifier',             'input',    '{"text": "Hospital number (MRN)"}','{"label": "identifier"}'),
    ('c51c1e5f-5cc1-4b77-8832-2d10cc97b209', 'pd_email',                  'input',    '{"text": "Email"}',                '{"label": "email"}'),
    ('c51c1e5f-5cc1-4b77-8832-2d10cc97b210', 'pd_phone',                  'input',    '{"text": "Phone"}',                '{"label": "phone"}'),
    ('c51c1e5f-5cc1-4b77-8832-2d10cc97b211', 'pd_address',                'textarea', '{"text": "Address"}',              '{"label": "address"}'),
    ('c51c1e5f-5cc1-4b77-8832-2d10cc97b212', 'pd_notes',                  'textarea', '{"text": "Notes"}',                '{"label": "notes"}')
ON CONFLICT (id) DO NOTHING;

INSERT INTO components_relationships (parent_id, child_id, position) VALUES
    ('c51c1e5f-5cc1-4b77-8832-2d10cc97b200', 'c51c1e5f-5cc1-4b77-8832-2d10cc97b201', 1),
    ('c51c1e5f-5cc1-4b77-8832-2d10cc97b200', 'c51c1e5f-5cc1-4b77-8832-2d10cc97b202', 2),
    ('c51c1e5f-5cc1-4b77-8832-2d10cc97b200', 'c51c1e5f-5cc1-4b77-8832-2d10cc97b203', 3),
    ('c51c1e5f-5cc1-4b77-8832-2d10cc97b200', 'c51c1e5f-5cc1-4b77-8832-2d10cc97b204', 4),
    ('c51c1e5f-5cc1-4b77-8832-2d10cc97b204', 'c51c1e5f-5cc1-4b77-8832-2d10cc97b205', 1),
    ('c51c1e5f-5cc1-4b77-8832-2d10cc97b204', 'c51c1e5f-5cc1-4b77-8832-2d10cc97b206', 2),
    ('c51c1e5f-5cc1-4b77-8832-2d10cc97b204', 'c51c1e5f-5cc1-4b77-8832-2d10cc97b207', 3),
    ('c51c1e5f-5cc1-4b77-8832-2d10cc97b200', 'c51c1e5f-5cc1-4b77-8832-2d10cc97b208', 5),
    ('c51c1e5f-5cc1-4b77-8832-2d10cc97b200', 'c51c1e5f-5cc1-4b77-8832-2d10cc97b209', 6),
    ('c51c1e5f-5cc1-4b77-8832-2d10cc97b200', 'c51c1e5f-5cc1-4b77-8832-2d10cc97b210', 7),
    ('c51c1e5f-5cc1-4b77-8832-2d10cc97b200', 'c51c1e5f-5cc1-4b77-8832-2d10cc97b211', 8),
    ('c51c1e5f-5cc1-4b77-8832-2d10cc97b200', 'c51c1e5f-5cc1-4b77-8832-2d10cc97b212', 9)
ON CONFLICT (parent_id, child_id) DO NOTHING;

-- #endregion
