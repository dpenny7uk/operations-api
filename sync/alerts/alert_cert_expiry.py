"""Alert Teams when certificates are expiring or expired.

Queries certificates.v_expiring_soon for CRITICAL certs (<=14 days) and
posts an Adaptive Card to Teams. Uses certificates.alerts to track which
notifications have been sent, avoiding duplicate alerts for the same cert.

Designed to run as a post-sync step after sync_certificates.py.
"""

import os
import re
import logging
from datetime import datetime

from common import (
    setup_logging, create_argument_parser, configure_verbosity,
    validate_env_vars, http_request, get_database_connection
)

logger = setup_logging('cert_expiry_alert')

_TEAMS_WEBHOOK_RE = re.compile(
    r'^https://[a-zA-Z0-9.-]+\.(webhook\.office\.com|powerplatform\.com)[:/]'
)


def _validate_teams_url(url: str) -> None:
    if not url.startswith('https://'):
        raise ValueError(
            f"TEAMS_WEBHOOK_URL must use HTTPS — got: {url!r}"
        )
    if not _TEAMS_WEBHOOK_RE.match(url):
        raise ValueError(
            f"TEAMS_WEBHOOK_URL must be a webhook.office.com or powerplatform.com URL — "
            f"got: {url!r}. Set TEAMS_WEBHOOK_URL to the webhook URL from your Teams channel."
        )


_CERT_ALERT_BASE = """
    SELECT
        c.certificate_id,
        c.subject_cn,
        c.thumbprint,
        c.valid_to,
        c.days_until_expiry,
        c.alert_level,
        c.server_name,
        c.store_name,
        c.is_expired,
        s.environment,
        a.application_name,
        a.criticality
    FROM certificates.inventory c
    LEFT JOIN shared.servers s ON c.server_id = s.server_id
    LEFT JOIN shared.applications a ON s.primary_application_id = a.application_id
    WHERE c.is_active
      AND c.valid_to IS NOT NULL
      AND UPPER(c.server_name) NOT IN (
          SELECT UPPER(server_name) FROM system.scan_failures
          WHERE scan_type = 'certificate' AND NOT is_resolved
      )
      AND c.certificate_id NOT IN (
          SELECT certificate_id FROM certificates.alerts
          WHERE alert_type = 'expiry_teams'
            AND notification_sent = TRUE
            AND NOT resolved
            AND notification_sent_at >= CURRENT_TIMESTAMP - INTERVAL '7 days'
      )
"""

CRITICAL_QUERY = _CERT_ALERT_BASE + """
      AND c.days_until_expiry <= 14
    ORDER BY c.days_until_expiry, c.server_name
"""

WARNING_QUERY = _CERT_ALERT_BASE + """
      AND c.days_until_expiry > 14
      AND c.days_until_expiry <= 30
    ORDER BY c.days_until_expiry, c.server_name
"""


def build_adaptive_card(expired: list, critical: list, warning: list | None = None) -> dict:
    """Build a Teams Adaptive Card for expiring certificates."""
    warning = warning or []
    total = len(expired) + len(critical) + len(warning)
    title = f"Certificate Alert: {total} certificate(s) require attention"

    body = [
        {
            "type": "TextBlock",
            "size": "medium",
            "weight": "bolder",
            "text": title,
            "style": "heading",
            "color": "attention"
        }
    ]

    if expired:
        body.append({
            "type": "TextBlock",
            "text": f"\U0001f534 **EXPIRED ({len(expired)})**",
            "weight": "bolder"
        })
        body.append({
            "type": "FactSet",
            "facts": [_cert_fact(c) for c in expired]
        })

    if critical:
        body.append({
            "type": "TextBlock",
            "text": f"\U0001f7e0 **EXPIRING WITHIN 14 DAYS ({len(critical)})**",
            "weight": "bolder"
        })
        body.append({
            "type": "FactSet",
            "facts": [_cert_fact(c) for c in critical]
        })

    if warning:
        body.append({
            "type": "TextBlock",
            "text": f"\U0001f7e1 **EXPIRING WITHIN 30 DAYS ({len(warning)})**",
            "weight": "bolder"
        })
        body.append({
            "type": "FactSet",
            "facts": [_cert_fact(c) for c in warning]
        })

    return {
        "type": "message",
        "attachments": [{
            "contentType": "application/vnd.microsoft.card.adaptive",
            "content": {
                "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                "type": "AdaptiveCard",
                "version": "1.4",
                "body": body
            }
        }]
    }


