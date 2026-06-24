-- Operations Platform - Licensing Schema (Surface 08, Risk group)
-- Tracks vendor software-licence renewals so impending contract expiries are
-- flagged with enough runway for procurement to act (6 months / 3 months / 30 days).
-- Same operational shape as certificates (05) and EOL (06): threshold-bucketed
-- expiry tracking with Teams alerts firing at predefined windows.
--
-- Source of record is operations-api itself (manual CRUD via the SPA) -- this is
-- NOT synced from the CMDB/Databricks. The CMDB is audit/compliance-shaped and
-- carries no contract expiry date; the renewal date lives here.
--
-- Field model mirrors the Hiscox CMDB licence fields (Licence Type, Quantity Held,
-- Licence Audit Frequency, Licence Audit Owner) plus the ops-api-only renewal layer
-- (expires_at, notice_period_days, status_flag). CMDB-mirrored lookups
-- (licence_type, audit_frequency) are plain VARCHAR with NO check constraint so a
-- new CMDB dropdown value never breaks ops-api; the UI dropdown supplies the list.
-- status_flag is ops-api-internal and stable, so it keeps a CHECK.
--
-- Grants are included here (like 013, unlike 010 which needed 011 as a follow-up)
-- so ops_api can read + write licences and the alert script can write licensing.alerts.
-- This migration is idempotent -- safe to re-run.

BEGIN;

CREATE SCHEMA IF NOT EXISTS licensing;

-- ========================================================================
-- licensing.licences
-- One row per tracked vendor licence/contract.
-- ========================================================================

CREATE TABLE IF NOT EXISTS licensing.licences (
    licence_id          SERIAL PRIMARY KEY,

    -- Application link (optional; denormalised application_name for display)
    application_id      INTEGER REFERENCES shared.applications(application_id),
    application_name    VARCHAR(255),

    -- Vendor / product
    vendor              VARCHAR(120) NOT NULL,
    product             VARCHAR(120) NOT NULL,

    -- CMDB-mirrored fields (flexible: no CHECK, UI dropdown supplies values)
    licence_type        VARCHAR(50),
    quantity_held       INTEGER,
    audit_frequency     VARCHAR(30),
    audit_owner_sam     VARCHAR(255),

    -- ops-api renewal / expiry layer (drives crit-strip + Teams alerts)
    expires_at          DATE NOT NULL,
    notice_period_days  SMALLINT,
    status_flag         VARCHAR(20) NOT NULL DEFAULT 'tracked'
                            CHECK (status_flag IN ('tracked', 'engaged')),
    notes               TEXT,

    -- Audit: who created / last touched (manual-entry surface, like patch_exclusions)
    created_by          VARCHAR(255),
    updated_by          VARCHAR(255),

    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Alert query + bucket sort: find licences by expiry
CREATE INDEX IF NOT EXISTS idx_licence_expires_at
    ON licensing.licences (expires_at)
    WHERE is_active;

-- One active licence per (vendor, product, application)
CREATE UNIQUE INDEX IF NOT EXISTS idx_licence_active_vpa
    ON licensing.licences (vendor, product, application_id)
    WHERE is_active;

SELECT system.create_updated_at_trigger('licensing', 'licences');

-- ========================================================================
-- licensing.renewals
-- Append-only history: one row per renewal cycle. The audit trail for
-- "when did procurement actually close this out" and drives the Renewal
-- History panel.
-- ========================================================================

CREATE TABLE IF NOT EXISTS licensing.renewals (
    renewal_id      SERIAL PRIMARY KEY,
    licence_id      INTEGER NOT NULL REFERENCES licensing.licences(licence_id) ON DELETE CASCADE,
    cycle_ended     DATE NOT NULL,          -- the expires_at value when the cycle closed
    renewed_on      DATE NOT NULL,
    new_expires     DATE NOT NULL,
    renewed_by      VARCHAR(255),
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_renewal_licence
    ON licensing.renewals (licence_id);

-- ========================================================================
-- licensing.alerts
-- Teams-push de-duplication, mirroring the certificates.alerts pattern.
-- One row per (licence, threshold) so each threshold only fires once per
-- cycle; the renew endpoint DELETEs a licence's rows so the next cycle's
-- thresholds re-fire cleanly.
-- ========================================================================

CREATE TABLE IF NOT EXISTS licensing.alerts (
    alert_id                SERIAL PRIMARY KEY,
    licence_id              INTEGER NOT NULL REFERENCES licensing.licences(licence_id) ON DELETE CASCADE,
    threshold               VARCHAR(10) NOT NULL
                                CHECK (threshold IN ('six_mo', 'three_mo', 'thirty_d', 'expired')),
    notification_sent       BOOLEAN NOT NULL DEFAULT FALSE,
    sent_at                 TIMESTAMPTZ,
    webhook_response_status INTEGER,
    error_text              TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE (licence_id, threshold)
);

CREATE INDEX IF NOT EXISTS idx_licence_alert_licence
    ON licensing.alerts (licence_id);

-- ========================================================================
-- Grants
-- ops_migrate creates; ops_api reads + writes licences/renewals and the
-- alert script reads/writes licensing.alerts.
-- ========================================================================

GRANT USAGE ON SCHEMA licensing TO ops_api;

GRANT SELECT, INSERT, UPDATE, DELETE ON licensing.licences TO ops_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON licensing.renewals TO ops_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON licensing.alerts TO ops_api;

GRANT USAGE ON SEQUENCE licensing.licences_licence_id_seq TO ops_api;
GRANT USAGE ON SEQUENCE licensing.renewals_renewal_id_seq TO ops_api;
GRANT USAGE ON SEQUENCE licensing.alerts_alert_id_seq TO ops_api;

-- ========================================================================
-- Migration tracking
-- ========================================================================

INSERT INTO system.schema_migrations (script_name, description)
VALUES (
    '019-licensing-schema.sql',
    'Licensing (08): vendor licence renewal tracking -- licences + renewals history + alerts dedup, with Teams expiry alerts'
)
ON CONFLICT (script_name) DO NOTHING;

COMMIT;
