BEGIN;

REVOKE SELECT, INSERT, UPDATE ON patching.patch_exclusions FROM ops_api;
REVOKE SELECT, INSERT, UPDATE ON patching.exclusion_alerts FROM ops_api;
REVOKE USAGE ON SEQUENCE patching.patch_exclusions_exclusion_id_seq FROM ops_api;
REVOKE USAGE ON SEQUENCE patching.exclusion_alerts_alert_id_seq FROM ops_api;

UPDATE system.schema_migrations
SET rolled_back_at = CURRENT_TIMESTAMP,
    rolled_back_by = CURRENT_USER
WHERE script_name = '011-patch-exclusion-grants.sql';

COMMIT;
