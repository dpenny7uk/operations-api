/* licensing-demo-data.js — offline seed / fallback for 08 Licensing.

   Loaded before op-pages.js, exposes window.LICENSING_DATA with the shape the
   /api/licensing/* endpoints return. On boot, op-boot.js fetches the real data
   and overwrites the LICENCES / RENEWALS arrays IN PLACE (so the helper closures
   below keep working). If the fetch fails, this seed stays and the page shows a
   DEMO ribbon (markDemo('licensing')).

   Field model mirrors the Hiscox CMDB licence fields:
     licence_type     — CMDB "Licence Type" (N/A | Annual | Concurrent |
                        Open Source | Device Client Access | User Client Access)
     quantity_held    — CMDB "Quantity Held"
     audit_frequency  — CMDB "Licence Audit Frequency"
     audit_owner_sam  — CMDB "Licence Audit Owner"
   plus the ops-api renewal layer (expires_at, notice_period_days, status_flag).

   Deliberate test cases baked in (today ~ mid-2026):
   - 1 expired, 1 under-30-day, 2 under-3-month, 2 under-6-month, 2 healthy
   - Mix of status flags (tracked / engaged); some licences have renewal history */
(function () {
  'use strict';

  // Status flag — two values only. Renewal is a transition (recorded in
  // RENEWALS history below), NOT a sticky status.
  //   tracked   — default: licence is in the system, no procurement action started
  //   engaged   — procurement is actively working a renewal
  const STATUS_FLAGS = ['tracked', 'engaged'];

  const LICENCES = [
    {
      licence_id: 1,
      application_name: 'Confluence Data Center',
      vendor: 'Atlassian',
      product: 'Confluence Data Center',
      licence_type: 'Annual',
      quantity_held: 1000,
      audit_frequency: 'Annual',
      audit_owner_sam: 'sara.bennett',
      expires_at: '2026-05-10',         // EXPIRED
      notice_period_days: 60,
      status_flag: 'engaged',
      notes: 'Maintenance contract lapsed mid-May. Quote received, awaiting PO approval. No support tickets can be raised against Atlassian until paid.',
    },
    {
      licence_id: 2,
      application_name: 'Snyk',
      vendor: 'Snyk',
      product: 'Snyk Enterprise',
      licence_type: 'User Client Access',
      quantity_held: 100,
      audit_frequency: 'Annual',
      audit_owner_sam: 'tom.walsh',
      expires_at: '2026-06-15',         // <=30 days
      notice_period_days: 30,
      status_flag: 'engaged',
      notes: 'Quote in legal review. Devs lose dependency scanning if this lapses — block CI hardening epic.',
    },
    {
      licence_id: 3,
      application_name: 'ResQ',
      vendor: 'ResQ',
      product: 'ResQ Software',
      licence_type: 'Concurrent',
      quantity_held: 200,
      audit_frequency: 'Quarterly',
      audit_owner_sam: 'paul.griffin',
      expires_at: '2026-07-20',         // <=3 months
      notice_period_days: 90,
      status_flag: 'tracked',
      notes: '90-day notice period — procurement needs engagement by ~2026-04-22 (already passed). Escalate.',
    },
    {
      licence_id: 4,
      application_name: 'Splunk',
      vendor: 'Splunk',
      product: 'Splunk Enterprise',
      licence_type: 'Annual',
      quantity_held: 0,
      audit_frequency: 'Annual',
      audit_owner_sam: 'tom.walsh',
      expires_at: '2026-08-15',         // <=3 months
      notice_period_days: 60,
      status_flag: 'engaged',
      notes: 'Ingest-volume based (500 GB/day). Considering downsizing to 350 GB/day this cycle — SOC has data retention input.',
    },
    {
      licence_id: 5,
      application_name: 'Alteryx',
      vendor: 'Alteryx',
      product: 'Alteryx Designer + Server',
      licence_type: 'User Client Access',
      quantity_held: 50,
      audit_frequency: 'Annual',
      audit_owner_sam: 'paul.griffin',
      expires_at: '2026-09-10',         // <=6 months
      notice_period_days: 60,
      status_flag: 'tracked',
      notes: 'Used heavily by data team. Check seat utilisation before renewal — last cycle we paid for 50 but only ~32 active.',
    },
    {
      licence_id: 6,
      application_name: 'Tableau Server',
      vendor: 'Tableau',
      product: 'Tableau Server',
      licence_type: 'User Client Access',
      quantity_held: 500,
      audit_frequency: 'Annual',
      audit_owner_sam: 'paul.griffin',
      expires_at: '2026-11-22',         // <=6 months
      notice_period_days: 90,
      status_flag: 'tracked',
      notes: 'Multi-year contract option available — procurement to confirm budget envelope for 3-yr lock-in vs annual.',
    },
    {
      licence_id: 7,
      application_name: 'Snowflake',
      vendor: 'Snowflake',
      product: 'Snowflake Standard Edition',
      licence_type: 'Annual',
      quantity_held: 0,
      audit_frequency: 'Ad-hoc',
      audit_owner_sam: 'tom.walsh',
      expires_at: '2027-02-15',         // healthy
      notice_period_days: 30,
      status_flag: 'tracked',
      notes: 'Credit-based commit — review actual consumption vs committed credits at Q3 board meeting.',
    },
    {
      licence_id: 8,
      application_name: 'GitLab',
      vendor: 'GitLab',
      product: 'GitLab Ultimate',
      licence_type: 'User Client Access',
      quantity_held: 200,
      audit_frequency: 'Annual',
      audit_owner_sam: 'sara.bennett',
      expires_at: '2027-08-01',         // healthy
      notice_period_days: 60,
      status_flag: 'tracked',
      notes: 'Ultimate tier required for security dashboards. Evaluate Premium downgrade if dashboards usage stays low.',
    },
  ];

  // ---------- Bucket logic ----------
  // Buckets: expired, under30, under3mo, under6mo, healthy.
  function _daysBetween(targetIso) {
    const target = new Date(targetIso + 'T00:00:00');
    const now = new Date();
    return Math.ceil((target.getTime() - now.getTime()) / 86400000);
  }

  function daysUntilExpiry(licence) {
    return _daysBetween(licence.expires_at);
  }

  function getBucket(licence) {
    const d = daysUntilExpiry(licence);
    if (d < 0)   return 'expired';
    if (d <= 30) return 'under30';
    if (d <= 90) return 'under3mo';
    if (d <= 183) return 'under6mo';  // 6mo ~ 183 days
    return 'healthy';
  }

  function getCounts(list) {
    const src = list || LICENCES;
    const c = { expired: 0, under30: 0, under3mo: 0, under6mo: 0, healthy: 0 };
    for (const l of src) c[getBucket(l)]++;
    return c;
  }

  // Active alert threshold for a licence — the highest threshold crossed.
  function getAlertThreshold(licence) {
    const d = daysUntilExpiry(licence);
    if (d < 0)   return 'expired';
    if (d <= 30) return 'thirty_d';
    if (d <= 90) return 'three_mo';
    if (d <= 183) return 'six_mo';
    return null;
  }

  // Vendor list for the filter dropdown.
  function getVendors() {
    const seen = new Set();
    LICENCES.forEach(l => seen.add(l.vendor));
    return Array.from(seen).sort();
  }

  // licence_type now mirrors the CMDB dropdown values, which are already
  // human-readable — so this is identity for known values (kept for the
  // legacy prototype codes in case any linger).
  function fmtLicenceType(t) {
    if (!t) return '—';
    return ({
      saas: 'SaaS',
      onprem_subscription: 'On-prem subscription',
      perpetual_maintenance: 'Perpetual + maintenance',
    })[t] || t;
  }

  function fmtStatusFlag(s) {
    return ({ tracked: 'Tracked', engaged: 'Engaged' })[s] || s;
  }

  // Past renewals — one row per closed cycle.
  const RENEWALS = [
    { renewal_id: 1, licence_id: 6, cycle_ended: '2025-11-22', renewed_on: '2025-11-08', new_expires: '2026-11-22', renewed_by: 'paul.griffin', notes: 'Renewed for 1 year. Procurement got a 4% uplift held back.' },
    { renewal_id: 2, licence_id: 6, cycle_ended: '2024-11-22', renewed_on: '2024-10-30', new_expires: '2025-11-22', renewed_by: 'paul.griffin', notes: 'Standard 1-year renewal.' },
    { renewal_id: 3, licence_id: 7, cycle_ended: '2026-02-15', renewed_on: '2026-01-12', new_expires: '2027-02-15', renewed_by: 'tom.walsh', notes: 'Credit commit reduced from 250k to 200k after Q4 consumption review.' },
    { renewal_id: 4, licence_id: 7, cycle_ended: '2025-02-15', renewed_on: '2025-01-20', new_expires: '2026-02-15', renewed_by: 'tom.walsh', notes: '' },
    { renewal_id: 5, licence_id: 8, cycle_ended: '2026-08-01', renewed_on: '2026-06-22', new_expires: '2027-08-01', renewed_by: 'sara.bennett', notes: 'Stayed on Ultimate tier. Considered Premium downgrade but security wanted dashboards.' },
    { renewal_id: 6, licence_id: 5, cycle_ended: '2025-09-10', renewed_on: '2025-08-18', new_expires: '2026-09-10', renewed_by: 'paul.griffin', notes: 'Seat count reduced from 75 to 50 (down 25 unused seats). Saved ~30% on cost (per procurement).' },
  ];

  function getRenewalsForLicence(licenceId) {
    return RENEWALS.filter(r => r.licence_id === licenceId)
      .slice()
      .sort((a, b) => (b.renewed_on || '').localeCompare(a.renewed_on || ''));
  }

  // Apply a renewal in-memory: appends to RENEWALS, mutates the licence with
  // the new expiry, resets status to 'tracked'. Used as the offline fallback
  // when the POST /api/licensing/licences/{id}/renew endpoint is unreachable.
  function markRenewed(licence, newExpiry, notes, renewedBy) {
    const nextId = (RENEWALS.reduce((m, r) => Math.max(m, r.renewal_id), 0) || 0) + 1;
    RENEWALS.push({
      renewal_id: nextId,
      licence_id: licence.licence_id,
      cycle_ended: licence.expires_at,
      renewed_on: new Date().toISOString().slice(0, 10),
      new_expires: newExpiry,
      renewed_by: renewedBy || 'damian.penny',
      notes: notes || '',
    });
    licence.expires_at = newExpiry;
    licence.status_flag = 'tracked';
  }

  window.LICENSING_DATA = {
    LICENCES, STATUS_FLAGS, RENEWALS,
    daysUntilExpiry, getBucket, getCounts, getAlertThreshold,
    getVendors, fmtLicenceType, fmtStatusFlag,
    getRenewalsForLicence, markRenewed,
  };
})();
