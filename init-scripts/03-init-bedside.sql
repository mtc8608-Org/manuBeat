-- ════════════════════════════════════════════════════════════════════════════
--  03-init-bedside.sql — Data Collection (bedside telemetry) domain schema
--
--  A patient's identity IS its Patient Registration survey answer (survey f000,
--  seeded in 01-init-db.sql). This domain does NOT re-store demographics — it
--  augments a patient (keyed by survey_answers.id) with:
--    · bedside_nodes  — the Raspberry Pis (static for now; connected later)
--    · beds           — physical beds, each served by one Pi
--    · bed_assignments— patient ↔ bed history (encounters)
--    · patient_files  — the per-patient data file (HDF5 stream target)
--
--  Depends on: 01-init-db.sql (survey_answers + files tables must exist first).
--
--  UUID convention: framework prefix c51c1e5f-5cc1-4b77-8832-2d10cc97XXXX,
--  bedside sub-range b0XX.
-- ════════════════════════════════════════════════════════════════════════════


-- #region Data Collection

-- ── The bedside Raspberry Pis ────────────────────────────────────────────────
-- Static for now: status/last_seen are placeholders until the Pi dials home.
-- `hardware` holds the static device/sensor config (board, ADC, channels).
CREATE TABLE bedside_nodes (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        TEXT NOT NULL,
    hostname    TEXT,
    ip_address  TEXT,
    location    TEXT,
    status      TEXT NOT NULL DEFAULT 'offline',  -- online | offline | unknown
    last_seen   TIMESTAMPTZ,
    hardware    JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Physical beds — one Pi per bed ───────────────────────────────────────────
CREATE TABLE beds (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    label      TEXT NOT NULL UNIQUE,
    node_id    UUID UNIQUE REFERENCES bedside_nodes(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Patient ↔ bed history (encounters) ───────────────────────────────────────
-- patient_answer_id references the patient's survey answer (demographics).
-- ended_at IS NULL ⇒ the assignment is currently active.
CREATE TABLE bed_assignments (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_answer_id UUID NOT NULL REFERENCES survey_answers(id) ON DELETE CASCADE,
    bed_id            UUID NOT NULL REFERENCES beds(id) ON DELETE CASCADE,
    started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at          TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- At most one active assignment per bed, and per patient.
CREATE UNIQUE INDEX uq_active_bed     ON bed_assignments (bed_id)            WHERE ended_at IS NULL;
CREATE UNIQUE INDEX uq_active_patient ON bed_assignments (patient_answer_id) WHERE ended_at IS NULL;

-- ── Per-patient data file (HDF5 stream target) ───────────────────────────────
-- One file per patient, minted by the app on patient creation (MinIO + files row).
CREATE TABLE patient_files (
    patient_answer_id UUID PRIMARY KEY REFERENCES survey_answers(id) ON DELETE CASCADE,
    file_id           UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ── Seed: the current Pi + its bed ───────────────────────────────────────────
-- ⚠ PLACEHOLDER VALUES — replace name/hostname/ip_address/location with the
--   real Pi details (these are editable seeds, hardcoded UUIDs so they're stable).
INSERT INTO bedside_nodes (id, name, hostname, ip_address, location, status, hardware) VALUES
    ('c51c1e5f-5cc1-4b77-8832-2d10cc97b001', 'pi-bedside-01', 'pi-bedside-01.local', '192.168.1.50', 'ICU - Bed 1', 'offline',
     '{"board": "Raspberry Pi 4", "adc": "Waveshare ADS1256", "channels": 8}')
ON CONFLICT (id) DO NOTHING;

INSERT INTO beds (id, label, node_id) VALUES
    ('c51c1e5f-5cc1-4b77-8832-2d10cc97b101', 'Bed 1', 'c51c1e5f-5cc1-4b77-8832-2d10cc97b001')
ON CONFLICT (id) DO NOTHING;

-- #endregion
