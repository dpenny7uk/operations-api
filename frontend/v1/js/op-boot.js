/* Operations Console — boot / API wiring.
   Seeds from DEMO (op-core.js), fires parallel fetches, re-renders as each resolves.
   If /health probe fails, stays in demo mode. */

import { api, apiPost, apiErrors, clearApiErrors } from '../../js/api.js';

const OC = window.OC;
if (!OC) {
  // op-core.js didn't load or errored. Nothing we can do.
  // Fall through — render() calls below will be no-ops on undefined.
  console.error('op-boot: window.OC not initialised');
}

// ── Normalizers: map API response → demo-shape slots ─────

function mapServers(items) {
  return (items || []).map(s => ({
    serverId: s.serverId,
    serverName: s.serverName,
    fqdn: s.fqdn || null,
    ipAddress: s.ipAddress || null,
    environment: s.environment || null,
    applicationName: s.applicationName || null,
    patchGroup: s.patchGroup || null,
    isActive: !!s.isActive,
  }));
}

function mapSummary(summary) {
  const envCounts = {};
  if (summary && summary.environmentCounts) {
    for (const [env, v] of Object.entries(summary.environmentCounts)) {
      envCounts[env] = (v && v.active != null) ? v.active : (v && v.total) || 0;
    }
  }
  return {
    serverTotal: summary?.totalCount ?? 0,
    serverActive: summary?.activeCount ?? 0,
    envCounts,
  };
}

function mapCycles(items) {
  return (items || []).map(c => ({
    id: c.cycleId,
    date: c.cycleDate,
    count: c.serverCount,
    status: c.displayStatus || c.status,
  }));
}

function mapIssues(items) {
  return (items || []).map(i => ({
    id: i.issueId,
    title: i.title,
    severity: i.severity,
    win: !!i.appliesToWindows,
    sql: !!i.appliesToSql,
    fix: i.fix || '',
  }));
}

function mapExclusions(items) {
  return (items || []).map(x => ({
    id: x.exclusionId,
    serverId: x.serverId,
    server: x.serverName,
    group: x.patchGroup,
    service: x.service,
    fn: x.application || x.reason || '',
    env: x.environment,
    dateOut: x.excludedAt,
    heldUntil: x.heldUntil,
    notes: x.reason,
    holdExpired: !!x.holdExpired,
  }));
}

function mapEol(items) {
  return (items || []).map(e => ({
    product: e.product,
    version: e.version,
    eol: e.endOfLife,
    ext: e.endOfExtendedSupport,
    status: (e.alertLevel || 'supported').toLowerCase(),
    assets: e.affectedAssets ?? 0,
  }));
}

function mapSyncs(syncStatuses) {
  return (syncStatuses || []).map(s => ({
    name: s.syncName,
    status: s.status || (s.freshnessStatus === 'ok' ? 'success' : 'warning'),
    lastSuccess: s.lastSuccessAt ? new Date(s.lastSuccessAt).getTime() : null,
    hours: s.hoursSinceSuccess ?? 0,
    records: s.recordsProcessed ?? 0,
    fails: s.consecutiveFailures ?? 0,
    schedule: s.expectedSchedule || '',
    error: s.lastErrorMessage || null,
  }));
}

function mapNextPatch(n) {
  if (!n) return null;
  return {
    days: n.daysUntil ?? 0,
    date: n.cycle?.cycleDate || null,
    servers: n.cycle?.serverCount ?? 0,
    issues: n.issuesBySeverity || {},
    groups: n.serversByGroup || {},
  };
}

