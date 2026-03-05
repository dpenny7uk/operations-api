"""Tests for alert script card building and logic."""

import sys
import os
from datetime import datetime

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'alerts'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from sync_health_alert import build_adaptive_card as build_health_card
from alert_cert_expiry import build_adaptive_card as build_cert_card, _cert_fact
from alert_unmatched_spike import build_adaptive_card as build_unmatched_card


# ── Health alert card ────────────────────────────────────────────────────────

class TestHealthAlertCard:
    def _make_summary(self, overall='error', syncs=None, unreachable=0, unmatched=0):
        if syncs is None:
            syncs = [
                {
                    'syncName': 'databricks_servers',
                    'freshnessStatus': 'stale',
                    'hoursSinceSuccess': 30.5,
                    'lastErrorMessage': None
                },
                {
                    'syncName': 'certificate_scan',
                    'freshnessStatus': 'healthy',
                    'hoursSinceSuccess': 2.1,
                    'lastErrorMessage': None
                }
            ]
        return {
            'overallStatus': overall,
            'syncStatuses': syncs,
            'unreachableServersCount': unreachable,
            'unmatchedServersCount': unmatched,
            'lastUpdated': '2025-01-01T00:00:00Z'
        }

    def test_card_structure(self):
        card = build_health_card(self._make_summary())
        assert card['type'] == 'message'
        assert len(card['attachments']) == 1
        content = card['attachments'][0]['content']
        assert content['type'] == 'AdaptiveCard'

    def test_card_title_includes_status(self):
        card = build_health_card(self._make_summary(overall='warning'))
        title = card['attachments'][0]['content']['body'][0]['text']
        assert 'WARNING' in title

    def test_card_includes_all_syncs(self):
        card = build_health_card(self._make_summary())
        facts = card['attachments'][0]['content']['body'][1]['facts']
        sync_names = [f['title'] for f in facts]
        assert 'databricks_servers' in sync_names
        assert 'certificate_scan' in sync_names

    def test_unreachable_shown_when_nonzero(self):
        card = build_health_card(self._make_summary(unreachable=5))
        facts = card['attachments'][0]['content']['body'][1]['facts']
        titles = [f['title'] for f in facts]
        assert 'Unreachable Servers' in titles

    def test_unreachable_hidden_when_zero(self):
        card = build_health_card(self._make_summary(unreachable=0))
        facts = card['attachments'][0]['content']['body'][1]['facts']
        titles = [f['title'] for f in facts]
        assert 'Unreachable Servers' not in titles

    def test_stale_sync_has_hours(self):
        card = build_health_card(self._make_summary())
        facts = card['attachments'][0]['content']['body'][1]['facts']
        stale_fact = [f for f in facts if f['title'] == 'databricks_servers'][0]
        assert '30h ago' in stale_fact['value'] or '31h ago' in stale_fact['value']

    def test_error_message_included(self):
        syncs = [{
            'syncName': 'failing_sync',
            'freshnessStatus': 'error',
            'hoursSinceSuccess': None,
            'lastErrorMessage': 'Connection refused'
        }]
        card = build_health_card(self._make_summary(syncs=syncs))
        facts = card['attachments'][0]['content']['body'][1]['facts']
        assert 'Connection refused' in facts[0]['value']


# ── Certificate expiry card ──────────────────────────────────────────────────

