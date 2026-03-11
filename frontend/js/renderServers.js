import { esc, num, badge, dot, fmtDate } from './utils.js';
import { allServers, setAllServers } from './api.js';

const SERVER_PAGE_SIZE = 20;
let unmatchedPage = 0;
let allUnmatched = [];
let _filteredUnmatched = [];
let serverPage = 0;
let _filteredServers = [];

const ENV_COLORS = {
  Prod: 'var(--env-red)', Dev: 'var(--env-blue)', Systest: 'var(--env-teal)',
  UAT: 'var(--env-orange)', Staging: 'var(--env-yellow)', Training: 'var(--env-purple)',
  'Live Support': 'var(--env-red)', 'Shared Services': 'var(--env-teal)',
  'Proof of Concept': 'var(--env-blue)', 'Continuous Integration': 'var(--env-yellow)'
};

export function renderServers(servers, unmatched) {
  setAllServers(servers);

  const active = servers.filter(s => s.isActive).length;
  const inactive = servers.length - active;
  const envCounts = {};
  servers.forEach(s => { envCounts[s.environment || 'Unknown'] = (envCounts[s.environment || 'Unknown'] || 0) + 1; });

  // Sort environments by count descending
  const sorted = Object.entries(envCounts).sort((a, b) => b[1] - a[1]);
  const maxCount = sorted.length ? sorted[0][1] : 1;

  document.getElementById('serverSummaryCard').className = 'card dash-status-card overflow-hidden status-healthy';
  document.getElementById('serverSummaryCard').innerHTML = `
    <h3>Server Inventory</h3>
    <div class="dash-status-value">${servers.length}</div>
    <div class="sub" style="margin-top:0.5rem">${active} active \u00B7 ${inactive} inactive</div>`;

  document.getElementById('serverEnvBars').innerHTML = sorted.map(([env, count]) => {
    const pct = Math.max((count / maxCount) * 100, 4);
    const activeCount = servers.filter(s => s.environment === env && s.isActive).length;
    const color = ENV_COLORS[env] || 'var(--env-blue)';
    return `<div class="env-bar-row clickable" tabindex="0" role="button" data-filter="${esc(env)}">
      <span class="env-bar-label">${esc(env)}</span>
      <div class="env-bar-track">
        <div class="env-bar-fill" style="width:${pct.toFixed(1)}%;background:${color}"></div>
      </div>
      <span class="env-bar-count">${count}</span>
      <span class="env-bar-active">${activeCount} active</span>
    </div>`;
  }).join('');

  // Wire click-to-filter on bar rows
  const container = document.getElementById('serverEnvBars');
  let selectedFilter = null;
  container.querySelectorAll('.env-bar-row').forEach(row => {
    const handler = () => {
      const filter = row.dataset.filter;
      if (selectedFilter === filter) {
        selectedFilter = null;
        container.querySelectorAll('.env-bar-row').forEach(r => r.classList.remove('env-bar-selected'));
      } else {
        selectedFilter = filter;
        container.querySelectorAll('.env-bar-row').forEach(r => r.classList.remove('env-bar-selected'));
        row.classList.add('env-bar-selected');
      }
      document.getElementById('envFilter').value = selectedFilter || '';
      filterServers();
    };
    row.addEventListener('click', handler);
    row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); } });
  });

  renderServerTable(servers);
  allUnmatched = unmatched;
  renderUnmatchedTable(unmatched);
}

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
    if (prev) prev.onclick = () => { unmatchedPage--; renderUnmatchedTable(_filteredUnmatched); };
    if (next) next.onclick = () => { unmatchedPage++; renderUnmatchedTable(_filteredUnmatched); };
  } else if (pag) {
    pag.remove();
  }
}

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
    <td>${badge(s.environment || 'Unknown', s.environment === 'Prod' || s.environment === 'Live Support' ? 'red' : s.environment === 'Staging' ? 'yellow' : 'blue')}</td>
    <td>${esc(s.applicationName) || '\u2014'}</td>
    <td>${s.patchGroup ? badge(s.patchGroup, 'muted') : '\u2014'}</td>
    <td>${s.isActive ? dot('green') + 'Yes' : dot('red') + 'No'}</td>
  </tr>`).join('');

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
    if (prev) prev.onclick = () => { serverPage--; renderServerTable(_filteredServers); };
    if (next) next.onclick = () => { serverPage++; renderServerTable(_filteredServers); };
  } else if (pag) {
    pag.remove();
  }
}

export function filterServers() {
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
