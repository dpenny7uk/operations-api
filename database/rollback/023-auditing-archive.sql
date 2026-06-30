BEGIN;

-- Rollback: 023-auditing-archive.sql
-- Drops the audit_status column (and its CHECK, via the column drop) from
-- shared.applications. Any archived apps revert to indistinguishable-from-active.

ALTER TABLE shared.applications DROP COLUMN IF EXISTS audit_status;

DELETE FROM system.schema_migrations WHERE script_name = '023-auditing-archive.sql';

COMMIT;
