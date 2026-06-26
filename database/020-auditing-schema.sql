-- Operations Platform - Auditing Schema (Surface 09, Governance group)
-- Application access attestation / recertification. An OpsAdmin registers an
-- application + the AD groups that gate it + a routing mode; campaigns then ask
-- each recipient (line manager OR nominee) to keep/revoke every member, with a
-- full audit trail (decisions, every email logged, audit mailbox CC'd).
--
-- Build is phased. THIS migration creates the WHOLE auditing schema up front so
-- later slices (attestation, launch, email, AD sync) are pure code with no
-- further DDL. Slice 1 only reads/writes the management + read-only tables;
-- the AD-sync tables (ad_users, group_memberships, group_owners, auto_launch_log)
-- are created here but not populated until the AD-sync slice.
--
-- Mirrors 019-licensing-schema.sql: idempotent (safe to re-run), grants included
-- so ops_api can read+write, paired rollback under database/rollback/.
--
-- Field shapes match the Phase 0 frontend contract in
-- frontend/js/auditing-demo-data.js so the SPA cutover stays minimal.

BEGIN;

CREATE SCHEMA IF NOT EXISTS auditing;

-- ========================================================================
-- shared.applications -- per-app audit config (added columns)
-- business_owner / technical_owner / support_email already exist (002).
-- audit_routing_mode picks line_manager vs nominees; business_owner is reused
-- as the fallback recipient for line_manager subjects with no resolvable manager.
-- ========================================================================

ALTER TABLE shared.applications ADD COLUMN IF NOT EXISTS audit_frequency_months SMALLINT;
ALTER TABLE shared.applications ADD COLUMN IF NOT EXISTS auto_launch           BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE shared.applications ADD COLUMN IF NOT EXISTS audit_routing_mode    VARCHAR(20) NOT NULL DEFAULT 'line_manager';
ALTER TABLE shared.applications ADD COLUMN IF NOT EXISTS audit_due_period_days SMALLINT NOT NULL DEFAULT 21;

-- Named CHECK on audit_routing_mode. PG has no ADD CONSTRAINT IF NOT EXISTS, so
-- guard against re-runs by swallowing duplicate_object.
DO $$ BEGIN
    ALTER TABLE shared.applications
        ADD CONSTRAINT chk_app_routing_mode CHECK (audit_routing_mode IN ('line_manager', 'nominees'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ========================================================================
-- auditing.application_groups -- the AD groups that gate an application (bindings)
-- ========================================================================

CREATE TABLE IF NOT EXISTS auditing.application_groups (
    binding_id      SERIAL PRIMARY KEY,
    application_id  INTEGER NOT NULL REFERENCES shared.applications(application_id) ON DELETE CASCADE,
    group_dn        VARCHAR(500) NOT NULL,
    group_sam       VARCHAR(255),
    group_type      VARCHAR(20),                 -- 'Security' / 'DL' / 'M365'
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_by      VARCHAR(255),
    updated_by      VARCHAR(255),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- One active binding per (application, group_dn); re-binding after removal is allowed.
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_group_active
    ON auditing.application_groups (application_id, group_dn)
    WHERE is_active;

SELECT system.create_updated_at_trigger('auditing', 'application_groups');

-- ========================================================================
-- auditing.application_nominees -- picked recipients (nominees routing only)
-- ========================================================================

CREATE TABLE IF NOT EXISTS auditing.application_nominees (
    nominee_id           SERIAL PRIMARY KEY,
    application_id       INTEGER NOT NULL REFERENCES shared.applications(application_id) ON DELETE CASCADE,
    nominee_sam          VARCHAR(255) NOT NULL,
    nominee_display_name VARCHAR(255),
    nominee_email        VARCHAR(255),
    role_note            TEXT,                    -- e.g. 'Tech owner', 'Business owner'
    added_by             VARCHAR(255),
    added_at             TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE (application_id, nominee_sam)
);

-- ========================================================================
-- auditing.campaigns -- one attestation cycle per application
-- routing_mode / closure_mode / cc_audit_mailbox are snapshotted at launch so
-- later app-config changes never rewrite an in-flight campaign's behaviour.
-- ========================================================================

CREATE TABLE IF NOT EXISTS auditing.campaigns (
    campaign_id         SERIAL PRIMARY KEY,
    application_id      INTEGER NOT NULL REFERENCES shared.applications(application_id),
    name                VARCHAR(255) NOT NULL,
    status              VARCHAR(10) NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft', 'active', 'closed')),
    due_at              TIMESTAMPTZ,
    created_by          VARCHAR(255),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    closed_at           TIMESTAMPTZ,
    closed_by_packet_id UUID,                     -- which packet closed it (any_packet mode)
    launch_kind         VARCHAR(10),              -- 'manual' / 'auto'
    routing_mode        VARCHAR(20) NOT NULL,     -- snapshot of app.audit_routing_mode
    closure_mode        VARCHAR(15) NOT NULL
                            CHECK (closure_mode IN ('all_packets', 'any_packet')),
    cc_audit_mailbox    VARCHAR(255)
);

CREATE INDEX IF NOT EXISTS idx_campaign_application ON auditing.campaigns (application_id);
CREATE INDEX IF NOT EXISTS idx_campaign_status      ON auditing.campaigns (status);

-- ========================================================================
-- auditing.attestation_packets -- one per (campaign, recipient)
-- packet_id is a UUID (gen_random_uuid from pgcrypto, 000-extensions.sql); the
-- signed attestation link carries it. token_hash stores SHA-256(raw token) only.
-- ========================================================================

CREATE TABLE IF NOT EXISTS auditing.attestation_packets (
    packet_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id          INTEGER NOT NULL REFERENCES auditing.campaigns(campaign_id) ON DELETE CASCADE,
    recipient_sam        VARCHAR(255) NOT NULL,
    recipient_display_name VARCHAR(255),
    recipient_email      VARCHAR(255),
    recipient_kind       VARCHAR(15) NOT NULL
                            CHECK (recipient_kind IN ('manager', 'nominee')),
    role_note            TEXT,
    token_hash           BYTEA,
    token_expires_at     TIMESTAMPTZ,
    submitted_at         TIMESTAMPTZ,
    submitted_by_sam     VARCHAR(255),
    submitted_by_display VARCHAR(255),
    submitted_ip         INET,
    reminder_sent_at     TIMESTAMPTZ,

    UNIQUE (campaign_id, recipient_sam, recipient_kind)
);

CREATE INDEX IF NOT EXISTS idx_packet_campaign   ON auditing.attestation_packets (campaign_id);
CREATE INDEX IF NOT EXISTS idx_packet_token_hash ON auditing.attestation_packets (token_hash);

-- ========================================================================
-- auditing.attestation_packet_subjects -- who a packet is asking about
-- Snapshot at launch so later AD changes don't rewrite who was in scope.
-- ========================================================================

CREATE TABLE IF NOT EXISTS auditing.attestation_packet_subjects (
    packet_id            UUID NOT NULL REFERENCES auditing.attestation_packets(packet_id) ON DELETE CASCADE,
    subject_sam          VARCHAR(255) NOT NULL,
    subject_display_name VARCHAR(255),

    PRIMARY KEY (packet_id, subject_sam)
);

-- ========================================================================
-- auditing.attestation_decisions -- keep/revoke per subject, per packet
-- ========================================================================

CREATE TABLE IF NOT EXISTS auditing.attestation_decisions (
    decision_id     SERIAL PRIMARY KEY,
    packet_id       UUID NOT NULL REFERENCES auditing.attestation_packets(packet_id) ON DELETE CASCADE,
    subject_sam     VARCHAR(255) NOT NULL,
    subject_display VARCHAR(255),
    decision        VARCHAR(10) NOT NULL CHECK (decision IN ('keep', 'revoke')),
    decided_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    comment         TEXT,

    UNIQUE (packet_id, subject_sam)
);

CREATE INDEX IF NOT EXISTS idx_decision_packet ON auditing.attestation_decisions (packet_id);

-- ========================================================================
-- auditing.email_log -- every invite/reminder/closure send (auditable trail)
-- cc_addr records that the audit mailbox was CC'd even if delivery later fails.
-- ========================================================================

CREATE TABLE IF NOT EXISTS auditing.email_log (
    log_id          SERIAL PRIMARY KEY,
    packet_id       UUID REFERENCES auditing.attestation_packets(packet_id) ON DELETE SET NULL,
    campaign_id     INTEGER REFERENCES auditing.campaigns(campaign_id) ON DELETE CASCADE,
    to_addr         VARCHAR(255),
    cc_addr         VARCHAR(255),
    subject         VARCHAR(500),
    kind            VARCHAR(10) CHECK (kind IN ('invite', 'reminder', 'closure')),
    sent_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    smtp_response   TEXT,
    success         BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_email_log_campaign ON auditing.email_log (campaign_id);

-- ========================================================================
-- AD-sync tables -- created now, populated by the AD-sync slice (not Slice 1).
-- ========================================================================

CREATE TABLE IF NOT EXISTS auditing.ad_users (
    sam_account          VARCHAR(255) PRIMARY KEY,
    display_name         VARCHAR(255),
    email                VARCHAR(255),
    manager_sam          VARCHAR(255),
    manager_dn           VARCHAR(500),
    manager_email        VARCHAR(255),
    enabled              BOOLEAN,
    last_seen_at         TIMESTAMPTZ,
    last_seen_manager_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ad_user_email   ON auditing.ad_users (email);
CREATE INDEX IF NOT EXISTS idx_ad_user_manager ON auditing.ad_users (manager_sam);

CREATE TABLE IF NOT EXISTS auditing.group_memberships (
    group_dn    VARCHAR(500) NOT NULL,
    sam_account VARCHAR(255) NOT NULL,
    synced_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (group_dn, sam_account)
);

CREATE INDEX IF NOT EXISTS idx_group_membership_sam ON auditing.group_memberships (sam_account);

-- Group owners (managedBy / m365 owner). Informational/diagnostic only -- NOT
-- used for campaign routing (the business confirmed managedBy is unreliable).
CREATE TABLE IF NOT EXISTS auditing.group_owners (
    group_dn           VARCHAR(500) NOT NULL,
    owner_sam          VARCHAR(255) NOT NULL,
    owner_display_name VARCHAR(255),
    owner_email        VARCHAR(255),
    source             VARCHAR(20),              -- 'managedBy' / 'm365_owner'
    synced_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (group_dn, owner_sam)
);

CREATE TABLE IF NOT EXISTS auditing.auto_launch_log (
    log_id         SERIAL PRIMARY KEY,
    application_id INTEGER REFERENCES shared.applications(application_id) ON DELETE CASCADE,
    attempted_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    result         VARCHAR(30),                  -- 'launched' / 'skipped_no_owners' / 'error'
    campaign_id    INTEGER REFERENCES auditing.campaigns(campaign_id) ON DELETE SET NULL,
    error_text     TEXT
);

-- ========================================================================
-- Grants -- ops_migrate creates; ops_api reads + writes everything in auditing.
-- ========================================================================

GRANT USAGE ON SCHEMA auditing TO ops_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA auditing TO ops_api;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA auditing TO ops_api;

-- ========================================================================
-- Migration tracking
-- ========================================================================

INSERT INTO system.schema_migrations (script_name, description)
VALUES (
    '020-auditing-schema.sql',
    'Auditing (09): application access attestation -- per-app routing config + bindings + nominees + campaigns + packets/subjects/decisions + email log, plus AD-sync tables (unpopulated until the AD-sync slice)'
)
ON CONFLICT (script_name) DO NOTHING;

COMMIT;
