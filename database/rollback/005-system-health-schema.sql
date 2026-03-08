BEGIN;

-- Rollback: 005-system-health-schema.sql
-- Drops all objects added to the system schema by this script.
-- Does NOT drop the system schema itself (created by 001-common.sql).
--
-- WARNING: This will delete ALL sync history, validation rules and results,
-- server name aliases, unmatched servers, and scan failure records.
-- Ensure a database backup exists before running.
-- Run BEFORE rolling back 004-patching-schema.sql.

-- Views
DROP VIEW IF EXISTS system.v_health_summary;
DROP VIEW IF EXISTS system.v_recent_syncs;
DROP VIEW IF EXISTS system.v_sync_health;

-- Functions
DROP FUNCTION IF EXISTS system.run_validation(VARCHAR);
DROP FUNCTION IF EXISTS system.record_unmatched_server(TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS system.resolve_server_name(TEXT);

-- Tables (ordered to respect FK constraints)
DROP TABLE IF EXISTS system.validation_results CASCADE;
DROP TABLE IF EXISTS system.validation_rules CASCADE;
DROP TABLE IF EXISTS system.server_name_aliases CASCADE;
DROP TABLE IF EXISTS system.unmatched_servers CASCADE;
DROP TABLE IF EXISTS system.scan_failures CASCADE;
DROP TABLE IF EXISTS system.sync_history CASCADE;
DROP TABLE IF EXISTS system.sync_status CASCADE;

COMMIT;
