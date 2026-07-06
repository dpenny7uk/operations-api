"""Tests for alert script card building and logic."""

import json
import sys
import os
from datetime import datetime, date

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'alerts'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from sync_health_alert import build_adaptive_card as build_health_card
from alert_cert_expiry import build_adaptive_card as build_cert_card, _cert_fact
from alert_unmatched_spike import build_adaptive_card as build_unmatched_card
from alert_patch_cycle import build_adaptive_cards as build_patch_cards, _format_date_range
from alert_disk_breaches import (
    build_adaptive_card as build_disk_card,
    _dedupe_resolved,
    BREACH_QUERY,
    RESOLUTION_QUERY,
    NONPROD_FQDN_SUFFIX,
)
from alert_licence_expiry import (
    threshold_for as licence_threshold_for,
    _licence_row as licence_row,
    build_adaptive_card as build_licence_card,
)


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


# ── Patch cycle card ─────────────────────────────────────────────────────

class TestPatchCycleCard:
    def _make_rows(self, count=2, weekend=False):
        base_date = date(2026, 3, 21)  # Saturday
        rows = []
        for i in range(count):
            rows.append({
                'cycle_date': base_date,
                'server_name': f'SRV{i + 1:03d}',
                'patch_group': '8a' if i % 2 == 0 else '9b',
                'scheduled_time': '00:00-01:30' if i % 2 == 0 else '03:00-05:00',
                'service': f'Service{chr(65 + i % 3)}',
                'domain': 'EMEA' if i % 2 == 0 else 'US',
                'issue_title': None,
                'issue_severity': None,
                'confluence_url': None,
            })
        if weekend:
            sunday = date(2026, 3, 22)
            rows.append({
                'cycle_date': sunday,
                'server_name': 'SRV_SUN01',
                'patch_group': '8b',
                'scheduled_time': '01:30-03:00',
                'service': 'ServiceD',
                'domain': 'APAC',
                'issue_title': None,
                'issue_severity': None,
                'confluence_url': None,
            })
        return rows

    def test_returns_two_cards(self):
        cards = build_patch_cards(self._make_rows(), 5)
        assert len(cards) == 2
        assert all(c['type'] == 'AdaptiveCard' for c in cards)

    def test_empty_rows_returns_empty(self):
        assert build_patch_cards([], 5) == []

    def test_card1_is_service_summary(self):
        cards = build_patch_cards(self._make_rows(), 5)
        body = cards[0]['body']
        title = body[0]['text']
        assert 'Services' in title

    def test_card2_is_environment_breakdown(self):
        cards = build_patch_cards(self._make_rows(), 5)
        body = cards[1]['body']
        title = body[0]['text']
        assert 'Environment' in title

    def test_service_deduplication(self):
        rows = self._make_rows(4)  # ServiceA, ServiceB, ServiceC, ServiceA
        cards = build_patch_cards(rows, 5)
        # Card 1 is the services card — services are deduplicated by name
        col_sets = [b for b in cards[0]['body'] if b.get('type') == 'ColumnSet']
        # First ColumnSet is the header row, rest are service rows
        service_rows = col_sets[1:]
        # 3 unique services: ServiceA, ServiceB, ServiceC
        assert len(service_rows) == 3

    def test_server_detail_has_domain(self):
        cards = build_patch_cards(self._make_rows(), 5)
        server_card = cards[1]
        body_json = json.dumps(server_card['body'])
        assert 'EMEA' in body_json
        assert 'US' in body_json

    def test_weekend_date_range(self):
        rows = self._make_rows(2, weekend=True)
        date_str = _format_date_range(rows)
        assert '21' in date_str
        assert '22' in date_str
        assert 'March' in date_str

    def test_single_date_format(self):
        rows = self._make_rows(2)
        date_str = _format_date_range(rows)
        assert '21 March 2026' == date_str

    def test_known_issues_on_services_card(self):
        rows = self._make_rows(2)
        rows[0]['issue_title'] = 'KB12345 breaks IIS'
        rows[0]['issue_severity'] = 'HIGH'
        rows[0]['confluence_url'] = 'https://confluence.example.com/fix'
        cards = build_patch_cards(rows, 5)
        services_card_json = json.dumps(cards[0]['body'])
        assert 'KB12345 breaks IIS' in services_card_json
        assert 'KNOWN ISSUES' in services_card_json

    def test_week_mode_subtitle(self):
        cards = build_patch_cards(self._make_rows(), None)
        body_json = json.dumps(cards[0]['body'])
        assert 'This week' in body_json
        assert 'days away' not in body_json

    def test_week_mode_returns_two_cards(self):
        cards = build_patch_cards(self._make_rows(), None)
        assert len(cards) == 2
        assert all(c['type'] == 'AdaptiveCard' for c in cards)


