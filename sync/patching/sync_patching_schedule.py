#!/usr/bin/env python3
"""Sync patching schedule from internal HTML page to PostgreSQL."""

import os
import sys
import re
from datetime import datetime

from bs4 import BeautifulSoup

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from common import (
    setup_logging, create_argument_parser, configure_verbosity, SyncContext,
    http_request, savepoint, resolve_server_name
)

logger = setup_logging('sync_patching_html')

DEFAULT_URL = 'https://contosodeployment.contoso.com/patching%20schedule.htm'

# HTML table column -> DB schema mapping
COLUMN_MAP = {
    'server': 'server_name',
    'domain': 'domain',
    'app': 'app',
    'service': 'service',
    'support team': 'support_team',
    'business unit': 'business_unit',
    'contact': 'contact',
    'patchgroup': 'patch_group',
    'scheduled time': 'scheduled_time',
}


def fetch_page(url: str) -> str:
    """Fetch the patching schedule HTML page."""
    resp = http_request('GET', url, timeout=30)
    return resp.text


def parse_cycle_date(soup: BeautifulSoup) -> datetime:
    """Extract cycle date from h1 heading (e.g. 'Patching Schedule 12/03/2026')."""
    h1 = soup.find('h1')
    if not h1:
        raise ValueError("No <h1> found in page")

    text = h1.get_text(strip=True)
    match = re.search(r'(\d{2}/\d{2}/\d{4})', text)
    if match:
        return datetime.strptime(match.group(1), '%d/%m/%Y')

    match = re.search(r'(\d{4}-\d{2}-\d{2})', text)
    if match:
        return datetime.strptime(match.group(1), '%Y-%m-%d')

    raise ValueError(f"Cannot parse date from heading: {text}")


def parse_last_updated(soup: BeautifulSoup) -> str | None:
    """Extract 'Last updated' text from page."""
    for p in soup.find_all('p'):
        text = p.get_text(strip=True)
        if 'last updated' in text.lower():
            return text
    return None


def parse_group_sections(soup: BeautifulSoup) -> list[dict]:
    """Parse all Shavlik group sections, return flat list of server dicts."""
    servers = []

    for h2 in soup.find_all('h2'):
        h2_id = h2.get('id', '')
        h2_text = h2.get_text(strip=True)

        # Extract patch group name from heading (e.g. "Shavlik_8a" -> "8a")
        group_match = re.search(r'[Ss]havlik[_ ]?(\w+)', h2_id or h2_text)
        if not group_match:
            continue

        section_group = group_match.group(1)

        # Find the next table after this h2
        table = h2.find_next('table')
        if not table:
            continue

        # Parse table headers
        header_row = table.find('tr')
        if not header_row:
            continue

        headers = [th.get_text(strip=True).lower() for th in header_row.find_all(['th', 'td'])]

        # Parse data rows
        for row in table.find_all('tr')[1:]:
            cells = row.find_all('td')
            if len(cells) != len(headers):
                logger.debug("Skipping row: %d cells but %d headers", len(cells), len(headers))
                continue

            record = {}
            for header, cell in zip(headers, cells):
                value = cell.get_text(strip=True)
                mapped = COLUMN_MAP.get(header)
                if mapped and value:
                    record[mapped] = value[:255]

            # Use section group as fallback if no patch_group column
            if 'server_name' in record:
                if not record.get('patch_group'):
                    record['patch_group'] = section_group
                servers.append(record)

    return servers


def process_servers(ctx, cycle_id: int, servers: list[dict]):
    """Resolve server names and upsert into patch_schedule."""
    with ctx.conn.cursor() as cur:
        for server in servers:
            server_name = server.get('server_name')
            if not server_name:
                continue

            ctx.stats.processed += 1

            # Resolve server_id
            server_id = resolve_server_name(cur, server_name, 'patching_html', cycle_id)
            if not server_id:
                ctx.stats.unmatched += 1

            try:
                with savepoint(cur, 'srv'):
                    cur.execute("""
                        INSERT INTO patching.patch_schedule (
                            cycle_id, server_name, server_type, server_id,
                            domain, app, service, support_team, business_unit,
                            contact, patch_group, scheduled_time
                        )
                        VALUES (%s, %s, 'onprem', %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (cycle_id, server_name, server_type) DO UPDATE SET
                            server_id = EXCLUDED.server_id,
                            app = EXCLUDED.app,
                            service = EXCLUDED.service,
                            patch_group = EXCLUDED.patch_group,
                            scheduled_time = EXCLUDED.scheduled_time
                        RETURNING (xmax = 0) AS is_insert
                    """, (
                        cycle_id,
                        server_name,
                        server_id,
                        server.get('domain'),
                        server.get('app'),
                        server.get('service'),
                        server.get('support_team'),
                        server.get('business_unit'),
                        server.get('contact'),
                        server.get('patch_group'),
                        server.get('scheduled_time'),
                    ))
                    row = cur.fetchone()
                    if row and row['is_insert']:
                        ctx.stats.inserted += 1
                    else:
                        ctx.stats.updated += 1

            except Exception as e:
                ctx.stats.add_error(f"Failed {server_name}: {e}")


