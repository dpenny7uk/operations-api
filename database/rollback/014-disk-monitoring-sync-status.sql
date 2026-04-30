BEGIN;

-- Rollback: 014-disk-monitoring-sync-status.sql
-- Removes the solarwinds_disks row from system.sync_status.
--
-- WARNING: After rollback, the disk sync (sync/disks/sync_solarwinds_disks.py)
-- will continue to run on its 15-min cron, but every run's SyncContext UPDATE
-- against sync_status will affect 0 rows — meaning the Health page's Sync
-- statuses table will not show the disk sync, and consecutive_failures will
-- not accumulate. Disable ops-sync-disks in ADO if you don't want the sync
-- running silently while the row is gone.

DELETE FROM system.sync_status WHERE sync_name = 'solarwinds_disks';

DELETE FROM system.schema_migrations WHERE script_name = '014-disk-monitoring-sync-status.sql';

COMMIT;
