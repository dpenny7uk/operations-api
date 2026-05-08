BEGIN;

-- Rollback: 015-disk-current-matview.sql
-- Reverts the disk_current matview back to the plain VIEW from migration 013,
-- drops the SECURITY DEFINER functions, and restores the original solarwinds_disks
-- sync_status row.
--
-- WARNING: After rollback, /api/disks and /api/disks/summary will resume
-- timing out under any non-trivial snapshots-table size, because each read
-- will reissue the DISTINCT ON aggregation. Disable the disk-cleanup pipeline
-- (ops-cleanup-disk-snapshots) before rollback so a stale schedule does not
-- call a function that no longer exists.
--
-- The sync's refresh_disk_current() helper is defensive — when the function
-- vanishes, psycopg2 raises and the sync warns + continues, so no app-side
-- rollback is required.

-- Drop the SECURITY DEFINER wrappers first; the matview drop is independent
-- but they reference the schema, so order is purely cosmetic.
DROP FUNCTION IF EXISTS monitoring.cleanup_disk_snapshots(INTEGER);
DROP FUNCTION IF EXISTS monitoring.refresh_disk_current();

-- Replace the matview with the original view definition from 013.
DROP MATERIALIZED VIEW IF EXISTS monitoring.disk_current;

CREATE OR REPLACE VIEW monitoring.disk_current AS
SELECT DISTINCT ON (server_name, disk_label) *
FROM monitoring.disk_snapshots
ORDER BY server_name, disk_label, captured_at DESC;

GRANT SELECT ON monitoring.disk_current TO ops_api;

-- Restore the original sync_status row to its 15-min cadence values.
UPDATE system.sync_status
SET expected_schedule = 'Every 15 min',
    max_age_hours = 1
WHERE sync_name = 'solarwinds_disks';

DELETE FROM system.schema_migrations WHERE script_name = '015-disk-current-matview.sql';

COMMIT;
