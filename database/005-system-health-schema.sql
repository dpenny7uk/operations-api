BEGIN;

-- Operations Platform - System Health & Sync Tracking

-- ===========================================
-- SYNC STATUS (current state per job)
-- ===========================================

CREATE TABLE IF NOT EXISTS system.sync_status (
    sync_id             SERIAL PRIMARY KEY,
    sync_name           VARCHAR(100) NOT NULL UNIQUE,
    sync_type           VARCHAR(50) DEFAULT 'scheduled',
    
    -- Current status
    status              system.health_status_type DEFAULT 'unknown',
    last_run_at         TIMESTAMP,
    last_success_at     TIMESTAMP,
    last_failure_at     TIMESTAMP,
    
    -- Metrics from last run
    records_processed   INTEGER DEFAULT 0,
    records_inserted    INTEGER DEFAULT 0,
    records_updated     INTEGER DEFAULT 0,
    records_failed      INTEGER DEFAULT 0,
    duration_seconds    NUMERIC(10,2),
    
    -- Error tracking
    consecutive_failures INTEGER DEFAULT 0,
    last_error_message  TEXT,
    
    -- Configuration
    expected_schedule   VARCHAR(100),
    max_age_hours       INTEGER DEFAULT 24,
    min_expected_records INTEGER DEFAULT 0,
    
    -- Timestamps
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Seed sync status entries
INSERT INTO system.sync_status (sync_name, sync_type, expected_schedule, max_age_hours, min_expected_records)
VALUES 
    ('databricks_servers',        'scheduled', 'Daily 5:00 AM',  24, 50),
    ('databricks_eol',            'scheduled', 'Daily 5:30 AM',  24, 10),
    ('confluence_issues',         'scheduled', 'Daily 4:00 AM',  24, 1),
    ('certificate_scan',          'scheduled', 'Daily 6:00 AM',  24, 10),
    ('ivanti_patching',           'triggered', 'Weekly Thursday', 168, 50),
    ('patching_schedule_html',    'scheduled', 'Daily 6:30 AM',  48, 50)
ON CONFLICT (sync_name) DO NOTHING;

-- ===========================================
-- SYNC HISTORY (audit log)
-- ===========================================

CREATE TABLE IF NOT EXISTS system.sync_history (
    history_id          SERIAL PRIMARY KEY,
    sync_name           VARCHAR(100) NOT NULL,
    started_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at        TIMESTAMP,
    
    -- Status
    status              system.sync_status_type DEFAULT 'running',
    
    -- Metrics
    records_processed   INTEGER DEFAULT 0,
    records_inserted    INTEGER DEFAULT 0,
    records_updated     INTEGER DEFAULT 0,
    records_failed      INTEGER DEFAULT 0,
    records_deactivated INTEGER DEFAULT 0,
    
    -- Details
    source_info         JSONB,
    error_message       TEXT,
    error_details       JSONB,
    
    -- Trigger info
    triggered_by        VARCHAR(100),
    pipeline_run_id     VARCHAR(100)
);

CREATE INDEX IF NOT EXISTS idx_history_name ON system.sync_history(sync_name);
CREATE INDEX IF NOT EXISTS idx_history_started ON system.sync_history(started_at DESC);
-- Composite index for circuit breaker query (filters by name, orders by time)
CREATE INDEX IF NOT EXISTS idx_history_name_started
    ON system.sync_history(sync_name, started_at DESC);

-- ===========================================
-- VALIDATION RULES
-- ===========================================

CREATE TABLE IF NOT EXISTS system.validation_rules (
    rule_id             SERIAL PRIMARY KEY,
    rule_name           VARCHAR(100) NOT NULL UNIQUE,
    rule_type           VARCHAR(50) NOT NULL,
    target_schema       VARCHAR(100) NOT NULL,
    target_table        VARCHAR(100) NOT NULL,
    target_column       VARCHAR(100),
    
    -- Rule definition
    validation_query    TEXT NOT NULL,
    expected_result     VARCHAR(50) DEFAULT 'empty',
    severity            VARCHAR(20) DEFAULT 'warning'
                        CHECK (severity IN ('critical', 'warning', 'info')),
    
    -- Status
    is_active           BOOLEAN DEFAULT TRUE,
    last_run_at         TIMESTAMP,
    last_result         VARCHAR(20),
    last_violation_count INTEGER DEFAULT 0,
    
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Seed validation rules
INSERT INTO system.validation_rules 
    (rule_name, rule_type, target_schema, target_table, target_column, validation_query, severity)
VALUES 
    ('servers_no_duplicates', 'uniqueness', 'shared', 'servers', 'server_name',
     'SELECT server_name, COUNT(*) FROM shared.servers GROUP BY server_name HAVING COUNT(*) > 1',
     'critical'),
    ('certs_expiring_critical', 'pattern', 'certificates', 'inventory', 'valid_to',
     'SELECT certificate_id, subject_cn, days_until_expiry FROM certificates.inventory WHERE is_active AND days_until_expiry <= 14 AND days_until_expiry > 0',
     'critical'),
    ('certs_expired', 'pattern', 'certificates', 'inventory', 'valid_to',
     'SELECT certificate_id, subject_cn FROM certificates.inventory WHERE is_active AND is_expired',
     'critical'),
    ('certs_server_id_mismatch', 'referential', 'certificates', 'inventory', 'server_id',
     'SELECT c.certificate_id, c.server_name, c.server_id, s.server_name AS canonical_name FROM certificates.inventory c JOIN shared.servers s ON c.server_id = s.server_id WHERE c.is_active AND UPPER(c.server_name) <> UPPER(s.server_name)',
     'warning')
ON CONFLICT (rule_name) DO NOTHING;

-- ===========================================
-- VALIDATION RESULTS
-- ===========================================

CREATE TABLE IF NOT EXISTS system.validation_results (
    result_id           SERIAL PRIMARY KEY,
    rule_id             INTEGER REFERENCES system.validation_rules(rule_id) ON DELETE CASCADE,
    run_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    result              VARCHAR(20) NOT NULL,
    violation_count     INTEGER DEFAULT 0,
    sample_violations   JSONB,
    execution_time_ms   INTEGER
);

CREATE INDEX IF NOT EXISTS idx_valresults_rule_id ON system.validation_results(rule_id);

-- ===========================================
-- SERVER ALIASES (manual mappings)
-- ===========================================

CREATE TABLE IF NOT EXISTS system.server_aliases (
    alias_id            SERIAL PRIMARY KEY,
    canonical_name      VARCHAR(255) NOT NULL REFERENCES shared.servers(server_name),
    alias_name          VARCHAR(255) NOT NULL UNIQUE,
    source_system       VARCHAR(100),
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by          VARCHAR(100)
);

CREATE INDEX IF NOT EXISTS idx_alias_canonical ON system.server_aliases(canonical_name);

-- ===========================================
-- UNMATCHED SERVERS
-- ===========================================

CREATE TABLE IF NOT EXISTS system.unmatched_servers (
    unmatched_id        SERIAL PRIMARY KEY,
    server_name_raw     VARCHAR(255) NOT NULL,
    server_name_normalized VARCHAR(255),
    source_system       VARCHAR(100) NOT NULL,
    source_reference    VARCHAR(255),
    
    -- Resolution
    status              VARCHAR(20) DEFAULT 'pending'
                        CHECK (status IN ('pending', 'resolved', 'ignored', 'new_server')),
    resolved_to_server_id INTEGER REFERENCES shared.servers(server_id),
    resolved_at         TIMESTAMP,
    resolved_by         VARCHAR(100),
    
    -- Tracking
    first_seen_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_seen_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    occurrence_count    INTEGER DEFAULT 1,
    
    CONSTRAINT uq_unmatched UNIQUE (server_name_raw, source_system)
);

CREATE INDEX IF NOT EXISTS idx_unmatched_status ON system.unmatched_servers(status);
CREATE INDEX IF NOT EXISTS idx_unmatched_resolved_server ON system.unmatched_servers(resolved_to_server_id) WHERE resolved_to_server_id IS NOT NULL;

-- ===========================================
-- SCAN FAILURES (unreachable servers)
-- ===========================================

CREATE TABLE IF NOT EXISTS system.scan_failures (
    failure_id          SERIAL PRIMARY KEY,
    server_name         VARCHAR(255) NOT NULL,
    scan_type           VARCHAR(50) NOT NULL,      -- 'certificate', 'patching', etc.
    error_message       TEXT,
    error_category      VARCHAR(50) DEFAULT 'unknown'
                        CHECK (error_category IN ('unreachable', 'access_denied', 'timeout', 'winrm', 'unknown')),

    -- Tracking
    first_failure_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_failure_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    failure_count       INTEGER DEFAULT 1,
    last_success_at     TIMESTAMP,                 -- NULL if never succeeded
    is_resolved         BOOLEAN DEFAULT FALSE,
    resolved_at         TIMESTAMP,
    resolved_by         VARCHAR(100),

    CONSTRAINT uq_scan_failure UNIQUE (server_name, scan_type)
);

CREATE INDEX IF NOT EXISTS idx_scan_failures_unresolved
    ON system.scan_failures(scan_type) WHERE NOT is_resolved;

-- Record or increment a scan failure
CREATE OR REPLACE FUNCTION system.record_scan_failure(
    p_server VARCHAR(255),
    p_scan_type VARCHAR(50),
    p_error TEXT DEFAULT NULL,
    p_category VARCHAR(50) DEFAULT 'unknown'
)
RETURNS INTEGER AS $$
DECLARE
    v_id INTEGER;
BEGIN
    INSERT INTO system.scan_failures
        (server_name, scan_type, error_message, error_category)
    VALUES
        (p_server, p_scan_type, p_error, p_category)
    ON CONFLICT (server_name, scan_type) DO UPDATE SET
        last_failure_at = CURRENT_TIMESTAMP,
        failure_count = system.scan_failures.failure_count + 1,
        error_message = COALESCE(EXCLUDED.error_message, system.scan_failures.error_message),
        error_category = EXCLUDED.error_category,
        is_resolved = FALSE
    RETURNING failure_id INTO v_id;

    RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- Clear failure when a scan succeeds
CREATE OR REPLACE FUNCTION system.clear_scan_failure(
    p_server VARCHAR(255),
    p_scan_type VARCHAR(50)
)
RETURNS VOID AS $$
BEGIN
    UPDATE system.scan_failures SET
        is_resolved = TRUE,
        resolved_at = CURRENT_TIMESTAMP,
        last_success_at = CURRENT_TIMESTAMP
    WHERE server_name = p_server
      AND scan_type = p_scan_type
      AND NOT is_resolved;
END;
$$ LANGUAGE plpgsql;

-- View: current unreachable servers with counts
CREATE OR REPLACE VIEW system.v_unreachable_servers AS
SELECT
    sf.server_name,
    sf.scan_type,
    sf.error_category,
    sf.error_message,
    sf.failure_count,
    sf.first_failure_at,
    sf.last_failure_at,
    sf.last_success_at,
    s.environment,
    s.business_unit,
    a.application_name
FROM system.scan_failures sf
LEFT JOIN shared.servers s ON UPPER(sf.server_name) = UPPER(s.server_name) AND s.is_active
LEFT JOIN shared.applications a ON s.primary_application_id = a.application_id
WHERE NOT sf.is_resolved
ORDER BY sf.failure_count DESC;

-- ===========================================
-- FUNCTIONS
-- ===========================================

-- Resolve server name (exact -> normalized -> alias -> fuzzy)
CREATE OR REPLACE FUNCTION system.resolve_server_name(input_name TEXT)
RETURNS TABLE (server_id INTEGER, server_name VARCHAR(255), match_type VARCHAR(20)) AS $$
BEGIN
    -- Exact match
    RETURN QUERY
    SELECT s.server_id, s.server_name, 'exact'::VARCHAR(20)
    FROM shared.servers s
    WHERE s.server_name = input_name AND s.is_active
    LIMIT 1;
    IF FOUND THEN RETURN; END IF;
    
    -- Case-insensitive exact
    RETURN QUERY
    SELECT s.server_id, s.server_name, 'exact_ci'::VARCHAR(20)
    FROM shared.servers s
    WHERE LOWER(s.server_name) = LOWER(input_name) AND s.is_active
    LIMIT 1;
    IF FOUND THEN RETURN; END IF;
    
    -- Normalized (removes domain suffixes)
    RETURN QUERY
    SELECT s.server_id, s.server_name, 'normalized'::VARCHAR(20)
    FROM shared.servers s
    WHERE system.normalize_server_name(s.server_name) = system.normalize_server_name(input_name)
      AND s.is_active
    LIMIT 1;
    IF FOUND THEN RETURN; END IF;
    
    -- Alias lookup
    RETURN QUERY
    SELECT s.server_id, s.server_name, 'alias'::VARCHAR(20)
    FROM system.server_aliases a
    JOIN shared.servers s ON s.server_name = a.canonical_name AND s.is_active
    WHERE system.normalize_server_name(a.alias_name) = system.normalize_server_name(input_name)
    LIMIT 1;
    IF FOUND THEN RETURN; END IF;
    
    -- Fuzzy match (Levenshtein distance <= 2)
    RETURN QUERY
    SELECT sub.server_id, sub.server_name, 'fuzzy'::VARCHAR(20)
    FROM (
        SELECT s.server_id, s.server_name,
               levenshtein(
                   system.normalize_server_name(s.server_name),
                   system.normalize_server_name(input_name)
               ) AS dist
        FROM shared.servers s
        WHERE s.is_active
    ) sub
    WHERE sub.dist <= 2
    ORDER BY sub.dist
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Record unmatched server
CREATE OR REPLACE FUNCTION system.record_unmatched_server(
    p_name VARCHAR(255),
    p_source VARCHAR(100),
    p_ref VARCHAR(255) DEFAULT NULL
)
RETURNS INTEGER AS $$
DECLARE
    v_id INTEGER;
BEGIN
    INSERT INTO system.unmatched_servers 
        (server_name_raw, server_name_normalized, source_system, source_reference)
    VALUES 
        (p_name, system.normalize_server_name(p_name), p_source, p_ref)
    ON CONFLICT (server_name_raw, source_system) DO UPDATE SET
        last_seen_at = CURRENT_TIMESTAMP,
        occurrence_count = system.unmatched_servers.occurrence_count + 1
    RETURNING unmatched_id INTO v_id;
    
    RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- Run validation rules
CREATE OR REPLACE FUNCTION system.run_validation(p_rule_name VARCHAR(100) DEFAULT NULL)
RETURNS TABLE (
    rule_name VARCHAR(100),
    result VARCHAR(20),
    violation_count INTEGER,
    execution_time_ms INTEGER
) AS $fn$
DECLARE
    v_rule RECORD;
    v_start TIMESTAMP;
    v_count INTEGER;
    v_sample JSONB;
BEGIN
    FOR v_rule IN
        SELECT * FROM system.validation_rules vr
        WHERE vr.is_active AND (p_rule_name IS NULL OR vr.rule_name = p_rule_name)
    LOOP
        v_start := clock_timestamp();

        -- Validate query is read-only (SELECT only).
        -- Blocks: non-SELECT statements, DDL/DML keywords, semicolons (multi-statement),
        -- SQL comment syntax (-- and /* */), and dollar-quoting which could be used
        -- to smuggle forbidden keywords past the keyword regex.
        IF v_rule.validation_query !~* '^\s*SELECT\s'
           OR v_rule.validation_query ~*  '\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COPY|EXECUTE|DO)\b'
           OR v_rule.validation_query ~ ';'
           OR v_rule.validation_query ~ '--'
           OR v_rule.validation_query ~ '/\*'
           OR v_rule.validation_query ~ '\$\$' THEN
            v_count := -1;
            v_sample := '[]'::jsonb;
            RAISE WARNING 'Validation rule % has unsafe query — skipped', v_rule.rule_name;
            CONTINUE;
        END IF;

        -- Execute validation query
        BEGIN
        SET LOCAL transaction_read_only = on;
            EXECUTE 'SELECT COUNT(*) FROM (' || v_rule.validation_query || ') sq'
            INTO v_count;
        EXCEPTION WHEN OTHERS THEN
            v_count := -1;
        END;

        -- Get sample violations
        IF v_count > 0 THEN
            BEGIN
                SET LOCAL transaction_read_only = on;
                EXECUTE 'SELECT jsonb_agg(sq) FROM (SELECT * FROM (' ||
                        v_rule.validation_query || ') sq LIMIT 10) sq2'
                INTO v_sample;
            EXCEPTION WHEN OTHERS THEN
                v_sample := '[]'::jsonb;
            END;
        ELSE
            v_sample := '[]'::jsonb;
        END IF;
        
        -- Record result
        INSERT INTO system.validation_results 
            (rule_id, result, violation_count, sample_violations, execution_time_ms)
        VALUES (
            v_rule.rule_id,
            CASE WHEN v_count = 0 THEN 'pass' WHEN v_count = -1 THEN 'error' ELSE 'fail' END,
            GREATEST(v_count, 0),
            v_sample,
            EXTRACT(MILLISECONDS FROM (clock_timestamp() - v_start))::INTEGER
        );
        
        -- Update rule status
        UPDATE system.validation_rules SET
            last_run_at = CURRENT_TIMESTAMP,
            last_result = CASE WHEN v_count = 0 THEN 'pass' WHEN v_count = -1 THEN 'error' ELSE 'fail' END,
            last_violation_count = GREATEST(v_count, 0)
        WHERE rule_id = v_rule.rule_id;
        
        -- Return row
        rule_name := v_rule.rule_name;
        result := CASE WHEN v_count = 0 THEN 'pass' WHEN v_count = -1 THEN 'error' ELSE 'fail' END;
        violation_count := GREATEST(v_count, 0);
        execution_time_ms := EXTRACT(MILLISECONDS FROM (clock_timestamp() - v_start))::INTEGER;
        RETURN NEXT;
    END LOOP;
END;
$fn$ LANGUAGE plpgsql;

-- ===========================================
-- VIEWS
-- ===========================================

-- Health summary
CREATE OR REPLACE VIEW system.v_health_summary AS
SELECT 
    ss.sync_name,
    ss.status,
    ss.last_success_at,
    ROUND(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - ss.last_success_at)) / 3600, 1) AS hours_since_success,
    CASE 
        WHEN ss.last_success_at IS NULL THEN 'error'
        WHEN EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - ss.last_success_at)) / 3600 > ss.max_age_hours THEN 'stale'
        WHEN ss.consecutive_failures > 0 THEN 'warning'
        ELSE 'healthy'
    END AS freshness_status,
    ss.records_processed,
    ss.consecutive_failures,
    ss.last_error_message