def _cert_fact(cert: dict) -> dict:
    cn = cert['subject_cn'] or cert['thumbprint'][:16]
    server = cert['server_name']
    env = cert.get('environment') or ''
    app = cert.get('application_name') or ''
    days = cert['days_until_expiry']
    expiry = cert['valid_to'].strftime('%Y-%m-%d') if cert['valid_to'] else '?'

    label = f"{cn} on {server}"
    if env:
        label += f" ({env})"

    if days < 0:
        value = f"EXPIRED {abs(days)}d ago ({expiry})"
    elif days == 0:
        value = f"EXPIRES TODAY ({expiry})"
    else:
        value = f"{days}d remaining ({expiry})"
    if app:
        value += f" — {app}"

    return {"title": label, "value": value}


def record_alerts(conn, cert_ids: list):
    """Record that notifications were sent for these certificates."""
    with conn.cursor() as cur:
        for cert_id in cert_ids:
            cur.execute("""
                INSERT INTO certificates.alerts
                    (certificate_id, alert_type, alert_level, alert_message,
                     days_until_expiry, notification_sent, notification_sent_at)
                SELECT
                    c.certificate_id, 'expiry_teams', c.alert_level,
                    'Teams notification sent',
                    c.days_until_expiry, TRUE, CURRENT_TIMESTAMP
                FROM certificates.inventory c
                WHERE c.certificate_id = %s
            """, (cert_id,))
        conn.commit()


def main():
    parser = create_argument_parser(
        'Alert Teams about expiring/expired certificates',
        include_dry_run=True
    )
    args = parser.parse_args()
    configure_verbosity(args.verbose)

    validate_env_vars(['TEAMS_WEBHOOK_URL'])
    webhook_url = os.environ['TEAMS_WEBHOOK_URL']
    _validate_teams_url(webhook_url)

    conn = get_database_connection(app_name='cert_expiry_alert')
    try:
        with conn.cursor() as cur:
            cur.execute(CRITICAL_QUERY)
            certs = [dict(row) for row in cur.fetchall()]
            cur.execute(WARNING_QUERY)
            warning_certs = [dict(row) for row in cur.fetchall()]

        if not certs and not warning_certs:
            logger.info("No new certificate expiry alerts to send")
            return

        # Treat NULL days_until_expiry as critical (unknown expiry date)
        expired = [c for c in certs if c['days_until_expiry'] is not None and c['days_until_expiry'] < 0]
        critical = [c for c in certs if c['days_until_expiry'] is None or c['days_until_expiry'] >= 0]

        logger.warning(
            f"Found {len(expired)} expired + {len(critical)} critical + {len(warning_certs)} warning certs — sending alert"
        )
        card = build_adaptive_card(expired, critical, warning_certs)

        if args.dry_run:
            import json
            logger.info(f"[DRY RUN] Would post to Teams:\n{json.dumps(card, indent=2, default=str)}")
            logger.info(f"[DRY RUN] Would record alerts for {len(certs) + len(warning_certs)} certificates")
            return

        http_request('POST', webhook_url, json=card, retries=2, timeout=15)
        logger.info("Teams alert sent")

        cert_ids = [c['certificate_id'] for c in certs] + [c['certificate_id'] for c in warning_certs]
        record_alerts(conn, cert_ids)
        logger.info(f"Recorded {len(cert_ids)} alert(s) in certificates.alerts")
    finally:
        conn.close()


if __name__ == '__main__':
    main()
