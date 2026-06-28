BEGIN;

-- Rollback: 022-auditing-one-open-campaign.sql

DROP INDEX IF EXISTS auditing.idx_campaign_one_open_per_app;

DELETE FROM system.schema_migrations WHERE script_name = '022-auditing-one-open-campaign.sql';

COMMIT;
