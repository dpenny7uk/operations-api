import { esc, num, badge, dot, fmtDate, statusBadge, severityBadge } from './utils.js';
import { api, usingDemo } from './api.js';
import { DEMO } from './demo.js';

const CYCLE_PAGE_SIZE = 20;
export let cycleServerCache = {};
const cycleServerCacheTime = {};
const cycleSearchTerms = {};
const CYCLE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
let debounceTimers = {};
export function resetCycleServerCache() { cycleServerCache = {}; }

export function renderPatching(next, cycles, issues) {
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
            <div class="value">${num(next.daysUntil)} day${next.daysUntil !== 1 ? 's' : ''}</div>
            <div class="sub">${fmtDate(next.cycle.cycleDate)} \u00B7 ${num(next.cycle.serverCount)} servers</div>
          </div>
          <div class="patch-banner-details">
            <div class="patch-banner-col">
              <h3>Servers by Group</h3>
              ${Object.entries(next.serversByGroup).map(([g,c])=>`<div class="patch-detail-row">${esc(g)}: <strong>${esc(String(c))}</strong></div>`).join('')}
            </div>
            <div class="patch-banner-col">
              <h3>Issues by Severity</h3>
              ${Object.keys(next.issuesBySeverity).length > 0
                ? Object.entries(next.issuesBySeverity).map(([s,c])=>`<div class="patch-detail-row">${severityBadge(s)} <strong>${esc(String(c))}</strong></div>`).join('')
                : '<div class="color-green">\u2705 No known issues</div>'}
            </div>
          </div>
        </div>
      </div>`;
  }

  // Wire up global search
  const globalSearchInput = document.getElementById('patchingGlobalSearch');
  if (globalSearchInput) {
    globalSearchInput.oninput = () => {
      clearTimeout(debounceTimers.__global);
      debounceTimers.__global = setTimeout(() => {
        const q = globalSearchInput.value.trim();
        if (q.length >= 2) {
          runGlobalSearch(q);
        } else if (q.length === 0) {
          // Restore normal cycle view
          const tbody = document.getElementById('cycleTable');
          tbody.innerHTML = '';
          cycles.forEach(c => appendCycleRow(tbody, c));
        }
      }, 400);
    };
  }

  const tbody = document.getElementById('cycleTable');
  tbody.innerHTML = '';
  cycles.forEach(c => appendCycleRow(tbody, c));

  document.getElementById('issueTable').innerHTML = issues.map(i => `<tr>
    <td><strong>${esc(i.title)}</strong></td>
    <td>${severityBadge(i.severity)}</td>
    <td>${i.application ? esc(i.application) : '<span class="color-muted">All</span>'}</td>
    <td>${i.appliesToWindows ? dot('green') : dot('red')}</td>
    <td>${i.appliesToSql ? dot('green') : dot('red')}</td>
    <td class="color-muted issue-fix">${esc(i.fix) || '\u2014'}</td>
  </tr>`).join('');
}

function appendCycleRow(tbody, c) {
  const row = document.createElement('tr');
  row.className = 'cycle-row';
  row.tabIndex = 0;
  row.setAttribute('role', 'button');
  row.setAttribute('aria-expanded', 'false');
  row.innerHTML = `
    <td><strong>${fmtDate(c.cycleDate)}</strong></td>
    <td>${num(c.serverCount)}</td>
    <td>${statusBadge(c.displayStatus || c.status)}</td>`;

  const detailRow = document.createElement('tr');
  detailRow.className = 'cycle-detail';
  detailRow.innerHTML = `<td colspan="3"><div class="cycle-detail-inner" id="cycleDetail-${parseInt(c.cycleId)}"></div></td>`;

  const toggle = () => toggleCycleDetail(c.cycleId, row, detailRow);
  row.addEventListener('click', toggle);
  row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  tbody.appendChild(row);
  tbody.appendChild(detailRow);
}

async function toggleCycleDetail(cycleId, row, detailRow) {
  const isOpen = detailRow.classList.contains('visible');
  document.querySelectorAll('.cycle-detail.visible').forEach(d => d.classList.remove('visible'));
  document.querySelectorAll('.cycle-row.expanded').forEach(r => { r.classList.remove('expanded'); r.setAttribute('aria-expanded', 'false'); });

  if (isOpen) return;

  row.classList.add('expanded');
  row.setAttribute('aria-expanded', 'true');
  detailRow.classList.add('visible');

  const cacheValid = cycleServerCache[cycleId] && (Date.now() - (cycleServerCacheTime[cycleId] || 0)) < CYCLE_CACHE_TTL_MS;
  if (!cacheValid) {
    await loadCycleServersPage(cycleId, 0);
  } else {
    renderCycleServers(cycleId);
  }

  const detail = document.getElementById(`cycleDetail-${parseInt(cycleId)}`);
  if (detail) { detail.tabIndex = -1; detail.focus(); }
}

async function loadCycleServersPage(cycleId, offset, search) {
  if (search !== undefined) cycleSearchTerms[cycleId] = search;
  const currentSearch = cycleSearchTerms[cycleId] || '';
  const container = document.getElementById(`cycleDetail-${cycleId}`);
  container.innerHTML = '<div class="loading-state flex-center gap-sm"><span class="loading"></span> Loading servers\u2026</div>';

  const searchParam = currentSearch ? `&search=${encodeURIComponent(currentSearch)}` : '';
  const data = await api(`/patching/cycles/${cycleId}/servers?limit=${CYCLE_PAGE_SIZE}&offset=${offset}${searchParam}`);
  if (data) {
    cycleServerCache[cycleId] = data;
  } else if (!usingDemo && currentSearch) {
    cycleServerCache[cycleId] = { items: [], totalCount: 0, limit: CYCLE_PAGE_SIZE, offset: 0, error: true };
  } else if (usingDemo) {
    const demo = DEMO.cycleServers[cycleId] || { items: [], totalCount: 0, limit: CYCLE_PAGE_SIZE, offset: 0 };
    // Simulate server-side pagination over the full demo item list
    const allItems = DEMO.cycleServers[cycleId]?.items || demo.items;
    const fullCount = DEMO.cycleServers[cycleId]?.totalCount ?? allItems.length;
    cycleServerCache[cycleId] = { items: allItems.slice(offset, offset + CYCLE_PAGE_SIZE), totalCount: fullCount, limit: CYCLE_PAGE_SIZE, offset };
  } else {
    cycleServerCache[cycleId] = { items: [], totalCount: 0, limit: CYCLE_PAGE_SIZE, offset: 0 };
  }
  cycleServerCacheTime[cycleId] = Date.now();

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

  const currentSearch = cycleSearchTerms[cycleId] || '';
  container.innerHTML = `
    <div class="cycle-search">
      <input type="text" placeholder="Search servers, service, function, group" class="cycle-search-input" data-cycle="${parseInt(cycleId)}" value="${esc(currentSearch)}">
    </div>
    ${page.error
      ? '<div class="empty-state color-red">Search failed \u2014 check API connection</div>'
      : servers.length === 0
      ? '<div class="empty-state">No servers found</div>'
      : `<div class="cycle-scroll-wrap"><table>
          <thead><tr>
            <th>Server</th><th>Patch Group</th><th>Scheduled</th><th>Service</th><th>Function</th><th>Issues</th>
          </tr></thead>
          <tbody>${servers.map(s => `<tr>
            <td><strong>${esc(s.serverName)}</strong></td>
            <td>${s.patchGroup ? badge(s.patchGroup, 'muted') : '\u2014'}</td>
            <td class="color-muted">${esc(s.scheduledTime) || '\u2014'}</td>
            <td>${esc(s.service) || '\u2014'}</td>
            <td>${esc(s.application) || '\u2014'}</td>
            <td>${s.hasKnownIssue
              ? `<span class="color-orange">${dot('orange')}${num(s.issueCount)} issue${num(s.issueCount) !== 1 ? 's' : ''}</span>`
              : `<span class="color-green">${dot('green')}None</span>`}</td>
          </tr>`).join('')}</tbody>
        </table></div>`
    }
    ${paginationHtml}`;

  container.querySelectorAll('.page-prev, .page-next').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      loadCycleServersPage(parseInt(btn.dataset.cycle), parseInt(btn.dataset.offset));
    };
  });

  const searchInput = container.querySelector('.cycle-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      e.stopPropagation();
      const cid = parseInt(searchInput.dataset.cycle);
      clearTimeout(debounceTimers[cid]);
      debounceTimers[cid] = setTimeout(() => {
        loadCycleServersPage(cid, 0, searchInput.value.trim());
      }, 300);
    });
  }
}

async function runGlobalSearch(query) {
  const tbody = document.getElementById('cycleTable');
  tbody.innerHTML = '<tr><td colspan="3"><div class="loading-state flex-center gap-sm"><span class="loading"></span> Searching\u2026</div></td></tr>';

  const results = await api(`/patching/servers/search?q=${encodeURIComponent(query)}&limit=100`);
  if (results === null) {
    tbody.innerHTML = '<tr><td colspan="3"><div class="empty-state color-red">Search failed \u2014 check API connection</div></td></tr>';
    return;
  }
  if (results.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3"><div class="empty-state">No results found</div></td></tr>';
    return;
  }

  tbody.innerHTML = '';
  results.forEach(group => {
    // Cycle header row
    const headerRow = document.createElement('tr');
    headerRow.className = 'cycle-row expanded';
    headerRow.innerHTML = `
      <td><strong>${fmtDate(group.cycleDate)}</strong></td>
      <td>${num(group.totalCount)}</td>
      <td>${statusBadge(group.displayStatus)}</td>`;
    tbody.appendChild(headerRow);

    // Detail row with server results
    const detailRow = document.createElement('tr');
    detailRow.className = 'cycle-detail visible';
    detailRow.innerHTML = `<td colspan="3"><div class="cycle-detail-inner">
      <div class="cycle-scroll-wrap"><table>
        <thead><tr>
          <th>Server</th><th>Patch Group</th><th>Scheduled</th><th>Service</th><th>Function</th><th>Issues</th>
        </tr></thead>
        <tbody>${group.servers.map(s => `<tr>
          <td><strong>${esc(s.serverName)}</strong></td>
          <td>${s.patchGroup ? badge(s.patchGroup, 'muted') : '\u2014'}</td>
          <td class="color-muted">${esc(s.scheduledTime) || '\u2014'}</td>
          <td>${esc(s.service) || '\u2014'}</td>
          <td>${esc(s.application) || '\u2014'}</td>
          <td>${s.hasKnownIssue
            ? `<span class="color-orange">${dot('orange')}${num(s.issueCount)} issue${num(s.issueCount) !== 1 ? 's' : ''}</span>`
            : `<span class="color-green">${dot('green')}None</span>`}</td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div></td>`;
    tbody.appendChild(detailRow);
  });
}
