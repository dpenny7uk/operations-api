BEGIN;

-- Operations Platform - Shared Schema (Servers & Applications)
-- Source: Databricks master_server_list (Gold standard)

CREATE SCHEMA IF NOT EXISTS shared;

-- ===========================================
-- APPLICATIONS
-- ===========================================

CREATE TABLE IF NOT EXISTS shared.applications (
    application_id      SERIAL PRIMARY KEY,
    application_name    VARCHAR(255) NOT NULL UNIQUE,
    description         TEXT,
    criticality         system.criticality_type DEFAULT 'MEDIUM',
    
    -- Support contacts
    support_team        VARCHAR(255),
    support_email       VARCHAR(255),
    business_owner      VARCHAR(255),
    technical_owner     VARCHAR(255),
    
    -- Sync tracking
    cmdb_id             VARCHAR(100),
    source_system       VARCHAR(50) DEFAULT 'databricks',
    is_active           BOOLEAN DEFAULT TRUE,
    
    -- Timestamps
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    synced_at           TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_app_name ON shared.applications(application_name);
CREATE INDEX IF NOT EXISTS idx_app_active ON shared.applications(is_active) WHERE is_active;

-- ===========================================
-- SERVERS
-- ===========================================

CREATE TABLE IF NOT EXISTS shared.servers (
    server_id               SERIAL PRIMARY KEY,
    server_name             VARCHAR(255) NOT NULL UNIQUE,
    fqdn                    VARCHAR(500),
    ip_address              VARCHAR(50),
    operating_system        VARCHAR(255),
    environment             VARCHAR(50),
    location                VARCHAR(100),
    business_unit           VARCHAR(100),
    
    -- Application link
    primary_application_id  INTEGER REFERENCES shared.applications(application_id),
    
    -- Contacts
    primary_contact         VARCHAR(255),
    secondary_contact       VARCHAR(255),
    
    -- Patching
    patch_group             VARCHAR(100),
    
    -- Sync tracking
    cmdb_id                 VARCHAR(100),
    source_system           VARCHAR(50) DEFAULT 'databricks',
    is_active               BOOLEAN DEFAULT TRUE,
    
    -- Timestamps
    created_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    synced_at               TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_srv_name ON shared.servers(server_name);
CREATE INDEX IF NOT EXISTS idx_srv_env ON shared.servers(environment) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_srv_app ON shared.servers(primary_application_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_srv_patch_group ON shared.servers(patch_group) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_srv_name_trgm ON shared.servers USING GIN (server_name gin_trgm_ops);

-- ===========================================
-- VIEWS
-- ===========================================

CREATE OR REPLACE VIEW shared.v_application_summary AS
SELECT 
    a.application_id,
    a.application_name,
    a.criticality,
    a.support_team,
    a.support_email,
    COUNT(DISTINCT s.server_id) AS server_count,
    COUNT(DISTINCT s.server_id) FILTER (WHERE s.environment ILIKE 'prod%') AS prod_servers
FROM shared.applications a
LEFT JOIN shared.servers s ON s.primary_application_id = a.application_id AND s.is_active
WHERE a.is_active
GROUP BY a.application_id
ORDER BY a.criticality, a.application_name;

-- ===========================================
-- TRIGGERS
-- ===========================================

SELECT system.create_updated_at_trigger('shared', 'applications');
SELECT system.create_updated_at_trigger('shared', 'servers');

COMMIT;
