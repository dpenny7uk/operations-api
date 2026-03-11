// API base URL - auto-detects from current origin in production, falls back to localhost for dev
const API_BASE = window.location.hostname === 'localhost'
    ? 'http://localhost:5000/api'
    : window.location.origin + '/api';

// --- Demo data generator (used when the API is unreachable) ---
const DEMO = (() => {
  // Seeded pseudo-random for deterministic demo data
  let _seed = 42;
  const rand = () => { _seed = (_seed * 16807 + 0) % 2147483647; return (_seed - 1) / 2147483646; };
  const pick = arr => arr[Math.floor(rand() * arr.length)];
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const DAY = 86400000;

  // --- Generate 520 servers ---
  const envSpec = [
    ['Production', 'PROD', 200], ['Staging', 'STG', 80], ['UAT', 'UAT', 80],
    ['Development', 'DEV', 100], ['SIT', 'SIT', 60]
  ];
  const prefixes = ['WEB','SQL','APP','API','SVC','BATCH','ETL','RPT','MON','DC',
                     'FILE','CACHE','MSG','LOG','AUTH','VPN','DNS','NTP','SCAN','BACKUP'];
  const apps = ['Customer Portal','API Gateway','Database Cluster','Monitoring','CI/CD',
                'Admin Panel','Reporting','Data Warehouse','Message Broker','Identity Service',
                'File Share','Backup Service','DNS Service','VPN Gateway','Cache Layer',
                'ETL Pipeline','Batch Processing','Log Aggregator','Security Scanner','Mail Relay'];
  const groups = ['Group-A','Group-B','Group-C','Group-D'];

  const servers = [];
  let serverId = 1;
  for (const [env, envShort, count] of envSpec) {
    for (let i = 1; i <= count; i++) {
      const prefix = prefixes[(i - 1) % prefixes.length];
      const name = `${prefix}-${envShort}-${pad(i)}`;
      servers.push({
        serverId: serverId++,
        serverName: name,
        fqdn: `${name.toLowerCase()}.corp.local`,
        environment: env,
        applicationName: apps[(i - 1) % apps.length],
        patchGroup: env === 'Development' && rand() < 0.3 ? null : pick(groups),
        isActive: rand() > 0.05
      });
    }
  }

  // --- Generate 1000 certificates ---
  const cnPrefixes = ['*.corp.local','api.corp.com','mail.corp.com','admin.corp.local',
    'monitor.corp.local','db.corp.local','ldap.corp.local','intranet.corp.local',
    'vpn.corp.com','sso.corp.com','tableau.corp.com','grafana.corp.local',
    'jenkins.corp.local','nexus.corp.local','sonar.corp.local','jira.corp.com',
    'confluence.corp.com','bitbucket.corp.com','artifactory.corp.local','vault.corp.local',
    'consul.corp.local','redis.corp.local','kafka.corp.local','elastic.corp.local',
    'kibana.corp.local','prometheus.corp.local','alertmanager.corp.local','minio.corp.local',
    'harbor.corp.local','keycloak.corp.local'];

  const certs = [];
  // 30 critical, 120 warning, 850 ok
  const certDist = [
    [30, 1, 14, 'critical'],
    [120, 15, 60, 'warning'],
    [850, 61, 365, 'ok']
  ];
  let certId = 1;
  for (const [count, minDays, maxDays, level] of certDist) {
    for (let i = 0; i < count; i++) {
      const days = minDays + Math.floor(rand() * (maxDays - minDays + 1));
      const cn = i < cnPrefixes.length ? cnPrefixes[i] : `svc-${pad(certId, 4)}.corp.local`;
      certs.push({
        certId: certId++,
        subjectCn: cn,
        serverName: pick(servers).serverName,
        validTo: new Date(Date.now() + days * DAY).toISOString(),
        daysUntilExpiry: days,
        alertLevel: level
      });
    }
  }
  const certSummary = { criticalCount: 30, warningCount: 120, okCount: 850, totalCount: 1000 };

  // --- Unreachable servers (12) ---
  const unreachable = [];
  const usedIdx = new Set();
  while (unreachable.length < 12) {
    const idx = Math.floor(rand() * servers.length);
    if (usedIdx.has(idx)) continue;
    usedIdx.add(idx);
    const s = servers[idx];
    unreachable.push({
      serverName: s.serverName, environment: s.environment,
      lastSeen: new Date(Date.now() - Math.floor(rand() * 3600000)).toISOString()
    });
  }

  // --- Unmatched servers (15) ---
  const unmatchedRaw = ['WEBPROD01','SQLPRD1','APPPRD02','SVCPROD3','MONPROD1',
    'unknown-host-42','unknown-host-99','DEVBLD01','ETLSVR1','RPTPRD02',
    'CACHEPRD1','MSGPROD1','FILEPRD02','DNSPRD1','BKUPPROD1'];
  const sources = ['SCCM','Qualys','Splunk','CrowdStrike'];
  const unmatched = unmatchedRaw.map((raw, i) => ({
    serverNameRaw: raw,
    sourceSystem: sources[i % sources.length],
    occurrenceCount: 1 + Math.floor(rand() * 30),
    firstSeenAt: new Date(Date.now() - Math.floor(rand() * 90 * DAY)).toISOString(),
    lastSeenAt: new Date().toISOString(),
    closestMatch: raw.startsWith('unknown') ? null : servers[Math.floor(rand() * 50)].serverName
  }));

  // --- Cycle servers for patching (20 from prod/staging) ---
  const patchServers = servers.filter(s => s.environment === 'Production' || s.environment === 'Staging').slice(0, 20);
  const cycleItems = patchServers.map((s, i) => ({
    scheduleId: i + 1, serverName: s.serverName, patchGroup: s.patchGroup || 'Group-A',
    scheduledTime: `0${2 + Math.floor(i / 5)}:00`.slice(-5), application: s.applicationName,
    hasKnownIssue: rand() < 0.2, issueCount: rand() < 0.2 ? 1 + Math.floor(rand() * 2) : 0
  }));

  // --- EOL detail using generated server names ---
  const pickN = (n) => { const out = []; for (let i = 0; i < n; i++) out.push(pick(servers).serverName); return [...new Set(out)]; };

  return {
    health: {
      overallStatus: 'healthy',
      syncStatuses: [
        { syncName: 'databricks_servers', status: 'success', lastSuccessAt: new Date(Date.now() - 3600000).toISOString(), hoursSinceSuccess: 1.0, freshnessStatus: 'healthy', recordsProcessed: 520, consecutiveFailures: 0, expectedSchedule: 'Every 6 hours' },
        { syncName: 'patching_schedule_html', status: 'success', lastSuccessAt: new Date(Date.now() - 7200000).toISOString(), hoursSinceSuccess: 2.0, freshnessStatus: 'healthy', recordsProcessed: 260, consecutiveFailures: 0, expectedSchedule: 'Every 12 hours' },
        { syncName: 'confluence_issues', status: 'warning', lastSuccessAt: new Date(Date.now() - 86400000).toISOString(), hoursSinceSuccess: 24.0, freshnessStatus: 'stale', recordsProcessed: 28, consecutiveFailures: 2, lastErrorMessage: 'Sync error occurred \u2014 check server logs', expectedSchedule: 'Every 6 hours' },
        { syncName: 'certificate_scan', status: 'success', lastSuccessAt: new Date(Date.now() - 14400000).toISOString(), hoursSinceSuccess: 4.0, freshnessStatus: 'healthy', recordsProcessed: 1000, consecutiveFailures: 0, expectedSchedule: 'Daily' },
      ],
      unmatchedServersCount: 15,
      unreachableServersCount: 12,
      lastUpdated: new Date().toISOString()
    },
    unreachableServers: unreachable,
    servers,
    unmatched,
    nextPatch: {
      cycle: { cycleId: 12, cycleDate: new Date(Date.now() + 5 * DAY).toISOString(), serverCount: 260, status: 'Scheduled' },
      daysUntil: 5,
      serversByGroup: { 'Group-A': 72, 'Group-B': 68, 'Group-C': 65, 'Group-D': 55 },
      issuesBySeverity: { 'High': 2, 'Medium': 5, 'Low': 3 },
      totalIssuesAffectingServers: 48
    },
    cycles: [
      { cycleId: 12, cycleDate: new Date(Date.now() + 5 * DAY).toISOString(), serverCount: 260, status: 'Scheduled' },
      { cycleId: 11, cycleDate: new Date(Date.now() - 25 * DAY).toISOString(), serverCount: 255, status: 'Completed' },
      { cycleId: 10, cycleDate: new Date(Date.now() - 55 * DAY).toISOString(), serverCount: 248, status: 'Completed' },
    ],
    issues: [
      { issueId: 1, title: 'KB5034441 fails on small recovery partition', severity: 'High', application: null, appliesToWindows: true, appliesToSql: false, fix: 'Resize recovery partition to 1GB' },
      { issueId: 2, title: 'SQL CU requires SSMS restart', severity: 'Medium', application: 'SQL Server', appliesToWindows: false, appliesToSql: true, fix: 'Restart SSMS after patching' },
      { issueId: 3, title: '.NET 8 runtime conflict with legacy app', severity: 'High', application: 'Legacy CRM', appliesToWindows: true, appliesToSql: false, fix: 'Pin .NET runtime version' },
      { issueId: 4, title: 'Cluster failover during patch window', severity: 'Medium', application: 'Database Cluster', appliesToWindows: true, appliesToSql: true, fix: 'Drain node before patching' },
      { issueId: 5, title: 'TLS 1.0 disabled after security update', severity: 'Low', application: null, appliesToWindows: true, appliesToSql: false, fix: 'Update legacy clients' },
    ],
    cycleServers: {
      12: { items: cycleItems, totalCount: cycleItems.length, limit: 100, offset: 0 },
      11: { items: cycleItems.slice(0, 5), totalCount: 5, limit: 100, offset: 0 },
      10: { items: [], totalCount: 0, limit: 100, offset: 0 },
    },
    eolSummary: { eolCount: 4, approachingCount: 6, supportedCount: 35, unknownCount: 0, totalCount: 45, affectedServers: 180 },
    eolSoftware: [
      { product: 'Windows Server', version: '2012 R2', endOfLife: '2023-10-10T00:00:00Z', endOfExtendedSupport: '2026-10-13T00:00:00Z', endOfSupport: '2023-10-10T00:00:00Z', alertLevel: 'eol', affectedAssets: 25 },
      { product: 'SQL Server', version: '2014', endOfLife: '2024-07-09T00:00:00Z', endOfExtendedSupport: '2024-07-09T00:00:00Z', endOfSupport: '2019-07-09T00:00:00Z', alertLevel: 'eol', affectedAssets: 18 },
      { product: '.NET Framework', version: '4.6.1', endOfLife: '2022-04-26T00:00:00Z', endOfExtendedSupport: null, endOfSupport: '2022-04-26T00:00:00Z', alertLevel: 'eol', affectedAssets: 40 },
      { product: 'Windows Server', version: '2016', endOfLife: '2027-01-12T00:00:00Z', endOfExtendedSupport: '2027-01-12T00:00:00Z', endOfSupport: '2022-01-11T00:00:00Z', alertLevel: 'approaching', affectedAssets: 65 },
      { product: 'SQL Server', version: '2016', endOfLife: '2026-07-14T00:00:00Z', endOfExtendedSupport: '2026-07-14T00:00:00Z', endOfSupport: '2021-07-13T00:00:00Z', alertLevel: 'approaching', affectedAssets: 30 },
      { product: 'IIS', version: '10.0', endOfLife: '2026-10-13T00:00:00Z', endOfExtendedSupport: null, endOfSupport: '2026-10-13T00:00:00Z', alertLevel: 'approaching', affectedAssets: 22 },
      { product: 'Windows Server', version: '2019', endOfLife: '2029-01-09T00:00:00Z', endOfExtendedSupport: '2029-01-09T00:00:00Z', endOfSupport: '2024-01-09T00:00:00Z', alertLevel: 'supported', affectedAssets: 110 },
      { product: 'SQL Server', version: '2019', endOfLife: '2030-01-08T00:00:00Z', endOfExtendedSupport: '2030-01-08T00:00:00Z', endOfSupport: '2025-01-07T00:00:00Z', alertLevel: 'supported', affectedAssets: 75 },
      { product: 'Windows Server', version: '2022', endOfLife: '2031-10-14T00:00:00Z', endOfExtendedSupport: '2031-10-14T00:00:00Z', endOfSupport: '2026-10-13T00:00:00Z', alertLevel: 'supported', affectedAssets: 150 },
      { product: '.NET', version: '8.0', endOfLife: '2026-11-10T00:00:00Z', endOfExtendedSupport: null, endOfSupport: '2026-11-10T00:00:00Z', alertLevel: 'approaching', affectedAssets: 70 },
    ],
    eolDetail: {
      'Windows Server|2012 R2': { assets: pickN(25) },
      'SQL Server|2014': { assets: pickN(18) },
      '.NET Framework|4.6.1': { assets: pickN(40) },
      'Windows Server|2016': { assets: pickN(65) },
      'SQL Server|2016': { assets: pickN(30) },
      'IIS|10.0': { assets: pickN(22) },
      'Windows Server|2019': { assets: pickN(110) },
      'SQL Server|2019': { assets: pickN(75) },
      'Windows Server|2022': { assets: pickN(150) },
      '.NET|8.0': { assets: pickN(70) },
    },
    certSummary,
    certificates: certs
  };
})();

