-- Operations Platform - Register the Auditing AD membership sync (Surface 09, Slice 5)
-- Adds a system.sync_status row so the AD membership sync (auditing_ad_sync)
-- surfaces on the health dashboard with the rest of the syncs. The sync itself
-- works without this row (SyncContext tolerates a missing row), so this is
-- health-visibility only. Mirrors 014-disk-monitoring-sync-status.sql.
-- Idempotent; paired rollback.

BEGIN;

INSERT INTO system.sync_status (sync_name, sync_type, expected_schedule, max_age_hours, min_expected_records)
VALUES ('auditing_ad_sync', 'scheduled', 'Daily 5:00 AM', 26, 0)
ON CONFLICT (sync_name) DO NOTHING;

INSERT INTO system.schema_migrations (script_name, description)
VALUES (
    '021-auditing-ad-sync-status.sql',
    'Auditing (09): register the AD membership sync (auditing_ad_sync) on the health dashboard'
)
ON CONFLICT (script_name) DO NOTHING;

COMMIT;
