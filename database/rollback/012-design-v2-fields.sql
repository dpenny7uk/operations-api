-- Rollback for 012-design-v2-fields.sql
-- Drops the new columns and reverts the active-exclusions view.

BEGIN;

-- Revert view to the original 010 shape
CREATE OR REPLACE VIEW patching.v_active_exclusions AS
SELECT
    pe.exclusion_id,
    pe.server_id,
    pe.server_name,
    s.environment,
    pe.reason,
    pe.held_until,
    pe.excluded_by,
    pe.excluded_at,
    (pe.held_until <= CURRENT_DATE) AS hold_expired
FROM patching.patch_exclusions pe
LEFT JOIN shared.servers s ON pe.server_id = s.server_id
WHERE pe.is_active
ORDER BY pe.held_until, pe.server_name;

ALTER TABLE patching.patch_exclusions DROP COLUMN IF EXISTS ticket;
ALTER TABLE patching.patch_exclusions DROP COLUMN IF EXISTS reason_slug;
ALTER TABLE patching.patch_exclusions DROP COLUMN IF EXISTS notes;

ALTER TABLE shared.servers DROP COLUMN IF EXISTS service;
ALTER TABLE shared.servers DROP COLUMN IF EXISTS func;
ALTER TABLE shared.servers DROP COLUMN IF EXISTS last_seen_at;

DELETE FROM system.schema_migrations WHERE script_name = '012-design-v2-fields.sql';

COMMIT;
