-- Migration Tracking & Rollback Strategy
-- Records which database scripts have been applied and supports rollback metadata.

CREATE TABLE IF NOT EXISTS system.schema_migrations (
    migration_id    SERIAL PRIMARY KEY,
    script_name     VARCHAR(255) NOT NULL UNIQUE,
    checksum        VARCHAR(64),
    applied_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    applied_by      VARCHAR(100) NOT NULL DEFAULT CURRENT_USER,
    execution_ms    INT,
    rolled_back_at  TIMESTAMPTZ,
    rolled_back_by  VARCHAR(100),
    description     TEXT
);

CREATE INDEX IF NOT EXISTS idx_migrations_applied
    ON system.schema_migrations(applied_at DESC);

-- Seed with existing scripts so the tracker reflects current state.
-- ON CONFLICT ensures idempotency — safe to re-run.
INSERT INTO system.schema_migrations (script_name, description) VALUES
    ('000-extensions.sql',          'PostgreSQL extensions (fuzzystrmatch)'),
    ('001-common.sql',              'Common types, domains, and utility functions'),
    ('002-shared-schema.sql',       'Shared server inventory schema'),
    ('003-certificates-schema.sql', 'Certificate monitoring schema'),
    ('004-patching-schema.sql',     'Patching schedule and known issues schema'),
    ('005-system-health-schema.sql','System health, sync tracking, and validation schema'),
    ('006-eol-schema.sql',          'End-of-life software tracking schema'),
    ('007-migration-tracking.sql',  'Migration tracking table (this script)')
ON CONFLICT (script_name) DO NOTHING;


-- ========================================================================
-- ROLLBACK STRATEGY
-- ========================================================================
--
-- Each numbered migration script should have a corresponding rollback
-- script in database/rollback/ that reverses its changes. Naming:
--
--   007-migration-tracking.sql        <- forward migration
--   rollback/007-migration-tracking.sql  <- rollback script
--
-- Rollback procedure:
--   1. Run the rollback script:
--        psql -f database/rollback/NNN-script-name.sql
--   2. Mark the migration as rolled back:
--        UPDATE system.schema_migrations
--        SET rolled_back_at = CURRENT_TIMESTAMP,
--            rolled_back_by = CURRENT_USER
--        WHERE script_name = 'NNN-script-name.sql';
--
-- Pre-deployment checklist function:
-- ========================================================================

CREATE OR REPLACE FUNCTION system.check_pending_migrations(expected_scripts TEXT[])
RETURNS TABLE (
    script_name TEXT,
    status TEXT
) LANGUAGE sql STABLE AS $$
    -- Returns each expected script and whether it has been applied or is pending.
    SELECT
        s.script,
        CASE
            WHEN m.script_name IS NOT NULL AND m.rolled_back_at IS NULL THEN 'applied'
            WHEN m.script_name IS NOT NULL AND m.rolled_back_at IS NOT NULL THEN 'rolled_back'
            ELSE 'pending'
        END AS status
    FROM unnest(expected_scripts) AS s(script)
    LEFT JOIN system.schema_migrations m ON m.script_name = s.script
    ORDER BY s.script;
$$;
