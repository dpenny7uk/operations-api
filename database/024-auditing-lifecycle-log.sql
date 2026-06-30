-- Operations Platform - Auditing: application lifecycle audit log (Surface 09)
-- Records who archived / restored / deleted / renamed an application and when, so
-- a governance audit can trace ownership changes. Deliberately has NO FK to
-- shared.applications: a hard-delete must NOT cascade away its own delete record,
-- and application_name is snapshotted so the trail is readable after the row is gone.
-- Idempotent; paired rollback.

BEGIN;

CREATE TABLE IF NOT EXISTS auditing.app_lifecycle_log (
    log_id           SERIAL PRIMARY KEY,
    application_id   INTEGER,                  -- no FK on purpose (survives hard delete)
    application_name VARCHAR(255),
    action           VARCHAR(20) NOT NULL,     -- archived / restored / deleted / unregistered / renamed
    actor            VARCHAR(255),
    detail           TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_app_lifecycle_app ON auditing.app_lifecycle_log (application_id);

-- ops_api reads + appends; ops_migrate owns. The blanket grant in 020 only covered
-- tables that existed then, so grant this one explicitly (table + its serial sequence).
GRANT SELECT, INSERT ON auditing.app_lifecycle_log TO ops_api;
GRANT USAGE, SELECT ON SEQUENCE auditing.app_lifecycle_log_log_id_seq TO ops_api;

INSERT INTO system.schema_migrations (script_name, description)
VALUES (
    '024-auditing-lifecycle-log.sql',
    'Auditing (09): app_lifecycle_log -- audit trail of archive/restore/delete/rename actions'
)
ON CONFLICT (script_name) DO NOTHING;

COMMIT;
