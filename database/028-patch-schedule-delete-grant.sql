-- 028-patch-schedule-delete-grant.sql
-- b99ae13 added onprem cycle-pruning (DELETE) to sync_patching_schedule.py, but
-- patch_schedule was only granted SELECT/INSERT/UPDATE. Idempotent — safe to re-run.
BEGIN;
GRANT DELETE ON patching.patch_schedule TO ops_api;
INSERT INTO system.schema_migrations (script_name, description)
VALUES ('028-patch-schedule-delete-grant.sql', 'Grant ops_api DELETE on patch_schedule for cycle pruning');
COMMIT;