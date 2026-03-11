"""Common utilities for Operations Platform sync scripts."""

import os
import sys
import logging
import argparse
import re
import socket
import random
import time
from datetime import datetime, timedelta, timezone
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

    if retries < 1:
        raise ValueError(f"retries must be >= 1, got {retries!r}")

    last_exception: Exception | None = None
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
            wait = backoff ** attempt + random.uniform(0, 1)
            logger.info("Retrying in %.1f seconds...", wait)
            time.sleep(wait)

    raise last_exception  # type: ignore[misc]


ALLOWED_QUERY_OVERRIDES = {'DATABRICKS_QUERY', 'DATABRICKS_EOL_QUERY'}


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
        if env_var_override not in ALLOWED_QUERY_OVERRIDES:
            raise ValueError(
                f"Invalid env_var_override '{env_var_override}' — "
                f"must be one of {sorted(ALLOWED_QUERY_OVERRIDES)}"
            )
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

    manifest = result.get('manifest')
    if not manifest or not isinstance(manifest, dict):
        raise RuntimeError(
            "Databricks response missing or invalid 'manifest' field — "
            "unexpected API response structure. Check the API version."
        )
    schema = manifest.get('schema')
    if not schema or not isinstance(schema, dict):
        raise RuntimeError(
            "Databricks response missing 'manifest.schema' — "
            "unexpected API response structure."
        )
    columns_raw = schema.get('columns')
    if not isinstance(columns_raw, list):
        raise RuntimeError(
            f"Databricks 'manifest.schema.columns' is not a list "
            f"(got {type(columns_raw).__name__}) — unexpected API response structure."
        )
    for i, col in enumerate(columns_raw):
        if not isinstance(col, dict) or 'name' not in col:
            raise RuntimeError(
                f"Databricks column at index {i} missing 'name' key — got {col!r}"
            )
    columns = [col['name'].lower() for col in columns_raw]

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
    """Create PostgreSQL connection from params or environment variables.

    Credentials can be supplied via:
      - OPS_DB_PASSWORD environment variable (Azure DevOps secret variable recommended)
      - A .pgpass file: set OPS_DB_USE_PGPASS=1 and psycopg2 will read ~/.pgpass
        or the file at PGPASSFILE. This is the preferred option for production as
        it avoids storing the password in process environment at all.

    SSL:
      - Set OPS_DB_SSLMODE=verify-full and OPS_DB_SSLROOTCERT=/path/to/ca.crt for
        full certificate verification (strongly recommended in production).
      - Defaults to sslmode=require which encrypts but does not verify the server cert.
    """
    _log = logging.getLogger('database')

    db_user = user or os.environ.get('OPS_DB_USER')
    db_password = password or os.environ.get('OPS_DB_PASSWORD')
    use_pgpass = os.environ.get('OPS_DB_USE_PGPASS', '').lower() in ('1', 'true', 'yes')

    if not db_user:
        raise EnvironmentError("Database user not configured: set OPS_DB_USER or pass user parameter")
    if not db_password and not use_pgpass:
        raise EnvironmentError(
            "Database password not configured: set OPS_DB_PASSWORD, or set OPS_DB_USE_PGPASS=1 "
            "to authenticate via a .pgpass file (recommended for production)"
        )

    sslmode = os.environ.get('OPS_DB_SSLMODE', 'require')
    sslrootcert = os.environ.get('OPS_DB_SSLROOTCERT')

    if sslmode not in ('verify-full', 'verify-ca'):
        _log.warning(
            "Database SSL mode is %r — server certificate is not verified. "
            "Set OPS_DB_SSLMODE=verify-full and OPS_DB_SSLROOTCERT=/path/to/ca.crt "
            "for full verification in production.",
            sslmode
        )

    connect_kwargs: dict = dict(
        host=host or os.environ.get('OPS_DB_HOST', 'localhost'),
        port=port or int(os.environ.get('OPS_DB_PORT', '5432')),
        database=database or os.environ.get('OPS_DB_NAME', 'ops_platform'),
        user=db_user,
        application_name=app_name,
        cursor_factory=RealDictCursor,
        sslmode=sslmode,
    )
    if db_password:
        connect_kwargs['password'] = db_password
    if sslrootcert:
        connect_kwargs['sslrootcert'] = sslrootcert

    conn = psycopg2.connect(**connect_kwargs)
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


