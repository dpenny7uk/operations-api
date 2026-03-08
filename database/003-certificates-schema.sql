BEGIN;

-- Operations Platform - Certificates Schema
-- Source: PowerShell certificate scans

CREATE SCHEMA IF NOT EXISTS certificates;

-- ===========================================
-- CERTIFICATE INVENTORY
-- ===========================================

CREATE TABLE IF NOT EXISTS certificates.inventory (
    certificate_id      SERIAL PRIMARY KEY,
    thumbprint          VARCHAR(64) NOT NULL,
    
    -- Subject/Issuer
    subject             VARCHAR(1000),
    subject_cn          VARCHAR(500),
    issuer              VARCHAR(1000),
    issuer_cn           VARCHAR(500),
    
    -- Validity
    valid_from          TIMESTAMP,
    valid_to            TIMESTAMP,
    days_until_expiry   INTEGER,
    is_expired          BOOLEAN DEFAULT FALSE,
    alert_level         VARCHAR(20) CHECK (alert_level IN ('CRITICAL', 'WARNING', 'OK')),
    
    -- Location
    server_id           INTEGER REFERENCES shared.servers(server_id),
    server_name         VARCHAR(255) NOT NULL,
    store_name          VARCHAR(100),
    store_location      VARCHAR(100),
    
    -- IIS Binding (if applicable)
    iis_site_name       VARCHAR(500),
    iis_binding_ip      VARCHAR(50),
    iis_binding_port    INTEGER,
    iis_binding_hostname VARCHAR(500),
    iis_binding_protocol VARCHAR(20),
    
    -- Certificate details
    key_algorithm       VARCHAR(50),
    key_length          INTEGER,
    signature_algorithm VARCHAR(100),
    san_entries         TEXT,
    
    -- Status
    is_self_signed      BOOLEAN DEFAULT FALSE,
    has_private_key     BOOLEAN DEFAULT TRUE,
    is_active           BOOLEAN DEFAULT TRUE,
    
    -- Timestamps
    first_seen_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_seen_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    scan_source         VARCHAR(100) DEFAULT 'powershell',
    
    CONSTRAINT uq_cert_location UNIQUE (server_name, thumbprint, store_name)
);

CREATE INDEX IF NOT EXISTS idx_cert_thumbprint ON certificates.inventory(thumbprint);
CREATE INDEX IF NOT EXISTS idx_cert_server ON certificates.inventory(server_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_cert_expiry ON certificates.inventory(valid_to) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_cert_alert ON certificates.inventory(alert_level) WHERE is_active;

-- ===========================================
-- ALERTS
-- ===========================================

CREATE TABLE IF NOT EXISTS certificates.alerts (
    alert_id            SERIAL PRIMARY KEY,
    certificate_id      INTEGER REFERENCES certificates.inventory(certificate_id) ON DELETE CASCADE,
    alert_type          VARCHAR(50) NOT NULL,
    alert_level         VARCHAR(20) NOT NULL CHECK (alert_level IN ('CRITICAL', 'WARNING', 'OK')),
    alert_message       TEXT,
    days_until_expiry   INTEGER,
    
    -- Notification tracking
    notification_sent   BOOLEAN DEFAULT FALSE,
    notification_sent_at TIMESTAMP,
    
    -- Resolution
    acknowledged        BOOLEAN DEFAULT FALSE,
    acknowledged_by     VARCHAR(255),
    acknowledged_at     TIMESTAMP,
    resolved            BOOLEAN DEFAULT FALSE,
    resolved_at         TIMESTAMP,
    
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_alert_cert_id ON certificates.alerts(certificate_id);

-- ===========================================
-- FUNCTIONS
-- ===========================================

CREATE OR REPLACE FUNCTION certificates.refresh_expiry_calculations()
RETURNS INTEGER AS $$
DECLARE
    v_updated INTEGER;
BEGIN
    UPDATE certificates.inventory
    SET 
        days_until_expiry = CEIL(EXTRACT(EPOCH FROM (valid_to - CURRENT_TIMESTAMP)) / 86400)::INTEGER,
        is_expired = (valid_to < CURRENT_TIMESTAMP),
        alert_level = CASE
            WHEN valid_to < CURRENT_TIMESTAMP + INTERVAL '14 days' THEN 'CRITICAL'
            WHEN valid_to < CURRENT_TIMESTAMP + INTERVAL '30 days' THEN 'WARNING'
            ELSE 'OK'
        END,
        updated_at = CURRENT_TIMESTAMP
    WHERE is_active AND valid_to IS NOT NULL;

    -- Flag certs with NULL valid_to as CRITICAL (unknown expiry = assume worst)
    UPDATE certificates.inventory
    SET
        days_until_expiry = NULL,
        is_expired = FALSE,
        alert_level = 'CRITICAL',
        updated_at = CURRENT_TIMESTAMP
    WHERE is_active AND valid_to IS NULL AND alert_level IS DISTINCT FROM 'CRITICAL';
    
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RETURN v_updated;
END;
$$ LANGUAGE plpgsql;

-- ===========================================
-- VIEWS
-- ===========================================

CREATE OR REPLACE VIEW certificates.v_expiring_soon AS
SELECT 
    c.certificate_id,
    c.subject_cn,
    c.thumbprint,
    c.valid_to,
    c.days_until_expiry,
    c.alert_level,
    c.server_name,
    c.iis_site_name,
    s.environment,
    a.application_name,
    a.criticality,
    a.support_email,
    -- Impact score for prioritization
    (
        CASE 
            WHEN c.days_until_expiry <= 7 THEN 100
            WHEN c.days_until_expiry <= 14 THEN 80
            WHEN c.days_until_expiry <= 30 THEN 60
            ELSE 20
        END +
        CASE a.criticality 
            WHEN 'CRITICAL' THEN 50 
            WHEN 'HIGH' THEN 30 
            ELSE 10 
        END +
        CASE WHEN s.environment ILIKE 'prod%' THEN 25 ELSE 0 END
    ) AS impact_score
FROM certificates.inventory c
LEFT JOIN shared.servers s ON c.server_id = s.server_id
LEFT JOIN shared.applications a ON s.primary_application_id = a.application_id
WHERE c.is_active
  AND NOT c.is_expired
  AND (c.days_until_expiry <= 90 OR c.valid_to IS NULL)
ORDER BY impact_score DESC, c.days_until_expiry;

-- ===========================================
-- TRIGGERS
-- ===========================================

SELECT system.create_updated_at_trigger('certificates', 'inventory');

COMMIT;
