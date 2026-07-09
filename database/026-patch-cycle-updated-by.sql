-- Operations Platform - Attribute patch-cycle status changes
--
-- patch_cycles recorded created_by but nothing for later status changes, so a
-- cancel/complete via PATCH /api/patching/cycles/{id}/status left no trace of who
-- acted. This adds updated_by, written by PatchingService.UpdateCycleStatusAsync
-- (which already sets updated_at). Existing rows get updated_by = NULL until the
-- next status change.
--
-- Column inherits the table's existing ops_api grants (no new GRANT needed).
-- Idempotent: ADD COLUMN IF NOT EXISTS, wrapped in a txn. Paired rollback.

BEGIN;

ALTER TABLE patching.patch_cycles ADD COLUMN IF NOT EXISTS updated_by VARCHAR(255);

INSERT INTO system.schema_migrations (script_name, description)
VALUES (
    '026-patch-cycle-updated-by.sql',
    'Add updated_by to patch_cycles so cycle cancel/complete actions are attributed'
)
ON CONFLICT (script_name) DO NOTHING;

COMMIT;
