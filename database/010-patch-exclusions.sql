-- Patch Exclusion Management
-- Allows ops team to exclude servers from patching cycles with a reason and hold date.
-- Tracks exclusion history via soft-delete and sends Teams alerts when holds expire.
-- This migration is idempotent — safe to re-run.

BEGIN;

-- ========================================================================
-- Table: patching.patch_exclusions
-- ========================================================================

CREATE TABLE IF NOT EXISTS patching.patch_exclusions (
    exclusion_id    SERIAL PRIMARY KEY,

    -- Server link (denormalized server_name for display convenience)
    server_id       INTEGER NOT NULL REFERENCES shared.servers(server_id) ON DELETE CASCADE,
    server_name     VARCHAR(255) NOT NULL,

    -- Exclusion details
    reason          TEXT NOT NULL,
    held_until      DATE NOT NULL,

    -- Audit: who created / removed
    excluded_by     VARCHAR(255) NOT NULL,
    excluded_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    removed_by      VARCHAR(255),
    removed_at      TIMESTAMPTZ,

    -- Standard timestamps
    created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Only one active exclusion per server at a time
CREATE UNIQUE INDEX IF NOT EXISTS idx_exclusion_active_server
    ON patching.patch_exclusions(server_id)
    WHERE is_active;

-- Alert query: find active exclusions whose hold date has passed
CREATE INDEX IF NOT EXISTS idx_exclusion_held_until
    ON patching.patch_exclusions(held_until)
    WHERE is_active;

-- General active exclusion lookup
CREATE INDEX IF NOT EXISTS idx_exclusion_active
    ON patching.patch_exclusions(is_active)
    WHERE is_active;

SELECT system.create_updated_at_trigger('patching', 'patch_exclusions');

-- ========================================================================
-- Table: patching.exclusion_alerts
-- Deduplication for Teams notifications (follows certificates.alerts pattern)
-- ========================================================================

CREATE TABLE IF NOT EXISTS patching.exclusion_alerts (
    alert_id            SERIAL PRIMARY KEY,
    exclusion_id        INTEGER NOT NULL REFERENCES patching.patch_exclusions(exclusion_id) ON DELETE CASCADE,
    alert_type          VARCHAR(50) NOT NULL DEFAULT 'hold_expired_teams',
    alert_message       TEXT,
    notification_sent   BOOLEAN NOT NULL DEFAULT FALSE,
    notification_sent_at TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_excl_alert_exclusion
    ON patching.exclusion_alerts(exclusion_id);

-- ========================================================================
-- View: patching.v_active_exclusions
-- Convenience view joining to shared.servers for environment
-- ========================================================================

CREATE OR REPLACE VIEW patching.v_active_exclusions AS
SELECT
    pe.exclusion_id,
    pe.server_id,
    pe.server_name,
    s.environment,
    pe.reason,
    pe.held_until,
    pe.excluded_by,
    pe.excluded_at,
    (pe.held_until <= CURRENT_DATE) AS hold_expired
FROM patching.patch_exclusions pe
LEFT JOIN shared.servers s ON pe.server_id = s.server_id
WHERE pe.is_active
ORDER BY pe.held_until, pe.server_name;

-- ========================================================================
-- Permissions: ops_api needs read + write for exclusion management
-- ========================================================================

GRANT SELECT, INSERT, UPDATE ON patching.patch_exclusions TO ops_api;
GRANT SELECT, INSERT, UPDATE ON patching.exclusion_alerts TO ops_api;
GRANT USAGE ON SEQUENCE patching.patch_exclusions_exclusion_id_seq TO ops_api;
GRANT USAGE ON SEQUENCE patching.exclusion_alerts_alert_id_seq TO ops_api;

-- ========================================================================
-- Migration tracking
-- ========================================================================

INSERT INTO system.schema_migrations (script_name, description)
VALUES ('010-patch-exclusions.sql', 'Patch exclusion management with hold dates and alerts')
ON CONFLICT (script_name) DO NOTHING;

COMMIT;