// --- State ---
let allServers = [];
let allCerts = [];
let allEol = [];
let usingDemo = false;
let activeCertFilter = null;
let activeEolFilter = null;

// --- API helpers ---
let apiError = null;
async function api(path) {
  try {
    const res = await fetch(API_BASE + path, { credentials: 'include' });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) apiError = 'Authentication failed \u2014 check your credentials';
      else if (res.status === 429) apiError = 'Rate limited \u2014 too many requests';
      else if (res.status >= 500) apiError = 'Server error \u2014 data may be stale';
      else apiError = `API error (${res.status})`;
      return null;
    }
    return await res.json();
  } catch (e) {
    console.warn('API fetch failed:', path, e.message || e);
    if (!apiError) apiError = 'Network error \u2014 API not reachable';
    return null;
  }
}

// --- Navigation ---
document.querySelectorAll('header nav button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('header nav button').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.page).classList.add('active');
  });
});

// --- Rendering helpers ---
function esc(str) {
  const d = document.createElement('div');
  d.textContent = str ?? '';
  return d.innerHTML;
}

function num(v) { return Number.isFinite(Number(v)) ? Number(v) : 0; }

function badge(text, color) {
  const safeColor = (color || '').replace(/[^a-zA-Z0-9_-]/g, '');
  return `<span class="badge ${safeColor}">${esc(text)}</span>`;
}

