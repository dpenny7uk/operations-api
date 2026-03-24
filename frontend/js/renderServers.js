import { esc, num, badge, dot, fmtDate } from './utils.js';
import { allServers, setAllServers, api, apiPost, usingDemo } from './api.js';

const SERVER_PAGE_SIZE = 50;
let unmatchedPage = 0;
let allUnmatched = [];
let _filteredUnmatched = [];
let serverOffset = 0;
let serverTotalCount = 0;
let _currentFilters = { environment: '', search: '' };

const ENV_COLORS = {
  Production: 'var(--env-red)', Development: 'var(--env-blue)', UAT: 'var(--env-orange)',
  Staging: 'var(--env-yellow)', Systest: 'var(--env-teal)', 'Live Support': 'var(--env-pink)',
  'Shared Services': 'var(--env-lime)', Training: 'var(--env-purple)',
  'Proof of Concept': 'var(--env-cyan)', 'Continuous Integration': 'var(--env-indigo)',
  Unknown: 'var(--env-gray)'
};

const ENV_BADGE_COLORS = {
  Production: 'red', Development: 'blue', UAT: 'orange', Staging: 'yellow',
  Systest: 'teal', 'Live Support': 'pink', 'Shared Services': 'lime',
  Training: 'purple', 'Proof of Concept': 'cyan', 'Continuous Integration': 'indigo',
  Unknown: 'muted'
};

function envBadge(env) {
  const label = env || 'Unknown';
  const color = ENV_BADGE_COLORS[label] || 'muted';
  return badge(label, color);
}

