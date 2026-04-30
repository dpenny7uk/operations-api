-- Operations Platform - Seed solarwinds_disks row in system.sync_status
--
-- The disk sync (sync/disks/sync_solarwinds_disks.py) runs every 15 min from
-- ops-sync-disks.yml but didn't appear on the Health page's "Sync statuses"
-- table. Root cause: SyncContext only UPDATEs system.sync_status, so a sync
-- needs a pre-seeded row to show up + accumulate consecutive_failures.
--
-- Idempotent — safe to re-run.

BEGIN;

INSERT INTO system.sync_status (sync_name, sync_type, expected_schedule, max_age_hours, min_expected_records)
VALUES
    ('solarwinds_disks', 'scheduled', 'Every 15 min', 1, 1000)
ON CONFLICT (sync_name) DO NOTHING;

INSERT INTO system.schema_migrations (script_name, description)
VALUES ('014-disk-monitoring-sync-status.sql', 'Seed solarwinds_disks row in sync_status so the 15-min disk sync appears on the health dashboard and accumulates consecutive_failures on error')
ON CONFLICT (script_name) DO NOTHING;

COMMIT;
