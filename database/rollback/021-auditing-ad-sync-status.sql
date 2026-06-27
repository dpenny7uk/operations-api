BEGIN;

-- Rollback: 021-auditing-ad-sync-status.sql
-- Removes the auditing_ad_sync health-dashboard row and its migration record.

DELETE FROM system.sync_status WHERE sync_name = 'auditing_ad_sync';

DELETE FROM system.schema_migrations WHERE script_name = '021-auditing-ad-sync-status.sql';

COMMIT;
