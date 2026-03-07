-- Operations Platform - Patching Schema
-- Sources: Ivanti Excel exports, Confluence known issues

CREATE SCHEMA IF NOT EXISTS patching;

-- ===========================================
-- PATCH CYCLES
-- ===========================================

CREATE TABLE IF NOT EXISTS patching.patch_cycles (
    cycle_id            SERIAL PRIMARY KEY,
    cycle_date          DATE NOT NULL UNIQUE,
    email_subject       VARCHAR(500),
    email_received_at   TIMESTAMP,
    file_name           VARCHAR(500),
    
    -- Server counts
    servers_onprem      INTEGER DEFAULT 0,
    servers_azure       INTEGER DEFAULT 0,
    
    -- Status
    status              VARCHAR(20) DEFAULT 'active'
                        CHECK (status IN ('active', 'completed', 'cancelled')),
    notes               TEXT,
    
    -- Timestamps
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by          VARCHAR(255) DEFAULT CURRENT_USER
);

CREATE INDEX IF NOT EXISTS idx_cycle_date ON patching.patch_cycles(cycle_date DESC);

-- ===========================================
-- PATCH WINDOWS
-- ===========================================

CREATE TABLE IF NOT EXISTS patching.patch_windows (
    window_id           SERIAL PRIMARY KEY,
    patch_group         VARCHAR(20) NOT NULL,
    window_type         VARCHAR(20) NOT NULL CHECK (window_type IN ('onprem', 'azure')),
    scheduled_time      VARCHAR(20),
    start_time          TIME,
    end_time            TIME,
    description         VARCHAR(255),
    
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT uq_patch_window UNIQUE (patch_group, window_type)
);

-- Seed standard patch windows
INSERT INTO patching.patch_windows (patch_group, window_type, scheduled_time, start_time, end_time, description)
VALUES 
    ('8a',  'onprem', '00:00-01:30', '00:00', '01:30', 'Shavlik_8a'),
    ('8b',  'onprem', '01:30-03:00', '01:30', '03:00', 'Shavlik_8b'),
    ('9a',  'onprem', '03:00-05:00', '03:00', '05:00', 'Shavlik_9a'),
    ('9b',  'onprem', '05:00-07:00', '05:00', '07:00', 'Shavlik_9b'),
    ('usa', 'onprem', '07:00-08:30', '07:00', '08:30', 'Shavlik_usa'),
    ('usb', 'onprem', '08:30-10:00', '08:30', '10:00', 'Shavlik_usb'),
    ('8a',  'azure',  NULL, NULL, NULL, 'Azure 8a'),
    ('8b',  'azure',  NULL, NULL, NULL, 'Azure 8b'),
    ('9a',  'azure',  NULL, NULL, NULL, 'Azure 9a'),
    ('9b',  'azure',  NULL, NULL, NULL, 'Azure 9b'),
    ('usa', 'azure',  NULL, NULL, NULL, 'Azure US a'),
    ('usb', 'azure',  NULL, NULL, NULL, 'Azure US b')
ON CONFLICT (patch_group, window_type) DO UPDATE SET
    scheduled_time = EXCLUDED.scheduled_time,
    start_time = EXCLUDED.start_time,
    end_time = EXCLUDED.end_time,
    updated_at = CURRENT_TIMESTAMP;

-- ===========================================
-- PATCH SCHEDULE
-- ===========================================

CREATE TABLE IF NOT EXISTS patching.patch_schedule (
    schedule_id         SERIAL PRIMARY KEY,
    cycle_id            INTEGER NOT NULL REFERENCES patching.patch_cycles(cycle_id) ON DELETE CASCADE,
    
    -- Server identification
    server_name         VARCHAR(255) NOT NULL,
    server_type         VARCHAR(20) NOT NULL CHECK (server_type IN ('onprem', 'azure')),
    server_id           INTEGER REFERENCES shared.servers(server_id),
    
    -- From Ivanti (common fields)
    domain              VARCHAR(100),
    app                 VARCHAR(255),
    service             VARCHAR(255),
    support_team        VARCHAR(255),
    business_unit       VARCHAR(100),
    contact             VARCHAR(255),
    patch_group         VARCHAR(20),
    scheduled_time      VARCHAR(20),
    
    -- Azure-specific fields
    resource_group      VARCHAR(255),
    location            VARCHAR(100),
    azure_id            VARCHAR(500),
    environment         VARCHAR(50),
    power_state         VARCHAR(50),
    subscription        VARCHAR(255),
    os                  VARCHAR(100),
    
    -- Status tracking
    patch_status        VARCHAR(20) DEFAULT 'scheduled'
                        CHECK (patch_status IN ('scheduled', 'in_progress', 'completed', 
                                                 'failed', 'skipped', 'excluded')),
    status_updated_at   TIMESTAMP,
    status_notes        TEXT,
    
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT uq_patch_schedule_server UNIQUE (cycle_id, server_name, server_type)
);

CREATE INDEX IF NOT EXISTS idx_sched_cycle ON patching.patch_schedule(cycle_id);
CREATE INDEX IF NOT EXISTS idx_sched_server ON patching.patch_schedule(server_name);
CREATE INDEX IF NOT EXISTS idx_sched_group ON patching.patch_schedule(patch_group);
CREATE INDEX IF NOT EXISTS idx_sched_server_id ON patching.patch_schedule(server_id) WHERE server_id IS NOT NULL;

