-- DEPLOYMENT ORDER: Run BEFORE deploying updated sync scripts and API code.
-- This migration updates views to support the split EOL data model:
--   - Product-level rows (machine_name IS NULL): lifecycle dates from end_of_life_dates
--   - Per-server rows (machine_name IS NOT NULL): installed software from asset_inventory
-- This migration is idempotent — safe to re-run.

BEGIN;

-- Clear existing EOL data to prepare for the new data model.
-- The old data used a different source (end_of_life_software table with 29 rows).
-- The new model uses end_of_life_dates (445+ products) and asset_inventory pattern matching.
DELETE FROM eol.end_of_life_software WHERE source_system = 'databricks';

-- Map Windows Server versions from shared.servers.operating_system.
-- This view bridges the gap between server OS names and endoflife.date product identifiers.
-- Must be created BEFORE v_software_summary which depends on it.
CREATE OR REPLACE VIEW eol.v_os_eol_mapping AS
SELECT
    s.server_name AS machine_name,
    'windows-server' AS eol_product,
    CASE
        WHEN s.operating_system ILIKE '%2012 R2%' THEN '2012-r2'
        WHEN s.operating_system ILIKE '%2012%' THEN '2012'
        WHEN s.operating_system ILIKE '%2016%' THEN '2016'
        WHEN s.operating_system ILIKE '%2019%' THEN '2019'
        WHEN s.operating_system ILIKE '%2022%' THEN '2022'
        WHEN s.operating_system ILIKE '%2025%' THEN '2025'
    END AS eol_product_version
FROM shared.servers s
WHERE s.is_active = TRUE
  AND s.operating_system IS NOT NULL;

-- Updated v_software_summary: JOIN product-level dates with per-server counts.
-- Product-level rows (machine_name IS NULL) provide lifecycle dates.
-- Per-server rows (machine_name IS NOT NULL) provide affected server counts.
CREATE OR REPLACE VIEW eol.v_software_summary AS
SELECT
    p.eol_product,
    p.eol_product_version,
    p.eol_end_of_life,
    p.eol_end_of_support,
    p.eol_end_of_extended_support,
    (
        COUNT(DISTINCT s.machine_name) +
        COUNT(DISTINCT os.machine_name)
    ) AS affected_assets,
    CASE
        WHEN p.eol_end_of_life IS NULL THEN 'UNKNOWN'
        WHEN p.eol_end_of_life <= CURRENT_TIMESTAMP THEN 'EOL'
        WHEN p.eol_end_of_life <= CURRENT_TIMESTAMP + INTERVAL '6 months' THEN 'APPROACHING'
        ELSE 'SUPPORTED'
    END AS alert_level
FROM eol.end_of_life_software p
-- Join per-server software rows (SQL Server, .NET, IIS from asset_inventory)
LEFT JOIN eol.end_of_life_software s
    ON s.eol_product = p.eol_product
    AND s.eol_product_version = p.eol_product_version
    AND s.machine_name IS NOT NULL
    AND s.is_active = TRUE
-- Join Windows Server matches via OS mapping view
LEFT JOIN eol.v_os_eol_mapping os
    ON os.eol_product = p.eol_product
    AND os.eol_product_version = p.eol_product_version
WHERE p.machine_name IS NULL
  AND p.is_active = TRUE
GROUP BY p.eol_product, p.eol_product_version, p.eol_end_of_life,
         p.eol_end_of_support, p.eol_end_of_extended_support
ORDER BY p.eol_end_of_life NULLS LAST;

-- Recreate v_at_risk_servers to use the split model.
-- Combines per-server software rows + OS mapping for a unified risk view.
DROP VIEW IF EXISTS eol.v_at_risk_servers;
CREATE VIEW eol.v_at_risk_servers AS
WITH server_eol AS (
    -- Per-server software rows (SQL Server, .NET, IIS)
    SELECT machine_name, eol_product, eol_product_version
    FROM eol.end_of_life_software
    WHERE is_active = TRUE AND machine_name IS NOT NULL
    UNION
    -- Windows Server via OS mapping
    SELECT machine_name, eol_product, eol_product_version
    FROM eol.v_os_eol_mapping
    WHERE eol_product_version IS NOT NULL
)
SELECT
    se.machine_name,
    srv.server_id,
    srv.server_name,
    srv.environment,
    a.application_name,
    a.criticality,
    COUNT(*) FILTER (WHERE p.eol_end_of_life <= CURRENT_TIMESTAMP) AS eol_product_count,
    COUNT(*) FILTER (WHERE p.eol_end_of_life > CURRENT_TIMESTAMP
                       AND p.eol_end_of_life <= CURRENT_TIMESTAMP + INTERVAL '6 months') AS approaching_product_count,
    ARRAY_AGG(DISTINCT p.eol_product || ' ' || p.eol_product_version
              ORDER BY p.eol_product || ' ' || p.eol_product_version)
        FILTER (WHERE p.eol_end_of_life <= CURRENT_TIMESTAMP + INTERVAL '6 months') AS at_risk_products,
    (
        COUNT(*) FILTER (WHERE p.eol_end_of_life <= CURRENT_TIMESTAMP) * 30 +
        COUNT(*) FILTER (WHERE p.eol_end_of_life > CURRENT_TIMESTAMP
                           AND p.eol_end_of_life <= CURRENT_TIMESTAMP + INTERVAL '6 months') * 10 +
        CASE WHEN srv.environment ILIKE 'prod%' THEN 25 ELSE 0 END +
        CASE a.criticality
            WHEN 'CRITICAL' THEN 50
            WHEN 'HIGH' THEN 30
            ELSE 10
        END
    ) AS impact_score
FROM server_eol se
-- Join to product-level rows for lifecycle dates
JOIN eol.end_of_life_software p
    ON p.eol_product = se.eol_product
    AND p.eol_product_version = se.eol_product_version
    AND p.machine_name IS NULL
    AND p.is_active = TRUE
LEFT JOIN shared.servers srv
    ON UPPER(se.machine_name) = UPPER(srv.server_name) AND srv.is_active
LEFT JOIN shared.applications a
    ON srv.primary_application_id = a.application_id
WHERE p.eol_end_of_life <= CURRENT_TIMESTAMP + INTERVAL '6 months'
GROUP BY se.machine_name, srv.server_id, srv.server_name, srv.environment,
         a.application_name, a.criticality
ORDER BY impact_score DESC;

COMMIT;