def main():
    parser = create_argument_parser("Sync patching schedule from HTML page")
    parser.add_argument('--url', default=DEFAULT_URL, help='URL of the patching schedule page')
    args = parser.parse_args()
    configure_verbosity(args.verbose)

    if not args.url.startswith('https://'):
        logger.error(f"Invalid URL scheme: {args.url} — only https allowed")
        sys.exit(1)

    import ipaddress
    import socket
    from urllib.parse import urlparse

    parsed = urlparse(args.url)
    hostname = parsed.hostname
    if not hostname:
        logger.error("URL has no hostname")
        sys.exit(1)

    # Resolve hostname to IP(s) and validate each resolved address.
    # This prevents DNS rebinding: a hostname that passes the name check
    # but resolves to a private/internal IP at request time.
    try:
        resolved = socket.getaddrinfo(hostname, None)
    except socket.gaierror as exc:
        logger.error(f"Cannot resolve hostname {hostname!r}: {exc}")
        sys.exit(1)

    for _family, _type, _proto, _canonname, sockaddr in resolved:
        raw_ip = sockaddr[0]
        try:
            addr = ipaddress.ip_address(raw_ip)
        except ValueError:
            logger.error(f"Unexpected address format from getaddrinfo: {raw_ip!r}")
            sys.exit(1)

        if (addr.is_loopback or addr.is_link_local or addr.is_multicast
                or addr.is_reserved or addr.is_unspecified):
            logger.error(f"URL {args.url!r} resolves to restricted address {raw_ip}")
            sys.exit(1)

        if addr.version == 4:
            # Block RFC-1918 private ranges not covered by is_private in older Python:
            # 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
            private_ranges = [
                ipaddress.ip_network('10.0.0.0/8'),
                ipaddress.ip_network('172.16.0.0/12'),
                ipaddress.ip_network('192.168.0.0/16'),
                ipaddress.ip_network('169.254.0.0/16'),  # link-local / IMDS
            ]
            if any(addr in net for net in private_ranges):
                logger.error(f"URL {args.url!r} resolves to private address {raw_ip}")
                sys.exit(1)
        else:
            # IPv6: block private/ULA (fc00::/7), loopback (::1), link-local (fe80::/10),
            # and IPv4-mapped addresses (::ffff:0:0/96) which can bypass IPv4 checks.
            ipv6_private = [
                ipaddress.ip_network('::ffff:0:0/96'),  # IPv4-mapped IPv6 (SSRF bypass)
                ipaddress.ip_network('fc00::/7'),        # Unique Local Address (ULA)
                ipaddress.ip_network('fe80::/10'),       # Link-local
                ipaddress.ip_network('::1/128'),         # Loopback
            ]
            if any(addr in net for net in ipv6_private):
                logger.error(f"URL {args.url!r} resolves to private IPv6 address {raw_ip}")
                sys.exit(1)

    logger.info(f"Fetching patching schedule from {args.url}")
    html = fetch_page(args.url)
    soup = BeautifulSoup(html, 'lxml')

    cycle_date = parse_cycle_date(soup)
    last_updated = parse_last_updated(soup)
    logger.info(f"Cycle date: {cycle_date.date()}, {last_updated or 'no update timestamp found'}")

    servers = parse_group_sections(soup)
    if not servers:
        logger.warning("No servers found in HTML page")
        sys.exit(0)

    logger.info(f"Parsed {len(servers)} servers from HTML")

    with SyncContext("patching_schedule_html", "Patching Schedule (HTML)", dry_run=args.dry_run) as ctx:
        ctx.check_circuit_breaker()
        if ctx.conn is None:
            raise RuntimeError("Failed to establish database connection")

        # Create or get patch cycle
        with ctx.conn.cursor() as cur:
            cur.execute("""
                INSERT INTO patching.patch_cycles (cycle_date, file_name)
                VALUES (%s, %s)
                ON CONFLICT (cycle_date) DO UPDATE SET
                    file_name = EXCLUDED.file_name,
                    updated_at = CURRENT_TIMESTAMP
                RETURNING cycle_id
            """, (cycle_date.date(), args.url))
            row = cur.fetchone()
            if row is None:
                raise RuntimeError("Failed to create/get patch cycle — INSERT RETURNING returned no row")
            cycle_id = row['cycle_id']  # type: ignore[index]

        process_servers(ctx, cycle_id, servers)

        # Update cycle counts
        with ctx.conn.cursor() as cur:
            cur.execute("""
                UPDATE patching.patch_cycles SET
                    servers_onprem = %s
                WHERE cycle_id = %s
            """, (ctx.stats.processed, cycle_id))

        if not ctx.dry_run:
            ctx.conn.commit()

    logger.info(f"Done. Processed {len(servers)} servers for cycle {cycle_date.date()}")


if __name__ == "__main__":
    main()
