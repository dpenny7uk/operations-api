-- Operations Platform - Auditing: one open campaign per application (Surface 09)
-- Enforces at most one open (draft/active) campaign per application so a
-- double-launch can't create duplicate packets/emails or fork the audit trail.
-- CampaignService.LaunchAsync also pre-checks; this partial unique index is the
-- race-safe backstop. Idempotent; paired rollback.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_one_open_per_app
    ON auditing.campaigns (application_id)
    WHERE status IN ('draft', 'active');

INSERT INTO system.schema_migrations (script_name, description)
VALUES (
    '022-auditing-one-open-campaign.sql',
    'Auditing (09): partial unique index - at most one open (draft/active) campaign per application'
)
ON CONFLICT (script_name) DO NOTHING;

COMMIT;
