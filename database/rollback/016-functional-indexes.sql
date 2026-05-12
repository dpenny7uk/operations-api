-- Rollback for 016-functional-indexes.sql
-- Drops the three UPPER() functional indexes. Safe to re-run.

BEGIN;

DROP INDEX IF EXISTS shared.idx_srv_name_upper;
DROP INDEX IF EXISTS certificates.idx_cert_name_upper;
DROP INDEX IF EXISTS eol.idx_eol_machine_upper;

DELETE FROM system.schema_migrations
WHERE script_name = '016-functional-indexes.sql';

COMMIT;
