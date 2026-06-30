BEGIN;

-- Rollback: 024-auditing-lifecycle-log.sql

DROP TABLE IF EXISTS auditing.app_lifecycle_log;

DELETE FROM system.schema_migrations WHERE script_name = '024-auditing-lifecycle-log.sql';

COMMIT;