FROM system.sync_status ss
ORDER BY 
    CASE ss.status WHEN 'error' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END;

-- Unmatched servers with suggestions
CREATE OR REPLACE VIEW system.v_unmatched_pending AS
SELECT 
    um.unmatched_id,
    um.server_name_raw,
    um.source_system,
    um.occurrence_count,
    um.last_seen_at,
    (
        SELECT s.server_name 
        FROM shared.servers s 
        WHERE s.is_active
        ORDER BY similarity(system.normalize_server_name(s.server_name), um.server_name_normalized) DESC
        LIMIT 1
    ) AS suggested_match
FROM system.unmatched_servers um
WHERE um.status = 'pending'
ORDER BY um.occurrence_count DESC;

-- ===========================================
-- SYNC HISTORY RETENTION
-- ===========================================
-- Purges old sync_history rows to prevent unbounded table growth.
-- Call manually or from a scheduled pipeline/pg_cron job.
-- Default: retain 90 days. Override with p_retain_days parameter.

CREATE OR REPLACE FUNCTION system.purge_old_sync_history(p_retain_days INTEGER DEFAULT 90)
RETURNS INTEGER AS $$
DECLARE
    v_deleted INTEGER;
BEGIN
    DELETE FROM system.sync_history
    WHERE started_at < CURRENT_TIMESTAMP - (p_retain_days || ' days')::INTERVAL;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
END;
$$ LANGUAGE plpgsql;

-- ===========================================
-- TRIGGERS
-- ===========================================

SELECT system.create_updated_at_trigger('system', 'sync_status');

COMMIT;
