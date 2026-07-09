-- Operations Platform - Attribute patch-exclusion edits
--
-- Extending or editing an exclusion (ExtendExclusionAsync / UpdateExclusionAsync)
-- overwrote excluded_by with whoever made the edit, erasing who originally excluded
-- the server. This adds updated_by: excluded_by/excluded_at now stay pinned to the
-- original exclusion, and edits stamp updated_by (alongside the existing updated_at).
-- Existing rows get updated_by = NULL until their next edit.
--
-- Column inherits the table's existing ops_api grants (no new GRANT needed).
-- Idempotent: ADD COLUMN IF NOT EXISTS, wrapped in a txn. Paired rollback.

BEGIN;

ALTER TABLE patching.patch_exclusions ADD COLUMN IF NOT EXISTS updated_by VARCHAR(255);

INSERT INTO system.schema_migrations (script_name, description)
VALUES (
    '027-patch-exclusion-updated-by.sql',
    'Add updated_by to patch_exclusions so edits stop overwriting the original excluded_by'
)
ON CONFLICT (script_name) DO NOTHING;

COMMIT;
