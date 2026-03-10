// API base URL - auto-detects from current origin in production, falls back to localhost for dev
const API_BASE = window.location.hostname === 'localhost'
    ? 'http://localhost:5000/api'
    : window.location.origin + '/api';

// --- Demo data (used when the API is unreachable) ---
const DEMO = {
  health: {
    overallStatus: 'healthy',
    syncStatuses: [
      { syncName: 'databricks_servers', status: 'success', lastSuccessAt: new Date(Date.now() - 3600000).toISOString(), hoursSinceSuccess: 1.0, freshnessStatus: 'healthy', recordsProcessed: 342, consecutiveFailures: 0, expectedSchedule: 'Every 6 hours' },
      { syncName: 'patching_schedule_html', status: 'success', lastSuccessAt: new Date(Date.now() - 7200000).toISOString(), hoursSinceSuccess: 2.0, freshnessStatus: 'healthy', recordsProcessed: 156, consecutiveFailures: 0, expectedSchedule: 'Every 12 hours' },
      { syncName: 'confluence_issues', status: 'warning', lastSuccessAt: new Date(Date.now() - 86400000).toISOString(), hoursSinceSuccess: 24.0, freshnessStatus: 'stale', recordsProcessed: 28, consecutiveFailures: 2, lastErrorMessage: 'Sync error occurred \u2014 check server logs', expectedSchedule: 'Every 6 hours' },
      { syncName: 'certificate_scan', status: 'success', lastSuccessAt: new Date(Date.now() - 14400000).toISOString(), hoursSinceSuccess: 4.0, freshnessStatus: 'healthy', recordsProcessed: 89, consecutiveFailures: 0, expectedSchedule: 'Daily' },
    ],
    unmatchedServersCount: 7,
    unreachableServersCount: 4,
    lastUpdated: new Date().toISOString()
  },
  servers: [
    { serverId: 1, serverName: 'WEB-PROD-01', fqdn: 'web-prod-01.corp.local', environment: 'Production', applicationName: 'Customer Portal', patchGroup: 'Group-A', isActive: true },
    { serverId: 2, serverName: 'WEB-PROD-02', fqdn: 'web-prod-02.corp.local', environment: 'Production', applicationName: 'Customer Portal', patchGroup: 'Group-A', isActive: true },
    { serverId: 3, serverName: 'SQL-PROD-01', fqdn: 'sql-prod-01.corp.local', environment: 'Production', applicationName: 'Database Cluster', patchGroup: 'Group-B', isActive: true },
    { serverId: 4, serverName: 'APP-STG-01', fqdn: 'app-stg-01.corp.local', environment: 'Staging', applicationName: 'API Gateway', patchGroup: 'Group-C', isActive: true },
    { serverId: 5, serverName: 'DEV-BUILD-01', fqdn: 'dev-build-01.corp.local', environment: 'Development', applicationName: 'CI/CD', patchGroup: null, isActive: true },
    { serverId: 6, serverName: 'WEB-PROD-03', fqdn: 'web-prod-03.corp.local', environment: 'Production', applicationName: 'Admin Panel', patchGroup: 'Group-A', isActive: false },
    { serverId: 7, serverName: 'SQL-STG-01', fqdn: 'sql-stg-01.corp.local', environment: 'Staging', applicationName: 'Database Cluster', patchGroup: 'Group-C', isActive: true },
    { serverId: 8, serverName: 'MONITOR-01', fqdn: 'monitor-01.corp.local', environment: 'Production', applicationName: 'Monitoring', patchGroup: 'Group-B', isActive: true },
  ],
  unmatched: [
    { serverNameRaw: 'WEBPROD01', sourceSystem: 'SCCM', occurrenceCount: 15, firstSeenAt: '2025-12-01T00:00:00Z', lastSeenAt: new Date().toISOString(), closestMatch: 'WEB-PROD-01' },
    { serverNameRaw: 'unknown-host-42', sourceSystem: 'Qualys', occurrenceCount: 3, firstSeenAt: '2026-02-15T00:00:00Z', lastSeenAt: new Date().toISOString(), closestMatch: null },
    { serverNameRaw: 'SQLPROD1', sourceSystem: 'SCCM', occurrenceCount: 8, firstSeenAt: '2026-01-10T00:00:00Z', lastSeenAt: new Date().toISOString(), closestMatch: 'SQL-PROD-01' },
  ],
  nextPatch: {
    cycle: { cycleId: 12, cycleDate: new Date(Date.now() + 5 * 86400000).toISOString(), serverCount: 45, status: 'Scheduled' },
    daysUntil: 5,
    serversByGroup: { 'Group-A': 22, 'Group-B': 18, 'Group-C': 15, 'Group-D': 13 },
    issuesBySeverity: { 'High': 2, 'Medium': 5, 'Low': 3 },
    totalIssuesAffectingServers: 12
  },
  cycles: [
    { cycleId: 12, cycleDate: new Date(Date.now() + 5 * 86400000).toISOString(), serverCount: 45, status: 'Scheduled' },
    { cycleId: 11, cycleDate: new Date(Date.now() - 25 * 86400000).toISOString(), serverCount: 44, status: 'Completed' },
    { cycleId: 10, cycleDate: new Date(Date.now() - 55 * 86400000).toISOString(), serverCount: 43, status: 'Completed' },
  ],
  issues: [
    { issueId: 1, title: 'KB5034441 fails on small recovery partition', severity: 'High', application: null, appliesToWindows: true, appliesToSql: false, fix: 'Resize recovery partition to 1GB' },
    { issueId: 2, title: 'SQL CU requires SSMS restart', severity: 'Medium', application: 'SQL Server', appliesToWindows: false, appliesToSql: true, fix: 'Restart SSMS after patching' },
    { issueId: 3, title: '.NET 8 runtime conflict with legacy app', severity: 'High', application: 'Legacy CRM', appliesToWindows: true, appliesToSql: false, fix: 'Pin .NET runtime version' },
    { issueId: 4, title: 'Cluster failover during patch window', severity: 'Medium', application: 'Database Cluster', appliesToWindows: true, appliesToSql: true, fix: 'Drain node before patching' },
    { issueId: 5, title: 'TLS 1.0 disabled after security update', severity: 'Low', application: null, appliesToWindows: true, appliesToSql: false, fix: 'Update legacy clients' },
  ],
  cycleServers: {
    12: {
      items: [
        { scheduleId: 1, serverName: 'WEB-PROD-01', patchGroup: 'Group-A', scheduledTime: '02:00', application: 'Customer Portal', hasKnownIssue: true, issueCount: 1 },
        { scheduleId: 2, serverName: 'WEB-PROD-02', patchGroup: 'Group-A', scheduledTime: '02:00', application: 'Customer Portal', hasKnownIssue: false, issueCount: 0 },
        { scheduleId: 3, serverName: 'SQL-PROD-01', patchGroup: 'Group-B', scheduledTime: '03:00', application: 'Database Cluster', hasKnownIssue: true, issueCount: 2 },
        { scheduleId: 4, serverName: 'MONITOR-01', patchGroup: 'Group-B', scheduledTime: '03:00', application: 'Monitoring', hasKnownIssue: false, issueCount: 0 },
        { scheduleId: 5, serverName: 'APP-STG-01', patchGroup: 'Group-C', scheduledTime: '06:00', application: 'API Gateway', hasKnownIssue: false, issueCount: 0 },
      ],
      totalCount: 5, limit: 100, offset: 0
    },
    11: {
      items: [
        { scheduleId: 9, serverName: 'WEB-PROD-01', patchGroup: 'Group-A', scheduledTime: '02:00', application: 'Customer Portal', hasKnownIssue: false, issueCount: 0 },
      ],
      totalCount: 1, limit: 100, offset: 0
    },
    10: { items: [], totalCount: 0, limit: 100, offset: 0 },
  },
  eolSummary: { eolCount: 4, approachingCount: 6, supportedCount: 35, unknownCount: 0, totalCount: 45, affectedServers: 18 },
  eolSoftware: [
    { product: 'Windows Server', version: '2012 R2', endOfLife: '2023-10-10T00:00:00Z', endOfExtendedSupport: '2026-10-13T00:00:00Z', endOfSupport: '2023-10-10T00:00:00Z', alertLevel: 'eol', affectedAssets: 5 },
    { product: 'SQL Server', version: '2014', endOfLife: '2024-07-09T00:00:00Z', endOfExtendedSupport: '2024-07-09T00:00:00Z', endOfSupport: '2019-07-09T00:00:00Z', alertLevel: 'eol', affectedAssets: 3 },
    { product: '.NET Framework', version: '4.6.1', endOfLife: '2022-04-26T00:00:00Z', endOfExtendedSupport: null, endOfSupport: '2022-04-26T00:00:00Z', alertLevel: 'eol', affectedAssets: 8 },
    { product: 'Windows Server', version: '2016', endOfLife: '2027-01-12T00:00:00Z', endOfExtendedSupport: '2027-01-12T00:00:00Z', endOfSupport: '2022-01-11T00:00:00Z', alertLevel: 'approaching', affectedAssets: 12 },
    { product: 'SQL Server', version: '2016', endOfLife: '2026-07-14T00:00:00Z', endOfExtendedSupport: '2026-07-14T00:00:00Z', endOfSupport: '2021-07-13T00:00:00Z', alertLevel: 'approaching', affectedAssets: 6 },
    { product: 'IIS', version: '10.0', endOfLife: '2026-10-13T00:00:00Z', endOfExtendedSupport: null, endOfSupport: '2026-10-13T00:00:00Z', alertLevel: 'approaching', affectedAssets: 4 },
    { product: 'Windows Server', version: '2019', endOfLife: '2029-01-09T00:00:00Z', endOfExtendedSupport: '2029-01-09T00:00:00Z', endOfSupport: '2024-01-09T00:00:00Z', alertLevel: 'supported', affectedAssets: 22 },
    { product: 'SQL Server', version: '2019', endOfLife: '2030-01-08T00:00:00Z', endOfExtendedSupport: '2030-01-08T00:00:00Z', endOfSupport: '2025-01-07T00:00:00Z', alertLevel: 'supported', affectedAssets: 15 },
    { product: 'Windows Server', version: '2022', endOfLife: '2031-10-14T00:00:00Z', endOfExtendedSupport: '2031-10-14T00:00:00Z', endOfSupport: '2026-10-13T00:00:00Z', alertLevel: 'supported', affectedAssets: 30 },
    { product: '.NET', version: '8.0', endOfLife: '2026-11-10T00:00:00Z', endOfExtendedSupport: null, endOfSupport: '2026-11-10T00:00:00Z', alertLevel: 'approaching', affectedAssets: 14 },
  ],
  eolDetail: {
    'Windows Server|2012 R2': { assets: ['SQL-PROD-01', 'WEB-PROD-03', 'APP-LEGACY-01', 'FILE-SVR-02', 'PRINT-SVR-01'] },
    'SQL Server|2014': { assets: ['SQL-PROD-01', 'SQL-STG-01', 'RPT-SVR-01'] },
    '.NET Framework|4.6.1': { assets: ['WEB-PROD-01', 'WEB-PROD-02', 'WEB-PROD-03', 'APP-STG-01', 'APP-LEGACY-01', 'SVC-PROD-01', 'SVC-PROD-02', 'BATCH-01'] },
    'Windows Server|2016': { assets: ['WEB-PROD-01', 'WEB-PROD-02', 'WEB-PROD-03', 'SQL-PROD-01', 'SQL-STG-01', 'APP-STG-01', 'MONITOR-01', 'DC-01', 'DC-02', 'FILE-SVR-01', 'FILE-SVR-02', 'PRINT-SVR-01'] },
    'SQL Server|2016': { assets: ['SQL-PROD-01', 'SQL-STG-01', 'RPT-SVR-01', 'DW-PROD-01', 'DW-PROD-02', 'ETL-SVR-01'] },
    'IIS|10.0': { assets: ['WEB-PROD-01', 'WEB-PROD-02', 'WEB-PROD-03', 'APP-STG-01'] },
    'Windows Server|2019': { assets: ['APP-PROD-01', 'APP-PROD-02', 'APP-PROD-03', 'SVC-PROD-01', 'SVC-PROD-02', 'API-PROD-01', 'API-PROD-02', 'BATCH-01', 'BATCH-02', 'CI-BUILD-01', 'CI-BUILD-02', 'VPN-01', 'AUTH-01', 'MAIL-01', 'DNS-01', 'DNS-02', 'NTP-01', 'LOG-01', 'LOG-02', 'BACKUP-01', 'BACKUP-02', 'SCAN-01'] },
    'SQL Server|2019': { assets: ['SQL-PROD-02', 'SQL-PROD-03', 'SQL-DEV-01', 'DW-PROD-03', 'DW-STG-01', 'ETL-SVR-02', 'RPT-SVR-02', 'RPT-SVR-03', 'SSAS-01', 'SSIS-01', 'SSRS-01', 'LOG-DB-01', 'AUDIT-DB-01', 'CONFIG-DB-01', 'CACHE-DB-01'] },
    'Windows Server|2022': { assets: Array.from({length: 30}, (_, i) => `SRV-2022-${String(i+1).padStart(2,'0')}`) },
    '.NET|8.0': { assets: ['API-PROD-01', 'API-PROD-02', 'API-STG-01', 'SVC-PROD-01', 'SVC-PROD-02', 'SVC-STG-01', 'WEB-PROD-01', 'WEB-PROD-02', 'WEB-PROD-03', 'APP-PROD-01', 'APP-PROD-02', 'BATCH-01', 'BATCH-02', 'CI-BUILD-01'] },
  },
  certSummary: { criticalCount: 3, warningCount: 8, okCount: 79, totalCount: 90 },
  certificates: [
    { certId: 1, subjectCn: '*.corp.local', serverName: 'WEB-PROD-01', validTo: new Date(Date.now() + 5 * 86400000).toISOString(), daysUntilExpiry: 5, alertLevel: 'critical' },
    { certId: 2, subjectCn: 'api.corp.com', serverName: 'WEB-PROD-02', validTo: new Date(Date.now() + 12 * 86400000).toISOString(), daysUntilExpiry: 12, alertLevel: 'critical' },
    { certId: 3, subjectCn: 'mail.corp.com', serverName: 'MAIL-01', validTo: new Date(Date.now() + 8 * 86400000).toISOString(), daysUntilExpiry: 8, alertLevel: 'critical' },
    { certId: 4, subjectCn: 'admin.corp.local', serverName: 'WEB-PROD-03', validTo: new Date(Date.now() + 22 * 86400000).toISOString(), daysUntilExpiry: 22, alertLevel: 'warning' },
    { certId: 5, subjectCn: 'monitor.corp.local', serverName: 'MONITOR-01', validTo: new Date(Date.now() + 35 * 86400000).toISOString(), daysUntilExpiry: 35, alertLevel: 'warning' },
    { certId: 6, subjectCn: 'db.corp.local', serverName: 'SQL-PROD-01', validTo: new Date(Date.now() + 45 * 86400000).toISOString(), daysUntilExpiry: 45, alertLevel: 'ok' },
    { certId: 7, subjectCn: 'ldap.corp.local', serverName: 'DC-01', validTo: new Date(Date.now() + 180 * 86400000).toISOString(), daysUntilExpiry: 180, alertLevel: 'ok' },
    { certId: 8, subjectCn: 'intranet.corp.local', serverName: 'WEB-PROD-01', validTo: new Date(Date.now() + 250 * 86400000).toISOString(), daysUntilExpiry: 250, alertLevel: 'ok' },
    { certId: 9, subjectCn: 'vpn.corp.com', serverName: 'VPN-01', validTo: new Date(Date.now() + 28 * 86400000).toISOString(), daysUntilExpiry: 28, alertLevel: 'warning' },
    { certId: 10, subjectCn: 'sso.corp.com', serverName: 'AUTH-01', validTo: new Date(Date.now() + 90 * 86400000).toISOString(), daysUntilExpiry: 90, alertLevel: 'ok' },
    { certId: 11, subjectCn: 'tableau.contoso.com', serverName: 'Tableau-Prod', validTo: new Date(Date.now() + 42 * 86400000).toISOString(), daysUntilExpiry: 42, alertLevel: 'ok' },
  ]
};

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

