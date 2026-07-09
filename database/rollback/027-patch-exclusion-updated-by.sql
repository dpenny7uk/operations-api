BEGIN;

-- Rollback: 027-patch-exclusion-updated-by.sql
-- Drops the updated_by editor-attribution column from patch_exclusions. Any editor
-- attribution captured since the forward migration is discarded (excluded_by is
-- unaffected).

ALTER TABLE patching.patch_exclusions DROP COLUMN IF EXISTS updated_by;

DELETE FROM system.schema_migrations WHERE script_name = '027-patch-exclusion-updated-by.sql';

COMMIT;
