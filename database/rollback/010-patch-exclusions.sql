BEGIN;

DROP VIEW IF EXISTS patching.v_active_exclusions;
DROP TABLE IF EXISTS patching.exclusion_alerts;
DROP TABLE IF EXISTS patching.patch_exclusions;

UPDATE system.schema_migrations
SET rolled_back_at = CURRENT_TIMESTAMP,
    rolled_back_by = CURRENT_USER
WHERE script_name = '010-patch-exclusions.sql';

COMMIT;
