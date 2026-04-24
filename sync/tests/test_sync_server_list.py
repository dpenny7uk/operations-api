"""Tests for server sync field mapping and NULL preservation."""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'servers'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from sync_server_list import derive_business_unit


def _build_value_tuple(record: dict) -> tuple:
    """Replicate the field mapping from sync_server_list.sync_servers()."""
    return (
        (record.get('server_name') or '')[:255],
        (record.get('fqdn') or '').strip()[:500] or None,
        (record.get('ip_address') or '').strip()[:50] or None,
        (record.get('operating_system') or '').strip()[:255] or None,
        (record.get('environment') or '').strip()[:50] or None,
        (record.get('location') or '').strip()[:100] or None,
        derive_business_unit(record.get('business_unit')),
        (record.get('combined_service') or '').strip()[:255] or None,
        (record.get('primary_contact') or '').strip()[:255] or None,
        (record.get('patch_group') or '').strip()[:100] or None,
        (record.get('cmdb_id') or '').strip()[:100] or None,
    )


# Indices in the value tuple where business_unit lives; BU is no longer nullable
# (it normalises missing/unknown to 'Unknown'), so the blanket None checks below
# skip this index and assert it separately.
_BU_IDX = 6


# ── NULL preservation ────────────────────────────────────────────────────────

class TestNullPreservation:
    def test_empty_string_becomes_none(self):
        record = {
            'server_name': 'SRV01',
            'fqdn': '', 'ip_address': '', 'operating_system': '',
            'environment': '', 'location': '', 'business_unit': '',
            'combined_service': '', 'primary_contact': '',
            'patch_group': '', 'cmdb_id': '',
        }
        t = _build_value_tuple(record)
        # server_name is index 0, rest are nullable except BU (normalises to 'Unknown')
        assert t[0] == 'SRV01'
        for i in range(1, len(t)):
            if i == _BU_IDX:
                continue
            assert t[i] is None, f"Index {i} should be None, got {t[i]!r}"
        assert t[_BU_IDX] == 'Unknown'

    def test_whitespace_only_becomes_none(self):
        record = {
            'server_name': 'SRV01',
            'fqdn': '   ', 'ip_address': '\t', 'operating_system': ' \n ',
            'environment': '  ', 'location': '  ', 'business_unit': '  ',
            'combined_service': '  ', 'primary_contact': '  ',
            'patch_group': '  ', 'cmdb_id': '  ',
        }
        t = _build_value_tuple(record)
        for i in range(1, len(t)):
            if i == _BU_IDX:
                continue
            assert t[i] is None, f"Index {i} should be None, got {t[i]!r}"
        assert t[_BU_IDX] == 'Unknown'

    def test_none_value_becomes_none(self):
        record = {
            'server_name': 'SRV01',
            'fqdn': None, 'ip_address': None, 'operating_system': None,
            'environment': None, 'location': None, 'business_unit': None,
            'combined_service': None, 'primary_contact': None,
            'patch_group': None, 'cmdb_id': None,
        }
        t = _build_value_tuple(record)
        for i in range(1, len(t)):
            if i == _BU_IDX:
                continue
            assert t[i] is None
        assert t[_BU_IDX] == 'Unknown'

    def test_missing_key_becomes_none(self):
        record = {'server_name': 'SRV01'}
        t = _build_value_tuple(record)
        for i in range(1, len(t)):
            if i == _BU_IDX:
                continue
            assert t[i] is None
        assert t[_BU_IDX] == 'Unknown'

    def test_valid_values_preserved(self):
        record = {
            'server_name': 'SRV01',
            'fqdn': 'srv01.contoso.com',
            'ip_address': '10.0.0.1',
            'operating_system': 'Windows Server 2022',
            'environment': 'Production',
            'location': 'DC1',
            'business_unit': 'Hiscox UK',
            'combined_service': 'Portal',
            'primary_contact': 'ops@contoso.com',
            'patch_group': 'Group A',
            'cmdb_id': 'CI12345',
        }
        t = _build_value_tuple(record)
        assert t[0] == 'SRV01'
        assert t[1] == 'srv01.contoso.com'
        assert t[2] == '10.0.0.1'
        assert t[3] == 'Windows Server 2022'
        assert t[4] == 'Production'
        assert t[5] == 'DC1'
        assert t[6] == 'Hiscox UK'
        assert t[7] == 'Portal'
        assert t[8] == 'ops@contoso.com'
        assert t[9] == 'Group A'
        assert t[10] == 'CI12345'

    def test_values_trimmed(self):
        record = {
            'server_name': 'SRV01',
            'fqdn': '  srv01.contoso.com  ',
            'ip_address': ' 10.0.0.1 ',
            'operating_system': ' Windows Server 2022 ',
            'environment': ' Production ',
            'location': ' DC1 ',
            'business_unit': ' Hiscox UK ',
            'combined_service': ' Portal ',
            'primary_contact': ' ops@contoso.com ',
            'patch_group': ' Group A ',
            'cmdb_id': ' CI12345 ',
        }
        t = _build_value_tuple(record)
        assert t[1] == 'srv01.contoso.com'
        assert t[2] == '10.0.0.1'
        assert t[3] == 'Windows Server 2022'

    def test_server_name_never_none(self):
        record = {'server_name': 'SRV01'}
        t = _build_value_tuple(record)
        assert t[0] is not None
        assert t[0] == 'SRV01'


