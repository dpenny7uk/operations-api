"""Query active application-group bindings from auditing.application_groups.

Writes one distinguished name per line to the given output file, for the
PowerShell AD membership expander to consume. Mirrors certificates/query_servers.py.
"""
import os
import sys

import psycopg2


def main():
    if len(sys.argv) != 2:
        print("Usage: query_bindings.py <output-file>", file=sys.stderr)
        sys.exit(1)

    output_path = sys.argv[1]

    conn = psycopg2.connect(
        host=os.environ["OPS_DB_HOST"],
        port=os.environ["OPS_DB_PORT"],
        dbname=os.environ["OPS_DB_NAME"],
        user=os.environ["OPS_DB_USER"],
        password=os.environ["OPS_DB_PASSWORD"],
        sslmode=os.environ.get("OPS_DB_SSLMODE", "disable"),
    )
    cur = conn.cursor()
    cur.execute(
        "SELECT DISTINCT group_dn FROM auditing.application_groups "
        "WHERE is_active = TRUE ORDER BY group_dn"
    )
    with open(output_path, "w", encoding="utf-8") as f:
        for (group_dn,) in cur:
            f.write(group_dn + "\n")
    conn.close()


if __name__ == "__main__":
    main()
