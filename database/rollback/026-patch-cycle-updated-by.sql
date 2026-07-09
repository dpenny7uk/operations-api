BEGIN;

-- Rollback: 026-patch-cycle-updated-by.sql
-- Drops the updated_by attribution column from patch_cycles. Any attribution
-- captured since the forward migration is discarded.

ALTER TABLE patching.patch_cycles DROP COLUMN IF EXISTS updated_by;

DELETE FROM system.schema_migrations WHERE script_name = '026-patch-cycle-updated-by.sql';

COMMIT;
