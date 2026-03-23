import { esc, num, badge, fmtDate } from './utils.js';
import { api, allEol, setAllEol, setActiveEolFilter, usingDemo } from './api.js';
import { wireCriticalCardFilters, syncCriticalCardSelection } from './components.js';
import { DEMO } from './demo.js';

const EOL_PAGE_SIZE = 20;
let eolPage = 0;
let _filteredEol = [];
export let eolDetailCache = {};
const eolDetailCacheTime = {};
const EOL_DETAIL_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
export function resetEolDetailCache() { eolDetailCache = {}; }

function eolBadge(level) {
  const colors = { eol: 'red', extended: 'blue', approaching: 'orange', supported: 'green' };
  const labels = { eol: 'EOL', extended: 'Extended Support', approaching: 'Approaching', supported: 'Supported' };
  return badge(labels[level] || level, colors[level] || 'muted');
}

function renderEolCards(summary) {
  const eolStatus = summary.eolCount > 0 ? 'status-error' : summary.approachingCount > 0 ? 'status-warning' : 'status-healthy';
  const eolLabel = summary.eolCount > 0 ? `${num(summary.affectedServers)} affected servers` : summary.approachingCount > 0 ? 'Approaching deadlines' : 'All supported';
  const eolColor = summary.eolCount > 0 ? 'red' : summary.approachingCount > 0 ? 'orange' : 'green';
  document.getElementById('eolStatusCard').className = `card dash-status-card overflow-hidden ${eolStatus}`;
  document.getElementById('eolStatusCard').innerHTML = `
    <h3>End of Life</h3>
    <div class="dash-status-value">${num(summary.totalCount)}</div>
    <div class="sub color-${eolColor}" style="margin-top:0.5rem">${eolLabel}</div>`;

  document.getElementById('eolCards').innerHTML = `
    <div class="critical-card critical-red clickable" tabindex="0" role="button" data-filter="eol">
      <div class="critical-num">${num(summary.eolCount)}</div>
      <div class="critical-label">End of Life</div>
      <div class="critical-delta">Past all support</div>
    </div>
    <div class="critical-card critical-blue clickable" tabindex="0" role="button" data-filter="extended">
      <div class="critical-num">${num(summary.extendedCount)}</div>
      <div class="critical-label">Extended Support</div>
      <div class="critical-delta">Past EOL, support active</div>
    </div>
    <div class="critical-card critical-orange clickable" tabindex="0" role="button" data-filter="approaching">
      <div class="critical-num">${num(summary.approachingCount)}</div>
      <div class="critical-label">Approaching</div>
      <div class="critical-delta">Within 6 months</div>
    </div>
    <div class="critical-card critical-green clickable" tabindex="0" role="button" data-filter="supported">
      <div class="critical-num">${num(summary.supportedCount)}</div>
      <div class="critical-label">Supported</div>
      <div class="critical-delta">Currently supported</div>
    </div>`;

  wireCriticalCardFilters('eolCards', (filter) => {
    setActiveEolFilter(filter);
    document.getElementById('eolAlertFilter').value = filter || '';
    filterEol();
  });
}

export function renderEol(summary, items) {
  setAllEol(items);
  setActiveEolFilter(null);
  renderEolCards(summary);
  renderEolTable(items);
}

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
    const safeId = key.replace(/[^a-zA-Z0-9]/g, '-');
    const row = document.createElement('tr');
    row.className = 'eol-row';
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    row.setAttribute('aria-expanded', 'false');
    row.innerHTML = `
      <td><strong>${esc(e.product)}</strong></td>
      <td>${esc(e.version)}</td>
      <td>${fmtDate(e.endOfLife)}</td>
      <td>${fmtDate(e.endOfExtendedSupport)}</td>
      <td>${eolBadge(e.alertLevel)}</td>
      <td><strong>${num(e.affectedAssets)}</strong></td>`;

    const detailRow = document.createElement('tr');
    detailRow.className = 'eol-detail';
    detailRow.innerHTML = `<td colspan="6"><div class="eol-detail-inner" id="eolDetail-${safeId}"></div></td>`;

    const toggle = () => toggleEolDetail(key, safeId, e, row, detailRow);
    row.addEventListener('click', toggle);
    row.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggle(); } });
    tbody.appendChild(row);
    tbody.appendChild(detailRow);
  });

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
    if (prev) prev.onclick = () => { eolPage--; renderEolTable(_filteredEol); };
    if (next) next.onclick = () => { eolPage++; renderEolTable(_filteredEol); };
  } else if (pag) {
    pag.remove();
  }
}

async function toggleEolDetail(key, safeId, eolItem, row, detailRow) {
  const isOpen = detailRow.classList.contains('visible');
  document.querySelectorAll('#eolTable .eol-detail.visible').forEach(d => d.classList.remove('visible'));
  document.querySelectorAll('#eolTable .eol-row.expanded').forEach(r => { r.classList.remove('expanded'); r.setAttribute('aria-expanded', 'false'); });

  if (isOpen) return;

  row.classList.add('expanded');
  row.setAttribute('aria-expanded', 'true');
  detailRow.classList.add('visible');

  const container = detailRow.querySelector('.eol-detail-inner');

  if (eolDetailCache[key] && (Date.now() - (eolDetailCacheTime[key] || 0)) < EOL_DETAIL_CACHE_TTL_MS) {
    renderEolDetail(container, eolDetailCache[key]);
    container.tabIndex = -1;
    container.focus();
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
  eolDetailCacheTime[key] = Date.now();

  renderEolDetail(container, eolDetailCache[key]);
  container.tabIndex = -1;
  container.focus();
}

function renderEolDetail(container, detail) {
  const assets = detail.assets || [];
  if (assets.length === 0) {
    container.innerHTML = '<div class="empty-state">No affected servers found</div>';
    return;
  }
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

export async function filterEol() {
  eolPage = 0;
  const level = document.getElementById('eolAlertFilter').value;
  const product = document.getElementById('eolProductSearch').value.trim();
  const showAll = document.getElementById('eolShowAll')?.checked;

  // Build API query with server-side filtering
  const params = new URLSearchParams();
  params.set('limit', '200');
  if (!showAll) params.set('hasServers', 'true');
  if (level) params.set('alertLevel', level);
  if (product) params.set('product', product);

  const [items, summary] = await Promise.all([
    api(`/eol?${params}`),
    api(`/eol/summary${showAll ? '' : '?hasServers=true'}`)
  ]);

  if (items) {
    setAllEol(items);
    renderEolTable(items);
  } else {
    // Fallback: client-side filtering for demo/offline mode
    const filtered = allEol.filter(e => {
      if (level && e.alertLevel !== level) return false;
      if (product && !(e.product||'').toLowerCase().includes(product.toLowerCase())) return false;
      if (!showAll && !e.affectedAssets) return false;
      return true;
    });
    renderEolTable(filtered);
  }
  if (summary) renderEolCards(summary);
  syncCriticalCardSelection('eolCards', level);
}