function alertBadge(level) {
  const l = (level || '').toLowerCase();
  const colors = { critical: 'red', warning: 'orange', ok: 'green' };
  return badge(level, colors[l] || 'muted');
}

function statusBadge(status) {
  const s = (status || '').toLowerCase();
  if (s === 'success' || s === 'healthy' || s === 'completed' || s === 'active') return badge(status, 'green');
  if (s === 'warning' || s === 'stale' || s === 'scheduled') return badge(status, 'yellow');
  if (s === 'error' || s === 'failed' || s === 'critical') return badge(status, 'red');
  return badge(status, 'muted');
}

function severityBadge(sev) {
  const s = (sev || '').toLowerCase();
  if (s === 'high' || s === 'critical') return badge(sev, 'red');
  if (s === 'medium') return badge(sev, 'orange');
  return badge(sev, 'yellow');
}

function fmtDate(d) {
  if (!d) return '\u2014';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtTime(d) {
  if (!d) return '\u2014';
  return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function dot(color) { const c = (color || '').replace(/[^a-zA-Z0-9_-]/g, ''); return `<span class="status-dot ${c}"></span>`; }

function cardAlert(value, thresholds) {
  if (thresholds.red != null && value >= thresholds.red) return ' card-alert-red';
  if (thresholds.orange != null && value >= thresholds.orange) return ' card-alert-orange';
  if (thresholds.yellow != null && value >= thresholds.yellow) return ' card-alert-yellow';
  return '';
}

// Animated number counter
function animateValue(el, target) {
  const start = parseInt(el.textContent) || 0;
  if (start === target) return;
  const duration = 600;
  const startTime = performance.now();
  function step(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const ease = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    el.textContent = Math.round(start + (target - start) * ease);
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// Sync card selection highlight with a filter value
function syncCardSelection(containerId, level) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.querySelectorAll('.card').forEach(c => c.classList.remove('card-selected'));
  if (level) {
    const match = Array.from(container.querySelectorAll('.card[data-filter]'))
      .find(c => c.dataset.filter === level);
    if (match) match.classList.add('card-selected');
  }
}

// Render a proportional timeline bar from segments with legend
function renderTimeline(containerId, segments) {
  const el = document.getElementById(containerId);
  el.innerHTML = '';
  segments.filter(s => s.pct > 0).forEach(s => {
    const div = document.createElement('div');
    div.className = 'segment';
    div.style.width = `${Number(s.pct)}%`;
    div.style.background = s.color;
    div.title = s.label;
    el.appendChild(div);
  });
  // Render legend below the timeline
  const legendEl = document.getElementById(containerId + 'Legend');
  if (legendEl) {
    legendEl.innerHTML = segments.filter(s => s.pct > 0).map(s =>
      `<span class="timeline-legend-item"><span class="timeline-legend-dot" style="background:${s.color}"></span>${esc(s.label)}</span>`
    ).join('');
  }
}

// Wire up clickable card grids — clicking a card filters the table
function wireCardFilters(containerId, filterFn) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.querySelectorAll('.card[data-filter]').forEach(card => {
    card.addEventListener('click', () => {
      const filter = card.dataset.filter;
      const isActive = card.classList.contains('card-selected');
      // Deselect all in this grid
      container.querySelectorAll('.card').forEach(c => c.classList.remove('card-selected'));
      if (isActive) {
        filterFn(null);
      } else {
        card.classList.add('card-selected');
        filterFn(filter);
      }
    });
  });
}

// Wire up clickable critical-card grids (gradient cards)
function wireCriticalCardFilters(containerId, filterFn) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.querySelectorAll('.critical-card[data-filter]').forEach(card => {
    card.addEventListener('click', () => {
      const filter = card.dataset.filter;
      const isActive = card.classList.contains('card-selected');
      container.querySelectorAll('.critical-card').forEach(c => c.classList.remove('card-selected'));
      if (isActive) {
        filterFn(null);
      } else {
        card.classList.add('card-selected');
        filterFn(filter);
      }
    });
  });
}

// Sync critical card selection state
function syncCriticalCardSelection(containerId, level) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.querySelectorAll('.critical-card').forEach(c => c.classList.remove('card-selected'));
  if (level) {
    const match = Array.from(container.querySelectorAll('.critical-card[data-filter]'))
      .find(c => c.dataset.filter === level);
    if (match) match.classList.add('card-selected');
  }
}

// --- Render: Health (Dashboard) ---
function timeAgo(iso) {
  if (!iso) return '\u2014';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60000) return 'just now';
  if (ms < 3600000) return `${Math.floor(ms/60000)} min ago`;
  if (ms < 86400000) return `${Math.floor(ms/3600000)}h ago`;
  return fmtDate(iso);
}

function durationStr(iso) {
  if (!iso) return '\u2014';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60000) return '<1 min';
  if (ms < 3600000) return `${Math.floor(ms/60000)} min`;
  if (ms < 86400000) return `${Math.floor(ms/3600000)}h ${Math.floor((ms%3600000)/60000)}m`;
  return `${Math.floor(ms/86400000)}d`;
}

