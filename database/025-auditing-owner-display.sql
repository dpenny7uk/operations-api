-- Operations Platform - Auditing: cache owner display names (Surface 09)
-- business_owner / technical_owner store the sAMAccountName (used as a routing key,
-- e.g. the line-manager fallback recipient). These columns cache the picked AD
-- display name so the UI can show "Jay Bishop" instead of "bishopj" without the
-- owner needing to be a synced group member. Mirrors application_nominees, which
-- already caches nominee_display_name. Idempotent; paired rollback.

BEGIN;

ALTER TABLE shared.applications ADD COLUMN IF NOT EXISTS business_owner_display  VARCHAR(255);
ALTER TABLE shared.applications ADD COLUMN IF NOT EXISTS technical_owner_display VARCHAR(255);

INSERT INTO system.schema_migrations (script_name, description)
VALUES (
    '025-auditing-owner-display.sql',
    'Auditing (09): cache business/technical owner display names on shared.applications'
)
ON CONFLICT (script_name) DO NOTHING;

COMMIT;
