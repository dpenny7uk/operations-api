"""Database maintenance tasks for Operations API.

Calls PostgreSQL maintenance functions:
  - refresh_expiry:           recalculates certificate expiry fields (daily)
  - purge_sync_history:       removes old sync_history rows (monthly)
  - cleanup_disk_snapshots:   removes disk snapshot rows older than retain_days
                              (nightly; bounds matview refresh time)
"""

import argparse
import sys

from common import setup_logging, database_connection, validate_env_vars

logger = setup_logging('maintenance')

REQUIRED_ENV = ['OPS_DB_HOST', 'OPS_DB_NAME', 'OPS_DB_USER']

TASKS = {
    'refresh_expiry': {
        'sql': 'SELECT certificates.refresh_expiry_calculations()',
        'description': 'Refresh certificate expiry calculations',
    },
    'purge_sync_history': {
        'sql': 'SELECT system.purge_old_sync_history(%s)',
        'description': 'Purge old sync history records',
    },
    'cleanup_disk_snapshots': {
        'sql': 'SELECT monitoring.cleanup_disk_snapshots(%s)',
        'description': 'Delete disk snapshots older than retention window',
    },
}

# Tasks that accept --retain-days as a positional argument.
RETAIN_DAYS_TASKS = {'purge_sync_history', 'cleanup_disk_snapshots'}


def run_task(task_name: str, retain_days: int = 90, dry_run: bool = False) -> int:
    """Run a maintenance task and return the affected row count."""
    task = TASKS[task_name]
    logger.info("Running: %s", task['description'])

    if dry_run:
        logger.info("[DRY RUN] Would execute: %s", task['sql'])
        return 0

    with database_connection(app_name=f"ops_maintenance_{task_name}") as conn:
        with conn.cursor() as cur:
            if task_name in RETAIN_DAYS_TASKS:
                cur.execute(task['sql'], (retain_days,))
            else:
                cur.execute(task['sql'])

            result = cur.fetchone()
            row_count = list(result.values())[0] if result else 0

        conn.commit()
        logger.info("%s complete — %d rows affected", task['description'], row_count)
        return row_count


def main():
    parser = argparse.ArgumentParser(description='Run database maintenance tasks')
    parser.add_argument(
        'task',
        choices=list(TASKS.keys()),
        help='Maintenance task to run',
    )
    parser.add_argument(
        '--retain-days',
        type=int,
        default=90,
        help='Retention window in days (used by purge_sync_history and cleanup_disk_snapshots; default: 90)',
    )
    parser.add_argument('--dry-run', action='store_true', help='Log actions without executing')
    parser.add_argument('--verbose', action='store_true', help='Enable debug logging')

    args = parser.parse_args()

    if args.verbose:
        import logging
        logging.getLogger().setLevel(logging.DEBUG)

    validate_env_vars(REQUIRED_ENV)

    try:
        row_count = run_task(args.task, retain_days=args.retain_days, dry_run=args.dry_run)
        logger.info("Maintenance task '%s' succeeded (rows: %d)", args.task, row_count)
    except Exception:
        logger.exception("Maintenance task '%s' failed", args.task)
        sys.exit(1)


if __name__ == '__main__':
    main()