export function renderServers(summary, servers, totalCount, unmatched) {
  serverTotalCount = totalCount;
  serverOffset = 0;

  const total = summary.totalCount || 0;
  const active = summary.activeCount || 0;
  const inactive = total - active;
  const envCounts = summary.environmentCounts || {};

  // Sort environments by total count descending
  const sorted = Object.entries(envCounts).sort((a, b) => b[1].total - a[1].total);
  const maxCount = sorted.length ? sorted[0][1].total : 1;

  document.getElementById('serverSummaryCard').className = 'card dash-status-card overflow-hidden status-healthy';
  document.getElementById('serverSummaryCard').innerHTML = `
    <h3>Server Inventory</h3>
    <div class="dash-status-value">${active}</div>
    <div class="sub" style="margin-top:0.5rem">active servers</div>`;

  document.getElementById('serverEnvBars').innerHTML = sorted.map(([env, counts]) => {
    const pct = Math.max((counts.total / maxCount) * 100, 4);
    const color = ENV_COLORS[env] || 'var(--env-blue)';
    return `<div class="env-bar-row clickable" tabindex="0" role="button" data-filter="${esc(env)}">
      <span class="env-bar-label">${esc(env)}</span>
      <div class="env-bar-track">
        <div class="env-bar-fill" style="width:${pct.toFixed(1)}%;background:${color}"></div>
      </div>
      <span class="env-bar-count">${counts.total}</span>
      <span class="env-bar-active">${counts.active} active</span>
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

  renderServerTable(servers, serverTotalCount);
  allUnmatched = unmatched;
  renderUnmatchedTable(unmatched);
}

function renderUnmatchedTable(items) {
  _filteredUnmatched = items;
  const total = items.length;
  const totalPages = Math.ceil(total / 20);
  const start = unmatchedPage * 20;
  const page = items.slice(start, start + 20);

  // Ensure shared datalist exists (populated dynamically on input)
  if (!document.getElementById('serverNameList')) {
    const dl = document.createElement('datalist');
    dl.id = 'serverNameList';
    document.body.appendChild(dl);
  }

  document.getElementById('unmatchedTable').innerHTML = page.map((u, i) => {
    const rowId = `unmatched-${start + i}`;
    return `<tr id="${rowId}">
    <td><code>${esc(u.serverNameRaw)}</code></td>
    <td>${badge(u.sourceSystem, 'blue')}</td>
    <td>${num(u.occurrenceCount)}</td>
    <td>${fmtDate(u.firstSeenAt)}</td>
    <td>${u.closestMatch ? `<span class="color-green">${esc(u.closestMatch)}</span>` : '<span class="color-muted">None</span>'}</td>
    <td class="unmatched-actions">
      ${u.closestMatch
        ? `<button class="btn-sm btn-green" data-action="link" data-raw="${esc(u.serverNameRaw)}" data-match="${esc(u.closestMatch)}">Link</button>`
        : `<button class="btn-sm btn-green" disabled title="No closest match found \u2014 use manual input">Link</button>`}
      <button class="btn-sm btn-muted" data-action="ignore" data-raw="${esc(u.serverNameRaw)}">Ignore</button>
      <div class="unmatched-manual">
        <input type="text" list="serverNameList" placeholder="Search server\u2026" class="input-sm" maxlength="255">
        <button class="btn-sm btn-blue" data-action="manual" data-raw="${esc(u.serverNameRaw)}">Link</button>
      </div>
    </td>
  </tr>`;
  }).join('');

  // Wire action buttons
  document.getElementById('unmatchedTable').querySelectorAll('button[data-action]').forEach(btn => {
    btn.addEventListener('click', () => handleUnmatchedAction(btn));
  });

  // Wire dynamic datalist filtering (max 20 suggestions)
  document.getElementById('unmatchedTable').querySelectorAll('.unmatched-manual input').forEach(input => {
    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      const dl = document.getElementById('serverNameList');
      if (q.length < 2) { dl.innerHTML = ''; return; }
      const matches = allServers.filter(s => s.serverName.toLowerCase().includes(q)).slice(0, 20);
      dl.innerHTML = matches.map(s => `<option value="${esc(s.serverName)}">`).join('');
    });
  });

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

async function handleUnmatchedAction(btn) {
  const action = btn.dataset.action;
  const raw = btn.dataset.raw;
  const row = btn.closest('tr');

  if (action === 'ignore') {
    if (!confirm(`Ignore "${raw}"? This server will be skipped on future syncs.`)) return;
    btn.disabled = true;
    btn.textContent = '\u2026';
    if (usingDemo) {
      removeUnmatchedRow(raw, row);
      return;
    }
    const res = await apiPost(`/servers/unmatched/${encodeURIComponent(raw)}/ignore`);
    if (res.ok) {
      removeUnmatchedRow(raw, row);
    } else {
      btn.disabled = false;
      btn.textContent = 'Ignore';
      showRowError(row, res.error);
    }
    return;
  }

  // Link (suggested match or manual input)
  let serverName;
  if (action === 'link') {
    serverName = btn.dataset.match;
  } else {
    const input = row.querySelector('input[type="text"]');
    serverName = (input?.value || '').trim();
  }

  if (!serverName) {
    showRowError(row, 'Enter a server name');
    return;
  }

  const server = allServers.find(s => s.serverName === serverName);
  if (!server) {
    showRowError(row, 'Server not found in inventory');
    return;
  }

  if (!confirm(`Link "${raw}" → "${serverName}"? This creates a permanent alias.`)) return;
  btn.disabled = true;
  btn.textContent = '\u2026';
  if (usingDemo) {
    removeUnmatchedRow(raw, row);
    return;
  }
  const res = await apiPost(`/servers/unmatched/${encodeURIComponent(raw)}/resolve`, { serverId: server.serverId });
  if (res.ok) {
    removeUnmatchedRow(raw, row);
  } else {
    btn.disabled = false;
    btn.textContent = 'Link';
    showRowError(row, res.error);
  }
}

function removeUnmatchedRow(raw, row) {
  allUnmatched = allUnmatched.filter(u => u.serverNameRaw !== raw);
  _filteredUnmatched = _filteredUnmatched.filter(u => u.serverNameRaw !== raw);
  row.remove();
  // Re-render if page is now empty but more pages exist
  if (document.getElementById('unmatchedTable').children.length === 0 && allUnmatched.length > 0) {
    unmatchedPage = Math.max(0, unmatchedPage - 1);
    renderUnmatchedTable(_filteredUnmatched);
  }
}

function showRowError(row, msg) {
  let err = row.querySelector('.row-error');
  if (!err) {
    err = document.createElement('span');
    err.className = 'row-error color-red';
    err.style.marginLeft = '0.5rem';
    row.querySelector('.unmatched-actions')?.appendChild(err);
  }
  err.textContent = msg;
  setTimeout(() => err?.remove(), 4000);
}

function renderServerTable(servers, totalCount) {
  const total = totalCount;
  const totalPages = Math.ceil(total / SERVER_PAGE_SIZE);
  const currentPage = Math.floor(serverOffset / SERVER_PAGE_SIZE);
  const showFrom = total === 0 ? 0 : serverOffset + 1;
  const showTo = Math.min(serverOffset + SERVER_PAGE_SIZE, total);

  const indicator = document.getElementById('serverCountIndicator');
  if (indicator) indicator.textContent = `Showing ${showFrom}\u2013${showTo} of ${total} servers`;

  document.getElementById('serverTable').innerHTML = servers.map(s => `<tr>
    <td><strong>${esc(s.serverName)}</strong></td>
    <td class="color-muted">${esc(s.fqdn) || '\u2014'}</td>
    <td>${envBadge(s.environment)}</td>
    <td>${esc(s.applicationName) || '\u2014'}</td>
    <td>${s.patchGroup ? badge(s.patchGroup, 'muted') : '\u2014'}</td>
    <td>${s.isActive ? dot('green') + 'Yes' : dot('red') + 'No'}</td>
  </tr>`).join('');

  const tableCard = document.getElementById('serverTable').closest('.card');
  let pag = tableCard.querySelector('.pagination');
  if (totalPages > 1) {
    if (!pag) { pag = document.createElement('div'); pag.className = 'pagination flex-between'; tableCard.appendChild(pag); }
    pag.innerHTML = `
      <span>Page ${currentPage + 1} of ${totalPages}</span>
      <div class="page-btns flex">
        <button ${currentPage === 0 ? 'disabled' : ''} id="serverPrev">\u2190 Prev</button>
        <button ${currentPage >= totalPages - 1 ? 'disabled' : ''} id="serverNext">Next \u2192</button>
      </div>`;
    const prev = pag.querySelector('#serverPrev');
    const next = pag.querySelector('#serverNext');
    if (prev) prev.onclick = () => { serverOffset -= SERVER_PAGE_SIZE; fetchAndRenderServerPage(); };
    if (next) next.onclick = () => { serverOffset += SERVER_PAGE_SIZE; fetchAndRenderServerPage(); };
  } else if (pag) {
    pag.remove();
  }
}

async function fetchAndRenderServerPage() {
  const env = _currentFilters.environment;
  const search = _currentFilters.search;
  let path = `/servers?limit=${SERVER_PAGE_SIZE}&offset=${serverOffset}`;
  if (env) path += `&environment=${encodeURIComponent(env)}`;
  if (search) path += `&search=${encodeURIComponent(search)}`;

  const data = await api(path);
  if (data) {
    serverTotalCount = data.totalCount;
    setAllServers([...allServers, ...data.items.filter(s => !allServers.some(a => a.serverId === s.serverId))]);
    renderServerTable(data.items, data.totalCount);
  }
}

export async function filterServers() {
  serverOffset = 0;
  _currentFilters.search = document.getElementById('serverSearch').value.trim();
  _currentFilters.environment = document.getElementById('envFilter').value;

  if (usingDemo) {
    // Client-side filtering for demo mode
    const { DEMO } = await import('./demo.js');
    const servers = DEMO.servers;
    const search = _currentFilters.search.toLowerCase();
    const env = _currentFilters.environment;
    const filtered = servers.filter(s => {
      if (env && s.environment !== env) return false;
      if (search && !(s.serverName||'').toLowerCase().includes(search) && !(s.fqdn||'').toLowerCase().includes(search)) return false;
      return true;
    });
    renderServerTable(filtered, filtered.length);
    return;
  }

  await fetchAndRenderServerPage();
}
