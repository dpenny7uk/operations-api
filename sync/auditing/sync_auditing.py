#!/usr/bin/env python3
"""Sync AD group membership + users from PowerShell CSVs into the auditing tables.

Reads auditing-members-*.csv (group_dn, sam_account) and auditing-users-*.csv
(sam_account, display_name, email, enabled, manager_sam, manager_dn, manager_email),
upserts auditing.ad_users + auditing.group_memberships, and prunes membership rows
that disappeared from a synced group. Mirrors certificates/sync_certificates.py.
"""

import csv
import glob
import os
import sys

from psycopg2.extras import execute_values

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from common import (
    setup_logging, create_argument_parser, configure_verbosity, SyncContext
)

logger = setup_logging('sync_auditing')


def _latest(pattern: str) -> str:
    files = glob.glob(pattern)
    if not files:
        raise FileNotFoundError(f"No CSV files found matching: {pattern}")
    return max(files, key=os.path.getmtime)


def read_csv(pattern: str) -> list:
    path = _latest(pattern)
    logger.info("Reading CSV: %s", path)
    with open(path, 'r', encoding='utf-8-sig', errors='replace') as f:
        rows = [{k.lower(): v for k, v in row.items()} for row in csv.DictReader(f)]
    logger.info("Read %d row(s) from %s", len(rows), os.path.basename(path))
    return rows


def _trunc(value, n):
    value = (value or '').strip()
    return value[:n] if value else None


def _bool(value) -> bool:
    return str(value).strip().lower() in ('true', '1', 'yes')


def sync_auditing(ctx, members: list, users: list):
    with ctx.conn.cursor() as cur:
        # ---- Users ----
        user_rows = []
        for r in users:
            sam = (r.get('sam_account') or '').strip()
            if not sam:
                continue
            user_rows.append((
                sam[:255],
                _trunc(r.get('display_name'), 255),
                _trunc(r.get('email'), 255),
                _trunc(r.get('manager_sam'), 255),
                _trunc(r.get('manager_dn'), 500),
                _trunc(r.get('manager_email'), 255),
                _bool(r.get('enabled')),
            ))

        if user_rows:
            cur.execute("""
                CREATE TEMP TABLE tmp_ad_users (
                    sam_account   VARCHAR(255),
                    display_name  VARCHAR(255),
                    email         VARCHAR(255),
                    manager_sam   VARCHAR(255),
                    manager_dn    VARCHAR(500),
                    manager_email VARCHAR(255),
                    enabled       BOOLEAN
                ) ON COMMIT DROP
            """)
            execute_values(cur, "INSERT INTO tmp_ad_users VALUES %s", user_rows)
            cur.execute("""
                WITH upserted AS (
                    INSERT INTO auditing.ad_users
                        (sam_account, display_name, email, manager_sam, manager_dn,
                         manager_email, enabled, last_seen_at)
                    SELECT DISTINCT ON (sam_account)
                        sam_account, display_name, email, manager_sam, manager_dn,
                        manager_email, enabled, NOW()
                    FROM tmp_ad_users
                    ORDER BY sam_account
                    ON CONFLICT (sam_account) DO UPDATE SET
                        display_name  = EXCLUDED.display_name,
                        email         = EXCLUDED.email,
                        manager_sam   = EXCLUDED.manager_sam,
                        manager_dn    = EXCLUDED.manager_dn,
                        manager_email = EXCLUDED.manager_email,
                        enabled       = EXCLUDED.enabled,
                        last_seen_at  = NOW()
                    RETURNING (xmax = 0) AS is_insert
                )
                SELECT
                    COUNT(*) FILTER (WHERE is_insert)     AS inserted,
                    COUNT(*) FILTER (WHERE NOT is_insert) AS updated
                FROM upserted
            """)
            row = cur.fetchone()
            ctx.stats.inserted += row['inserted']
            ctx.stats.updated += row['updated']
            logger.info("Users: %d inserted, %d updated", row['inserted'], row['updated'])

        # ---- Memberships ----
        member_rows = []
        for r in members:
            dn = (r.get('group_dn') or '').strip()
            sam = (r.get('sam_account') or '').strip()
            if dn and sam:
                member_rows.append((dn[:500], sam[:255]))
        ctx.stats.processed = len(member_rows)

        if member_rows:
            cur.execute("""
                CREATE TEMP TABLE tmp_members (
                    group_dn    VARCHAR(500),
                    sam_account VARCHAR(255)
                ) ON COMMIT DROP
            """)
            execute_values(cur, "INSERT INTO tmp_members VALUES %s", member_rows)
            cur.execute("""
                INSERT INTO auditing.group_memberships (group_dn, sam_account, synced_at)
                SELECT DISTINCT group_dn, sam_account, NOW() FROM tmp_members
                ON CONFLICT (group_dn, sam_account) DO UPDATE SET synced_at = NOW()
            """)
            # Prune memberships for synced groups whose (group, user) pair is gone.
            cur.execute("""
                DELETE FROM auditing.group_memberships gm
                WHERE gm.group_dn IN (SELECT DISTINCT group_dn FROM tmp_members)
                  AND NOT EXISTS (
                      SELECT 1 FROM tmp_members t
                      WHERE t.group_dn = gm.group_dn AND t.sam_account = gm.sam_account
                  )
            """)
            ctx.stats.deactivated = cur.rowcount
            logger.info("Memberships: %d synced, %d pruned", len(member_rows), ctx.stats.deactivated)
        else:
            logger.warning("No membership rows in CSV - nothing to sync.")

        if not ctx.dry_run:
            ctx.conn.commit()

        logger.info(
            "Synced %d membership row(s): %d users inserted, %d users updated, %d memberships pruned",
            ctx.stats.processed, ctx.stats.inserted, ctx.stats.updated, ctx.stats.deactivated
        )


def main():
    parser = create_argument_parser("Sync AD group membership into the auditing tables")
    parser.add_argument(
        '--members',
        default=os.environ.get('AUDIT_MEMBERS_CSV', 'auditing-members-*.csv'),
        help='Path or glob to the members CSV'
    )
    parser.add_argument(
        '--users',
        default=os.environ.get('AUDIT_USERS_CSV', 'auditing-users-*.csv'),
        help='Path or glob to the users CSV'
    )
    args = parser.parse_args()
    configure_verbosity(args.verbose)

    with SyncContext("auditing_ad_sync", "Auditing AD Membership Sync", dry_run=args.dry_run) as ctx:
        ctx.check_circuit_breaker()
        members = read_csv(args.members)
        users = read_csv(args.users)
        sync_auditing(ctx, members, users)


if __name__ == "__main__":
    main()
