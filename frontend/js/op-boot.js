/* Service Ops Console — v2 boot / API wiring.
   Replaces the design bundle's synthetic window.*_DATA globals with real
   API responses, and exposes window.OC_ACTIONS for wizard submits.

   The design bundle (op-app.js / op-pages.js) is IIFE-based
   with all renders reading from window.PATCH_GROUPS / SYNCS / EXCLUSIONS / RECENT_ALERTS_BASE
   / SERVERS_DATA / CERTS_DATA / EOL_DATA. We populate those globals after
   parallel fetches and call window.RERENDER_PAGE(mount) to redraw. */

import { api, apiPost, apiPatch, apiDelete, apiErrors, clearApiErrors, setUsingDemo, setApiErrorsListener, markDemo, clearDemo, clearAllDemo } from './api.js';

// RERENDER_PAGE expects the inner .page-mount div (NOT the outer #root).
// Passing #root would wipe the shell (rail + statusline). Passing null lets
// op-app.js default to .page-mount, which is what we want.
function mount() { return document.querySelector('.page-mount'); }

// ── Normalisers: backend response → design global shape ──────────────

function mapServers(items) {
  return (items || []).map(s => ({
    id: s.serverId,
    name: s.serverName,
    fqdn: s.fqdn || null,
    ip: s.ipAddress || null,
    env: s.environment || 'Untagged',
    app: s.applicationName || '',
    service: s.service || '',
    func: s.func || '',
    pg: s.patchGroup || 'NO PATCH GROUP FOUND',
    bu: s.businessUnit || 'Unknown',
    active: !!s.isActive,
    lastSeen: s.lastSeen || null,
  }));
}

function mapEnvBreakdown(summary) {
  if (!summary || !summary.environmentCounts) return [];
  return Object.entries(summary.environmentCounts).map(([name, v]) => ({
    name,
    count: (v && v.active != null) ? v.active : (v && v.total) || 0,
  })).sort((a, b) => b.count - a.count);
}

function mapBuBreakdown(summary) {
  if (!summary || !summary.businessUnitCounts) return [];
  return Object.entries(summary.businessUnitCounts).map(([name, v]) => ({
    name,
    count: (v && v.active != null) ? v.active : (v && v.total) || 0,
  })).sort((a, b) => b.count - a.count);
}

function mapUnreachable(items) {
  return (items || []).map(u => ({
    name: u.serverName || '—',
    env: u.environment || 'Untagged',
    lastSeen: u.lastSeen ? new Date(u.lastSeen).toLocaleString('en-GB') : '—',
    duration: '', // not in current API
  }));
}

function mapUnmatched(items) {
  return (items || []).map(u => ({
    raw: u.serverNameRaw || '—',
    source: u.sourceSystem || '—',
    times: u.occurrenceCount || 0,
    first: u.firstSeenAt ? new Date(u.firstSeenAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—',
    closest: u.closestMatch || null,
  }));
}

function mapCerts(items) {
  // Backend: alertLevel is 'CRITICAL'|'WARNING'|'OK' and isExpired is a
  // separate boolean. CertsPage filters expect 'expired'|'crit'|'warn'|'ok'.
  return (items || []).map(c => {
    const raw = (c.alertLevel || '').toUpperCase();
    const level = c.isExpired ? 'expired'
      : raw === 'CRITICAL' ? 'crit'
      : raw === 'WARNING'  ? 'warn'
      : 'ok';
    return {
      name: c.subjectCn || c.serviceName || '—',
      server: c.serverName || '',
      service: c.serviceName || '',
      expires: c.validTo ? new Date(c.validTo).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—',
      days: c.daysUntilExpiry,
      level,
      bu: c.businessUnit || 'Unknown',
    };
  });
}

// Aliases: dashboard CertCard reads within7d/within30d/healthy; CertsPage reads
// crit/warn/ok. Expose both so either render path works.
function mapCertCounts(summary) {
  if (!summary) return { expired: 0, crit: 0, warn: 0, ok: 0, within7d: 0, within30d: 0, within90d: 0, healthy: 0 };
  const expired = summary.expiredCount || 0;
  const crit = summary.criticalCount || 0;
  const warn = summary.warningCount || 0;
  const ok = summary.okCount || 0;
  return { expired, crit, warn, ok, within7d: crit, within30d: warn, within90d: 0, healthy: ok };
}

// Cross-facet breakdowns from /api/certificates/summary — drives the level
// and BU dropdown counts on the certs page (per-level scoped by BU, per-BU
// scoped by level).
function mapCertBreakdown(summary) {
  if (!summary) return { levels: [], businessUnits: [] };
  const levels = Array.isArray(summary.levels) ? summary.levels : [];
  const bus = Array.isArray(summary.businessUnits) ? summary.businessUnits : [];
  return {
    levels: levels.map(l => ({
      level: String(l.level || ''),
      totalCount: Number(l.totalCount) || 0,
    })),
    businessUnits: bus.map(b => ({
      businessUnit: String(b.businessUnit || ''),
      totalCount: Number(b.totalCount) || 0,
    })),
  };
}

function mapEolProducts(items) {
  const fmt = (iso) => iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : null;
  return (items || []).map(e => ({
    product: e.product,
    version: e.version,
    status: (e.alertLevel || 'supported').toLowerCase(),
    eol: fmt(e.endOfLife),
    ext: fmt(e.endOfExtendedSupport),
    servers: e.affectedAssets || 0,
    hosts: [], // detail endpoint provides .assets; list endpoint does not
  }));
}

function mapEolTotals(summary) {
  if (!summary) return { products: 0, eol: 0, extended: 0, approaching: 0, supported: 0, affected: 0 };
  return {
    products: summary.totalCount || 0,
    eol: summary.eolCount || 0,
    extended: summary.extendedCount || 0,
    approaching: summary.approachingCount || 0,
    supported: summary.supportedCount || 0,
    affected: summary.affectedServers || 0,
  };
}

// Convert a PatchCycle from /api/patching/cycles into the design's PATCH_GROUPS
// shape. Real data doesn't have per-group breakdown at this level — we use
// cycle aggregate and attach patch group breakdown from /api/patching/next
// where available.
function mapPatchGroups(cycles, nextSummary) {
  const groups = [];
  const wbg = (nextSummary && nextSummary.windowsByGroup) || {};

  // Preferred path: iterate cycleDetails so each (cycle, group) entry gets
  // the correct cycle date. Earlier code pulled ServersByGroup flat and
  // assigned cycle[0].cycleDate to every group — wrong when cycles span
  // multiple days.
  if (nextSummary && Array.isArray(nextSummary.cycleDetails) && nextSummary.cycleDetails.length > 0) {
    for (const cd of nextSummary.cycleDetails) {
      const date = cd.cycleDate ? new Date(cd.cycleDate) : null;
      const sbg = cd.serversByGroup || {};
      for (const [name, count] of Object.entries(sbg)) {
        const scheduled = wbg[name];
        groups.push({
          name,
          servers: count,
          date,
          window: scheduled ? scheduled + ' UTC' : '—',
          services: '',
        });
      }
    }
  } else if (nextSummary && nextSummary.serversByGroup) {
    // Legacy fallback — only one cycle's worth of data, all same date.
    const nextCycleDate = nextSummary.cycle && nextSummary.cycle.cycleDate;
    const date = nextCycleDate ? new Date(nextCycleDate) : null;
    for (const [name, count] of Object.entries(nextSummary.serversByGroup)) {
      const scheduled = wbg[name];
      groups.push({
        name,
        servers: count,
        date,
        window: scheduled ? scheduled + ' UTC' : '—',
        services: '',
      });
    }
  } else if (Array.isArray(cycles)) {
    for (const c of cycles.slice(0, 8)) {
      groups.push({
        name: 'Cycle #' + c.cycleId,
        servers: c.serverCount || 0,
        date: c.cycleDate ? new Date(c.cycleDate) : null,
        window: c.displayStatus || c.status,
        services: '',
      });
    }
  }

  // Sort by date asc, then by window start time, then by name. Parses
  // "HH:MM-HH:MM UTC" to minutes; unknown windows sort last within a date.
  const startMins = (w) => {
    if (!w) return 1e9;
    const m = w.match(/^(\d{1,2}):(\d{2})/);
    return m ? (+m[1]) * 60 + (+m[2]) : 1e9;
  };
  groups.sort((a, b) => {
    const da = a.date ? a.date.getTime() : Infinity;
    const db = b.date ? b.date.getTime() : Infinity;
    if (da !== db) return da - db;
    const ta = startMins(a.window);
    const tb = startMins(b.window);
    if (ta !== tb) return ta - tb;
    return (a.name || '').localeCompare(b.name || '');
  });

  return groups;
}

// Raw cycles for the Patching page's history tab. Demo shape:
// { id, window, status, servers, completed, failed, skipped, groups, notes }
function mapPatchCycles(cycles) {
  if (!Array.isArray(cycles)) return [];
  const monthLabel = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  };
  const windowLabel = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  };
  return cycles.map(c => ({
    id: monthLabel(c.cycleDate),
    window: windowLabel(c.cycleDate),
    status: (c.displayStatus || c.status || 'queued').toLowerCase(),
    servers: c.serverCount || 0,
    completed: c.completedCount || 0,
    failed: c.failedCount || 0,
    skipped: 0,
    groups: 0,
    notes: '',
  }));
}

