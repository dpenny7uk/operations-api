"""Query active servers from shared.servers for certificate scanning."""
import os
import sys

import psycopg2

def main():
    if len(sys.argv) != 2:
        print("Usage: query_servers.py <output-file>", file=sys.stderr)
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
        "SELECT server_name FROM shared.servers "
        "WHERE is_active = TRUE "
        "AND LEFT(LOWER(server_name), 2) IN "
        "('pr','dv','sy','ut','st','tr','ls','ss','pc','ci') "
        "ORDER BY server_name"
    )
    with open(output_path, "w") as f:
        for (server_name,) in cur:
            f.write(server_name + "\n")
    conn.close()

if __name__ == "__main__":
    main()
