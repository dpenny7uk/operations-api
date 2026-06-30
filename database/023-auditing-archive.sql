-- Operations Platform - Auditing: application archive lifecycle (Surface 09)
-- Adds audit_status to shared.applications so a retired/decommissioned app can be
-- archived (preserving its attestation history) instead of unregistered. Archived
-- apps stay registered but move to the Archived tab, drop out of the active counts,
-- and cannot launch campaigns (CampaignService.LaunchAsync guards on this).
-- Idempotent; paired rollback.

BEGIN;

ALTER TABLE shared.applications ADD COLUMN IF NOT EXISTS audit_status VARCHAR(20) NOT NULL DEFAULT 'active';

-- Named CHECK on audit_status. PG has no ADD CONSTRAINT IF NOT EXISTS, so guard
-- against re-runs by swallowing duplicate_object.
DO $$ BEGIN
    ALTER TABLE shared.applications
        ADD CONSTRAINT chk_app_audit_status CHECK (audit_status IN ('active', 'archived'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

INSERT INTO system.schema_migrations (script_name, description)
VALUES (
    '023-auditing-archive.sql',
    'Auditing (09): add audit_status (active/archived) to shared.applications for the archive/retire lifecycle'
)
ON CONFLICT (script_name) DO NOTHING;

COMMIT;
