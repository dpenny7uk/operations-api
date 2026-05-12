-- Rollback for 017-unmatched-eol-software.sql

BEGIN;

DROP FUNCTION IF EXISTS eol.record_unmatched_software(VARCHAR, VARCHAR, VARCHAR, VARCHAR);
DROP TABLE IF EXISTS eol.unmatched_software;

DELETE FROM system.schema_migrations
WHERE script_name = '017-unmatched-eol-software.sql';

COMMIT;