# ── Disk breach card ─────────────────────────────────────────────────────────

class TestDiskBreachCard:
    def _breach(self, server='PR0607-1', label='E:\\', status=3, pct=94.0, service='insight'):
        return {
            'server_name': server, 'disk_label': label, 'service': service,
            'environment': 'Production', 'technical_owner': 'team@contoso.com',
            'percent_used': pct, 'used_gb': 536.0, 'volume_size_gb': 570.0,
            'threshold_warn_pct': 80.0, 'threshold_crit_pct': 90.0,
            'alert_status': status,
        }

    def _resolution(self, alert_id, server, label, current=63.5, service='insight'):
        return {
            'alert_id': alert_id, 'server_name': server, 'disk_label': label,
            'service': service, 'alert_type': 'breach_crit', 'percent_used_at_send': 94.0,
            'current_percent_used': current,
        }

    @staticmethod
    def _cell_text(column):
        return column['items'][0].get('text', '')

    def _resolved_lines(self, card):
        # Resolved rows are 4-column ColumnSets whose Usage cell starts with "now".
        body = card['attachments'][0]['content']['body']
        return [b for b in body
                if b.get('type') == 'ColumnSet' and len(b.get('columns', [])) == 4
                and self._cell_text(b['columns'][3]).startswith('now ')]

    def test_dedupe_collapses_same_disk(self):
        # Same (server, disk_label) accumulated across 14 cooldown windows.
        rows = [self._resolution(i, 'dv0603-14002-00', 'E:\\SQL_RND_01') for i in range(14)]
        unique = _dedupe_resolved(rows)
        assert len(unique) == 1
        assert unique[0]['alert_id'] == 0  # first occurrence kept

    def test_dedupe_keeps_distinct_disks(self):
        # Same server, different labels — must NOT collapse (the WARNING case).
        rows = [
            self._resolution(1, 'pr0607-20525-01', 'E:\\ Label:DATA 068A3A22'),
            self._resolution(2, 'pr0607-20525-01', 'E:\\ Label:DATA 68a3a22'),
        ]
        assert len(_dedupe_resolved(rows)) == 2

    def test_card_shows_one_resolved_line_per_disk(self):
        resolved = [self._resolution(i, 'dv0603-14002-00', 'E:\\SQL_RND_01') for i in range(14)]
        card = build_disk_card([], resolved)
        lines = self._resolved_lines(card)
        assert len(lines) == 1

    def test_resolved_header_count_is_deduped(self):
        resolved = [self._resolution(i, 'dv0603-14002-00', 'E:\\SQL_RND_01') for i in range(14)]
        card = build_disk_card([], resolved)
        body = card['attachments'][0]['content']['body']
        header = [b['text'] for b in body if b.get('text', '').startswith('✅ **RESOLVED')][0]
        assert 'RESOLVED (1)' in header

    def test_recovered_only_card_count_is_deduped(self):
        resolved = [self._resolution(i, 'dv0603-14002-00', 'E:\\SQL_RND_01') for i in range(5)]
        card = build_disk_card([], resolved)
        title = card['attachments'][0]['content']['body'][0]['text']
        assert '1 disk(s) recovered' in title

    def test_breaches_unaffected_by_dedup(self):
        # Two genuinely different critical disks on the same server stay separate.
        crit = [
            self._breach('pr0607-20525-01', 'E:\\ Label:DATA 068A3A22'),
            self._breach('pr0607-20525-01', 'E:\\ Label:DATA 68a3a22'),
        ]
        card = build_disk_card(crit, [])
        body = card['attachments'][0]['content']['body']
        col_sets = [b for b in body if b.get('type') == 'ColumnSet']
        # 1 header row + 2 disk rows
        assert len(col_sets) == 3

    def test_card_is_critical_only(self):
        # The card heads with "at critical" and has no WARNING section.
        crit = [self._breach('pr0607-20525-01', 'E:\\', status=3, pct=95.0)]
        card = build_disk_card(crit, [])
        body = card['attachments'][0]['content']['body']
        title = body[0]['text']
        assert 'at critical' in title
        texts = [b.get('text', '') for b in body]
        assert any('CRITICAL' in t for t in texts)
        assert not any('WARNING' in t for t in texts)

    def _column_sets(self, card):
        body = card['attachments'][0]['content']['body']
        return [b for b in body if b.get('type') == 'ColumnSet']

    def test_header_has_four_named_columns(self):
        card = build_disk_card([self._breach()], [])
        header = self._column_sets(card)[0]  # table header precedes the data rows
        assert [self._cell_text(c) for c in header['columns']] == ['Server', 'Disk', 'Service', 'Usage']

    def test_critical_row_splits_server_disk_service_usage(self):
        crit = [self._breach('pr0607-20725-03.hiscox.com', 'E:\\ Label:DATA 781988e1',
                              status=3, pct=90.3, service='riskvision')]
        card = build_disk_card(crit, [])
        row = self._column_sets(card)[1]  # [0] is the header
        cells = [self._cell_text(c) for c in row['columns']]
        assert cells[0] == 'pr0607-20725-03.hiscox.com'   # Server
        assert cells[1] == 'E:\\ Label:DATA 781988e1'      # Disk (split out)
        assert cells[2] == 'riskvision'                    # Service
        assert '90.3%' in cells[3]                         # Usage

    def test_resolved_row_has_four_columns_and_drops_dash_before_now(self):
        card = build_disk_card([], [self._resolution(1, 'pr0607-20725-03.hiscox.com', 'E:\\', current=89.1)])
        row = self._resolved_lines(card)[0]
        cells = [self._cell_text(c) for c in row['columns']]
        assert cells[0] == 'pr0607-20725-03.hiscox.com'
        assert cells[2] == 'insight'                       # Service
        assert cells[3] == 'now 89.1%'                     # no "—" before now
        assert '—' not in cells[3]