class CircuitBreakerOpenError(Exception):
    """Raised by SyncContext.check_circuit_breaker() when a sync has failed too many times recently.

    The circuit breaker reads consecutive_failures and last_failure_at from
    system.sync_status. When open, SyncContext.__exit__() suppresses this exception
    and records the run as 'cancelled' so the pipeline step exits with code 0.
    """
    def __init__(
        self,
        sync_name: str,
        consecutive_failures: int,
        last_failure_at: datetime,
        retry_after: datetime,
    ):
        self.sync_name = sync_name
        self.consecutive_failures = consecutive_failures
        self.last_failure_at = last_failure_at
        self.retry_after = retry_after
        super().__init__(
            f"Circuit breaker OPEN for '{sync_name}': {consecutive_failures} consecutive failures, "
            f"last failure at {last_failure_at:%Y-%m-%d %H:%M:%S %Z}, "
            f"will retry after {retry_after:%Y-%m-%d %H:%M:%S %Z}"
        )


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

    def check_circuit_breaker(self) -> None:
        """Skip this sync run if too many consecutive failures have occurred recently.

        Reads consecutive_failures and last_failure_at from system.sync_status.
        Opens the circuit (raises CircuitBreakerOpenError) when both conditions hold:
          - consecutive_failures >= CIRCUIT_BREAKER_THRESHOLD (default: 3)
          - last_failure_at is within CIRCUIT_BREAKER_TIMEOUT_SECONDS (default: 7200)

        Fails open on any DB error — the sync will proceed rather than silently skip.
        Does nothing in dry-run mode (the sync should always attempt in dry-run).
        """
        if self.dry_run:
            return

        threshold = max(int(os.environ.get('CIRCUIT_BREAKER_THRESHOLD', '3')), 1)
        timeout_seconds = int(os.environ.get('CIRCUIT_BREAKER_TIMEOUT_SECONDS', '7200'))

        try:
            with self.conn.cursor() as cur:
                cur.execute(
                    "SELECT consecutive_failures, last_failure_at "
                    "FROM system.sync_status WHERE sync_name = %s",
                    (self.sync_name,)
                )
                row = cur.fetchone()
        except Exception as exc:
            self.logger.warning(
                "Circuit breaker check failed (DB error) — proceeding with sync: %s", exc
            )
            return

        if row is None:
            return  # No tracking row yet — first run, proceed normally

        failures = row['consecutive_failures'] or 0
        last_failure_at = row['last_failure_at']

        if failures < threshold or last_failure_at is None:
            return

        now = datetime.now(timezone.utc)
        # last_failure_at from psycopg2 TIMESTAMPTZ is already timezone-aware
        elapsed = (now - last_failure_at).total_seconds()
        if elapsed >= timeout_seconds:
            return  # Cooldown has passed — let the sync attempt

        retry_after = last_failure_at + timedelta(seconds=timeout_seconds)
        self.logger.warning(
            "Circuit breaker OPEN for '%s': %d consecutive failures, "
            "last failure at %s UTC, will retry after %s UTC.",
            self.sync_name,
            failures,
            last_failure_at.strftime('%Y-%m-%d %H:%M:%S'),
            retry_after.strftime('%Y-%m-%d %H:%M:%S'),
        )
        raise CircuitBreakerOpenError(self.sync_name, failures, last_failure_at, retry_after)

    def __exit__(self, exc_type, exc_val, exc_tb):
        # Circuit breaker fired — record the skip as 'cancelled' and exit cleanly.
        if exc_type is CircuitBreakerOpenError:
            if self.conn:
                try:
                    with self.conn.cursor() as cur:
                        if self.history_id:
                            cur.execute(
                                "UPDATE system.sync_history SET "
                                "completed_at = CURRENT_TIMESTAMP, status = 'cancelled', "
                                "error_message = %s WHERE history_id = %s",
                                (str(exc_val), self.history_id)
                            )
                        cur.execute(
                            "UPDATE system.sync_status SET "
                            "consecutive_failures = consecutive_failures + 1, "
                            "last_failure_at = CURRENT_TIMESTAMP "
                            "WHERE sync_name = %s",
                            (self.sync_name,)
                        )
                    self.conn.commit()
                except Exception as db_err:
                    self.logger.warning("Failed to record circuit breaker skip: %s", db_err)
            if self.conn:
                self.conn.close()
            self.logger.info("Sync '%s' skipped — circuit breaker open.", self.sync_name)
            return True  # Suppress exception; process exits 0

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

        if not self.dry_run and self.history_id and self.conn:
            try:
                self._complete_sync(status)
            except Exception as e:
                self.logger.error(f"Failed to complete sync tracking: {e}")
                # Rollback the failed tracking update to leave connection clean
                try:
                    self.conn.rollback()
                except Exception as rb_err:
                    self.logger.warning(f"Rollback after tracking failure also failed: {rb_err}")
                # Ensure sync_status is updated even if full tracking failed,
                # so the health dashboard and circuit breaker reflect reality.
                try:
                    with self.conn.cursor() as cur:
                        cur.execute(
                            "UPDATE system.sync_status SET status = 'error', "
                            "last_failure_at = CURRENT_TIMESTAMP, "
                            "consecutive_failures = consecutive_failures + 1, "
                            "last_error_message = %s WHERE sync_name = %s",
                            (f"Tracking failure: {e}", self.sync_name)
                        )
                    self.conn.commit()
                except Exception as fallback_err:
                    # Both the main and fallback tracking updates failed on the existing
                    # connection (likely broken). Open a fresh connection as a last resort
                    # to prevent sync_status being stuck at 'warning' permanently.
                    self.logger.error("Fallback sync_status update failed: %s — attempting fresh connection", fallback_err)
                    try:
                        with get_database_connection(app_name=f"{self.app_name}_recovery") as recovery_conn:
                            with recovery_conn.cursor() as cur:
                                cur.execute(
                                    "UPDATE system.sync_status SET status = 'error', "
                                    "last_failure_at = CURRENT_TIMESTAMP, "
                                    "consecutive_failures = consecutive_failures + 1, "
                                    "last_error_message = %s WHERE sync_name = %s",
                                    (f"Recovery update after double failure: {e}", self.sync_name)
                                )
                            recovery_conn.commit()
                            self.logger.info("Recovery connection successfully updated sync_status to 'error'")
                    except Exception as recovery_err:
                        self.logger.critical(
                            "MANUAL INTERVENTION REQUIRED: sync_status for '%s' is stuck at 'warning'. "
                            "Run: UPDATE system.sync_status SET status = 'error' WHERE sync_name = '%s'; "
                            "Recovery error: %s", self.sync_name, self.sync_name, recovery_err
                        )

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
            row = cur.fetchone()
            if row is None:
                raise RuntimeError(f"Failed to create sync_history record for {self.sync_name!r}")
            history_id = row['history_id']
            
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