function renderHealth(data, servers, unmatched, certSummary, certs, nextPatch) {
  const syncs = data.syncStatuses || [];
  const failCount = syncs.filter(s => s.status === 'error' || s.consecutiveFailures > 0).length;
  const status = (data.overallStatus || '').toLowerCase();
  const overallColor = status === 'healthy' ? 'green' : status === 'error' ? 'red' : 'yellow';

  document.getElementById('overallStatus').innerHTML = `${dot(overallColor)}<span class="header-status">${esc(data.overallStatus)}</span>`;
  document.getElementById('lastUpdated').textContent = `Updated ${fmtTime(data.lastUpdated)}`;

  // System Status card
  const statusClass = status === 'healthy' ? 'status-healthy' : status === 'error' ? 'status-error' : 'status-warning';
  const statusIcon = status === 'healthy' ? '\u2705' : status === 'error' ? '\u274C' : '\u26A0\uFE0F';
  document.getElementById('systemStatusCard').className = `card dash-status-card overflow-hidden ${statusClass}`;
  document.getElementById('systemStatusCard').innerHTML = `
    <h3>System Status</h3>
    <div class="dash-status-value">
      <span class="status-icon">${statusIcon}</span>
      <span class="color-${overallColor}">${esc(data.overallStatus)}</span>
    </div>`;

  // Critical Issues cards
  document.getElementById('criticalCards').innerHTML = `
    <div class="critical-card critical-teal">
      <div class="critical-num">${num(data.unreachableServersCount)}</div>
      <div class="critical-label">Unreachable</div>
      <div class="critical-delta"><span class="delta-icon">\u25B2</span> ${num(data.unreachableServersCount)} today</div>
    </div>
    <div class="critical-card critical-orange">
      <div class="critical-num">${num(data.unmatchedServersCount)}</div>
      <div class="critical-label">Unmatched Servers</div>
      <div class="critical-delta"><span class="delta-icon">\u25B2</span> ${num(data.unmatchedServersCount)} today</div>
    </div>
    <div class="critical-card critical-red">
      <div class="critical-num">${failCount}</div>
      <div class="critical-label">Sync Failures</div>
      <div class="critical-delta"><span class="delta-icon">\u25C6</span> ${failCount > 0 ? '+' : ''}${failCount} today</div>
    </div>`;

  // Recent Alerts — synthesize from certs, syncs, unreachable
  const alerts = [];
  const unreachable = usingDemo ? (DEMO.unreachableServers || []) : [];
  unreachable.forEach(s => {
    alerts.push({
      icon: 'icon-red', iconChar: '\u25A0',
      title: `<strong>${esc(s.serverName)}</strong> <span class="alert-status color-red">unreachable</span>`,
      sub: `\u25B2 ${num(data.unreachableServersCount)} total`,
      time: timeAgo(s.lastSeen)
    });
  });
  syncs.filter(s => s.consecutiveFailures > 0).forEach(s => {
    alerts.push({
      icon: 'icon-orange', iconChar: '\u25A0',
      title: `<strong>${esc(s.syncName)}</strong> <span class="alert-status color-orange">sync failed</span>`,
      sub: `\u25B2 ${num(s.consecutiveFailures)} failures`,
      time: timeAgo(s.lastSuccessAt)
    });
  });
  (certs || []).filter(c => (c.alertLevel || '').toLowerCase() === 'critical').slice(0, 2).forEach(c => {
    alerts.push({
      icon: 'icon-yellow', iconChar: '\u25C6',
      title: `<strong>${esc(c.serverName)}</strong> cert <span class="alert-status color-orange">expires in ${num(c.daysUntilExpiry)} days</span>`,
      sub: `\u25B2 1 total`,
      time: timeAgo(c.validTo)
    });
  });

  document.getElementById('recentAlerts').innerHTML = alerts.length === 0
    ? '<div class="empty-state">No active alerts</div>'
    : alerts.slice(0, 5).map(a => `
      <div class="alert-item">
        <div class="alert-icon ${a.icon}">${a.iconChar}</div>
        <div class="alert-body">
          <div class="alert-title">${a.title}</div>
          <div class="alert-sub">${a.sub}</div>
        </div>
        <div class="alert-time">${a.time}</div>
      </div>`).join('');

  // Key Metrics
  const serverList = servers || [];
  const envCounts = {};
  serverList.forEach(s => { envCounts[s.environment || 'Unknown'] = (envCounts[s.environment || 'Unknown'] || 0) + 1; });

  const cs = certSummary || {};
  const np = nextPatch || {};
  const patchServers = np.cycle ? num(np.cycle.serverCount) : 0;
  const patchGroups = np.serversByGroup || {};

  document.getElementById('keyMetrics').innerHTML = `
    <div class="metric-card">
      <h4>Servers</h4>
      <div class="metric-big">${serverList.length}<span> total</span></div>
      <div class="metric-detail">
        ${Object.entries(envCounts).map(([env, count]) => `<div class="metric-row"><span class="color-${env === 'Production' ? 'red' : env === 'Staging' ? 'yellow' : 'blue'}">${count}</span> <span>${esc(env)}</span></div>`).join('')}
      </div>
    </div>
    <div class="metric-card metric-green">
      <h4><span class="metric-icon">\u2705</span> Patch Compliance</h4>
      <div class="metric-big">${patchServers > 0 ? Math.round((patchServers / Math.max(serverList.length, 1)) * 100) : '\u2014'}${patchServers > 0 ? '<span>%</span>' : ''}</div>
      <div class="metric-detail">
        <div>Scheduled: ${patchServers} servers</div>
        ${Object.entries(patchGroups).map(([g, c]) => `<div class="metric-row"><span>${esc(g)}:</span> <strong>${c}</strong></div>`).join('')}
      </div>
    </div>
    <div class="metric-card metric-accent">
      <h4>Certificates</h4>
      <div class="metric-big">${num(cs.totalCount)}<span> total</span></div>
      <div class="metric-detail">
        <div class="color-red">${num(cs.criticalCount)} Expiring Soon</div>
        ${(certs || []).filter(c => c.alertLevel === 'critical').slice(0, 3).map(c => `<div class="metric-row"><span class="color-red">\u25CF</span> ${esc(c.serverName)}</div>`).join('')}
      </div>
    </div>`;

  // Unreachable servers table
  document.getElementById('unreachableTable').innerHTML = unreachable.length === 0
    ? `<tr><td colspan="4" class="empty-state">No unreachable servers</td></tr>`
    : unreachable.map(s => `<tr>
      <td><strong>${esc(s.serverName)}</strong></td>
      <td>${badge(s.environment || 'Unknown', s.environment === 'Production' ? 'red' : 'blue')}</td>
      <td class="color-muted">${timeAgo(s.lastSeen)}</td>
      <td class="color-muted">${durationStr(s.lastSeen)}</td>
    </tr>`).join('');

  // Unmatched servers summary
  const unmatchedList = unmatched || [];
  document.getElementById('dashUnmatchedTable').innerHTML = unmatchedList.length === 0
    ? `<tr><td colspan="3" class="empty-state">No unmatched servers</td></tr>`
    : unmatchedList.slice(0, 5).map(u => `<tr>
      <td><strong>${esc(u.serverNameRaw)}</strong></td>
      <td>${badge(u.sourceSystem, 'blue')}</td>
      <td class="color-muted">${fmtDate(u.firstSeenAt)}</td>
    </tr>`).join('');

  // Sync table
  document.getElementById('syncTable').innerHTML = syncs.map(s => `<tr>
    <td><strong>${esc(s.syncName)}</strong></td>
    <td>${statusBadge(s.freshnessStatus)}</td>
    <td>${fmtTime(s.lastSuccessAt)}</td>
    <td>${num(s.recordsProcessed).toLocaleString()}</td>
    <td>${num(s.consecutiveFailures) > 0 ? `<span class="color-red">${num(s.consecutiveFailures)}</span>` : '<span class="color-muted">0</span>'}</td>
    <td class="color-muted">${esc(s.expectedSchedule) || '\u2014'}</td>
  </tr>`).join('');
}

// --- Render: Servers ---
function renderServers(servers, unmatched) {
  allServers = servers;

  // Summary cards
  const active = servers.filter(s => s.isActive).length;
  const inactive = servers.length - active;
  const envCounts = {};
  servers.forEach(s => { envCounts[s.environment || 'Unknown'] = (envCounts[s.environment || 'Unknown'] || 0) + 1; });
  const envColors = { Production: 'critical-red', Staging: 'critical-yellow', UAT: 'critical-orange', Development: 'critical-blue', SIT: 'critical-teal' };

  document.getElementById('serverSummaryCard').className = 'card dash-status-card overflow-hidden status-healthy';
  document.getElementById('serverSummaryCard').innerHTML = `
    <h3>Server Inventory</h3>
    <div class="dash-status-value">${servers.length}</div>
    <div class="sub" style="margin-top:0.5rem">${active} active \u00B7 ${inactive} inactive</div>`;

  document.getElementById('serverEnvCards').innerHTML = Object.entries(envCounts).map(([env, count]) => `
    <div class="critical-card ${envColors[env] || 'critical-blue'}">
      <div class="critical-num">${count}</div>
      <div class="critical-label">${esc(env)}</div>
      <div class="critical-delta">${servers.filter(s => s.environment === env && s.isActive).length} active</div>
    </div>`).join('');

  renderServerTable(servers);
  allUnmatched = unmatched;
  renderUnmatchedTable(unmatched);
}

