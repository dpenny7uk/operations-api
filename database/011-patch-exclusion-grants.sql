-- Grant ops_api access to patch exclusion tables
-- Migration 010 created the tables as ops_migrate but did not grant access to ops_api.
-- ALTER DEFAULT PRIVILEGES only applies to tables created by the role that ran it,
-- so tables created by ops_migrate need explicit grants.
-- This migration is idempotent — safe to re-run.

BEGIN;

GRANT SELECT, INSERT, UPDATE ON patching.patch_exclusions TO ops_api;
GRANT SELECT, INSERT, UPDATE ON patching.exclusion_alerts TO ops_api;
GRANT USAGE ON SEQUENCE patching.patch_exclusions_exclusion_id_seq TO ops_api;
GRANT USAGE ON SEQUENCE patching.exclusion_alerts_alert_id_seq TO ops_api;

INSERT INTO system.schema_migrations (script_name, description)
VALUES ('011-patch-exclusion-grants.sql', 'Grant ops_api access to patch exclusion tables')
ON CONFLICT (script_name) DO NOTHING;

COMMIT;