_SAVEPOINT_NAME_RE = re.compile(r'^[a-zA-Z_][a-zA-Z0-9_]*$')

@contextmanager
def savepoint(cur, name: str = 'sp'):
    """Context manager for PostgreSQL savepoints with automatic rollback on error."""
    if not _SAVEPOINT_NAME_RE.match(name):
        raise ValueError(f"Invalid savepoint name: {name!r}")
    cur.execute(f"SAVEPOINT {name}")
    try:
        yield
        cur.execute(f"RELEASE SAVEPOINT {name}")
    except Exception:
        cur.execute(f"ROLLBACK TO SAVEPOINT {name}")
        raise


def count_upsert_results(rows) -> tuple:
    """Count inserts/updates from RETURNING (xmax = 0) AS is_insert rows."""
    inserted = sum(1 for r in rows if r['is_insert'])
    updated = sum(1 for r in rows if not r['is_insert'])
    return inserted, updated


def resolve_server_name(cur, server_name: str, source_system: str, context_id=None):
    """Resolve server_id via system.resolve_server_name, record unmatched if not found.

    Returns server_id or None.
    """
    logger = logging.getLogger('resolve_server')
    cur.execute(
        "SELECT server_id FROM system.resolve_server_name(%s) LIMIT 1",
        (server_name,)
    )
    row = cur.fetchone()
    server_id = row['server_id'] if row else None

    if not server_id:
        try:
            cur.execute(
                "SELECT system.record_unmatched_server(%s, %s, %s)",
                (server_name, source_system, context_id)
            )
        except Exception as e:
            # DB function uses ON CONFLICT DO UPDATE, so unique violations
            # should not occur. Log at error level for unexpected failures.
            logger.error("Failed to record unmatched server '%s' (source=%s): %s",
                         server_name, source_system, e)

    return server_id
