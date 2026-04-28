BEGIN;

-- Rollback: 013-monitoring-schema.sql
-- Drops the monitoring schema and all its contents.
--
-- WARNING: This will delete ALL disk snapshot history (monitoring.disk_snapshots),
-- the disk_current view, and the Teams-alert log (monitoring.alerts) including
-- cooldown state and resolution markers. Ensure a database backup exists before
-- running, and disable both ADO pipelines (ops-sync-disks, ops-alert-disk-breaches)
-- to prevent the next sync run from reinserting partial data.

DROP SCHEMA IF EXISTS monitoring CASCADE;

DELETE FROM system.schema_migrations WHERE script_name = '013-monitoring-schema.sql';

COMMIT;
