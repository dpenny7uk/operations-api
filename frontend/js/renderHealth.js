import { esc, num, badge, dot, fmtDate, fmtTime, statusBadge, timeAgo, durationStr, navigateTo } from './utils.js';
import { api, usingDemo } from './api.js';
import { DEMO } from './demo.js';

export async function renderHealth(data, serverSummary, unmatched, certSummary, certs, nextPatch) {
  const syncs = data.syncStatuses || [];
  const failCount = syncs.filter(s => s.status === 'error' || s.consecutiveFailures > 0).length;
  const status = (data.overallStatus || '').toLowerCase();
  const overallColor = status === 'healthy' ? 'green' : status === 'error' ? 'red' : 'yellow';
  const statusLabel = status === 'healthy' ? 'Healthy' : status === 'error' ? 'Error' : 'Warning';

  document.getElementById('overallStatus').innerHTML = `${dot(overallColor)}<span class="header-status">${esc(data.overallStatus)}</span>`;
  document.getElementById('lastUpdated').textContent = `Updated ${fmtTime(data.lastUpdated)}`;

  // System Status card — #6: wrap emoji in aria-label span
  const statusClass = status === 'healthy' ? 'status-healthy' : status === 'error' ? 'status-error' : 'status-warning';
  const statusIcon = status === 'healthy' ? '\u2705' : status === 'error' ? '\u274C' : '\u26A0\uFE0F';
  document.getElementById('systemStatusCard').className = `card dash-status-card overflow-hidden ${statusClass}`;
  document.getElementById('systemStatusCard').innerHTML = `
    <h3>System Status</h3>
    <div class="dash-status-value">
      <span class="status-icon" role="img" aria-label="${statusLabel}">${statusIcon}</span>
      <span class="color-${overallColor}">${esc(statusLabel)}</span>
    </div>`;

  // Critical Issues cards
  document.getElementById('criticalCards').innerHTML = `
    <div class="critical-card critical-teal">
      <div class="critical-num">${num(data.unreachableServersCount)}</div>
      <div class="critical-label">Unreachable</div>
      <div class="critical-delta">${num(data.unreachableServersCount)} total</div>
    </div>
    <div class="critical-card critical-orange">
      <div class="critical-num">${num(data.unmatchedServersCount)}</div>
      <div class="critical-label">Unmatched Servers</div>
      <div class="critical-delta">${num(data.unmatchedServersCount)} pending review</div>
    </div>
    <div class="critical-card critical-red">
      <div class="critical-num">${failCount}</div>
      <div class="critical-label">Sync Failures</div>
      <div class="critical-delta">${failCount > 0 ? `${failCount} sync${failCount !== 1 ? 's' : ''} failing` : 'All syncs healthy'}</div>
    </div>`;

  // #3: Fetch unreachable servers from API (not just demo mode)
  let unreachable = [];
  if (usingDemo) {
    unreachable = DEMO.unreachableServers || [];
  } else {
    const unreachableData = await api('/servers/unreachable');
    unreachable = unreachableData || [];
  }

  // Recent Alerts
  const alerts = [];
  unreachable.forEach(s => {
    alerts.push({
      icon: 'icon-red', iconChar: '\u25A0',
      title: `<strong>${esc(s.serverName)}</strong> <span class="alert-status color-red">unreachable</span>`,
      sub: `${num(data.unreachableServersCount)} total`,
      time: timeAgo(s.lastSeen),
      goto: 'servers'
    });
  });
  syncs.filter(s => s.consecutiveFailures > 0).forEach(s => {
    alerts.push({
      icon: 'icon-orange', iconChar: '\u25A0',
      title: `<strong>${esc(s.syncName)}</strong> <span class="alert-status color-orange">sync failed</span>`,
      sub: `${num(s.consecutiveFailures)} consecutive failures`,
      time: timeAgo(s.lastSuccessAt)
    });
  });
  (certs || []).filter(c => (c.alertLevel || '').toLowerCase() === 'critical').slice(0, 2).forEach(c => {
    alerts.push({
      icon: 'icon-yellow', iconChar: '\u25C6',
      title: `<strong>${esc(c.serverName)}</strong> cert <span class="alert-status color-orange">expires in ${num(c.daysUntilExpiry)} days</span>`,
      sub: `Certificate expiring soon`,
      time: timeAgo(c.validTo),
      goto: 'certificates'
    });
  });

  document.getElementById('recentAlerts').innerHTML = alerts.length === 0
    ? '<div class="empty-state">No active alerts</div>'
    : alerts.slice(0, 5).map(a => `
      <div class="alert-item${a.goto ? ' alert-clickable' : ''}"${a.goto ? ` data-alert-goto="${a.goto}"` : ''}>
        <div class="alert-icon ${a.icon}">${a.iconChar}</div>
        <div class="alert-body">
          <div class="alert-title">${a.title}</div>
          <div class="alert-sub">${a.sub}</div>
        </div>
        <div class="alert-time">${a.time}${a.goto ? ' <span class="alert-goto-hint">\u203A</span>' : ''}</div>
      </div>`).join('');

  // Wire click-through on alerts
  document.querySelectorAll('.alert-item[data-alert-goto]').forEach(el => {
    el.style.cursor = 'pointer';
    el.addEventListener('click', () => navigateTo(el.dataset.alertGoto));
  });

  // Key Metrics
  const ss = serverSummary || {};
  const envCounts = ss.environmentCounts || {};

  const cs = certSummary || {};
  const np = nextPatch || {};
  const patchServers = np.cycle ? num(np.cycle.serverCount) : 0;
  const patchGroups = np.serversByGroup || {};

  document.getElementById('keyMetrics').innerHTML = `
    <div class="metric-card">
      <h4><span role="img" aria-label="Servers">\uD83D\uDDA5\uFE0F</span> Servers</h4>
      <div class="metric-big">${num(ss.totalCount || 0)}<span> total</span></div>
      <div class="metric-detail">
        ${Object.entries(envCounts).map(([env, counts]) => {
          const c = {Production:'red',Development:'blue',UAT:'orange',Staging:'yellow',Systest:'teal','Live Support':'pink','Shared Services':'green',Training:'purple','Proof of Concept':'cyan','Continuous Integration':'indigo',Unknown:'muted'}[env]||'blue';
          return `<div class="metric-row"><span class="color-${c}">${counts.total}</span> <span>${esc(env)}</span></div>`;
        }).join('')}
      </div>
    </div>
    <div class="metric-card metric-green">
      <h4><span role="img" aria-label="Patch Groups">\u2705</span> Patch Groups</h4>
      <div class="metric-big">${Object.keys(patchGroups).length > 0 ? num(patchServers) : '\u2014'}<span>${Object.keys(patchGroups).length > 0 ? ' servers' : ''}</span></div>
      <div class="metric-detail">
        ${Object.keys(patchGroups).length > 0
          ? Object.entries(patchGroups).map(([g, c]) => `<div class="metric-row"><span>${esc(g)}:</span> <strong>${c}</strong></div>`).join('')
          : '<div class="color-muted">No patching this week</div>'}
      </div>
    </div>
    <div class="metric-card metric-accent">
      <h4><span role="img" aria-label="Certificates">\uD83D\uDD12</span> Certificates</h4>
      <div class="metric-big">${num(cs.totalCount)}<span> total</span></div>
      <div class="metric-detail">
        <div class="color-orange">${num(cs.warningCount)} Warning</div>
        <div class="color-green">${num(cs.okCount)} OK</div>
        <div class="color-red">${num(cs.criticalCount)} Expiring Soon</div>
      </div>
    </div>`;

  // Unreachable servers table (show first 5, like unmatched)
  const unreachableShown = unreachable.slice(0, 5);
  document.getElementById('unreachableTable').innerHTML = unreachable.length === 0
    ? `<tr><td colspan="4" class="empty-state">No unreachable servers</td></tr>`
    : unreachableShown.map(s => `<tr>
      <td><strong>${esc(s.serverName)}</strong></td>
      <td>${badge(s.environment || 'Unknown', s.environment === 'Production' ? 'red' : 'blue')}</td>
      <td class="color-muted">${timeAgo(s.lastSeen)}</td>
      <td class="color-muted">${durationStr(s.lastSeen)}</td>
    </tr>`).join('') + (unreachable.length > 5
      ? `<tr><td colspan="4" class="color-muted" style="text-align:center;padding:0.5rem">Showing 5 of ${unreachable.length}</td></tr>`
      : '');

  // #10: Unmatched servers summary with count indicator
  const unmatchedList = unmatched || [];
  const unmatchedShown = unmatchedList.slice(0, 5);
  document.getElementById('dashUnmatchedTable').innerHTML = unmatchedList.length === 0
    ? `<tr><td colspan="3" class="empty-state">No unmatched servers</td></tr>`
    : unmatchedShown.map(u => `<tr>
      <td><strong>${esc(u.serverNameRaw)}</strong></td>
      <td>${badge(u.sourceSystem, 'blue')}</td>
      <td class="color-muted">${fmtDate(u.firstSeenAt)}</td>
    </tr>`).join('') + (unmatchedList.length > 5
      ? `<tr><td colspan="3" class="color-muted" style="text-align:center;padding:0.5rem">Showing 5 of ${unmatchedList.length}</td></tr>`
      : '');

  // Sync table
  document.getElementById('syncTable').innerHTML = syncs.filter(s => s.syncName !== 'ivanti_patching').map(s => `<tr>
    <td><strong>${esc(s.syncName)}</strong></td>
    <td>${statusBadge(s.freshnessStatus)}</td>
    <td>${fmtTime(s.lastSuccessAt)}</td>
    <td>${num(s.recordsProcessed).toLocaleString()}</td>
    <td>${num(s.consecutiveFailures) > 0 ? `<span class="color-red">${num(s.consecutiveFailures)}</span>` : '<span class="color-muted">0</span>'}</td>
    <td>${s.lastErrorMessage ? `<span class="color-red">${esc(s.lastErrorMessage)}</span>` : '<span class="color-muted">\u2014</span>'}</td>
    <td class="color-muted">${esc(s.expectedSchedule) || '\u2014'}</td>
  </tr>`).join('');
}
