/* Service Ops Console — v2 boot / API wiring.
   Replaces the design bundle's synthetic window.*_DATA globals with real
   API responses, and exposes window.OC_ACTIONS for wizard submits.

   The design bundle (op-app.js / op-pages.js) is IIFE-based
   with all renders reading from window.PATCH_GROUPS / SYNCS / EXCLUSIONS / RECENT_ALERTS_BASE
   / SERVERS_DATA / CERTS_DATA / EOL_DATA. We populate those globals after
   parallel fetches and call window.RERENDER_PAGE(mount) to redraw. */

import { api, apiPost, apiErrors, clearApiErrors } from './api.js';

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

function mapAlerts(items) {
  return (items || []).map(a => ({
    id: a.id,
    when: a.when ? new Date(a.when).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—',
    sub: a.sub,
    detail: a.detail,
    tone: a.tone || 'info',
  }));
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
async function fetchAllServers() {
  const PAGE = 1000;
  const MAX_PAGES = 10;
  let offset = 0;
  let all = [];
  let total = null;
  for (let i = 0; i < MAX_PAGES; i++) {
    const r = await api(`/servers?limit=${PAGE}&offset=${offset}`);
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

  // Health probe gates demo fallback. If null, leave demo data in place.
  const healthPromise = api('/health');

  // Fire everything in parallel.
  const fetches = [
    fetchAllServers().then(r => {
      if (!r) return;
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
      if (!s) return;
      const envBreakdown = mapEnvBreakdown(s);
      window.SERVERS_DATA = Object.assign({}, window.SERVERS_DATA, {
        envBreakdown,
        SRV_ENV: envBreakdown,
        SRV_ENV_MAX: envBreakdown.length ? Math.max(...envBreakdown.map(e => e.count)) : 0,
        SRV_TOTAL: s.totalCount,
      });
      rerender();
    }),
    api('/servers/unreachable').then(v => {
      if (!Array.isArray(v)) return;
      window.SERVERS_DATA = Object.assign({}, window.SERVERS_DATA, { unreachable: mapUnreachable(v) });
      rerender();
    }),
    api('/servers/unmatched').then(v => {
      if (!Array.isArray(v)) return;
      window.SERVERS_DATA = Object.assign({}, window.SERVERS_DATA, { unmatched: mapUnmatched(v) });
      rerender();
    }),
    api('/certificates?limit=1000').then(v => {
      if (!Array.isArray(v)) return;
      window.CERTS_DATA = Object.assign({}, window.CERTS_DATA, { CERTS: mapCerts(v) });
      rerender();
    }),
    api('/certificates/summary').then(s => {
      if (!s) return;
      window.CERTS_DATA = Object.assign({}, window.CERTS_DATA, { CERT_COUNTS: mapCertCounts(s) });
      rerender();
    }),
    api('/eol?limit=500').then(v => {
      if (!Array.isArray(v)) return;
      window.EOL_DATA = Object.assign({}, window.EOL_DATA, { EOL_PRODUCTS: mapEolProducts(v) });
      rerender();
    }),
    api('/eol/summary').then(s => {
      if (!s) return;
      window.EOL_DATA = Object.assign({}, window.EOL_DATA, { EOL_TOTALS: mapEolTotals(s) });
      rerender();
    }),
    Promise.all([api('/patching/cycles'), api('/patching/next')]).then(([cycles, next]) => {
      window.PATCH_GROUPS = mapPatchGroups(cycles, next);
      rerender();
    }),
    api('/patching/cycles?upcomingOnly=false&limit=24').then(v => {
      if (!Array.isArray(v)) return;
      window.PATCH_CYCLES = mapPatchCycles(v);
      rerender();
    }),
    api('/patching/issues').then(v => {
      if (!Array.isArray(v)) return;
      window.PATCH_ISSUES = mapPatchIssues(v);
      rerender();
    }),
    api('/health/syncs').then(r => {
      // /api/health/syncs returns a bare SyncStatus[]; only the /api/health
      // root endpoint wraps it in {syncStatuses}. Accept both shapes.
      const arr = Array.isArray(r) ? r : (r && Array.isArray(r.syncStatuses) ? r.syncStatuses : null);
      if (!arr) return;
      window.SYNCS = mapSyncs(arr);
      rerender();
    }),
    api('/alerts/recent?limit=20').then(v => {
      if (!Array.isArray(v)) return;
      window.RECENT_ALERTS_BASE = mapAlerts(v);
      rerender();
    }),
    api('/patching/exclusions?limit=500').then(v => {
      if (!v) return;
      window.EXCLUSIONS = mapExclusions(v);
      rerender();
    }),
    api('/me').then(v => {
      if (!v) return;
      window.CURRENT_USER = v; // { username, fullName }
      rerender();
    }),
  ];

  const health = await healthPromise;
  if (health) {
    // Success — rendered data is live, clear any leftover demo banner state.
  }

  await Promise.allSettled(fetches);
  // Final rerender to ensure a consistent view once everything has landed.
  rerender();
}

// ── OC_API: authenticated GET helpers for IIFE modules (op-pages.js) ──

window.OC_API = {
  // Returns EolSoftwareDetail with .assets[] (machine names) or null on error.
  getEolDetail: (product, version) =>
    api('/eol/' + encodeURIComponent(product) + '/' + encodeURIComponent(version)),
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
    window.EXCLUSIONS = mapExclusions(v);
    const m = mount();
    if (window.RERENDER_PAGE && m) window.RERENDER_PAGE(m);
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
