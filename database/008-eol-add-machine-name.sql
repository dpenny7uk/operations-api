BEGIN;

-- Add machine_name column to EOL software table.
-- machine_name comes from asset_inventory.machine_name via JOIN on
-- ivanti_installed_software = eol.asset AND ivanti_software_version = eol.eol_product_version.
-- Previously, 'asset' held the software description (e.g. "SQL Server 2017 Database Engine Services"),
-- not the actual server name. machine_name is the real server identifier.

ALTER TABLE eol.end_of_life_software ADD COLUMN IF NOT EXISTS machine_name VARCHAR(255);

-- Drop old unique index keyed on (product, version, asset)
DROP INDEX IF EXISTS eol.uq_eol_product_asset;

-- New unique index keyed on (product, version, machine_name)
CREATE UNIQUE INDEX uq_eol_product_machine
    ON eol.end_of_life_software (eol_product, eol_product_version, COALESCE(machine_name, ''));

-- Index for server lookups by machine_name
CREATE INDEX idx_eol_machine_name_active
    ON eol.end_of_life_software (machine_name)
    WHERE is_active = TRUE AND machine_name IS NOT NULL;

-- Update v_software_summary to count distinct machine_names instead of assets
CREATE OR REPLACE VIEW eol.v_software_summary AS
SELECT
    eol_product,
    eol_product_version,
    eol_end_of_life,
    eol_end_of_support,
    eol_end_of_extended_support,
    COUNT(DISTINCT machine_name) AS affected_assets,
    CASE
        WHEN eol_end_of_life IS NULL THEN 'UNKNOWN'
        WHEN eol_end_of_life <= CURRENT_TIMESTAMP THEN 'EOL'
        WHEN eol_end_of_life <= CURRENT_TIMESTAMP + INTERVAL '6 months' THEN 'APPROACHING'
        ELSE 'SUPPORTED'
    END AS alert_level
FROM eol.end_of_life_software
WHERE is_active
GROUP BY eol_product, eol_product_version, eol_end_of_life, eol_end_of_support, eol_end_of_extended_support
ORDER BY eol_end_of_life NULLS LAST;

-- Recreate v_at_risk_servers to use machine_name directly
-- (DROP required because column name changes from 'asset' to 'machine_name')
DROP VIEW IF EXISTS eol.v_at_risk_servers;
CREATE VIEW eol.v_at_risk_servers AS
SELECT
    e.machine_name,
    s.server_id,
    s.server_name,
    s.environment,
    a.application_name,
    a.criticality,
    COUNT(*) FILTER (WHERE e.eol_end_of_life <= CURRENT_TIMESTAMP) AS eol_product_count,
    COUNT(*) FILTER (WHERE e.eol_end_of_life > CURRENT_TIMESTAMP
                       AND e.eol_end_of_life <= CURRENT_TIMESTAMP + INTERVAL '6 months') AS approaching_product_count,
    ARRAY_AGG(DISTINCT e.eol_product || ' ' || e.eol_product_version
              ORDER BY e.eol_product || ' ' || e.eol_product_version)
        FILTER (WHERE e.eol_end_of_life <= CURRENT_TIMESTAMP + INTERVAL '6 months') AS at_risk_products,
    (
        COUNT(*) FILTER (WHERE e.eol_end_of_life <= CURRENT_TIMESTAMP) * 30 +
        COUNT(*) FILTER (WHERE e.eol_end_of_life > CURRENT_TIMESTAMP
                           AND e.eol_end_of_life <= CURRENT_TIMESTAMP + INTERVAL '6 months') * 10 +
        CASE WHEN s.environment ILIKE 'prod%' THEN 25 ELSE 0 END +
        CASE a.criticality
            WHEN 'CRITICAL' THEN 50
            WHEN 'HIGH' THEN 30
            ELSE 10
        END
    ) AS impact_score
FROM eol.end_of_life_software e
LEFT JOIN shared.servers s
    ON UPPER(e.machine_name) = UPPER(s.server_name) AND s.is_active
LEFT JOIN shared.applications a
    ON s.primary_application_id = a.application_id
WHERE e.is_active
  AND e.eol_end_of_life <= CURRENT_TIMESTAMP + INTERVAL '6 months'
  AND e.machine_name IS NOT NULL
GROUP BY e.machine_name, s.server_id, s.server_name, s.environment,
         a.application_name, a.criticality
ORDER BY impact_score DESC;

COMMIT;