// Known issues for the Patching page's issues tab. Demo shape:
// { id, severity, product, kb, servers, group, first, status, title, notes }
function mapPatchIssues(items) {
  if (!Array.isArray(items)) return [];
  const sevMap = { high: 'crit', critical: 'crit', medium: 'warn', low: 'info' };
  return items.map(i => ({
    id: 'IS-' + (i.issueId != null ? i.issueId : '?'),
    severity: sevMap[(i.severity || '').toLowerCase()] || 'info',
    product: i.application || '—',
    kb: '—',
    servers: 0,
    group: '—',
    first: '—',
    status: (i.status || 'workaround').toLowerCase(),
    title: i.title || '',
    notes: i.fix || '',
  }));
}

function mapSyncs(items) {
  return (items || []).map(s => ({
    name: s.syncName,
    status: (s.status === 'error' || s.freshnessStatus === 'error') ? 'crit'
         : (s.status === 'warning' || s.freshnessStatus === 'stale' || s.consecutiveFailures > 0) ? 'warn'
         : 'healthy',
    last: s.lastSuccessAt ? new Date(s.lastSuccessAt) : null,
    records: s.recordsProcessed || 0,
    failures: s.consecutiveFailures || 0,
    err: s.lastErrorMessage || '—',
    schedule: s.expectedSchedule || '',
  }));
}

// Derive a display-friendly source label from the alert's id namespace. The
// AlertsService.cs UNION emits ids like 'disk:WEB01:C:\\', 'cert:42', etc.
// — same prefix vocabulary client-side derivers (deriveDiskAlerts) emit.
// Used by the Alert() renderer to show a small mono kicker so operators can
// triage at a glance without inspecting the body text.
function sourceFromId(id) {
  const s = String(id || '');
  if (s.startsWith('disk:'))      return 'Disks';
  if (s.startsWith('cert:'))      return 'Certs';
  if (s.startsWith('sync:'))      return 'Sync';
  if (s.startsWith('server:'))    return 'Servers';
  if (s.startsWith('exclusion:')) return 'Patching';
  return null;
}

function mapAlerts(items) {
  return (items || []).map(a => ({
    id: a.id,
    when: a.when ? new Date(a.when).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—',
    sub: a.sub,
    detail: a.detail,
    tone: a.tone || 'info',
    source: sourceFromId(a.id),
  }));
}

// Disk summary — total/ok/warn/crit + per-environment + per-BU breakdowns.
// Drives the KPI strip (DB-authoritative counts, not loaded-items counts) and
// the env/BU dropdown labels ("Production (466)", "Contoso UK (140)"). The
// top-level totals reflect any filters passed via the query string; the
// breakdown lists are always unscoped so dropdown counts stay stable.
function mapDiskSummary(s) {
  if (!s || typeof s !== 'object') return null;
  const envs = Array.isArray(s.environments) ? s.environments : [];
  const bus  = Array.isArray(s.businessUnits) ? s.businessUnits : [];
  const sts  = Array.isArray(s.alertStatuses) ? s.alertStatuses : [];
  return {
    totalCount:    Number(s.totalCount) || 0,
    okCount:       Number(s.okCount) || 0,
    warningCount:  Number(s.warningCount) || 0,
    criticalCount: Number(s.criticalCount) || 0,
    nonprodCount:  Number(s.nonprodCount) || 0,
    environments: envs.map(e => ({
      environment:   e.environment || '',
      totalCount:    Number(e.totalCount) || 0,
      okCount:       Number(e.okCount) || 0,
      warningCount:  Number(e.warningCount) || 0,
      criticalCount: Number(e.criticalCount) || 0,
    })),
    businessUnits: bus.map(b => ({
      businessUnit:  b.businessUnit || '',
      totalCount:    Number(b.totalCount) || 0,
      okCount:       Number(b.okCount) || 0,
      warningCount:  Number(b.warningCount) || 0,
      criticalCount: Number(b.criticalCount) || 0,
    })),
    // Cross-facet status breakdown (1=OK, 2=Warning, 3=Critical) — drives the
    // alert-levels dropdown counts on the Disks page.
    alertStatuses: sts.map(a => ({
      alertStatus:   Number(a.alertStatus) || 0,
      totalCount:    Number(a.totalCount) || 0,
    })),
  };
}

// Disk monitoring rows from /api/disks. The renderer reads camelCase fields
// directly, so this is essentially a passthrough that hardens nullables.
function mapDisks(items) {
  return (items || []).map((d, i) => ({
    id: i + 1,
    serverName: d.serverName || '',
    fqdn: d.fqdn || null,
    isNonprod: !!d.isNonprod,
    diskLabel: d.diskLabel || '',
    service: d.service || '',
    environment: d.environment || '',
    technicalOwner: d.technicalOwner || '',
    businessOwner: d.businessOwner || '',
    businessUnit: d.businessUnit || 'Unknown',
    tier: d.tier || '',
    volumeSizeGb: Number(d.volumeSizeGb) || 0,
    usedGb: Number(d.usedGb) || 0,
    freeGb: Number(d.freeGb) || 0,
    percentUsed: Number(d.percentUsed) || 0,
    alertStatus: Number(d.alertStatus) || 1,
    thresholdWarnPct: Number(d.thresholdWarnPct) || 80,
    thresholdCritPct: Number(d.thresholdCritPct) || 90,
    daysUntilCritical: d.daysUntilCritical != null ? Number(d.daysUntilCritical) : null,
  }));
}

// Cross-facet breakdowns from /api/patching/exclusions/summary — drives the
// state and BU dropdown counts on the Patch Management page.
function mapExclusionSummary(s) {
  if (!s) return null;
  const states = Array.isArray(s.states) ? s.states : [];
  const bus = Array.isArray(s.businessUnits) ? s.businessUnits : [];
  return {
    totalExcluded: Number(s.totalExcluded) || 0,
    holdExpiredCount: Number(s.holdExpiredCount) || 0,
    states: states.map(x => ({ state: String(x.state || ''), totalCount: Number(x.totalCount) || 0 })),
    businessUnits: bus.map(x => ({ businessUnit: String(x.businessUnit || ''), totalCount: Number(x.totalCount) || 0 })),
  };
}

