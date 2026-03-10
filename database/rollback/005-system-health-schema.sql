BEGIN;

-- Rollback: 005-system-health-schema.sql
-- Drops all objects added to the system schema by this script.
-- Does NOT drop the system schema itself (created by 001-common.sql).
--
-- WARNING: This will delete ALL sync history, validation rules and results,
-- server name aliases, unmatched servers, and scan failure records.
-- Ensure a database backup exists before running.
-- Run BEFORE rolling back 004-patching-schema.sql.

-- Views (must match forward migration exactly)
DROP VIEW IF EXISTS system.v_unmatched_pending;
DROP VIEW IF EXISTS system.v_health_summary;
DROP VIEW IF EXISTS system.v_unreachable_servers;

-- Functions (signatures must match forward migration for PostgreSQL to find them)
DROP FUNCTION IF EXISTS system.purge_old_sync_history(INTEGER);
DROP FUNCTION IF EXISTS system.run_validation(VARCHAR);
DROP FUNCTION IF EXISTS system.record_unmatched_server(VARCHAR, VARCHAR, VARCHAR);
DROP FUNCTION IF EXISTS system.resolve_server_name(TEXT);
DROP FUNCTION IF EXISTS system.clear_scan_failure(VARCHAR, VARCHAR);
DROP FUNCTION IF EXISTS system.record_scan_failure(VARCHAR, VARCHAR, TEXT, VARCHAR);

-- Tables (ordered to respect FK constraints)
DROP TABLE IF EXISTS system.validation_results CASCADE;
DROP TABLE IF EXISTS system.validation_rules CASCADE;
DROP TABLE IF EXISTS system.server_aliases CASCADE;
DROP TABLE IF EXISTS system.unmatched_servers CASCADE;
DROP TABLE IF EXISTS system.scan_failures CASCADE;
DROP TABLE IF EXISTS system.sync_history CASCADE;
DROP TABLE IF EXISTS system.sync_status CASCADE;

COMMIT;
