/* Service Ops Console — v2 boot / API wiring.
   Replaces the design bundle's synthetic window.*_DATA globals with real
   API responses, and exposes window.OC_ACTIONS for wizard submits.

   The design bundle (op-app.js / op-pages.js) is IIFE-based
   with all renders reading from window.PATCH_GROUPS / SYNCS / EXCLUSIONS / RECENT_ALERTS_BASE
   / SERVERS_DATA / CERTS_DATA / EOL_DATA. We populate those globals after
   parallel fetches and call window.RERENDER_PAGE(mount) to redraw. */

import { api, apiPost, apiErrors, clearApiErrors, setUsingDemo, setApiErrorsListener, markDemo, clearDemo, clearAllDemo } from './api.js';

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
    env: s.environment || 'Unknown',
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
    env: u.environment || 'Unknown',
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
  // Attach the apiErrors listener exactly once per page load. window.OC_API.retry
  // re-runs runFetches() without re-attaching — the listener stays wired.
  setApiErrorsListener(() => {
    window.API_ERRORS = apiErrors.slice();
    if (window.RERENDER_SHELL) window.RERENDER_SHELL();
  });
  await runFetches();
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
      window.SERVERS_DATA = Object.assign({}, window.SERVERS_DATA, {
        envBreakdown,
        SRV_ENV: envBreakdown,
        SRV_BU:  buBreakdown,
        SRV_ENV_MAX: envBreakdown.length ? Math.max(...envBreakdown.map(e => e.count)) : 0,
        SRV_TOTAL: s.totalCount,
      });
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
    api('/eol?limit=500&hasServers=true').then(v => {
      if (!Array.isArray(v)) { markDemo('eol'); return; }
      window.EOL_DATA = Object.assign({}, window.EOL_DATA, { EOL_PRODUCTS: mapEolProducts(v) });
      rerender();
    }),
    api('/eol/summary?hasServers=true').then(s => {
      if (!s) { markDemo('eol'); return; }
      window.EOL_DATA = Object.assign({}, window.EOL_DATA, { EOL_TOTALS: mapEolTotals(s) });
      rerender();
    }),
    Promise.all([api('/patching/cycles'), api('/patching/next')]).then(([cycles, next]) => {
      if (!cycles && !next) { markDemo('patching'); return; }
      window.PATCH_GROUPS = mapPatchGroups(cycles, next);
      rerender();
    }),
    api('/patching/cycles?upcomingOnly=false&limit=24').then(v => {
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
    api('/me').then(v => {
      if (!v) return;
      window.CURRENT_USER = v; // { username, fullName }
      rerender();
    }),
    // Default to Production-only on initial load — non-prod is noise for the
    // ops team. The dropdown lets users widen scope (BU + env); OC_API.fetchDisks
    // handles the refetch.
    api('/disks?environment=Production&limit=5000' + buQs).then(r => {
      if (!r || !Array.isArray(r.items)) { markDemo('disks'); return; }
      window.DISKS_DATA = Object.assign({}, window.DISKS_DATA, {
        items: mapDisks(r.items),
        totalCount: r.totalCount != null ? r.totalCount : r.items.length,
        currentEnv: 'Production',
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
    // Health page disk card pins to Group + Production regardless of what the
    // Disks page is currently filtered to. Separate dedicated fetch so the
    // Health card can't be perturbed by user navigation.
    api('/disks/summary?environment=Production&businessUnit=' + encodeURIComponent('Contoso Group Support')).then(s => {
      const summary = mapDiskSummary(s);
      if (!summary) return; // demo fallback handled by op-app.js disks card path
      window.DISK_SUMMARY_GROUP_PROD = summary;
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
  const bu = (seed && seed.bu) || 'Hiscox UK';
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
      api('/disks?limit=100&serverName=' + encodeURIComponent(name)),
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
  getEolDetail: (product, version) =>
    api('/eol/' + encodeURIComponent(product) + '/' + encodeURIComponent(version)),

  // Refetch /api/disks + /api/disks/summary scoped to the given filters.
  // Any filter can be falsy / '__all' to mean unfiltered. Status is the
  // alert-status filter (1=OK, 2=Warning, 3=Critical). Updates
  // window.DISKS_DATA + window.DISK_SUMMARY and triggers a rerender so the
  // KPI strip, dropdown counts, and table all reflect the new selection.
  fetchDisks: async ({ env, bu, status } = {}) => {
    if (bu === undefined) bu = window.SELECTED_BU;
    const envSet = env && env !== '__all';
    const buSet  = bu && bu !== '__all';
    const stSet  = status && status !== '__all';
    const buildParams = (includeLimit) => {
      const ps = includeLimit ? ['limit=5000'] : [];
      if (envSet) ps.push('environment=' + encodeURIComponent(env));
      if (buSet)  ps.push('businessUnit=' + encodeURIComponent(bu));
      if (stSet)  ps.push('alertStatus=' + encodeURIComponent(status));
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
        currentEnv:    envSet ? env    : '__all',
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
  // { servers: [{id,name}], reason, until, notes } + cb()
  addExclusion: async (payload, onDone) => {
    // Translate design's formatted "Apr 22, 2026" → ISO yyyy-mm-dd
    const iso = toIsoDate(payload.until);
    if (!iso) { alert('Hold-until date is required.'); return; }
    const body = {
      serverIds: (payload.servers || []).map(s => s.id).filter(Boolean),
      reason: payload.reason || 'Exclusion',
      reasonSlug: slugify(payload.reason),
      notes: payload.notes || null,
      heldUntil: iso,
    };
    if (body.serverIds.length === 0) { alert('No servers selected.'); return; }
    const res = await apiPost('/patching/exclusions', body);
    if (!res.ok) { alert('Could not exclude (' + res.status + '): ' + (res.error || 'unknown error')); return; }
    await refetchExclusions();
    if (onDone) onDone();
  },

  // { kind: 'group'|'env', target, reason, until, affectedCount } + cb()
  bulkExclude: async (payload, onDone) => {
    const iso = toIsoDate(payload.until);
    if (!iso) { alert('Hold-until date is required.'); return; }
    const body = {
      kind: payload.kind,
      target: payload.target,
      reason: payload.reason || 'Bulk exclusion',
      reasonSlug: slugify(payload.reason),
      heldUntil: iso,
    };
    const res = await apiPost('/patching/exclusions/bulk', body);
    if (!res.ok) { alert('Bulk exclude failed (' + res.status + '): ' + (res.error || 'unknown error')); return; }
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
    const res = await apiPost('/patching/exclusions/' + id + '/extend', { heldUntil: iso });
    // apiPost uses POST; the design expects PATCH semantics. The /extend route
    // on the backend is still POST — we keep it that way and reuse here.
    if (!res.ok) { alert('Could not renew (' + res.status + '): ' + (res.error || 'unknown error')); return; }
    await refetchExclusions();
  },

  releaseExclusion: async (r) => {
    const id = r.exclusionId;
    if (!id) { alert('Cannot release: no ID on row (demo mode?).'); return; }
    if (!confirm('Release exclusion for ' + (r.server || r.id) + '?')) return;
    // apiPost only does POST/body; keep using /remove for compatibility.
    const res = await apiPost('/patching/exclusions/' + id + '/remove', {});
    if (!res.ok) { alert('Could not release (' + res.status + '): ' + (res.error || 'unknown error')); return; }
    await refetchExclusions();
  },
};

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
  // Accept "Apr 22, 2026" (design format) or ISO "2026-04-22".
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