// --- Render: Health ---
function renderHealth(data) {
  const syncs = data.syncStatuses || [];
  const failCount = syncs.filter(s => s.status === 'error' || s.consecutiveFailures > 0).length;
  const status = (data.overallStatus || '').toLowerCase();
  const overallColor = status === 'healthy' ? 'green' : status === 'error' ? 'red' : 'yellow';

  document.getElementById('overallStatus').innerHTML = `${dot(overallColor)}<span class="header-status">${esc(data.overallStatus)}</span>`;
  document.getElementById('lastUpdated').textContent = `Updated ${fmtTime(data.lastUpdated)}`;

  const statusAlert = status === 'error' ? ' card-alert-red' : status === 'warning' ? ' card-alert-orange' : '';
  document.getElementById('healthCards').innerHTML = `
    <div class="card${statusAlert}">
      <h3>Overall Status</h3>
      <div class="value color-${overallColor}">${esc(data.overallStatus)}</div>
    </div>
    <div class="card">
      <h3>Active Syncs</h3>
      <div class="value">${syncs.length}</div>
      <div class="sub">${syncs.filter(s=>s.freshnessStatus==='healthy').length} healthy</div>
    </div>
    <div class="card${cardAlert(data.unmatchedServersCount, {red: 10, orange: 5, yellow: 1})}">
      <h3>Unmatched Servers</h3>
      <div class="value">${num(data.unmatchedServersCount)}</div>
      <div class="sub">Need resolution</div>
    </div>
    <div class="card${cardAlert(data.unreachableServersCount, {red: 5, orange: 1})}">
      <h3>Unreachable</h3>
      <div class="value ${num(data.unreachableServersCount) ? 'color-orange' : 'color-green'}">${num(data.unreachableServersCount)}</div>
      <div class="sub">Scan failures</div>
    </div>
    <div class="card${cardAlert(failCount, {red: 1})}">
      <h3>Sync Failures</h3>
      <div class="value ${failCount ? 'color-red' : 'color-green'}">${failCount}</div>
      <div class="sub">Consecutive failures</div>
    </div>
  `;

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
  renderServerTable(servers);

  document.getElementById('unmatchedTable').innerHTML = unmatched.map(u => `<tr>
    <td><code>${esc(u.serverNameRaw)}</code></td>
    <td>${badge(u.sourceSystem, 'blue')}</td>
    <td>${num(u.occurrenceCount)}</td>
    <td>${fmtDate(u.firstSeenAt)}</td>
    <td>${u.closestMatch ? `<span class="color-green">${esc(u.closestMatch)}</span>` : '<span class="color-muted">None</span>'}</td>
  </tr>`).join('');
}