class TestDiskBreachNonProdExclusion:
    # The recurring CRITICAL cards must never include non-production hosts, even
    # when SolarWinds mis-tags a .hiscox.nonprod node into a production-class
    # environment. Both the breach and resolution queries must filter it so a
    # nonprod host neither pages nor emits a resolved card. This is a guard against
    # the filter being dropped; the queries themselves run under Docker-gated
    # integration tests.
    def test_suffix_targets_nonprod_domain(self):
        assert NONPROD_FQDN_SUFFIX == '%.nonprod'

    def test_breach_query_excludes_nonprod_on_fqdn_and_name(self):
        assert 'COALESCE(d.fqdn' in BREACH_QUERY
        assert 'COALESCE(d.server_name' in BREACH_QUERY
        assert BREACH_QUERY.count('NOT ILIKE %s') == 2

    def test_resolution_query_excludes_nonprod_on_fqdn_and_name(self):
        assert 'COALESCE(d.fqdn' in RESOLUTION_QUERY
        assert 'COALESCE(d.server_name' in RESOLUTION_QUERY
        assert RESOLUTION_QUERY.count('NOT ILIKE %s') == 2


# ── Licence expiry alert ──────────────────────────────────────────────────────

class TestLicenceExpiryThreshold:
    # These boundaries MUST stay in lockstep with the frontend getBucket
    # (licensing-demo-data.js) and the licensing.alerts.threshold enum:
    # <0 expired, <=30 thirty_d, <=90 three_mo, <=183 six_mo, else None.
    def test_expired(self):
        assert licence_threshold_for(-1) == 'expired'

    def test_thirty_day_boundaries(self):
        assert licence_threshold_for(0) == 'thirty_d'
        assert licence_threshold_for(30) == 'thirty_d'

    def test_three_month_boundaries(self):
        assert licence_threshold_for(31) == 'three_mo'
        assert licence_threshold_for(90) == 'three_mo'

    def test_six_month_boundaries(self):
        assert licence_threshold_for(91) == 'six_mo'
        assert licence_threshold_for(183) == 'six_mo'

    def test_beyond_six_months_is_none(self):
        assert licence_threshold_for(184) is None

    def test_none_days_is_none(self):
        assert licence_threshold_for(None) is None


