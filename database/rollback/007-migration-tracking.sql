BEGIN;

-- Rollback: 007-migration-tracking.sql
-- Removes the migration tracking table and helper function.

DROP FUNCTION IF EXISTS system.check_pending_migrations(TEXT[]);
DROP TABLE IF EXISTS system.schema_migrations;

COMMIT;