function renderServerTable(servers) {
  const indicator = document.getElementById('serverCountIndicator');
  if (indicator) indicator.textContent = allServers.length >= 200 ? `Showing ${servers.length} of 200+ servers` : `${servers.length} servers`;
  document.getElementById('serverTable').innerHTML = servers.map(s => `<tr>
    <td><strong>${esc(s.serverName)}</strong></td>
    <td class="color-muted">${esc(s.fqdn) || '\u2014'}</td>
    <td>${badge(s.environment || 'Unknown', s.environment === 'Production' ? 'red' : s.environment === 'Staging' ? 'yellow' : 'blue')}</td>
    <td>${esc(s.applicationName) || '\u2014'}</td>
    <td>${s.patchGroup ? badge(s.patchGroup, 'muted') : '\u2014'}</td>
    <td>${s.isActive ? dot('green') + 'Yes' : dot('red') + 'No'}</td>
  </tr>`).join('');
}

function filterServers() {
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
        <div class="patch-banner-layout">
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

const CYCLE_PAGE_SIZE = 100;

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
  container.innerHTML = '<div class="loading-state"><span class="loading"></span> Loading servers\u2026</div>';

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
      <div class="pagination">
        <span>Showing ${showFrom}\u2013${showTo} of ${page.totalCount} servers</span>
        <div class="page-btns">
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

  document.getElementById('certCards').innerHTML = `
    <div class="card clickable${cardAlert(summary.criticalCount, {red: 1})}" data-filter="critical">
      <h3>Critical</h3>
      <div class="value color-red">${num(summary.criticalCount)}</div>
      <div class="sub">Expiring soon</div>
    </div>
    <div class="card clickable${cardAlert(summary.warningCount, {orange: 1})}" data-filter="warning">
      <h3>Warning</h3>
      <div class="value color-orange">${num(summary.warningCount)}</div>
      <div class="sub">Needs attention</div>
    </div>
    <div class="card clickable" data-filter="ok">
      <h3>OK</h3>
      <div class="value color-green">${num(summary.okCount)}</div>
      <div class="sub">Valid</div>
    </div>
    <div class="card">
      <h3>Total</h3>
      <div class="value">${num(summary.totalCount)}</div>
      <div class="sub">All certificates</div>
    </div>
  `;

  const total = summary.totalCount || 1;
  renderTimeline('certTimeline', [
    { pct: summary.criticalCount / total * 100, color: 'var(--red)', label: `Critical: ${summary.criticalCount}` },
    { pct: summary.warningCount / total * 100, color: 'var(--orange)', label: `Warning: ${summary.warningCount}` },
    { pct: summary.okCount / total * 100, color: 'var(--green)', label: `OK: ${summary.okCount}` },
  ]);

  // Wire up card click filters
  wireCardFilters('certCards', (filter) => {
    activeCertFilter = filter;
    document.getElementById('alertFilter').value = filter || '';
    filterCerts();
  });

  renderCertTable(certs);
}