class TestLicenceExpiryCard:
    def _licence(self, threshold='thirty_d', days=15):
        return {
            'licence_id': 1, 'vendor': 'Tableau', 'product': 'Tableau Server',
            'application_name': 'Tableau Server', 'days_until_expiry': days,
            'expires_at': date(2026, 11, 22), 'quantity_held': 500,
            'audit_owner_sam': 'paul.griffin', 'status_flag': 'tracked',
            'threshold': threshold,
        }

    def test_row_shows_vendor_qty_owner_and_days(self):
        text = json.dumps(licence_row(self._licence()))
        assert 'Tableau Server' in text
        assert '500' in text               # quantity held
        assert 'paul.griffin' in text      # audit owner
        assert '15d remaining' in text

    def test_row_expired_wording(self):
        assert 'Expired 5d ago' in json.dumps(licence_row(self._licence('expired', -5)))

    def test_card_structure(self):
        card = build_licence_card({'thirty_d': [self._licence()]}, 'https://ops/')
        assert card['type'] == 'message'
        assert card['attachments'][0]['content']['type'] == 'AdaptiveCard'

    def test_card_title_counts_all_sections(self):
        by = {'expired': [self._licence('expired', -1)], 'six_mo': [self._licence('six_mo', 150)]}
        title = build_licence_card(by, 'https://ops/')['attachments'][0]['content']['body'][0]['text']
        assert '2 licence(s)' in title

    def test_card_orders_expired_before_six_mo(self):
        by = {'six_mo': [self._licence('six_mo', 150)], 'expired': [self._licence('expired', -1)]}
        body = build_licence_card(by, 'https://ops/')['attachments'][0]['content']['body']
        texts = [b.get('text', '') for b in body if b.get('text')]
        exp_idx = next(i for i, t in enumerate(texts) if 'EXPIRED' in t)
        six_idx = next(i for i, t in enumerate(texts) if 'WITHIN 6 MONTHS' in t)
        assert exp_idx < six_idx

    def test_card_omits_empty_sections(self):
        body_json = json.dumps(build_licence_card({'thirty_d': [self._licence()]}, 'https://ops/')['attachments'][0]['content']['body'])
        assert 'WITHIN 30 DAYS' in body_json
        assert 'WITHIN 6 MONTHS' not in body_json

    def test_card_has_console_deep_link(self):
        actions = build_licence_card({'thirty_d': [self._licence()]}, 'https://ops/')['attachments'][0]['content']['actions']
        assert actions[0]['type'] == 'Action.OpenUrl'
        assert actions[0]['url'] == 'https://ops/#licensing'
