-- Operations Platform - Functional indexes for UPPER(server_name) joins
--
-- Background: API and sync queries join on UPPER(server_name) = UPPER(server_name)
-- across [CertificateService.cs], [EolService.cs], sync_certificates.py, and
-- alert_cert_expiry.py. The existing btree indexes on the raw column cannot
-- serve those predicates, so the planner falls back to seq scan + hash join.
-- That bites under realistic cardinality (1,800+ unreachable servers, thousands
-- of certs).
--
-- These functional indexes let the planner use index scan / hash join with
-- pre-computed UPPER() values. No application code changes required — the
-- planner picks them up automatically.
--
-- This is a bridge fix. The follow-up workstream normalises server_name at
-- source (lowercase on write in the sync scripts) and drops the UPPER()
-- predicates entirely.
--
-- Idempotent: CREATE INDEX IF NOT EXISTS wrapped in BEGIN/COMMIT.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_srv_name_upper
    ON shared.servers (UPPER(server_name));

CREATE INDEX IF NOT EXISTS idx_cert_name_upper
    ON certificates.inventory (UPPER(server_name));

CREATE INDEX IF NOT EXISTS idx_eol_machine_upper
    ON eol.end_of_life_software (UPPER(machine_name));

INSERT INTO system.schema_migrations (script_name, description)
VALUES (
    '016-functional-indexes.sql',
    'Functional UPPER() indexes on server_name / machine_name to support case-insensitive joins until source normalisation lands'
)
ON CONFLICT (script_name) DO NOTHING;

COMMIT;