const SERVER_PAGE_SIZE = 20;
let unmatchedPage = 0;
let allUnmatched = [];
let _filteredUnmatched = [];

function renderUnmatchedTable(items) {
  _filteredUnmatched = items;
  const total = items.length;
  const totalPages = Math.ceil(total / SERVER_PAGE_SIZE);
  const start = unmatchedPage * SERVER_PAGE_SIZE;
  const page = items.slice(start, start + SERVER_PAGE_SIZE);

  document.getElementById('unmatchedTable').innerHTML = page.map(u => `<tr>
    <td><code>${esc(u.serverNameRaw)}</code></td>
    <td>${badge(u.sourceSystem, 'blue')}</td>
    <td>${num(u.occurrenceCount)}</td>
    <td>${fmtDate(u.firstSeenAt)}</td>
    <td>${u.closestMatch ? `<span class="color-green">${esc(u.closestMatch)}</span>` : '<span class="color-muted">None</span>'}</td>
  </tr>`).join('');

  const tableCard = document.getElementById('unmatchedTable').closest('.card');
  let pag = tableCard.querySelector('.pagination');
  if (totalPages > 1) {
    if (!pag) { pag = document.createElement('div'); pag.className = 'pagination flex-between'; tableCard.appendChild(pag); }
    pag.innerHTML = `
      <span>Page ${unmatchedPage + 1} of ${totalPages}</span>
      <div class="page-btns flex">
        <button ${unmatchedPage === 0 ? 'disabled' : ''} id="unmatchedPrev">\u2190 Prev</button>
        <button ${unmatchedPage >= totalPages - 1 ? 'disabled' : ''} id="unmatchedNext">Next \u2192</button>
      </div>`;
    const prev = pag.querySelector('#unmatchedPrev');
    const next = pag.querySelector('#unmatchedNext');
    if (prev) prev.addEventListener('click', () => { unmatchedPage--; renderUnmatchedTable(_filteredUnmatched); });
    if (next) next.addEventListener('click', () => { unmatchedPage++; renderUnmatchedTable(_filteredUnmatched); });
  } else if (pag) {
    pag.remove();
  }
}
let serverPage = 0;
let _filteredServers = [];

function renderServerTable(servers) {
  _filteredServers = servers;
  const total = servers.length;
  const totalPages = Math.ceil(total / SERVER_PAGE_SIZE);
  const start = serverPage * SERVER_PAGE_SIZE;
  const page = servers.slice(start, start + SERVER_PAGE_SIZE);
  const showFrom = total === 0 ? 0 : start + 1;
  const showTo = Math.min(start + SERVER_PAGE_SIZE, total);

  const indicator = document.getElementById('serverCountIndicator');
  if (indicator) indicator.textContent = `Showing ${showFrom}\u2013${showTo} of ${total} servers`;

  document.getElementById('serverTable').innerHTML = page.map(s => `<tr>
    <td><strong>${esc(s.serverName)}</strong></td>
    <td class="color-muted">${esc(s.fqdn) || '\u2014'}</td>
    <td>${badge(s.environment || 'Unknown', s.environment === 'Production' ? 'red' : s.environment === 'Staging' ? 'yellow' : 'blue')}</td>
    <td>${esc(s.applicationName) || '\u2014'}</td>
    <td>${s.patchGroup ? badge(s.patchGroup, 'muted') : '\u2014'}</td>
    <td>${s.isActive ? dot('green') + 'Yes' : dot('red') + 'No'}</td>
  </tr>`).join('');

  // Pagination controls
  const tableCard = document.getElementById('serverTable').closest('.card');
  let pag = tableCard.querySelector('.pagination');
  if (totalPages > 1) {
    if (!pag) { pag = document.createElement('div'); pag.className = 'pagination flex-between'; tableCard.appendChild(pag); }
    pag.innerHTML = `
      <span>Page ${serverPage + 1} of ${totalPages}</span>
      <div class="page-btns flex">
        <button ${serverPage === 0 ? 'disabled' : ''} id="serverPrev">\u2190 Prev</button>
        <button ${serverPage >= totalPages - 1 ? 'disabled' : ''} id="serverNext">Next \u2192</button>
      </div>`;
    const prev = pag.querySelector('#serverPrev');
    const next = pag.querySelector('#serverNext');
    if (prev) prev.addEventListener('click', () => { serverPage--; renderServerTable(_filteredServers); });
    if (next) next.addEventListener('click', () => { serverPage++; renderServerTable(_filteredServers); });
  } else if (pag) {
    pag.remove();
  }
}

function filterServers() {
  serverPage = 0;
  const search = document.getElementById('serverSearch').value.toLowerCase().trim();
  const env = document.getElementById('envFilter').value;
  const filtered = allServers.filter(s => {
    if (env && s.environment !== env) return false;
    if (search && !s.serverName.toLowerCase().includes(search) && !(s.fqdn||'').toLowerCase().includes(search)) return false;
    return true;
  });
  renderServerTable(filtered);
}

// --- Render: Patching ---
let cycleServerCache = {};

function renderPatching(next, cycles, issues) {
  if (!next && cycles.length === 0 && issues.length === 0) {
    document.getElementById('nextPatchBanner').innerHTML = `
      <div class="card" style="text-align:center;padding:2rem">
        <h3 style="margin-bottom:0.5rem">No Patch Cycles Scheduled</h3>
        <div class="color-muted">Patch cycles will appear here once they are created in the system.</div>
      </div>`;
    document.getElementById('cycleTable').innerHTML = '';
    document.getElementById('issueTable').innerHTML = '';
    return;
  }
  if (next) {
    const urgency = next.daysUntil <= 3 ? 'red' : next.daysUntil <= 7 ? 'yellow' : 'green';
    document.getElementById('nextPatchBanner').innerHTML = `
      <div class="card patch-banner patch-banner-${urgency}">
        <div class="patch-banner-layout flex-between gap-xl">
          <div class="patch-banner-main">
            <h3>Next Patch Cycle</h3>
            <div class="value">${num(next.daysUntil)} days</div>
            <div class="sub">${fmtDate(next.cycle.cycleDate)} \u00B7 ${num(next.cycle.serverCount)} servers</div>
          </div>
          <div class="patch-banner-details">
            <div class="patch-banner-col">
              <h3>Servers by Group</h3>
              ${Object.entries(next.serversByGroup).map(([g,c])=>`<div class="patch-detail-row">${esc(g)}: <strong>${esc(String(c))}</strong></div>`).join('')}
            </div>
            <div class="patch-banner-col">
              <h3>Issues by Severity</h3>
              ${Object.entries(next.issuesBySeverity).map(([s,c])=>`<div class="patch-detail-row">${severityBadge(s)} <strong>${esc(String(c))}</strong></div>`).join('')}
            </div>
          </div>
        </div>
      </div>`;
  }

  const tbody = document.getElementById('cycleTable');
  tbody.innerHTML = '';
  cycles.forEach(c => {
    const row = document.createElement('tr');
    row.className = 'cycle-row';
    row.innerHTML = `
      <td><strong>${fmtDate(c.cycleDate)}</strong></td>
      <td>${num(c.serverCount)}</td>
      <td>${statusBadge(c.status)}</td>`;

    const detailRow = document.createElement('tr');
    detailRow.className = 'cycle-detail';
    detailRow.innerHTML = `<td colspan="3"><div class="cycle-detail-inner" id="cycleDetail-${parseInt(c.cycleId)}"></div></td>`;

    row.addEventListener('click', () => toggleCycleDetail(c.cycleId, row, detailRow));
    tbody.appendChild(row);
    tbody.appendChild(detailRow);
  });

  document.getElementById('issueTable').innerHTML = issues.map(i => `<tr>
    <td><strong>${esc(i.title)}</strong></td>
    <td>${severityBadge(i.severity)}</td>
    <td>${i.application ? esc(i.application) : '<span class="color-muted">All</span>'}</td>
    <td>${i.appliesToWindows ? dot('green') : dot('red')}</td>
    <td>${i.appliesToSql ? dot('green') : dot('red')}</td>
    <td class="color-muted issue-fix">${esc(i.fix) || '\u2014'}</td>
  </tr>`).join('');
}

