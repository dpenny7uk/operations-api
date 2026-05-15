-- Operations Platform - Track installed software that did not match any
-- entry in sync_eol_software.py's SOFTWARE_PATTERNS catalogue.
--
-- Background: 11,757 of 18,065 EOL records are skipped each run. These are
-- managed servers (post desktop-filter) whose installed-
-- software string doesn't match the 12 hardcoded regex patterns. Today they
-- are logged at INFO and silently discarded — so the dashboard's EOL coverage
-- is ~35% of reality and nobody can see what we're missing.
--
-- This migration:
--   1. Adds eol.unmatched_software — one row per distinct (raw_software_name,
--      source_system), aggregating occurrence_count + first/last_seen_at.
--      Mirrors the system.unmatched_servers shape (005-system-health-schema.sql).
--   2. Adds eol.record_unmatched_software(...) — INSERT ... ON CONFLICT DO
--      UPDATE wrapper. Called from sync/eol/sync_eol_software.py for each
--      skipped record. Skips bookkeeping when status is 'ignored' or 'mapped'
--      so resolved entries don't get reopened by every nightly run.
--   3. Grants the api + sync access patterns matching the rest of the schema.
--
-- Idempotent.

BEGIN;

-- ========================================================================
-- Table: eol.unmatched_software
-- ========================================================================

CREATE TABLE IF NOT EXISTS eol.unmatched_software (
    unmatched_id            SERIAL PRIMARY KEY,
    raw_software_name       VARCHAR(500) NOT NULL,
    raw_software_version    VARCHAR(255),
    source_system           VARCHAR(100) NOT NULL DEFAULT 'databricks',
    sample_machine_name     VARCHAR(255),
    status                  VARCHAR(20) NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'ignored', 'mapped')),
    first_seen_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    occurrence_count        INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT uq_unmatched_software UNIQUE (raw_software_name, source_system)
);

CREATE INDEX IF NOT EXISTS idx_unmatched_software_status
    ON eol.unmatched_software(status);
-- Top-N work list: pending entries ordered by frequency (where catalogue
-- expansion has the highest payoff). Partial index keeps it small.
CREATE INDEX IF NOT EXISTS idx_unmatched_software_pending_freq
    ON eol.unmatched_software(occurrence_count DESC)
    WHERE status = 'pending';

-- ========================================================================
-- Function: eol.record_unmatched_software
-- Idempotent upsert called by sync_eol_software.py per skipped record.
-- ========================================================================

CREATE OR REPLACE FUNCTION eol.record_unmatched_software(
    p_software_name VARCHAR(500),
    p_source        VARCHAR(100) DEFAULT 'databricks',
    p_version       VARCHAR(255) DEFAULT NULL,
    p_machine       VARCHAR(255) DEFAULT NULL
)
RETURNS INTEGER AS $$
DECLARE
    v_id INTEGER;
BEGIN
    INSERT INTO eol.unmatched_software
        (raw_software_name, raw_software_version, source_system, sample_machine_name)
    VALUES
        (p_software_name, p_version, p_source, p_machine)
    ON CONFLICT (raw_software_name, source_system) DO UPDATE SET
        last_seen_at         = CURRENT_TIMESTAMP,
        occurrence_count     = eol.unmatched_software.occurrence_count + 1,
        -- Preserve the first version/machine we saw; don't churn them.
        raw_software_version = COALESCE(eol.unmatched_software.raw_software_version, EXCLUDED.raw_software_version),
        sample_machine_name  = COALESCE(eol.unmatched_software.sample_machine_name,  EXCLUDED.sample_machine_name)
    WHERE eol.unmatched_software.status = 'pending'
    RETURNING unmatched_id INTO v_id;
    RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- ========================================================================
-- Grants
-- ========================================================================

GRANT SELECT, INSERT, UPDATE ON eol.unmatched_software TO ops_api;
GRANT USAGE ON SEQUENCE eol.unmatched_software_unmatched_id_seq TO ops_api;
GRANT EXECUTE ON FUNCTION eol.record_unmatched_software(VARCHAR, VARCHAR, VARCHAR, VARCHAR) TO ops_api;

-- ========================================================================
-- Migration tracking
-- ========================================================================

INSERT INTO system.schema_migrations (script_name, description)
VALUES (
    '017-unmatched-eol-software.sql',
    'Track installed software that did not match SOFTWARE_PATTERNS — work list for catalogue expansion'
)
ON CONFLICT (script_name) DO NOTHING;

COMMIT;