// Synthesize alerts from unreachable, syncs, and cert summary — no dedicated API endpoint.
function synthAlerts(data) {
  const out = [];
  const now = Date.now();

  for (const u of (data.unreachable || []).slice(0, 4)) {
    out.push({
      ts: u.lastSeen ? new Date(u.lastSeen).getTime() : now,
      level: 'crit',
      msg: (u.serverName || 'unknown host') + ' unreachable',
      sub: (u.environment || 'unknown env') + (u.lastSeen ? ' · last seen ' + new Date(u.lastSeen).toLocaleString('en-GB') : ''),
    });
  }
  for (const s of (data.syncs || []).filter(x => x.status !== 'success').slice(0, 3)) {
    out.push({
      ts: now - (s.hours || 0) * 3600 * 1000,
      level: (s.fails && s.fails > 1) ? 'crit' : 'warn',
      msg: s.name + ' sync ' + s.status,
      sub: s.error || ((s.fails || 0) + ' consecutive failures · expected ' + (s.schedule || 'regularly')),
    });
  }
  const cs = data.certSummary || {};
  if (cs.expiredCount > 0) {
    out.push({ ts: now, level: 'crit', msg: cs.expiredCount + ' certificate' + (cs.expiredCount === 1 ? '' : 's') + ' expired', sub: 'Reissue required — see Certificates' });
  }
  if (cs.criticalCount > 0) {
    out.push({ ts: now, level: 'warn', msg: cs.criticalCount + ' certificate' + (cs.criticalCount === 1 ? '' : 's') + ' expiring within 14 days', sub: 'Review Certificates' });
  }
  out.sort((a, b) => b.ts - a.ts);
  return out.slice(0, 8);
}

// ── Boot ────────────────────────────────────────────────

// Page through /api/servers (backend clamps limit to 1000 per call).
async function fetchAllServers() {
  const PAGE = 1000;
  const MAX_PAGES = 10; // safety cap — 10,000 servers
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
  return all;
}

async function boot() {
  if (!OC || !OC.state) return;
  const data = OC.state.data;

  // /health is the demo-fallback probe.
  const healthPromise = api('/health');

  // Fire the rest in parallel. Each resolver patches one slot and re-renders.
  const fetches = [
    fetchAllServers().then(items => {
      if (Array.isArray(items)) { data.servers = mapServers(items); OC.render(); }
    }),
    api('/servers/summary').then(s => {
      if (s) { Object.assign(data, mapSummary(s)); OC.render(); }
    }),
    api('/servers/unreachable').then(v => {
      if (Array.isArray(v)) { data.unreachable = v; OC.render(); }
    }),
    api('/servers/unmatched').then(v => {
      if (Array.isArray(v)) { data.unmatched = v; OC.render(); }
    }),
    api('/certificates?limit=1000').then(v => {
      if (Array.isArray(v)) { data.certs = v; OC.render(); }
    }),
    api('/certificates/summary').then(s => {
      if (s) { data.certSummary = s; OC.render(); }
    }),
    api('/eol?limit=500').then(v => {
      if (Array.isArray(v)) { data.eol = mapEol(v); OC.render(); }
    }),
    api('/patching/next').then(n => {
      const mapped = mapNextPatch(n);
      if (mapped) { data.nextPatch = mapped; OC.render(); }
    }),
    api('/patching/cycles').then(v => {
      if (Array.isArray(v)) { data.cycles = mapCycles(v); OC.render(); }
    }),
    api('/patching/issues').then(v => {
      if (Array.isArray(v)) { data.issues = mapIssues(v); OC.render(); }
    }),
    api('/patching/exclusions').then(v => {
      if (Array.isArray(v)) { data.exclusions = mapExclusions(v); OC.render(); }
    }),
    api('/health/syncs').then(r => {
      if (r && Array.isArray(r.syncStatuses)) { data.syncs = mapSyncs(r.syncStatuses); OC.render(); }
    }),
  ];

  const health = await healthPromise;
  if (health) {
    OC.state.usingDemo = false;
    OC.state.lastOkAt = Date.now();
    OC.render();
  }

  await Promise.allSettled(fetches);

  // Surface current errors into state.
  OC.state.apiErrors = apiErrors.slice();

  // Synthesize alerts once real data has settled.
  data.alerts = synthAlerts(data);
  OC.render();
}

// Expose refetch + apiPost so op-core's "Retry" button and page action handlers
// can trigger live API calls from inside the IIFE modules.
if (OC) {
  OC.refetch = async function refetch() {
    clearApiErrors();
    OC.state.apiErrors = [];
    await boot();
  };
  OC.apiPost = apiPost;
}

// Kick off as soon as the module lands.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { boot(); });
} else {
  boot();
}