const CYCLE_PAGE_SIZE = 20;

async function toggleCycleDetail(cycleId, row, detailRow) {
  const isOpen = detailRow.classList.contains('visible');
  document.querySelectorAll('.cycle-detail.visible').forEach(d => d.classList.remove('visible'));
  document.querySelectorAll('.cycle-row.expanded').forEach(r => r.classList.remove('expanded'));

  if (isOpen) return;

  row.classList.add('expanded');
  detailRow.classList.add('visible');

  if (!cycleServerCache[cycleId]) {
    await loadCycleServersPage(cycleId, 0);
  } else {
    renderCycleServers(cycleId);
  }
}

async function loadCycleServersPage(cycleId, offset) {
  const container = document.getElementById(`cycleDetail-${cycleId}`);
  container.innerHTML = '<div class="loading-state flex-center gap-sm"><span class="loading"></span> Loading servers\u2026</div>';

  const data = await api(`/patching/cycles/${cycleId}/servers?limit=${CYCLE_PAGE_SIZE}&offset=${offset}`);
  if (data) {
    cycleServerCache[cycleId] = data;
  } else if (usingDemo) {
    const demo = DEMO.cycleServers[cycleId] || { items: [], totalCount: 0, limit: CYCLE_PAGE_SIZE, offset: 0 };
    cycleServerCache[cycleId] = { ...demo, offset };
  } else {
    cycleServerCache[cycleId] = { items: [], totalCount: 0, limit: CYCLE_PAGE_SIZE, offset: 0 };
  }

  renderCycleServers(cycleId);
}

function renderCycleServers(cycleId) {
  const container = document.getElementById(`cycleDetail-${cycleId}`);
  const page = cycleServerCache[cycleId] || { items: [], totalCount: 0, limit: CYCLE_PAGE_SIZE, offset: 0 };
  const servers = page.items || [];

  const totalPages = Math.ceil(page.totalCount / page.limit);
  const showFrom = page.offset + 1;
  const showTo = Math.min(page.offset + page.limit, page.totalCount);
  const hasPrev = page.offset > 0;
  const hasNext = page.offset + page.limit < page.totalCount;

  let paginationHtml = '';
  if (totalPages > 1) {
    const prevOffset = Math.max(0, page.offset - page.limit);
    const nextOffset = page.offset + page.limit;
    paginationHtml = `
      <div class="pagination flex-between">
        <span>Showing ${showFrom}\u2013${showTo} of ${page.totalCount} servers</span>
        <div class="page-btns flex">
          <button ${hasPrev ? '' : 'disabled'} data-cycle="${parseInt(cycleId)}" data-offset="${prevOffset}" class="page-prev">\u2190 Prev</button>
          <button ${hasNext ? '' : 'disabled'} data-cycle="${parseInt(cycleId)}" data-offset="${nextOffset}" class="page-next">Next \u2192</button>
        </div>
      </div>`;
  }

  container.innerHTML = `
    ${servers.length === 0
      ? '<div class="empty-state">No servers found</div>'
      : `<table>
          <thead><tr>
            <th>Server</th><th>Patch Group</th><th>Scheduled</th><th>Application</th><th>Issues</th>
          </tr></thead>
          <tbody>${servers.map(s => `<tr>
            <td><strong>${esc(s.serverName)}</strong></td>
            <td>${s.patchGroup ? badge(s.patchGroup, 'muted') : '\u2014'}</td>
            <td class="color-muted">${esc(s.scheduledTime) || '\u2014'}</td>
            <td>${esc(s.application) || '\u2014'}</td>
            <td>${s.hasKnownIssue
              ? `<span class="color-orange">${dot('orange')}${num(s.issueCount)} issue${num(s.issueCount) !== 1 ? 's' : ''}</span>`
              : `<span class="color-green">${dot('green')}None</span>`}</td>
          </tr>`).join('')}</tbody>
        </table>`
    }
    ${paginationHtml}`;

  // Attach pagination event listeners
  container.querySelectorAll('.page-prev, .page-next').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      loadCycleServersPage(parseInt(btn.dataset.cycle), parseInt(btn.dataset.offset));
    });
  });
}

// --- Render: Certificates ---
function renderCerts(summary, certs) {
  allCerts = certs;
  activeCertFilter = null;

  // Status summary card
  const certStatus = summary.criticalCount > 0 ? 'status-error' : summary.warningCount > 0 ? 'status-warning' : 'status-healthy';
  const certStatusLabel = summary.criticalCount > 0 ? 'Action Required' : summary.warningCount > 0 ? 'Needs Attention' : 'All Clear';
  const certStatusColor = summary.criticalCount > 0 ? 'red' : summary.warningCount > 0 ? 'orange' : 'green';
  document.getElementById('certStatusCard').className = `card dash-status-card overflow-hidden ${certStatus}`;
  document.getElementById('certStatusCard').innerHTML = `
    <h3>Certificates</h3>
    <div class="dash-status-value">${num(summary.totalCount)}</div>
    <div class="sub color-${certStatusColor}" style="margin-top:0.5rem">${certStatusLabel}</div>`;

  // Gradient cards with click-to-filter
  document.getElementById('certCards').innerHTML = `
    <div class="critical-card critical-red clickable" data-filter="critical">
      <div class="critical-num">${num(summary.criticalCount)}</div>
      <div class="critical-label">Critical</div>
      <div class="critical-delta">Expiring soon</div>
    </div>
    <div class="critical-card critical-orange clickable" data-filter="warning">
      <div class="critical-num">${num(summary.warningCount)}</div>
      <div class="critical-label">Warning</div>
      <div class="critical-delta">Needs attention</div>
    </div>
    <div class="critical-card critical-green clickable" data-filter="ok">
      <div class="critical-num">${num(summary.okCount)}</div>
      <div class="critical-label">OK</div>
      <div class="critical-delta">Valid</div>
    </div>`;

  const total = summary.totalCount || 1;
  renderTimeline('certTimeline', [
    { pct: summary.criticalCount / total * 100, color: 'var(--red)', label: `Critical: ${summary.criticalCount}` },
    { pct: summary.warningCount / total * 100, color: 'var(--orange)', label: `Warning: ${summary.warningCount}` },
    { pct: summary.okCount / total * 100, color: 'var(--green)', label: `OK: ${summary.okCount}` },
  ]);

  // Wire up card click filters
  wireCriticalCardFilters('certCards', (filter) => {
    activeCertFilter = filter;
    document.getElementById('alertFilter').value = filter || '';
    filterCerts();
  });

  renderCertTable(certs);
}

