BEGIN;

-- Rollback: 028-patch-schedule-delete-grant.sql
-- Revokes DELETE on patching.patch_schedule from ops_api. Only run this if the
-- onprem cycle-pruning DELETE in sync_patching_schedule.process_servers has also
-- been reverted; otherwise the sync will fail with permission denied again.

REVOKE DELETE ON patching.patch_schedule FROM ops_api;

DELETE FROM system.schema_migrations WHERE script_name = '028-patch-schedule-delete-grant.sql';

COMMIT;