function renderCertTable(certs) {
  const indicator = document.getElementById('certCountIndicator');
  if (indicator) indicator.textContent = allCerts.length >= 200 ? `Showing ${certs.length} of 200+ certificates` : `${certs.length} certificates`;
  document.getElementById('certTable').innerHTML = certs.map(c => {
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
}

function filterCerts() {
  const level = document.getElementById('alertFilter').value;
  const server = document.getElementById('certServerSearch').value.toLowerCase().trim();
  const filtered = allCerts.filter(c => {
    if (level && (c.alertLevel || '').toLowerCase() !== level) return false;
    if (server && !c.serverName.toLowerCase().includes(server)) return false;
    return true;
  });
  renderCertTable(filtered);
  syncCardSelection('certCards', level);
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

  document.getElementById('eolCards').innerHTML = `
    <div class="card clickable${cardAlert(summary.eolCount, {red: 1})}" data-filter="eol">
      <h3>End of Life</h3>
      <div class="value color-red">${num(summary.eolCount)}</div>
      <div class="sub">Past EOL date</div>
    </div>
    <div class="card clickable${cardAlert(summary.approachingCount, {orange: 1})}" data-filter="approaching">
      <h3>Approaching EOL</h3>
      <div class="value color-orange">${num(summary.approachingCount)}</div>
      <div class="sub">Within 6 months</div>
    </div>
    <div class="card clickable" data-filter="supported">
      <h3>Supported</h3>
      <div class="value color-green">${num(summary.supportedCount)}</div>
      <div class="sub">Currently supported</div>
    </div>
    <div class="card${cardAlert(summary.affectedServers, {red: 20, orange: 10, yellow: 1})}">
      <h3>Affected Servers</h3>
      <div class="value">${num(summary.affectedServers)}</div>
      <div class="sub">Running EOL/approaching software</div>
    </div>
  `;

  const total = summary.totalCount || 1;
  renderTimeline('eolTimeline', [
    { pct: summary.eolCount / total * 100, color: 'var(--red)', label: `EOL: ${summary.eolCount}` },
    { pct: summary.approachingCount / total * 100, color: 'var(--orange)', label: `Approaching: ${summary.approachingCount}` },
    { pct: summary.supportedCount / total * 100, color: 'var(--green)', label: `Supported: ${summary.supportedCount}` },
    { pct: (summary.unknownCount || 0) / total * 100, color: 'var(--text-muted)', label: `Unknown: ${summary.unknownCount || 0}` },
  ]);

  // Wire up card click filters
  wireCardFilters('eolCards', (filter) => {
    activeEolFilter = filter;
    document.getElementById('eolAlertFilter').value = filter || '';
    filterEol();
  });

  renderEolTable(items);
}

function renderEolTable(items) {
  const indicator = document.getElementById('eolCountIndicator');
  if (indicator) indicator.textContent = allEol.length >= 200 ? `Showing ${items.length} of 200+ entries` : `${items.length} entries`;
  const tbody = document.getElementById('eolTable');
  tbody.innerHTML = '';
  items.forEach(e => {
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

  container.innerHTML = '<div class="loading-state"><span class="loading"></span> Loading affected servers\u2026</div>';

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
  container.innerHTML = `
    <div class="eol-detail-header">Affected Servers (${assets.length})</div>
    <div class="server-chips">${assets.map(a => `<span class="server-chip">${esc(a)}</span>`).join('')}</div>`;
}

function filterEol() {
  const level = document.getElementById('eolAlertFilter').value;
  const product = document.getElementById('eolProductSearch').value.toLowerCase().trim();
  const filtered = allEol.filter(e => {
    if (level && (e.alertLevel || '').toLowerCase() !== level) return false;
    if (product && !e.product.toLowerCase().includes(product) && !e.version.toLowerCase().includes(product)) return false;
    return true;
  });
  renderEolTable(filtered);
  syncCardSelection('eolCards', level);
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

  renderHealth(healthData || DEMO.health);
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