const CERT_PAGE_SIZE = 20;
let certPage = 0;
let _filteredCerts = [];

function renderCertTable(certs) {
  _filteredCerts = certs;
  const total = certs.length;
  const totalPages = Math.ceil(total / CERT_PAGE_SIZE);
  const start = certPage * CERT_PAGE_SIZE;
  const page = certs.slice(start, start + CERT_PAGE_SIZE);
  const showFrom = total === 0 ? 0 : start + 1;
  const showTo = Math.min(start + CERT_PAGE_SIZE, total);

  const indicator = document.getElementById('certCountIndicator');
  if (indicator) indicator.textContent = `Showing ${showFrom}\u2013${showTo} of ${total} certificates`;

  document.getElementById('certTable').innerHTML = page.map(c => {
    const days = c.daysUntilExpiry != null ? num(c.daysUntilExpiry) : null;
    const daysClass = days != null && days <= 14 ? 'color-red'
                    : days != null && days <= 30 ? 'color-orange' : '';
    return `<tr>
    <td><strong>${esc(c.subjectCn)}</strong></td>
    <td>${esc(c.serverName)}</td>
    <td>${fmtDate(c.validTo)}</td>
    <td class="${daysClass}"><strong>${days != null ? days + 'd' : '\u2014'}</strong></td>
    <td>${alertBadge(c.alertLevel)}</td>
  </tr>`;
  }).join('');

  // Pagination controls
  const tableCard = document.getElementById('certTable').closest('.card');
  let pag = tableCard.querySelector('.pagination');
  if (totalPages > 1) {
    if (!pag) { pag = document.createElement('div'); pag.className = 'pagination flex-between'; tableCard.appendChild(pag); }
    pag.innerHTML = `
      <span>Page ${certPage + 1} of ${totalPages}</span>
      <div class="page-btns flex">
        <button ${certPage === 0 ? 'disabled' : ''} id="certPrev">\u2190 Prev</button>
        <button ${certPage >= totalPages - 1 ? 'disabled' : ''} id="certNext">Next \u2192</button>
      </div>`;
    const prev = pag.querySelector('#certPrev');
    const next = pag.querySelector('#certNext');
    if (prev) prev.addEventListener('click', () => { certPage--; renderCertTable(_filteredCerts); });
    if (next) next.addEventListener('click', () => { certPage++; renderCertTable(_filteredCerts); });
  } else if (pag) {
    pag.remove();
  }
}

function filterCerts() {
  certPage = 0;
  const level = document.getElementById('alertFilter').value;
  const server = document.getElementById('certServerSearch').value.toLowerCase().trim();
  const filtered = allCerts.filter(c => {
    if (level && (c.alertLevel || '').toLowerCase() !== level) return false;
    if (server && !c.serverName.toLowerCase().includes(server)) return false;
    return true;
  });
  renderCertTable(filtered);
  syncCriticalCardSelection('certCards', level);
}

// --- Render: End of Life ---
let eolDetailCache = {};

function eolBadge(level) {
  const colors = { eol: 'red', approaching: 'orange', supported: 'green' };
  const labels = { eol: 'EOL', approaching: 'Approaching', supported: 'Supported' };
  return badge(labels[level] || level, colors[level] || 'muted');
}

function renderEol(summary, items) {
  allEol = items;
  activeEolFilter = null;

  // Status summary card
  const eolStatus = summary.eolCount > 0 ? 'status-error' : summary.approachingCount > 0 ? 'status-warning' : 'status-healthy';
  const eolLabel = summary.eolCount > 0 ? `${num(summary.affectedServers)} affected servers` : summary.approachingCount > 0 ? 'Approaching deadlines' : 'All supported';
  const eolColor = summary.eolCount > 0 ? 'red' : summary.approachingCount > 0 ? 'orange' : 'green';
  document.getElementById('eolStatusCard').className = `card dash-status-card overflow-hidden ${eolStatus}`;
  document.getElementById('eolStatusCard').innerHTML = `
    <h3>End of Life</h3>
    <div class="dash-status-value">${num(summary.totalCount)}</div>
    <div class="sub color-${eolColor}" style="margin-top:0.5rem">${eolLabel}</div>`;

  document.getElementById('eolCards').innerHTML = `
    <div class="critical-card critical-red clickable" data-filter="eol">
      <div class="critical-num">${num(summary.eolCount)}</div>
      <div class="critical-label">End of Life</div>
      <div class="critical-delta">Past EOL date</div>
    </div>
    <div class="critical-card critical-orange clickable" data-filter="approaching">
      <div class="critical-num">${num(summary.approachingCount)}</div>
      <div class="critical-label">Approaching</div>
      <div class="critical-delta">Within 6 months</div>
    </div>
    <div class="critical-card critical-green clickable" data-filter="supported">
      <div class="critical-num">${num(summary.supportedCount)}</div>
      <div class="critical-label">Supported</div>
      <div class="critical-delta">Currently supported</div>
    </div>`;

  // Wire up card click filters
  wireCriticalCardFilters('eolCards', (filter) => {
    activeEolFilter = filter;
    document.getElementById('eolAlertFilter').value = filter || '';
    filterEol();
  });

  renderEolTable(items);
}

const EOL_PAGE_SIZE = 20;
let eolPage = 0;
let _filteredEol = [];

function renderEolTable(items) {
  _filteredEol = items;
  const total = items.length;
  const totalPages = Math.ceil(total / EOL_PAGE_SIZE);
  const start = eolPage * EOL_PAGE_SIZE;
  const page = items.slice(start, start + EOL_PAGE_SIZE);
  const showFrom = total === 0 ? 0 : start + 1;
  const showTo = Math.min(start + EOL_PAGE_SIZE, total);

  const indicator = document.getElementById('eolCountIndicator');
  if (indicator) indicator.textContent = `Showing ${showFrom}\u2013${showTo} of ${total} products`;

  const tbody = document.getElementById('eolTable');
  tbody.innerHTML = '';
  page.forEach(e => {
    const key = `${e.product}|${e.version}`;
    const row = document.createElement('tr');
    row.className = 'eol-row';
    row.innerHTML = `
      <td><strong>${esc(e.product)}</strong></td>
      <td>${esc(e.version)}</td>
      <td>${fmtDate(e.endOfLife)}</td>
      <td>${fmtDate(e.endOfExtendedSupport)}</td>
      <td>${eolBadge(e.alertLevel)}</td>
      <td><strong>${num(e.affectedAssets)}</strong></td>`;

    const detailRow = document.createElement('tr');
    detailRow.className = 'eol-detail';
    detailRow.innerHTML = `<td colspan="6"><div class="eol-detail-inner" id="eolDetail-${esc(key)}"></div></td>`;

    row.addEventListener('click', () => toggleEolDetail(key, e, row, detailRow));
    tbody.appendChild(row);
    tbody.appendChild(detailRow);
  });

  // Pagination controls
  const tableCard = document.getElementById('eolTable').closest('.card');
  let pag = tableCard.querySelector('.pagination');
  if (totalPages > 1) {
    if (!pag) { pag = document.createElement('div'); pag.className = 'pagination flex-between'; tableCard.appendChild(pag); }
    pag.innerHTML = `
      <span>Page ${eolPage + 1} of ${totalPages}</span>
      <div class="page-btns flex">
        <button ${eolPage === 0 ? 'disabled' : ''} id="eolPrev">\u2190 Prev</button>
        <button ${eolPage >= totalPages - 1 ? 'disabled' : ''} id="eolNext">Next \u2192</button>
      </div>`;
    const prev = pag.querySelector('#eolPrev');
    const next = pag.querySelector('#eolNext');
    if (prev) prev.addEventListener('click', () => { eolPage--; renderEolTable(_filteredEol); });
    if (next) next.addEventListener('click', () => { eolPage++; renderEolTable(_filteredEol); });
  } else if (pag) {
    pag.remove();
  }
}