-- ===========================================
-- KNOWN ISSUES (from Confluence)
-- ===========================================

CREATE TABLE IF NOT EXISTS patching.known_issues (
    issue_id            SERIAL PRIMARY KEY,
    
    -- From Confluence
    title               VARCHAR(500) NOT NULL,
    application         VARCHAR(255),
    category            VARCHAR(50),
    status              VARCHAR(50),
    
    -- Normalized
    severity            system.severity_type DEFAULT 'MEDIUM',
    is_active           BOOLEAN DEFAULT TRUE,
    
    -- Confluence detail fields
    trigger_description TEXT,
    signature           TEXT,
    fix                 TEXT,
    category_notes      TEXT,
    
    -- Patch types affected
    patch_types         TEXT[],
    applies_to_windows  BOOLEAN DEFAULT FALSE,
    applies_to_sql      BOOLEAN DEFAULT FALSE,
    applies_to_other    BOOLEAN DEFAULT FALSE,
    
    -- Matching criteria (for auto-linking to servers)
    affected_os         TEXT[],
    affected_apps       TEXT[],
    affected_services   TEXT[],
    affected_patch_groups TEXT[],
    affected_servers    TEXT[],
    
    -- Confluence sync
    confluence_page_id  VARCHAR(50) UNIQUE,
    confluence_url      VARCHAR(500),
    last_synced_at      TIMESTAMP,
    
    -- Dates
    discovered_date     DATE DEFAULT CURRENT_DATE,
    resolved_date       DATE,
    
    -- Timestamps
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_issue_active ON patching.known_issues(is_active) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_issue_severity ON patching.known_issues(severity);
CREATE INDEX IF NOT EXISTS idx_issue_apps ON patching.known_issues USING GIN(affected_apps);
CREATE INDEX IF NOT EXISTS idx_issue_services ON patching.known_issues USING GIN(affected_services);

-- ===========================================
-- FUNCTIONS
-- ===========================================

-- Link patch schedule servers to inventory
CREATE OR REPLACE FUNCTION patching.link_servers_to_inventory()
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER;
BEGIN
    UPDATE patching.patch_schedule ps
    SET server_id = s.server_id
    FROM shared.servers s
    WHERE LOWER(ps.server_name) = LOWER(s.server_name)
      AND ps.server_id IS NULL
      AND s.is_active;
    
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- ===========================================
-- VIEWS
-- ===========================================

-- Current/upcoming patch schedule
CREATE OR REPLACE VIEW patching.v_current_schedule AS
SELECT 
    pc.cycle_id,
    pc.cycle_date,
    ps.server_name,
    ps.server_type,
    ps.patch_group,
    pw.scheduled_time,
    ps.app,
    ps.service,
    ps.patch_status,
    s.environment,
    a.application_name,
    a.criticality,
    a.support_email
FROM patching.patch_cycles pc
JOIN patching.patch_schedule ps ON ps.cycle_id = pc.cycle_id
LEFT JOIN patching.patch_windows pw ON pw.patch_group = ps.patch_group 
    AND pw.window_type = ps.server_type
LEFT JOIN shared.servers s ON ps.server_id = s.server_id
LEFT JOIN shared.applications a ON s.primary_application_id = a.application_id
WHERE pc.status = 'active' AND pc.cycle_date >= CURRENT_DATE
ORDER BY pc.cycle_date, pw.start_time, ps.server_name;

-- Servers with known issues
CREATE OR REPLACE VIEW patching.v_servers_with_issues AS
SELECT 
    ps.cycle_id,
    pc.cycle_date,
    ps.server_name,
    ps.patch_group,
    ps.app,
    ki.issue_id,
    ki.title AS issue_title,
    ki.severity,
    ki.fix
FROM patching.patch_schedule ps
JOIN patching.patch_cycles pc ON pc.cycle_id = ps.cycle_id
JOIN patching.known_issues ki ON ki.is_active
    AND (
        (ps.app IS NOT NULL AND ps.app = ANY(COALESCE(ki.affected_apps, ARRAY[]::TEXT[])))
        OR (ps.service IS NOT NULL AND ps.service = ANY(COALESCE(ki.affected_services, ARRAY[]::TEXT[])))
    )
WHERE pc.status = 'active'
ORDER BY ki.severity, pc.cycle_date;

-- Cycle summary
CREATE OR REPLACE VIEW patching.v_cycle_summary AS
SELECT 
    pc.cycle_id,
    pc.cycle_date,
    pc.status,
    pc.servers_onprem + pc.servers_azure AS total_servers,
    COUNT(DISTINCT ps.server_name) AS scheduled,
    COUNT(*) FILTER (WHERE ps.patch_status = 'completed') AS completed,
    COUNT(*) FILTER (WHERE ps.patch_status = 'failed') AS failed
FROM patching.patch_cycles pc
LEFT JOIN patching.patch_schedule ps ON ps.cycle_id = pc.cycle_id
GROUP BY pc.cycle_id
ORDER BY pc.cycle_date DESC;

-- ===========================================
-- TRIGGERS
-- ===========================================

SELECT system.create_updated_at_trigger('patching', 'patch_cycles');
SELECT system.create_updated_at_trigger('patching', 'patch_windows');
SELECT system.create_updated_at_trigger('patching', 'known_issues');