function mapExclusions(items) {
  const list = (items && items.items) ? items.items : (Array.isArray(items) ? items : []);
  return list.map(x => ({
    id: x.exclusionId != null ? ('EX-' + x.exclusionId) : (x.id || ''),
    exclusionId: x.exclusionId,
    server: x.serverName,
    fqdn: x.serverName, // /api/servers gives fqdn; this endpoint only has server_name
    group: x.patchGroup || '',
    service: x.service || '',
    func: x.application || '',
    env: x.environment || '',
    bu: x.businessUnit || 'Unknown',
    reason: x.reason || '',
    ticket: x.ticket || '',
    notes: x.notes || '',
    until: x.heldUntil ? new Date(x.heldUntil).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—',
    requester: x.excludedBy || '',
    requested: x.excludedAt ? new Date(x.excludedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—',
    state: x.status || 'active', // server-derived: overdue|expiring|active
  }));
}

// ── Licensing (08): the API returns snake_case fields matching the seed
// shape (licensing-demo-data.js), so this is a hardening passthrough. The
// list embeds each licence's renewal history; we flatten it into the
// RENEWALS array the detail panel reads via getRenewalsForLicence(). Both
// arrays are mutated IN PLACE so the seed's helper closures (getVendors,
// getCounts, getRenewalsForLicence) operate on the live data.
function applyLicensing(items) {
  const D = window.LICENSING_DATA;
  if (!D || !Array.isArray(D.LICENCES) || !Array.isArray(D.RENEWALS)) return;
  const licences = (items || []).map(l => ({
    licence_id: l.licence_id,
    application_id: l.application_id != null ? l.application_id : null,
    application_name: l.application_name || '',
    vendor: l.vendor || '',
    product: l.product || '',
    licence_type: l.licence_type || '',
    quantity_held: l.quantity_held != null ? l.quantity_held : null,
    audit_frequency: l.audit_frequency || '',
    audit_owner_sam: l.audit_owner_sam || '',
    expires_at: l.expires_at,
    notice_period_days: l.notice_period_days != null ? l.notice_period_days : 0,
    status_flag: l.status_flag || 'tracked',
    notes: l.notes || '',
  }));
  const renewals = [];
  (items || []).forEach(l => (l.renewals || []).forEach(r => renewals.push({
    renewal_id: r.renewal_id,
    licence_id: r.licence_id,
    cycle_ended: r.cycle_ended,
    renewed_on: r.renewed_on,
    new_expires: r.new_expires,
    renewed_by: r.renewed_by || '',
    notes: r.notes || '',
  })));
  D.LICENCES.length = 0; D.LICENCES.push(...licences);
  D.RENEWALS.length = 0; D.RENEWALS.push(...renewals);
}

// ── Auditing (09): reshape the live /api/auditing/* responses back into the
// demo fixture shape (auditing-demo-data.js) and replace the in-place arrays so
// the seed's helper closures (getApp, getSubjectsByManager, getCampaignProgress,
// getAuditStatus, getAuditingCritCounts, ...) operate on live data unchanged.
//
// SCOPE (Slice 1): applications, bindings, nominees, campaigns + their packets /
// decisions / email-log are LIVE. AD reference data (USERS, GROUPS,
// GROUP_MEMBERSHIPS, GROUP_OWNERS) is intentionally NOT touched — it stays on the
// demo fixture until the AD-sync slice. Bindings reference real DNs picked from
// that demo fixture, so the per-group member/owner panels still resolve.
//
// appDetails/campDetails are the per-id detail responses (the list endpoints
// don't embed bindings/nominees/packets), fetched in parallel by the caller.
// Reshape one API app-detail into the demo-fixture shape the SPA reads. The id
// maps let the OC_ACTIONS write helpers resolve binding_id/nominee_id (the UI
// works in DNs/sams).
function _shapeAuditApp(a) {
  return {
    application_id: a.application_id,
    name: a.name,
    business_owner: a.business_owner || '',
    technical_owner: a.technical_owner || '',
    support_email: a.support_email || '',
    bindings: (a.bindings || []).map(b => b.group_dn),
    audit_frequency_months: a.audit_frequency_months != null ? a.audit_frequency_months : null,
    auto_launch: !!a.auto_launch,
    audit_routing_mode: a.audit_routing_mode || 'line_manager',
    audit_due_period_days: a.audit_due_period_days || 21,
    nominees: (a.nominees || []).map(n => ({ nominee_sam: n.nominee_sam, role_note: n.role_note || '' })),
    _bindingIds: Object.fromEntries((a.bindings || []).map(b => [b.group_dn, b.binding_id])),
    _nomineeIds: Object.fromEntries((a.nominees || []).map(n => [n.nominee_sam, n.nominee_id])),
  };
}

// Replace (or insert) a single app in the live AUDITING_DATA — used for the
// targeted refresh after an app/binding/nominee write so we don't reload the
// whole auditing dataset each time.
function applyAuditingApp(detail) {
  const D = window.AUDITING_DATA;
  if (!D || !Array.isArray(D.APPLICATIONS) || !detail) return;
  const shaped = _shapeAuditApp(detail);
  const i = D.APPLICATIONS.findIndex(a => a.application_id === shaped.application_id);
  if (i >= 0) D.APPLICATIONS[i] = shaped; else D.APPLICATIONS.push(shaped);
}

function applyAuditing(appDetails, campDetails) {
  const D = window.AUDITING_DATA;
  if (!D || !Array.isArray(D.APPLICATIONS)) return;

  const apps = (appDetails || []).filter(Boolean).map(_shapeAuditApp);

  const campaigns = [], packets = [], decisions = [], emailLog = [];
  (campDetails || []).filter(Boolean).forEach(c => {
    campaigns.push({
      campaign_id: c.campaign_id,
      application_id: c.application_id,
      application_name: c.application_name || '',
      name: c.name,
      status: c.status,
      // date-only: the crit-strip helper appends 'T23:59:59' to due_at.
      due_at: c.due_at ? String(c.due_at).slice(0, 10) : null,
      created_by: c.created_by || '',
      created_at: c.created_at,
      closed_at: c.closed_at || null,
      closed_by_packet_id: c.closed_by_packet_id || null,
      launch_kind: c.launch_kind || 'manual',
      routing_mode: c.routing_mode,
      closure_mode: c.closure_mode,
      cc_audit_mailbox: c.cc_audit_mailbox || '',
    });
    (c.packets || []).forEach(p => packets.push({
      packet_id: p.packet_id,
      campaign_id: c.campaign_id,
      recipient_sam: p.recipient_sam,
      recipient_display: p.recipient_display || p.recipient_sam,
      recipient_email: p.recipient_email || '',
      recipient_kind: p.recipient_kind,
      role_note: p.role_note || '',
      subjects: (p.subjects || []).map(s => s.subject_sam),
      // attestation links are SSO-gated and built from packet_id (attest.html?p=<packet_id>).
      submitted_at: p.submitted_at || null,
      submitted_by_sam: p.submitted_by_sam || null,
      submitted_by_display: p.submitted_by_display || null,
      reminder_sent_at: p.reminder_sent_at || null,
    }));
    (c.decisions || []).forEach(d => decisions.push({
      packet_id: d.packet_id, subject_sam: d.subject_sam, decision: d.decision, comment: d.comment || '',
    }));
    (c.email_log || []).forEach(e => emailLog.push({
      log_id: e.log_id, packet_id: e.packet_id, campaign_id: e.campaign_id,
      to_addr: e.to_addr, cc_addr: e.cc_addr, subject: e.subject, kind: e.kind,
      sent_at: e.sent_at, success: !!e.success,
    }));
  });

  D.APPLICATIONS.length = 0; D.APPLICATIONS.push(...apps);
  D.CAMPAIGNS.length = 0;    D.CAMPAIGNS.push(...campaigns);
  D.PACKETS.length = 0;      D.PACKETS.push(...packets);
  D.DECISIONS.length = 0;    D.DECISIONS.push(...decisions);
  D.EMAIL_LOG.length = 0;    D.EMAIL_LOG.push(...emailLog);
}

// Fetch the auditing list endpoints, then their per-id details, and apply.
// Returns true on success, false if any list fetch was unreachable.
async function fetchAuditing() {
  const [appList, campList] = await Promise.all([
    api('/auditing/applications'),
    api('/auditing/campaigns'),
  ]);
  if (!Array.isArray(appList) || !Array.isArray(campList)) return false;
  const [appDetails, campDetails] = await Promise.all([
    Promise.all(appList.map(a => api('/auditing/applications/' + a.application_id))),
    Promise.all(campList.map(c => api('/auditing/campaigns/' + c.campaign_id))),
  ]);
  applyAuditing(appDetails, campDetails);
  return true;
}

// ── Paginated /api/servers (backend caps limit at 1000) ──────────────
async function fetchAllServers(bu) {
  const PAGE = 1000;
  const MAX_PAGES = 10;
  const buQs = (bu && bu !== '__all') ? '&businessUnit=' + encodeURIComponent(bu) : '';
  let offset = 0;
  let all = [];
  let total = null;
  for (let i = 0; i < MAX_PAGES; i++) {
    const r = await api(`/servers?limit=${PAGE}&offset=${offset}${buQs}`);
    if (!r || !Array.isArray(r.items)) return null;
    all = all.concat(r.items);
    if (total === null) total = r.totalCount ?? all.length;
    if (all.length >= total) break;
    offset += PAGE;
  }
  if (total !== null && all.length < total) {
    console.warn('op-boot: server inventory exceeds MAX_PAGES ceiling', { fetched: all.length, total });
  }
  return { items: all, total };
}

// ── Boot ─────────────────────────────────────────────────────────────

async function boot() {
  // (Step 10.3) shimmer the data modules until the first fetch wave settles.
  // Only on initial boot; OC_API.retry/refresh call runFetches() directly and
  // skip the skeleton so a manual refresh doesn't blank the page.
  document.body.classList.add('loading');
  // Attach the apiErrors listener exactly once per page load. window.OC_API.retry
  // re-runs runFetches() without re-attaching — the listener stays wired.
  setApiErrorsListener(() => {
    window.API_ERRORS = apiErrors.slice();
    if (window.RERENDER_SHELL) window.RERENDER_SHELL();
  });
  // finally: never leave the page stuck in the skeleton shimmer if the first
  // fetch wave throws before its own per-fetch error handling catches.
  try {
    await runFetches();
  } finally {
    document.body.classList.remove('loading');
  }
}

// The fetch wave — initial boot and retry both call this. Each fetch's
// failure marks its owning widget as "on demo data" so the page renders
// a DEMO ribbon on that card only.
async function runFetches() {
  // Seed globals exist from the design bundle by the time this runs (deferred
  // module script). Overwrite as fetches resolve and re-render.
  const rerender = () => {
    // Publish current apiErrors snapshot for op-app.js consoleState() to read.
    window.API_ERRORS = apiErrors.slice();
    const m = mount();
    if (window.RERENDER_PAGE && m) window.RERENDER_PAGE(m);
    // Also trigger a full shell re-render (rail footer, statusline, banner)
    // when the page re-renders, since apiState lives outside .page-mount.
    if (window.RERENDER_SHELL) window.RERENDER_SHELL();
  };

  // Fresh demo state on each call — clears stale markers from a prior run
  // where a fetch failed then succeeded.
  clearAllDemo();

  // Global BU scope (set by op-app.js's rail BuScope). Threaded into every
  // fetch that supports ?businessUnit=. Note: /servers/summary is *not*
  // threaded — it's the source of truth for the rail's BU dropdown options
  // and must always return the full BU breakdown.
  const bu = window.SELECTED_BU;
  const buQs = (bu && bu !== '__all') ? '&businessUnit=' + encodeURIComponent(bu) : '';

  // Fire everything in parallel. Each fetch's failure marks its owning widget
  // as "on demo data" so the page renders a DEMO ribbon on that card only.
  const fetches = [
    fetchAllServers(bu).then(r => {
      if (!r) { markDemo('servers'); return; }
      const servers = mapServers(r.items);
      const envCounts = {};
      for (const s of servers) envCounts[s.env] = (envCounts[s.env] || 0) + 1;
      const envBreakdown = Object.entries(envCounts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
      window.SERVERS_DATA = Object.assign({}, window.SERVERS_DATA, {
        servers,
        SRV_TOTAL: r.total,
        SRV_ENV: envBreakdown,
        SRV_ENV_MAX: envBreakdown.length ? Math.max(...envBreakdown.map(e => e.count)) : 0,
      });
      rerender();
    }),
    api('/servers/summary').then(s => {
      if (!s) { markDemo('servers'); return; }
      const envBreakdown = mapEnvBreakdown(s);
      const buBreakdown = mapBuBreakdown(s);
      // SRV_BU always reflects the unfiltered global breakdown (it powers
      // the rail's BU dropdown). The page-level numbers (SRV_TOTAL, SRV_ENV,
      // SRV_ENV_MAX) are owned by fetchAllServers above, which respects the
      // selected BU - overwriting them here causes the BU-filtered count to
      // briefly appear and then revert to the global count when this
      // unfiltered fetch resolves last.
      const update = { SRV_BU: buBreakdown };
      if (!bu || bu === '__all') {
        update.envBreakdown = envBreakdown;
        update.SRV_ENV = envBreakdown;
        update.SRV_ENV_MAX = envBreakdown.length ? Math.max(...envBreakdown.map(e => e.count)) : 0;
        update.SRV_TOTAL = s.totalCount;
      }
      window.SERVERS_DATA = Object.assign({}, window.SERVERS_DATA, update);
      rerender();
    }),
    api('/servers/unreachable' + (buQs ? '?' + buQs.slice(1) : '')).then(v => {
      if (!Array.isArray(v)) { markDemo('servers'); return; }
      window.SERVERS_DATA = Object.assign({}, window.SERVERS_DATA, { unreachable: mapUnreachable(v) });
      rerender();
    }),
    api('/servers/unmatched' + (buQs ? '?' + buQs.slice(1) : '')).then(v => {
      if (!Array.isArray(v)) { markDemo('servers'); return; }
      window.SERVERS_DATA = Object.assign({}, window.SERVERS_DATA, { unmatched: mapUnmatched(v) });
      rerender();
    }),
    api('/certificates?limit=1000' + buQs).then(v => {
      if (!Array.isArray(v)) { markDemo('certs'); return; }
      window.CERTS_DATA = Object.assign({}, window.CERTS_DATA, { CERTS: mapCerts(v) });
      rerender();
    }),
    api('/certificates/summary' + (buQs ? '?' + buQs.slice(1) : '')).then(s => {
      if (!s) { markDemo('certs'); return; }
      window.CERTS_DATA = Object.assign({}, window.CERTS_DATA, {
        CERT_COUNTS: mapCertCounts(s),
        CERT_BREAKDOWN: mapCertBreakdown(s),
      });
      rerender();
    }),
    api('/eol?limit=500&hasServers=true' + buQs).then(v => {
      if (!Array.isArray(v)) { markDemo('eol'); return; }
      window.EOL_DATA = Object.assign({}, window.EOL_DATA, { EOL_PRODUCTS: mapEolProducts(v) });
      rerender();
    }),
    api('/eol/summary?hasServers=true' + buQs).then(s => {
      if (!s) { markDemo('eol'); return; }
      window.EOL_DATA = Object.assign({}, window.EOL_DATA, { EOL_TOTALS: mapEolTotals(s) });
      rerender();
    }),
    api('/eol/unmatched?limit=50').then(v => {
      // The work-list is global (not BU-scoped) and best-effort — failure here
      // doesn't taint the EOL page's demo state, just leaves the panel empty.
      if (!Array.isArray(v)) return;
      window.EOL_DATA = Object.assign({}, window.EOL_DATA, { EOL_UNMATCHED: v });
      rerender();
    }),
    Promise.all([
      api('/patching/cycles' + (buQs ? '?' + buQs.slice(1) : '')),
      api('/patching/next' + (buQs ? '?' + buQs.slice(1) : '')),
    ]).then(([cycles, next]) => {
      if (!cycles && !next) { markDemo('patching'); return; }
      window.PATCH_GROUPS = mapPatchGroups(cycles, next);
      // Live cycle data for the patching-page hero. Source schedule is
      // human-maintained and sometimes lags; isStale=true means the API
      // fell back to the most recent past cycle and the hero should warn
      // instead of showing a fictional upcoming date.
      window.PATCH_NEXT_CYCLE = next ? {
        cycleId:    next.cycle && next.cycle.cycleId,
        cycleDate:  next.cycle && next.cycle.cycleDate,
        daysUntil:  next.daysUntil,
        isStale:    !!next.isStale,
        daysOverdue: next.daysOverdue || 0
      } : null;
      rerender();
    }),
    api('/patching/cycles?upcomingOnly=false&limit=24' + buQs).then(v => {
      if (!Array.isArray(v)) { markDemo('patching'); return; }
      window.PATCH_CYCLES = mapPatchCycles(v);
      rerender();
    }),
    api('/patching/issues').then(v => {
      if (!Array.isArray(v)) { markDemo('patching'); return; }
      window.PATCH_ISSUES = mapPatchIssues(v);
      rerender();
    }),
    api('/health/syncs').then(r => {
      // /api/health/syncs returns a bare SyncStatus[]; only the /api/health
      // root endpoint wraps it in {syncStatuses}. Accept both shapes.
      const arr = Array.isArray(r) ? r : (r && Array.isArray(r.syncStatuses) ? r.syncStatuses : null);
      if (!arr) { markDemo('health'); return; }
      window.SYNCS = mapSyncs(arr);
      rerender();
    }),
    api('/alerts/recent?limit=20').then(v => {
      if (!Array.isArray(v)) { markDemo('health'); return; }
      window.RECENT_ALERTS_BASE = mapAlerts(v);
      rerender();
    }),
    api('/patching/exclusions?limit=500' + buQs).then(v => {
      if (!v) { markDemo('exclusions'); return; }
      window.EXCLUSIONS = mapExclusions(v);
      rerender();
    }),
    api('/patching/exclusions/summary' + (buQs ? '?' + buQs.slice(1) : '')).then(s => {
      const summary = mapExclusionSummary(s);
      if (!summary) return;
      window.EXCL_BREAKDOWN = summary;
      rerender();
    }),
    // Licensing (08) — not BU-scoped (vendor licences aren't owned per BU).
    api('/licensing/licences').then(v => {
      if (!Array.isArray(v)) { markDemo('licensing'); return; }
      applyLicensing(v);
      rerender();
    }),
    // Auditing (09) — not BU-scoped. Applications + campaigns go live; AD
    // membership/owners stay on the demo fixture until the AD-sync slice.
    fetchAuditing().then(ok => {
      if (!ok) { markDemo('auditing'); return; }
      clearDemo('auditing');
      rerender();
    }).catch(() => markDemo('auditing')),
    api('/me').then(v => {
      if (!v) return;
      window.CURRENT_USER = v; // { username, fullName }
      rerender();
    }),
    // Default to the production-class environments on initial load (Production /
    // Live Support / Shared Services) — the rest of the estate is noise for the
    // ops team. The multi-select env dropdown lets users widen or narrow scope;
    // OC_API.fetchDisks handles the refetch.
    api('/disks?environment=Production&environment=Live%20Support&environment=Shared%20Services&limit=5000' + buQs).then(r => {
      if (!r || !Array.isArray(r.items)) { markDemo('disks'); return; }
      window.DISKS_DATA = Object.assign({}, window.DISKS_DATA, {
        items: mapDisks(r.items),
        totalCount: r.totalCount != null ? r.totalCount : r.items.length,
        currentEnvs: ['Production', 'Live Support', 'Shared Services'],
        currentBu:  bu || '__all',
      });
      rerender();
    }),
    // Top-level summary tracks the global BU scope so the env dropdown and
    // KPI cells show counts within the selected BU. Pre-BU-filter behaviour
    // (no scope) is preserved when bu === '__all'.
    api('/disks/summary' + (buQs ? '?' + buQs.slice(1) : '')).then(s => {
      const summary = mapDiskSummary(s);
      if (!summary) { markDemo('disks'); return; }
      window.DISK_SUMMARY = summary;
      rerender();
    }),
    // Health page disk card pins to Production environment only — non-prod
    // disk capacity is noise for the ops team's at-a-glance view. BU follows
    // the global rail selection (was previously hardcoded to Group Support;
    // now redundant with the rail BU filter, which the user can pin once
    // and have it persist).
    api('/disks/summary?environment=Production' + buQs).then(s => {
      const summary = mapDiskSummary(s);
      if (!summary) return; // demo fallback handled by op-app.js disks card path
      window.DISK_SUMMARY_PROD = summary;
      rerender();
    }),
  ];

  await Promise.allSettled(fetches);

  // Any fetch that returned null left a demo-seeded widget in place (and
  // recorded an error in apiErrors). Reflect that in the usingDemo flag so
  // op-app.js can surface it in the banner.
  const demoActive = apiErrors.length > 0;
  window.USING_DEMO = demoActive;
  setUsingDemo(demoActive);

  // Final rerender to ensure a consistent view once everything has landed.
  rerender();
}

// ── OC_API: authenticated GET helpers for IIFE modules (op-pages.js) ──

// Synthesised demo data for the server detail page. Shape mirrors the live
// API responses so the renderer doesn't branch on demo vs live. Used when
// the API is unreachable — see OC_API.getServerDetail.
function _demoServer(id, seed) {
  // seed is a row from window.SERVERS_DATA.servers (mapServers shape) — has
  // name/fqdn/env/bu/pg/etc. but no OS/location. Fill the gaps.
  const name = (seed && seed.name) || ('demo-srv-' + id);
  const fqdn = (seed && seed.fqdn) || (name + '.example.local');
  const env = (seed && seed.env) || 'Production';
  const bu = (seed && seed.bu) || 'Contoso UK';
  const pg = (seed && seed.pg && seed.pg !== 'NO PATCH GROUP FOUND') ? seed.pg : 'Group A';
  const lastSeen = (seed && seed.lastSeen) || new Date(Date.now() - 30 * 60 * 1000).toISOString();
  return {
    serverId: id,
    serverName: name,
    fqdn,
    ipAddress: '10.0.0.42',
    environment: env,
    applicationName: (seed && seed.app) || 'Demo Application',
    service: (seed && seed.service) || 'Demo Service',
    func: (seed && seed.func) || 'Application Server',
    patchGroup: pg,
    businessUnit: bu,
    isActive: !seed || seed.active !== false,
    lastSeen,
    operatingSystem: 'Windows Server 2022',
    location: 'London DC',
    primaryContact: 'demo@example.com',
  };
}
function _demoDisks() {
  return [
    { diskLabel:'C:\\', percentUsed:42.1, volumeSizeGb:240, alertStatus:1 },
    { diskLabel:'D:\\', percentUsed:45.2, volumeSizeGb:1900, alertStatus:1 },
    { diskLabel:'E:\\', percentUsed:68.0, volumeSizeGb:512, alertStatus:1 },
    { diskLabel:'L:\\', percentUsed:12.4, volumeSizeGb:128, alertStatus:1 },
  ];
}
function _demoCerts(host) {
  const today = new Date();
  const iso = (d) => d.toISOString();
  const monthsFromNow = (n) => new Date(today.getFullYear(), today.getMonth() + n, today.getDate());
  return [
    { subjectCn: host, validTo: iso(monthsFromNow(9)),  daysUntilExpiry: 246, alertLevel: 'OK',       isExpired: false },
    { subjectCn: 'int.' + host,  validTo: iso(monthsFromNow(4)),  daysUntilExpiry: 132, alertLevel: 'OK',       isExpired: false },
    { subjectCn: 'mgmt.' + host, validTo: iso(monthsFromNow(-1)), daysUntilExpiry: -7,  alertLevel: 'expired',  isExpired: true  },
  ];
}
function _demoHistory(patchGroup) {
  const today = new Date();
  const isoDate = (n) => {
    const d = new Date(today.getFullYear(), today.getMonth() - n, 8);
    return d.toISOString().slice(0, 10);
  };
  return [
    { cycleId: 1001, cycleDate: isoDate(1), patchGroup, status: 'patched' },
    { cycleId: 1000, cycleDate: isoDate(2), patchGroup, status: 'patched' },
    { cycleId: 999,  cycleDate: isoDate(3), patchGroup, status: 'held'    },
  ];
}

window.OC_API = {
  // Re-run the boot fetch wave with cleared apiErrors. Used by op-app.js for
  // the "Retry now" banner button and the top-right Refresh pill.
  retry: async () => {
    clearApiErrors();
    await runFetches();
  },

  // Server detail page bundle. Hits /api/servers/{id}, /api/disks (server-
  // scoped), /api/certificates/server/{name}, and /api/servers/{id}/patch-
  // history. Any failed fetch is replaced with synthesised demo data so
  // local dev without the API still renders a populated page; markDemo
  // ('server-detail') flags the substitution so the page can show the
  // DEMO ribbon. Returns the bundle directly (never null) — the detail
  // page only shows "Server not found" for the explicit-id case where
  // /api/servers/{id} returns 404 with a real, reachable API.
  getServerDetail: async (id) => {
    let usedDemo = false;
    let server = await api('/servers/' + encodeURIComponent(id));
    // Distinguish a 404 (server reachable, id unknown — return null so the
    // page can render "Server not found") from a connection failure (api.js
    // already pushed an error and apiErrors is non-empty).
    if (!server) {
      const apiUnreachable = (typeof apiErrors !== 'undefined') && apiErrors.length > 0;
      if (!apiUnreachable) return null;
      const seed = (window.SERVERS_DATA && Array.isArray(window.SERVERS_DATA.servers))
        ? window.SERVERS_DATA.servers.find(x => x.id === id) : null;
      server = _demoServer(id, seed);
      usedDemo = true;
    }
    const name = server.serverName || '';
    const [disksRes, certsRes, historyRes] = await Promise.all([
      // includeNonprod=true: a server's detail page must show all its disks even
      // when the server lives in the .nonprod domain (the list view hides those).
      api('/disks?limit=100&includeNonprod=true&serverName=' + encodeURIComponent(name)),
      api('/certificates/server/' + encodeURIComponent(name)),
      api('/servers/' + encodeURIComponent(id) + '/patch-history'),
    ]);

    let disks = disksRes;
    if (!disks || (typeof disks === 'object' && !Array.isArray(disks) && !Array.isArray(disks.items))) {
      disks = { items: _demoDisks() };
      usedDemo = true;
    }
    let certs = certsRes;
    if (!Array.isArray(certs)) {
      certs = _demoCerts(server.fqdn || server.serverName || '');
      usedDemo = true;
    }
    let history = historyRes;
    if (!Array.isArray(history)) {
      history = _demoHistory(server.patchGroup || 'Group A');
      usedDemo = true;
    }

    if (usedDemo) markDemo('server-detail');
    return { server, disks, certs, history };
  },

  // Returns EolSoftwareDetail with .assets[] (machine names) or null on error.
  getEolDetail: (product, version, businessUnit) => {
    const bu = businessUnit !== undefined ? businessUnit : window.SELECTED_BU;
    const qs = (bu && bu !== '__all') ? ('?businessUnit=' + encodeURIComponent(bu)) : '';
    return api('/eol/' + encodeURIComponent(product) + '/' + encodeURIComponent(version) + qs);
  },

  // Live AD search for the auditing binding + owner pickers. Returns an array
  // ({dn,sam,group_type} / {sam,display,email}) or null (503/unreachable -> demo fallback).
  searchAdGroups: (q, limit = 10) =>
    api('/auditing/ad-groups/search?q=' + encodeURIComponent(q) + '&limit=' + limit),
  searchAdUsers: (q, limit = 10) =>
    api('/auditing/ad-users/search?q=' + encodeURIComponent(q) + '&limit=' + limit),

  // Refetch /api/disks + /api/disks/summary scoped to the given filters.
  // Any filter can be falsy / '__all' to mean unfiltered. Status is the
  // alert-status filter (1=OK, 2=Warning, 3=Critical). Updates
  // window.DISKS_DATA + window.DISK_SUMMARY and triggers a rerender so the
  // KPI strip, dropdown counts, and table all reflect the new selection.
  fetchDisks: async ({ env, envs, bu, status, includeNonprod } = {}) => {
    if (bu === undefined) bu = window.SELECTED_BU;
    // Env is multi-select: accept an `envs` array, or a single `env` string for
    // back-compat. '__all' / falsy means no env filter. An empty string entry
    // selects the untagged (no-environment) group.
    const envList = Array.isArray(envs) ? envs.slice()
                  : (env && env !== '__all') ? [env] : [];
    const envSet = envList.length > 0;
    const buSet  = bu && bu !== '__all';
    const stSet  = status && status !== '__all';
    // includeNonprod defaults to false (the API also defaults to excluding
    // .nonprod disks); only send the param when explicitly opting in.
    const npSet  = includeNonprod === true;
    const buildParams = (includeLimit) => {
      const ps = includeLimit ? ['limit=5000'] : [];
      if (envSet) envList.forEach(e => ps.push('environment=' + encodeURIComponent(e)));
      if (buSet)  ps.push('businessUnit=' + encodeURIComponent(bu));
      if (stSet)  ps.push('alertStatus=' + encodeURIComponent(status));
      if (npSet)  ps.push('includeNonprod=true');
      return ps;
    };
    const qs = '?' + buildParams(true).join('&');
    const summaryParams = buildParams(false);
    const summaryQs = summaryParams.length ? '?' + summaryParams.join('&') : '';

    const [listResult, summaryResult] = await Promise.all([
      api('/disks' + qs),
      api('/disks/summary' + summaryQs),
    ]);

    if (listResult && Array.isArray(listResult.items)) {
      window.DISKS_DATA = Object.assign({}, window.DISKS_DATA, {
        items: mapDisks(listResult.items),
        totalCount: listResult.totalCount != null ? listResult.totalCount : listResult.items.length,
        currentEnvs:   envSet ? envList : [],
        currentBu:     buSet  ? bu     : '__all',
        currentStatus: stSet  ? status : '__all',
      });
    }
    const mappedSummary = mapDiskSummary(summaryResult);
    if (mappedSummary) {
      window.DISK_SUMMARY = mappedSummary;
    }
    if (typeof window.RERENDER_PAGE === 'function') {
      const m = document.querySelector('.page-mount');
      if (m) window.RERENDER_PAGE(m);
    }
    return listResult;
  },

  // Back-compat shim: existing callers pass an env string directly.
  fetchDisksByEnv: function(envName) {
    return this.fetchDisks({ env: envName });
  },

  // Refetch /api/patching/exclusions + /api/patching/exclusions/summary
  // scoped to state + BU. State values match the frontend dropdown vocabulary:
  // 'overdue' | 'expiring-soon' | 'active'. Updates window.EXCLUSIONS and
  // window.EXCL_BREAKDOWN; triggers rerender.
  fetchExclusions: async ({ state, bu } = {}) => {
    if (bu === undefined) bu = window.SELECTED_BU;
    const stSet = state && state !== '__all';
    const buSet = bu && bu !== '__all';
    const listParams = ['limit=500'];
    if (stSet) listParams.push('state=' + encodeURIComponent(state));
    if (buSet) listParams.push('businessUnit=' + encodeURIComponent(bu));
    const summaryParams = [];
    if (stSet) summaryParams.push('state=' + encodeURIComponent(state));
    if (buSet) summaryParams.push('businessUnit=' + encodeURIComponent(bu));
    const summaryQs = summaryParams.length ? '?' + summaryParams.join('&') : '';

    const [listResult, summaryResult] = await Promise.all([
      api('/patching/exclusions?' + listParams.join('&')),
      api('/patching/exclusions/summary' + summaryQs),
    ]);

    if (listResult) {
      window.EXCLUSIONS = mapExclusions(listResult);
    }
    const mappedSummary = mapExclusionSummary(summaryResult);
    if (mappedSummary) {
      window.EXCL_BREAKDOWN = mappedSummary;
    }
    if (typeof window.RERENDER_PAGE === 'function') {
      const m = document.querySelector('.page-mount');
      if (m) window.RERENDER_PAGE(m);
    }
    return listResult;
  },

  // Refetch /api/certificates + /api/certificates/summary scoped to BU+level.
  // Level values match the frontend dropdown vocabulary: 'expired' | 'crit' |
  // 'warn' | 'ok'. Updates window.CERTS_DATA and triggers rerender.
  fetchCerts: async ({ bu, level } = {}) => {
    if (bu === undefined) bu = window.SELECTED_BU;
    const buSet  = bu && bu !== '__all';
    const lvSet  = level && level !== '__all';
    // Map the dropdown vocabulary back to the existing /api/certificates
    // alertLevel param (which expects critical/warning/ok/expired uppercase-ish).
    const alertLevelFor = { expired: 'expired', crit: 'critical', warn: 'warning', ok: 'ok' };
    const listParams = ['limit=1000'];
    if (buSet) listParams.push('businessUnit=' + encodeURIComponent(bu));
    if (lvSet) listParams.push('alertLevel=' + encodeURIComponent(alertLevelFor[level] || level));
    const summaryParams = [];
    if (buSet) summaryParams.push('businessUnit=' + encodeURIComponent(bu));
    if (lvSet) summaryParams.push('level=' + encodeURIComponent(level));
    const summaryQs = summaryParams.length ? '?' + summaryParams.join('&') : '';

    const [listResult, summaryResult] = await Promise.all([
      api('/certificates?' + listParams.join('&')),
      api('/certificates/summary' + summaryQs),
    ]);

    if (Array.isArray(listResult)) {
      window.CERTS_DATA = Object.assign({}, window.CERTS_DATA, { CERTS: mapCerts(listResult) });
    }
    if (summaryResult) {
      window.CERTS_DATA = Object.assign({}, window.CERTS_DATA, {
        CERT_COUNTS: mapCertCounts(summaryResult),
        CERT_BREAKDOWN: mapCertBreakdown(summaryResult),
      });
    }
    if (typeof window.RERENDER_PAGE === 'function') {
      const m = document.querySelector('.page-mount');
      if (m) window.RERENDER_PAGE(m);
    }
    return listResult;
  },

  // Refetch /api/servers + /api/servers/summary scoped to env+BU. Updates
  // window.SERVERS_DATA (servers list, env/BU breakdowns) and triggers
  // rerender so the bar chart, dropdown counts, and table reflect the new
  // intersection.
  fetchServers: async ({ env, bu } = {}) => {
    if (bu === undefined) bu = window.SELECTED_BU;
    const envSet = env && env !== '__all';
    const buSet  = bu && bu !== '__all';
    // List URL gets the full filter set. Summary URL stays unfiltered by BU
    // so SERVERS_DATA.SRV_BU remains the full BU breakdown — that's the
    // source the rail's BuScope reads to build its dropdown options. Env
    // filter on the summary is fine since the summary returns env counts
    // cross-faceted with the requested env filter.
    const listParams = ['limit=2500'];
    if (envSet) listParams.push('environment=' + encodeURIComponent(env));
    if (buSet)  listParams.push('businessUnit=' + encodeURIComponent(bu));
    const summaryParams = [];
    if (envSet) summaryParams.push('environment=' + encodeURIComponent(env));
    const summaryQs = summaryParams.length ? '?' + summaryParams.join('&') : '';

    const [listResult, summaryResult] = await Promise.all([
      api('/servers?' + listParams.join('&')),
      api('/servers/summary' + summaryQs),
    ]);

    if (listResult && Array.isArray(listResult.items)) {
      window.SERVERS_DATA = Object.assign({}, window.SERVERS_DATA, {
        servers: mapServers(listResult.items),
      });
    }
    if (summaryResult) {
      const envBreakdown = mapEnvBreakdown(summaryResult);
      const buBreakdown = mapBuBreakdown(summaryResult);
      window.SERVERS_DATA = Object.assign({}, window.SERVERS_DATA, {
        envBreakdown,
        SRV_ENV: envBreakdown,
        SRV_BU:  buBreakdown,
        SRV_ENV_MAX: envBreakdown.length ? Math.max(...envBreakdown.map(e => e.count)) : 0,
        SRV_TOTAL: summaryResult.totalCount,
      });
    }
    if (typeof window.RERENDER_PAGE === 'function') {
      const m = document.querySelector('.page-mount');
      if (m) window.RERENDER_PAGE(m);
    }
    return listResult;
  },
};

// ── OC_ACTIONS: wizard submit hooks (op-pages.js calls these) ─────

window.OC_ACTIONS = {
  // { servers: [{id,name}], reason, reasonSlug, until, untilIso, notes } + onDone() + onError(msg)
  // onError surfaces failures as an inline wizard banner; falls back to alert()
  // if the caller didn't supply one.
  addExclusion: async (payload, onDone, onError) => {
    const fail = (m) => { if (onError) onError(m); else alert(m); };
    // Prefer the canonical ISO from the wizard; fall back to parsing the
    // display string only if an older caller didn't supply untilIso.
    const iso = payload.untilIso || toIsoDate(payload.until);
    if (!iso) { fail('Hold-until date is required.'); return; }
    const body = {
      serverIds: (payload.servers || []).map(s => s.id).filter(Boolean),
      reason: payload.reason || 'Exclusion',
      reasonSlug: payload.reasonSlug || slugify(payload.reason),
      notes: payload.notes || null,
      heldUntil: iso,
    };
    if (body.serverIds.length === 0) { fail('No servers selected.'); return; }
    const res = await apiPost('/patching/exclusions', body);
    if (!res.ok) { fail('Could not exclude (' + res.status + '): ' + (res.error || 'unknown error')); return; }
    await refetchExclusions();
    if (onDone) onDone();
  },

  // { kind: 'group'|'env', target, reason, reasonSlug, until, untilIso, affectedCount } + onDone() + onError(msg)
  bulkExclude: async (payload, onDone, onError) => {
    const fail = (m) => { if (onError) onError(m); else alert(m); };
    const iso = payload.untilIso || toIsoDate(payload.until);
    if (!iso) { fail('Hold-until date is required.'); return; }
    const body = {
      kind: payload.kind,
      target: payload.target,
      reason: payload.reason || 'Bulk exclusion',
      reasonSlug: payload.reasonSlug || slugify(payload.reason),
      heldUntil: iso,
    };
    const res = await apiPost('/patching/exclusions/bulk', body);
    if (!res.ok) { fail('Bulk exclude failed (' + res.status + '): ' + (res.error || 'unknown error')); return; }
    await refetchExclusions();
    if (onDone) onDone();
  },

  // r = exclusion row, extraDays = number of days to extend (default 30)
  renewExclusion: async (r, extraDays) => {
    const id = r.exclusionId;
    if (!id) { alert('Cannot renew: no ID on row (demo mode?).'); return; }
    const days = typeof extraDays === 'number' ? extraDays : 30;
    const newDate = new Date();
    newDate.setDate(newDate.getDate() + days);
    const iso = newDate.toISOString().slice(0, 10);
    const res = await apiPatch('/patching/exclusions/' + id, { heldUntil: iso });
    if (!res.ok) { alert('Could not renew (' + res.status + '): ' + (res.error || 'unknown error')); return; }
    await refetchExclusions();
  },

  releaseExclusion: async (r) => {
    const id = r.exclusionId;
    if (!id) { alert('Cannot release: no ID on row (demo mode?).'); return; }
    if (!confirm('Release exclusion for ' + (r.server || r.id) + '?')) return;
    const res = await apiDelete('/patching/exclusions/' + id);
    if (!res.ok) { alert('Could not release (' + res.status + '): ' + (res.error || 'unknown error')); return; }
    await refetchExclusions();
  },
};

// ── Licensing (08) write actions (op-pages.js calls these) ───────────
// Each tries the API first; on failure it falls back to the in-memory seed
// so the prototype stays interactive offline (and flips on the DEMO ribbon).
Object.assign(window.OC_ACTIONS, {
  // payload = snake_case licence fields. + onDone() + onError(msg)
  addLicence: async (payload, onDone, onError) => {
    const fail = (m) => { if (onError) onError(m); else alert(m); };
    if (!payload.vendor || !payload.product || !payload.expires_at) {
      fail('Vendor, product and expiry date are required.'); return;
    }
    const res = await apiPost('/licensing/licences', payload);
    if (res.ok) { await refetchLicences(); if (onDone) onDone(); return; }
    // Only fall back to the in-memory seed when the API is unreachable (transport
    // error => status 0). Real HTTP errors (409 duplicate, 400, 403, 500) must
    // surface to the user, not be masked as a fake success.
    if (res.status === 0 && _licenceFallbackAdd(payload)) { if (onDone) onDone(); return; }
    fail('Could not add licence (' + res.status + '): ' + (res.error || 'unknown error'));
  },

  // Inline status-flag edit (tracked | engaged).
  updateLicenceStatus: async (id, statusFlag) => {
    const res = await apiPatch('/licensing/licences/' + id, { status_flag: statusFlag });
    if (res.ok) { await refetchLicences(); return; }
    if (res.status === 0) _licenceFallbackPatch(id, { status_flag: statusFlag });
    else alert('Could not update status (' + res.status + '): ' + (res.error || 'unknown error'));
  },

  // Full edit form (any subset of patchable fields). + onDone() + onError(msg).
  patchLicence: async (id, fields, onDone, onError) => {
    const fail = (m) => { if (onError) onError(m); else alert(m); };
    const res = await apiPatch('/licensing/licences/' + id, fields);
    if (res.ok) { await refetchLicences(); if (onDone) onDone(); return; }
    if (res.status === 0 && window.LICENSING_DATA) { _licenceFallbackPatch(id, fields); if (onDone) onDone(); return; }
    fail('Could not update licence (' + res.status + '): ' + (res.error || 'unknown error'));
  },

  // Renew: close the current cycle, advance expiry, reset alerts.
  renewLicence: async (id, newExpires, notes) => {
    const res = await apiPost('/licensing/licences/' + id + '/renew', { new_expires: newExpires, notes: notes || null });
    if (res.ok) { await refetchLicences(); return; }
    if (res.status === 0) _licenceFallbackRenew(id, newExpires, notes);
    else alert('Could not renew licence (' + res.status + '): ' + (res.error || 'unknown error'));
  },

  deleteLicence: async (id) => {
    const res = await apiDelete('/licensing/licences/' + id);
    if (res.ok) { await refetchLicences(); return; }
    if (res.status === 0) _licenceFallbackDelete(id); // offline: drop from the in-memory seed
    else alert('Could not delete licence (' + res.status + '): ' + (res.error || 'unknown error'));
  },
});

// ── Auditing (09) write actions (op-pages.js calls these) ────────────
// API-backed. On failure they surface the error; there is no offline in-memory
// fallback in Slice 1 (the demo fixture still backs READS when the API is
// unreachable, flagged via markDemo('auditing')).
Object.assign(window.OC_ACTIONS, {
  // payload = snake_case app fields; bindings = [{group_dn, group_sam, group_type}].
  // onDone(newAppId) fires after the app + its bindings are created.
  addAuditApp: async (payload, bindings, onDone, onError) => {
    const fail = (m) => { if (onError) onError(m); else alert(m); };
    const res = await apiPost('/auditing/applications', payload);
    if (!res.ok) { fail('Could not create application (' + res.status + '): ' + (res.error || 'unknown error')); return; }
    await refetchAuditing();
    const created = (window.AUDITING_DATA.APPLICATIONS || []).find(a => a.name === payload.name);
    if (created && Array.isArray(bindings) && bindings.length) {
      for (const b of bindings) {
        const r = await apiPost('/auditing/applications/' + created.application_id + '/bindings', b);
        if (!r.ok) { fail('Application created, but binding ' + (b.group_sam || b.group_dn) + ' failed (' + r.status + ').'); break; }
      }
      await refetchAuditing();
    }
    if (onDone) onDone(created ? created.application_id : null);
  },

  // fields = any subset of patchable app fields (owners, cadence, routing, due, auto).
  patchAuditApp: async (id, fields, onDone, onError) => {
    const fail = (m) => { if (onError) onError(m); else alert(m); };
    const res = await apiPatch('/auditing/applications/' + id, fields);
    if (!res.ok) { fail('Could not update application (' + res.status + '): ' + (res.error || 'unknown error')); return; }
    await refetchAuditingApp(id); if (onDone) onDone();
  },

  deleteAuditApp: async (id, onDone) => {
    const res = await apiDelete('/auditing/applications/' + id);
    if (!res.ok) { alert('Could not unregister application (' + res.status + '): ' + (res.error || 'unknown error')); return; }
    await refetchAuditing(); if (onDone) onDone();
  },

  addAuditBinding: async (id, body, onDone, onError) => {
    const fail = (m) => { if (onError) onError(m); else alert(m); };
    const res = await apiPost('/auditing/applications/' + id + '/bindings', body);
    if (!res.ok) { fail('Could not bind group (' + res.status + '): ' + (res.error || 'unknown error')); return; }
    await refetchAuditingApp(id); if (onDone) onDone();
  },

  removeAuditBinding: async (id, bindingId, onDone) => {
    if (!bindingId) { alert('Cannot remove binding: no id (demo mode?).'); return; }
    const res = await apiDelete('/auditing/applications/' + id + '/bindings/' + bindingId);
    if (!res.ok) { alert('Could not remove binding (' + res.status + '): ' + (res.error || 'unknown error')); return; }
    await refetchAuditingApp(id); if (onDone) onDone();
  },

  addAuditNominee: async (id, body, onDone, onError) => {
    const fail = (m) => { if (onError) onError(m); else alert(m); };
    const res = await apiPost('/auditing/applications/' + id + '/nominees', body);
    if (!res.ok) { fail('Could not add nominee (' + res.status + '): ' + (res.error || 'unknown error')); return; }
    await refetchAuditingApp(id); if (onDone) onDone();
  },

  removeAuditNominee: async (id, nomineeId, onDone) => {
    if (!nomineeId) { alert('Cannot remove nominee: no id (demo mode?).'); return; }
    const res = await apiDelete('/auditing/applications/' + id + '/nominees/' + nomineeId);
    if (!res.ok) { alert('Could not remove nominee (' + res.status + '): ' + (res.error || 'unknown error')); return; }
    await refetchAuditingApp(id); if (onDone) onDone();
  },

  // payload = { application_id, name, due_at? }. onDone(result) receives the launch
  // result incl. the one-time attestation links (result.packets[].attestation_url).
  launchAuditCampaign: async (payload, onDone, onError) => {
    const fail = (m) => { if (onError) onError(m); else alert(m); };
    const res = await apiPost('/auditing/campaigns/launch', payload);
    if (!res.ok) { fail('Could not launch campaign (' + res.status + '): ' + (res.error || 'unknown error')); return; }
    await refetchAuditing();
    if (onDone) onDone(res.data || null);
  },

  closeAuditCampaign: async (id, onDone) => {
    const res = await apiPost('/auditing/campaigns/' + id + '/close', {});
    if (!res.ok) { alert('Could not close campaign (' + res.status + '): ' + (res.error || 'unknown error')); return; }
    await refetchAuditing(); if (onDone) onDone();
  },

  remindAuditCampaign: async (id, onDone) => {
    const res = await apiPost('/auditing/campaigns/' + id + '/remind', {});
    if (!res.ok) { alert('Could not send reminders (' + res.status + '): ' + (res.error || 'unknown error')); return; }
    const sent = (res.data && res.data.sent != null) ? res.data.sent : '?';
    await refetchAuditing();
    alert(sent + ' reminder(s) sent.');
    if (onDone) onDone();
  },
});

function _rerenderAuditing() {
  const m = mount();
  if (window.RERENDER_PAGE && m) window.RERENDER_PAGE(m);
  if (window.RERENDER_SHELL) window.RERENDER_SHELL();
}

async function refetchAuditing() {
  let ok = false;
  try { ok = await fetchAuditing(); } catch (_) { ok = false; }
  if (ok) clearDemo('auditing'); else markDemo('auditing');
  _rerenderAuditing();
}

// Targeted refresh of a single application after an in-place write (binding /
// nominee / config patch). Avoids the full list + per-app/per-campaign detail
// reload that refetchAuditing does — important when binding many groups in a row.
async function refetchAuditingApp(appId) {
  let detail = null;
  try { detail = await api('/auditing/applications/' + appId); } catch (_) {}
  if (detail) { clearDemo('auditing'); applyAuditingApp(detail); }
  _rerenderAuditing();
}

function _rerenderLic() {
  const m = mount();
  if (window.RERENDER_PAGE && m) window.RERENDER_PAGE(m);
  if (window.RERENDER_SHELL) window.RERENDER_SHELL();
}

async function refetchLicences() {
  const v = await api('/licensing/licences');
  if (Array.isArray(v)) { clearDemo('licensing'); applyLicensing(v); _rerenderLic(); }
  else { markDemo('licensing'); }
}

function _licenceFallbackAdd(payload) {
  const D = window.LICENSING_DATA;
  if (!D || !Array.isArray(D.LICENCES)) return false;
  const nextId = (D.LICENCES.reduce((m, l) => Math.max(m, l.licence_id || 0), 0) || 0) + 1;
  D.LICENCES.push(Object.assign({ licence_id: nextId, status_flag: 'tracked' }, payload));
  markDemo('licensing'); _rerenderLic(); return true;
}
function _licenceFallbackPatch(id, fields) {
  const D = window.LICENSING_DATA;
  const l = D && D.LICENCES.find(x => x.licence_id === id);
  if (l) { Object.assign(l, fields); markDemo('licensing'); _rerenderLic(); }
}
function _licenceFallbackRenew(id, newExpires, notes) {
  const D = window.LICENSING_DATA;
  const l = D && D.LICENCES.find(x => x.licence_id === id);
  if (l && D.markRenewed) { D.markRenewed(l, newExpires, notes); markDemo('licensing'); _rerenderLic(); }
}
function _licenceFallbackDelete(id) {
  const D = window.LICENSING_DATA;
  if (!D || !Array.isArray(D.LICENCES)) return;
  const i = D.LICENCES.findIndex(x => x.licence_id === id);
  if (i >= 0) { D.LICENCES.splice(i, 1); markDemo('licensing'); _rerenderLic(); }
}

async function refetchExclusions() {
  const v = await api('/patching/exclusions?limit=500');
  if (v) {
    clearDemo('exclusions');
    window.EXCLUSIONS = mapExclusions(v);
    const m = mount();
    if (window.RERENDER_PAGE && m) window.RERENDER_PAGE(m);
    if (window.RERENDER_SHELL) window.RERENDER_SHELL();
  } else {
    markDemo('exclusions');
  }
}

function toIsoDate(formatted) {
  // Accepts ISO "2026-04-22" or the en-GB display string fmtUntil() emits,
  // e.g. "22 Apr 2026" / "1 Sept 2026". Canonical parsing lives in
  // op-datekit.js so the frontend and tests share one implementation that
  // does not depend on the engine's implementation-defined Date() parser.
  // The submit path now sends payload.untilIso directly; this stays as a
  // defensive fallback for any caller still passing a display string.
  if (window.OP_DATEKIT) return window.OP_DATEKIT.toIsoDate(formatted);
  if (!formatted) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(formatted)) return formatted;
  const d = new Date(formatted);
  if (isNaN(d.getTime())) return null;
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function slugify(s) {
  if (!s) return null;
  const norm = String(s).toLowerCase().trim();
  if (norm.includes('freeze')) return 'business-freeze';
  if (norm.includes('vendor')) return 'pending-vendor-fix';
  if (norm.includes('depend')) return 'dependency-block';
  if (norm.includes('change')) return 'change-window-conflict';
  return 'custom';
}

// Kick off after the shell is rendered. op-app.js registers a DOMContentLoaded
// listener that builds the shell (rail + statusline + .page-mount). We queue
// boot as a SUBSEQUENT DOMContentLoaded listener so it runs right after, or
// schedule a microtask if the event already fired. Either way .page-mount exists.
if (document.readyState === 'loading' || document.readyState === 'interactive') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  // readyState === 'complete' — shell definitely rendered. Queue on next tick so
  // any late microtasks from op-app.js resolve first.
  setTimeout(boot, 0);
}