async function toggleEolDetail(key, eolItem, row, detailRow) {
  const isOpen = detailRow.classList.contains('visible');
  // Collapse all open details
  document.querySelectorAll('#eolTable .eol-detail.visible').forEach(d => d.classList.remove('visible'));
  document.querySelectorAll('#eolTable .eol-row.expanded').forEach(r => r.classList.remove('expanded'));

  if (isOpen) return;

  row.classList.add('expanded');
  detailRow.classList.add('visible');

  const container = detailRow.querySelector('.eol-detail-inner');

  if (eolDetailCache[key]) {
    renderEolDetail(container, eolDetailCache[key]);
    return;
  }

  container.innerHTML = '<div class="loading-state flex-center gap-sm"><span class="loading"></span> Loading affected servers\u2026</div>';

  const product = encodeURIComponent(eolItem.product);
  const version = encodeURIComponent(eolItem.version);
  const data = await api(`/eol/${product}/${version}`);

  if (data) {
    eolDetailCache[key] = data;
  } else if (usingDemo) {
    eolDetailCache[key] = DEMO.eolDetail[key] || { assets: [] };
  } else {
    eolDetailCache[key] = { assets: [] };
  }

  renderEolDetail(container, eolDetailCache[key]);
}

function renderEolDetail(container, detail) {
  const assets = detail.assets || [];
  if (assets.length === 0) {
    container.innerHTML = '<div class="empty-state">No affected servers found</div>';
    return;
  }
  // Split into 3 columns for compact layout
  const colSize = Math.ceil(assets.length / 3);
  const cols = [assets.slice(0, colSize), assets.slice(colSize, colSize * 2), assets.slice(colSize * 2)];
  const maxRows = cols[0].length;

  container.innerHTML = `
    <div class="eol-detail-header text-label">Affected Servers (${assets.length})</div>
    <div class="scroll-wrap">
      <table class="eol-server-table">
        <thead><tr><th>#</th><th>Server</th><th>#</th><th>Server</th><th>#</th><th>Server</th></tr></thead>
        <tbody>${Array.from({length: maxRows}, (_, i) => {
          const cells = cols.map((col, ci) => {
            if (!col[i]) return '<td></td><td></td>';
            const idx = ci * colSize + i + 1;
            return `<td class="color-muted">${idx}</td><td><code>${esc(col[i])}</code></td>`;
          }).join('');
          return `<tr>${cells}</tr>`;
        }).join('')}</tbody>
      </table>
    </div>`;
}

function filterEol() {
  eolPage = 0;
  const level = document.getElementById('eolAlertFilter').value;
  const product = document.getElementById('eolProductSearch').value.toLowerCase().trim();
  const filtered = allEol.filter(e => {
    if (level && (e.alertLevel || '').toLowerCase() !== level) return false;
    if (product && !e.product.toLowerCase().includes(product) && !e.version.toLowerCase().includes(product)) return false;
    return true;
  });
  renderEolTable(filtered);
  syncCriticalCardSelection('eolCards', level);
}

// --- Load all data ---
let _loadInFlight = false;
async function loadAllData() {
  if (_loadInFlight) return;
  _loadInFlight = true;
  try { await _loadAllDataInner(); } finally { _loadInFlight = false; }
}
async function _loadAllDataInner() {
  apiError = null;
  usingDemo = false;
  const [healthData, servers, unmatched, next, cycles, issues, certSummary, certs, eolSummary, eolItems] =
    await Promise.all([
      api('/health'),
      api('/servers?limit=200'),
      api('/servers/unmatched'),
      api('/patching/next'),
      api('/patching/cycles'),
      api('/patching/issues'),
      api('/certificates/summary'),
      api('/certificates?limit=200'),
      api('/eol/summary'),
      api('/eol?limit=200'),
    ]);

  if (!healthData) usingDemo = true;

  renderHealth(healthData || DEMO.health, servers || DEMO.servers, unmatched || DEMO.unmatched, certSummary || DEMO.certSummary, certs || DEMO.certificates, next || DEMO.nextPatch);
  renderServers(servers || DEMO.servers, unmatched || DEMO.unmatched);
  cycleServerCache = {};
  eolDetailCache = {};
  renderPatching(next || DEMO.nextPatch, cycles || DEMO.cycles, issues || DEMO.issues);
  renderCerts(certSummary || DEMO.certSummary, certs || DEMO.certificates);
  renderEol(eolSummary || DEMO.eolSummary, eolItems || DEMO.eolSoftware);

  // Show/hide demo banner
  const demoBanner = document.getElementById('demoBanner');
  if (demoBanner) demoBanner.style.display = usingDemo ? '' : 'none';

  if (apiError) {
    document.getElementById('lastUpdated').textContent = apiError;
  } else if (usingDemo) {
    document.getElementById('lastUpdated').textContent = 'Demo Mode \u2014 API not connected';
  }
}

// --- Wire up event handlers (no inline handlers) ---
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-goto]');
  if (!btn) return;
  e.preventDefault();
  const page = btn.dataset.goto;
  document.querySelectorAll('header nav button').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const navBtn = document.querySelector(`header nav button[data-page="${page}"]`);
  if (navBtn) navBtn.classList.add('active');
  document.getElementById(page)?.classList.add('active');
});
document.getElementById('refreshBtn').addEventListener('click', loadAllData);
document.getElementById('serverSearch').addEventListener('input', filterServers);
document.getElementById('envFilter').addEventListener('change', filterServers);
document.getElementById('alertFilter').addEventListener('change', filterCerts);
document.getElementById('certServerSearch').addEventListener('input', filterCerts);
document.getElementById('eolAlertFilter').addEventListener('change', filterEol);
document.getElementById('eolProductSearch').addEventListener('input', filterEol);

// --- Theme toggle ---
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const btn = document.getElementById('themeToggle');
  // ☾ for dark (click to go light), ☀ for light (click to go dark)
  btn.innerHTML = theme === 'light' ? '&#9788;' : '&#9790;';
  btn.title = theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode';
}

const savedTheme = localStorage.getItem('ges-theme') || 'dark';
applyTheme(savedTheme);

document.getElementById('themeToggle').addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  localStorage.setItem('ges-theme', next);
});

// --- Initial load ---
loadAllData();
