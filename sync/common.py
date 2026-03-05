"""Common utilities for Operations Platform sync scripts."""

import os
import sys
import logging
import argparse
import socket
import time
from typing import List, Optional
from dataclasses import dataclass, field
from contextlib import contextmanager

import requests
import psycopg2
from psycopg2.extras import RealDictCursor


def setup_logging(name: str = __name__, level: int = logging.INFO) -> logging.Logger:
    """Configure logging with standard format."""
    logging.basicConfig(
        level=level,
        format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    return logging.getLogger(name)


def get_current_user() -> str:
    """Get current user - checks Azure DevOps variables first."""
    return (
        os.environ.get('BUILD_REQUESTEDFOR') or
        os.environ.get('USERNAME') or
        os.environ.get('USER', 'unknown')
    )


def get_hostname() -> str:
    return socket.gethostname()


def validate_env_vars(required: List[str]) -> None:
    """Raise error if any required environment variables are missing."""
    missing = [v for v in required if not os.environ.get(v)]
    if missing:
        raise EnvironmentError(f"Missing required environment variables: {', '.join(missing)}")


def http_request(
    method: str,
    url: str,
    retries: int = 3,
    backoff: float = 2.0,
    timeout: int = 180,
    **kwargs
) -> requests.Response:
    """Make an HTTP request with retry logic for transient failures.

    Retries on connection errors, timeouts, and 5xx responses.
    Raises requests.HTTPError on non-retryable failures (4xx).
    """
    logger = logging.getLogger('http_request')
    kwargs.setdefault('timeout', timeout)

    last_exception = None
    for attempt in range(1, retries + 1):
        try:
            resp = requests.request(method, url, **kwargs)
            if resp.status_code < 500:
                resp.raise_for_status()
                return resp
            # 5xx — retryable
            last_exception = requests.HTTPError(
                f"{resp.status_code} Server Error: {resp.reason}", response=resp
            )
            logger.warning(
                "HTTP %s %s returned %d (attempt %d/%d)",
                method.upper(), url, resp.status_code, attempt, retries
            )
        except requests.ConnectionError as e:
            last_exception = e
            logger.warning(
                "Connection error for %s %s (attempt %d/%d): %s",
                method.upper(), url, attempt, retries, e
            )
        except requests.Timeout as e:
            last_exception = e
            logger.warning(
                "Timeout for %s %s (attempt %d/%d): %s",
                method.upper(), url, attempt, retries, e
            )

        if attempt < retries:
            wait = backoff ** attempt
            logger.info("Retrying in %.1f seconds...", wait)
            time.sleep(wait)

    raise last_exception  # type: ignore[misc]


def query_databricks(query: str, env_var_override: str = None) -> list:
    """Execute a SQL query against Databricks and return rows as dicts.

    Args:
        query: SQL statement to execute, or None to read from env_var_override.
        env_var_override: If set, read the query from this environment variable instead.

    Returns:
        List of dicts, one per row, with lowercase column names as keys.
    """
    validate_env_vars(['DATABRICKS_HOST', 'DATABRICKS_TOKEN', 'DATABRICKS_WAREHOUSE_ID'])

    if env_var_override:
        query = os.environ.get(env_var_override, query)

    logger = logging.getLogger('databricks')
    url = f"https://{os.environ['DATABRICKS_HOST']}/api/2.0/sql/statements"
    headers = {
        "Authorization": f"Bearer {os.environ['DATABRICKS_TOKEN']}",
        "Content-Type": "application/json"
    }

    response = http_request(
        'POST', url,
        headers=headers,
        json={
            "warehouse_id": os.environ['DATABRICKS_WAREHOUSE_ID'],
            "statement": query,
            "wait_timeout": "120s"
        },
        timeout=180
    )
    result = response.json()

    state = result.get('status', {}).get('state')
    if state != 'SUCCEEDED':
        error_msg = result.get('status', {}).get('error', {}).get('message', 'Unknown error')
        raise RuntimeError(f"Databricks query failed: {error_msg}")

    columns = [
        col['name'].lower()
        for col in result.get('manifest', {}).get('schema', {}).get('columns', [])
    ]

    rows = [dict(zip(columns, row)) for row in result.get('result', {}).get('data_array', [])]
    logger.info(f"Fetched {len(rows)} rows from Databricks")
    return rows


def get_database_connection(
    host: str = None,
    port: int = None,
    database: str = None,
    user: str = None,
    password: str = None,
    app_name: str = "ops_sync"
):
    """Create PostgreSQL connection from params or environment variables."""
    db_user = user or os.environ.get('OPS_DB_USER')
    db_password = password or os.environ.get('OPS_DB_PASSWORD')
    if not db_user:
        raise EnvironmentError("Database user not configured: set OPS_DB_USER or pass user parameter")
    if not db_password:
        raise EnvironmentError("Database password not configured: set OPS_DB_PASSWORD or pass password parameter")
    conn = psycopg2.connect(
        host=host or os.environ.get('OPS_DB_HOST', 'localhost'),
        port=port or int(os.environ.get('OPS_DB_PORT', '5432')),
        database=database or os.environ.get('OPS_DB_NAME', 'ops_platform'),
        user=db_user,
        password=db_password,
        application_name=app_name,
        cursor_factory=RealDictCursor
    )
    conn.autocommit = False
    return conn


@contextmanager
def database_connection(app_name: str = "ops_sync"):
    """Context manager for database connections with auto-close."""
    conn = get_database_connection(app_name=app_name)
    try:
        yield conn
    finally:
        conn.close()


@dataclass
class SyncStats:
    """Statistics tracked during sync operations."""
    processed: int = 0
    inserted: int = 0
    updated: int = 0
    failed: int = 0
    deactivated: int = 0
    unmatched: int = 0
    errors: List[str] = field(default_factory=list)

    def add_error(self, msg: str):
        self.errors.append(msg)
        self.failed += 1

    def to_dict(self) -> dict:
        return {
            'processed': self.processed,
            'inserted': self.inserted,
            'updated': self.updated,
            'failed': self.failed,
            'deactivated': self.deactivated,
            'unmatched': self.unmatched
        }


class SyncContext:
    """Context manager for sync operations with automatic tracking."""

    def __init__(
        self,
        sync_name: str,
        display_name: str = None,
        dry_run: bool = False,
        app_name: str = None
    ):
        self.sync_name = sync_name
        self.display_name = display_name or sync_name
        self.dry_run = dry_run
        self.app_name = app_name or f"ops_{sync_name}"
        
        self.conn = None
        self.history_id = None
        self.stats = SyncStats()
        self.logger = logging.getLogger(sync_name)
        self._error_message = None

    def __enter__(self):
        prefix = '[DRY RUN] ' if self.dry_run else ''
        self.logger.info(f"{prefix}Starting {self.display_name}")
        
        self.conn = get_database_connection(app_name=self.app_name)
        
        if not self.dry_run:
            self.history_id = self._start_sync()
        
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        status = 'error' if exc_type else 'success'

        if exc_type:
            self._error_message = str(exc_val)
            self.logger.error(f"Sync failed: {exc_val}")
            # Rollback the aborted transaction so error tracking queries can run
            if self.conn:
                try:
                    self.conn.rollback()
                except Exception as rollback_err:
                    self.logger.warning(f"Rollback failed: {rollback_err}")

        if not self.dry_run and self.history_id:
            try:
                self._complete_sync(status)
            except Exception as e:
                self.logger.error(f"Failed to complete sync tracking: {e}")

        if self.conn:
            self.conn.close()

        self.logger.info(f"Completed: {self.stats.to_dict()}")
        return False

    def _start_sync(self) -> int:
        """Start sync tracking, return history_id."""
        with self.conn.cursor() as cur:
            cur.execute(
                "INSERT INTO system.sync_history (sync_name, triggered_by) "
                "VALUES (%s, %s) RETURNING history_id",
                (self.sync_name, get_current_user())
            )
            history_id = cur.fetchone()['history_id']
            
            cur.execute(
                "UPDATE system.sync_status SET status = 'warning', "
                "last_run_at = CURRENT_TIMESTAMP WHERE sync_name = %s",
                (self.sync_name,)
            )
            self.conn.commit()
            return history_id

    def _complete_sync(self, status: str):
        """Complete sync tracking with final stats."""
        with self.conn.cursor() as cur:
            # Update history record
            cur.execute("""
                UPDATE system.sync_history SET
                    completed_at = CURRENT_TIMESTAMP,
                    status = %s,
                    records_processed = %s,
                    records_inserted = %s,
                    records_updated = %s,
                    records_failed = %s,
                    records_deactivated = %s,
                    error_message = %s
                WHERE history_id = %s
            """, (
                status,
                self.stats.processed,
                self.stats.inserted,
                self.stats.updated,
                self.stats.failed,
                self.stats.deactivated,
                self._error_message,
                self.history_id
            ))

            # Update sync status
            if status == 'success':
                cur.execute("""
                    UPDATE system.sync_status SET
                        status = 'healthy',
                        last_success_at = CURRENT_TIMESTAMP,
                        consecutive_failures = 0,
                        records_processed = %s,
                        records_inserted = %s,
                        records_updated = %s,
                        records_failed = %s,
                        last_error_message = NULL
                    WHERE sync_name = %s
                """, (
                    self.stats.processed,
                    self.stats.inserted,
                    self.stats.updated,
                    self.stats.failed,
                    self.sync_name
                ))
            else:
                cur.execute("""
                    UPDATE system.sync_status SET
                        status = 'error',
                        last_failure_at = CURRENT_TIMESTAMP,
                        consecutive_failures = consecutive_failures + 1,
                        last_error_message = %s
                    WHERE sync_name = %s
                """, (self._error_message, self.sync_name))
            
            self.conn.commit()

    def record_error(self, msg: str):
        """Record an error during sync."""
        self.stats.add_error(msg)
        self._error_message = msg


def create_argument_parser(
    description: str,
    include_dry_run: bool = True,
    include_verbose: bool = True
) -> argparse.ArgumentParser:
    """Create argument parser with common options."""
    parser = argparse.ArgumentParser(description=description)
    
    if include_dry_run:
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Validate without making database changes'
        )
    
    if include_verbose:
        parser.add_argument(
            '--verbose', '-v',
            action='store_true',
            help='Enable debug logging'
        )
    
    return parser


def configure_verbosity(verbose: bool) -> None:
    """Set logging level based on verbosity flag."""
    level = logging.DEBUG if verbose else logging.INFO
    logging.getLogger().setLevel(level)
