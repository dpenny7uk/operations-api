"""Database maintenance tasks for Operations API.

Calls PostgreSQL maintenance functions:
  - refresh_expiry: recalculates certificate expiry fields (daily)
  - purge_sync_history: removes old sync_history rows (monthly)
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
}


def run_task(task_name: str, retain_days: int = 90, dry_run: bool = False) -> int:
    """Run a maintenance task and return the affected row count."""
    task = TASKS[task_name]
    logger.info("Running: %s", task['description'])

    if dry_run:
        logger.info("[DRY RUN] Would execute: %s", task['sql'])
        return 0

    with database_connection(app_name=f"ops_maintenance_{task_name}") as conn:
        with conn.cursor() as cur:
            if task_name == 'purge_sync_history':
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
        help='Days of sync history to retain (purge_sync_history only, default: 90)',
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