class TestCertExpiryCard:
    def test_cert_fact_expired(self):
        cert = {
            'subject_cn': 'expired.contoso.com',
            'thumbprint': 'ABC123',
            'server_name': 'WEB01',
            'environment': 'Production',
            'application_name': 'Portal',
            'days_until_expiry': -5,
            'valid_to': datetime(2025, 1, 1),
            'is_expired': True,
        }
        fact = _cert_fact(cert)
        assert 'expired.contoso.com' in fact['title']
        assert 'WEB01' in fact['title']
        assert 'EXPIRED 5d ago' in fact['value']

    def test_cert_fact_expires_today(self):
        cert = {
            'subject_cn': 'today.contoso.com',
            'thumbprint': 'DEF456',
            'server_name': 'WEB02',
            'environment': None,
            'application_name': None,
            'days_until_expiry': 0,
            'valid_to': datetime(2025, 6, 15),
            'is_expired': False,
        }
        fact = _cert_fact(cert)
        assert 'EXPIRES TODAY' in fact['value']

    def test_cert_fact_days_remaining(self):
        cert = {
            'subject_cn': 'soon.contoso.com',
            'thumbprint': 'GHI789',
            'server_name': 'WEB03',
            'environment': 'Staging',
            'application_name': 'API',
            'days_until_expiry': 7,
            'valid_to': datetime(2025, 6, 22),
            'is_expired': False,
        }
        fact = _cert_fact(cert)
        assert '7d remaining' in fact['value']
        assert 'API' in fact['value']
        assert 'Staging' in fact['title']

    def test_cert_fact_no_cn_uses_thumbprint(self):
        cert = {
            'subject_cn': None,
            'thumbprint': 'ABCDEF1234567890',
            'server_name': 'WEB04',
            'environment': None,
            'application_name': None,
            'days_until_expiry': 3,
            'valid_to': datetime(2025, 6, 18),
            'is_expired': False,
        }
        fact = _cert_fact(cert)
        assert 'ABCDEF1234567890' in fact['title']

    def test_card_separates_expired_and_critical(self):
        expired = [{
            'subject_cn': 'exp.com', 'thumbprint': 'A', 'server_name': 'S1',
            'environment': None, 'application_name': None,
            'days_until_expiry': -1, 'valid_to': datetime(2025, 1, 1), 'is_expired': True,
        }]
        critical = [{
            'subject_cn': 'crit.com', 'thumbprint': 'B', 'server_name': 'S2',
            'environment': None, 'application_name': None,
            'days_until_expiry': 5, 'valid_to': datetime(2025, 6, 20), 'is_expired': False,
        }]
        card = build_cert_card(expired, critical)
        body = card['attachments'][0]['content']['body']
        texts = [b.get('text', '') for b in body]
        assert any('EXPIRED' in t for t in texts)
        assert any('EXPIRING' in t for t in texts)

    def test_card_only_expired(self):
        expired = [{
            'subject_cn': 'exp.com', 'thumbprint': 'A', 'server_name': 'S1',
            'environment': None, 'application_name': None,
            'days_until_expiry': -1, 'valid_to': datetime(2025, 1, 1), 'is_expired': True,
        }]
        card = build_cert_card(expired, [])
        body = card['attachments'][0]['content']['body']
        texts = [b.get('text', '') for b in body]
        assert any('EXPIRED' in t for t in texts)
        assert not any('EXPIRING' in t for t in texts)


# ── Unmatched server spike card ──────────────────────────────────────────────

class TestUnmatchedSpikeCard:
    def test_basic_card(self):
        unmatched = [
            {
                'server_name_raw': 'NEWSERVER01',
                'source_system': 'patching_html',
                'occurrence_count': 1,
                'first_seen_at': datetime(2025, 6, 15),
                'suggested_match': 'NEWSERVER-01',
            },
            {
                'server_name_raw': 'UNKNOWN02',
                'source_system': 'ivanti',
                'occurrence_count': 3,
                'first_seen_at': datetime(2025, 6, 15),
                'suggested_match': None,
            }
        ]
        card = build_unmatched_card(unmatched)
        body = card['attachments'][0]['content']['body']
        title = body[0]['text']
        assert '2 new entries' in title

    def test_card_shows_source_breakdown(self):
        unmatched = [
            {'server_name_raw': 'A', 'source_system': 'patching_html',
             'occurrence_count': 1, 'first_seen_at': datetime(2025, 1, 1),
             'suggested_match': None},
            {'server_name_raw': 'B', 'source_system': 'patching_html',
             'occurrence_count': 1, 'first_seen_at': datetime(2025, 1, 1),
             'suggested_match': None},
            {'server_name_raw': 'C', 'source_system': 'ivanti',
             'occurrence_count': 1, 'first_seen_at': datetime(2025, 1, 1),
             'suggested_match': None},
        ]
        card = build_unmatched_card(unmatched)
        body = card['attachments'][0]['content']['body']
        summary = body[1]['text']
        assert 'patching_html' in summary
        assert 'ivanti' in summary

    def test_card_caps_at_20(self):
        unmatched = [
            {'server_name_raw': f'SERVER{i:02d}', 'source_system': 'test',
             'occurrence_count': 1, 'first_seen_at': datetime(2025, 1, 1),
             'suggested_match': None}
            for i in range(25)
        ]
        card = build_unmatched_card(unmatched)
        body = card['attachments'][0]['content']['body']
        facts = [b for b in body if b.get('type') == 'FactSet'][0]['facts']
        assert len(facts) == 20
        # Should have overflow message
        overflow_texts = [b.get('text', '') for b in body if 'more' in b.get('text', '')]
        assert len(overflow_texts) == 1
        assert '5 more' in overflow_texts[0]

    def test_suggested_match_shown(self):
        unmatched = [
            {'server_name_raw': 'SRVR01', 'source_system': 'test',
             'occurrence_count': 1, 'first_seen_at': datetime(2025, 1, 1),
             'suggested_match': 'SERVER01'},
        ]
        card = build_unmatched_card(unmatched)
        facts = card['attachments'][0]['content']['body'][2]['facts']
        assert 'SERVER01' in facts[0]['value']