# ── Field truncation ─────────────────────────────────────────────────────────

class TestFieldTruncation:
    def test_server_name_max_255(self):
        record = {'server_name': 'X' * 300}
        t = _build_value_tuple(record)
        assert len(t[0]) == 255

    def test_fqdn_max_500(self):
        record = {'server_name': 'SRV01', 'fqdn': 'x' * 600}
        t = _build_value_tuple(record)
        assert len(t[1]) == 500

    def test_ip_address_max_50(self):
        record = {'server_name': 'SRV01', 'ip_address': '1' * 60}
        t = _build_value_tuple(record)
        assert len(t[2]) == 50

    def test_operating_system_max_255(self):
        record = {'server_name': 'SRV01', 'operating_system': 'o' * 300}
        t = _build_value_tuple(record)
        assert len(t[3]) == 255

    def test_environment_max_50(self):
        record = {'server_name': 'SRV01', 'environment': 'e' * 60}
        t = _build_value_tuple(record)
        assert len(t[4]) == 50

    def test_location_max_100(self):
        record = {'server_name': 'SRV01', 'location': 'l' * 150}
        t = _build_value_tuple(record)
        assert len(t[5]) == 100


# ── Business-unit normalisation ──────────────────────────────────────────────

class TestDeriveBusinessUnit:
    def test_raw_uk_maps_to_hiscox_uk(self):
        assert derive_business_unit('uk') == 'Hiscox UK'

    def test_title_case_hiscox_uk_maps_to_hiscox_uk(self):
        assert derive_business_unit('Hiscox UK') == 'Hiscox UK'

    def test_uk_case_insensitive(self):
        assert derive_business_unit('UK') == 'Hiscox UK'
        assert derive_business_unit('Uk') == 'Hiscox UK'
        assert derive_business_unit(' uk ') == 'Hiscox UK'

    def test_uk_and_i_distinct_from_uk(self):
        assert derive_business_unit('uk&i') == 'UK & I'
        assert derive_business_unit('uk&i') != derive_business_unit('uk')

    def test_us_variants_merge(self):
        assert derive_business_unit('us') == 'Hiscox US'
        assert derive_business_unit('Hiscox US') == 'Hiscox US'

    def test_europe_variants_merge(self):
        assert derive_business_unit('europe') == 'Hiscox Europe'
        assert derive_business_unit('Hiscox Europe') == 'Hiscox Europe'

    def test_london_market_variants_merge(self):
        assert derive_business_unit('london_market') == 'Hiscox London Market'
        assert derive_business_unit('Hiscox London Market') == 'Hiscox London Market'

    def test_hiscox_re_variants_merge(self):
        assert derive_business_unit('hiscox_re') == 'Hiscox Re & ILS'
        assert derive_business_unit('Hiscox Re and ILS') == 'Hiscox Re & ILS'

    def test_group_variants_merge(self):
        assert derive_business_unit('group') == 'Hiscox Group Support'
        assert derive_business_unit('Hiscox Group Support') == 'Hiscox Group Support'

    def test_special_risks_maps_to_itself(self):
        assert derive_business_unit('Hiscox Special Risks') == 'Hiscox Special Risks'

    def test_it_services_maps_to_its(self):
        assert derive_business_unit('it_services') == 'ITS'

    def test_infosec_maps_to_infosec(self):
        assert derive_business_unit('infosec') == 'Infosec'

    def test_no_bu_found_maps_to_unknown(self):
        assert derive_business_unit('No BU found') == 'Unknown'

    def test_null_maps_to_unknown(self):
        assert derive_business_unit(None) == 'Unknown'

    def test_empty_string_maps_to_unknown(self):
        assert derive_business_unit('') == 'Unknown'

    def test_whitespace_only_maps_to_unknown(self):
        assert derive_business_unit('   ') == 'Unknown'

    def test_unknown_value_maps_to_unknown_and_logs_warning(self, caplog):
        import logging
        with caplog.at_level(logging.WARNING, logger='sync_server_list'):
            result = derive_business_unit('newbu_not_in_map')
        assert result == 'Unknown'
        assert any('newbu_not_in_map' in r.message for r in caplog.records)

    def test_known_value_does_not_log_warning(self, caplog):
        import logging
        with caplog.at_level(logging.WARNING, logger='sync_server_list'):
            derive_business_unit('uk')
        assert not any('Unknown business_unit' in r.message for r in caplog.records)
