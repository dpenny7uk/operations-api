import { esc, num, fmtDate, alertBadge } from './utils.js';
import { allCerts, setAllCerts, setActiveCertFilter } from './api.js';
import { renderTimeline, wireCriticalCardFilters, syncCriticalCardSelection } from './components.js';

const CERT_PAGE_SIZE = 20;
let certPage = 0;
let _filteredCerts = [];
let certSortCol = 'daysUntilExpiry';
let certSortAsc = true;

export function renderCerts(summary, certs) {
  setAllCerts(certs);
  setActiveCertFilter(null);

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
  const expiredCount = num(summary.expiredCount);
  document.getElementById('certCards').innerHTML = `
    <div class="critical-card critical-red clickable" tabindex="0" role="button" data-filter="critical">
      <div class="critical-num">${num(summary.criticalCount)}</div>
      <div class="critical-label">Critical</div>
      <div class="critical-delta">Expiring soon</div>
    </div>
    <div class="critical-card critical-orange clickable" tabindex="0" role="button" data-filter="warning">
      <div class="critical-num">${num(summary.warningCount)}</div>
      <div class="critical-label">Warning</div>
      <div class="critical-delta">Needs attention</div>
    </div>
    <div class="critical-card critical-green clickable" tabindex="0" role="button" data-filter="ok">
      <div class="critical-num">${num(summary.okCount)}</div>
      <div class="critical-label">OK</div>
      <div class="critical-delta">Valid</div>
    </div>
    ${expiredCount > 0 ? `<div class="critical-card critical-muted clickable" tabindex="0" role="button" data-filter="expired">
      <div class="critical-num">${expiredCount}</div>
      <div class="critical-label">Expired</div>
      <div class="critical-delta">Past expiry date</div>
    </div>` : ''}`;

  const total = summary.totalCount || 1;
  const timelineSegments = [
    { pct: summary.criticalCount / total * 100, color: 'var(--red)', label: `Critical: ${summary.criticalCount}` },
    { pct: summary.warningCount / total * 100, color: 'var(--orange)', label: `Warning: ${summary.warningCount}` },
    { pct: summary.okCount / total * 100, color: 'var(--green)', label: `OK: ${summary.okCount}` },
  ];
  if (expiredCount > 0) timelineSegments.push({ pct: expiredCount / total * 100, color: 'var(--text-muted)', label: `Expired: ${expiredCount}` });
  renderTimeline('certTimeline', timelineSegments);

  wireCriticalCardFilters('certCards', (filter) => {
    setActiveCertFilter(filter);
    document.getElementById('alertFilter').value = filter || '';
    filterCerts();
  });

  renderCertTable(certs);
}

function sortIcon(col) {
  if (certSortCol !== col) return ' \u2195';
  return certSortAsc ? ' \u2191' : ' \u2193';
}

function renderCertTable(certs) {
  _filteredCerts = certs;

  // Sort
  const sorted = [...certs].sort((a, b) => {
    let av, bv;
    if (certSortCol === 'daysUntilExpiry') {
      av = a.daysUntilExpiry ?? Infinity;
      bv = b.daysUntilExpiry ?? Infinity;
    } else {
      av = a.validTo ? new Date(a.validTo).getTime() : Infinity;
      bv = b.validTo ? new Date(b.validTo).getTime() : Infinity;
    }
    return certSortAsc ? av - bv : bv - av;
  });

  const total = sorted.length;
  const totalPages = Math.ceil(total / CERT_PAGE_SIZE);
  const start = certPage * CERT_PAGE_SIZE;
  const page = sorted.slice(start, start + CERT_PAGE_SIZE);
  const showFrom = total === 0 ? 0 : start + 1;
  const showTo = Math.min(start + CERT_PAGE_SIZE, total);

  const indicator = document.getElementById('certCountIndicator');
  if (indicator) indicator.textContent = `Showing ${showFrom}\u2013${showTo} of ${total} certificates`;

  // Update sortable headers
  const thead = document.getElementById('certTable').closest('table').querySelector('thead');
  thead.innerHTML = `<tr>
    <th>Certificate Name</th><th>Server</th>
    <th class="sortable" data-sort="validTo">Expires${sortIcon('validTo')}</th>
    <th class="sortable" data-sort="daysUntilExpiry" title="Red = 14 days or less, Orange = 30 days or less">Days Left${sortIcon('daysUntilExpiry')}</th>
    <th>Alert Level</th>
  </tr>`;
  thead.querySelectorAll('.sortable').forEach(th => {
    th.style.cursor = 'pointer';
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (certSortCol === col) { certSortAsc = !certSortAsc; }
      else { certSortCol = col; certSortAsc = true; }
      certPage = 0;
      renderCertTable(_filteredCerts);
    });
  });

  document.getElementById('certTable').innerHTML = page.map(c => {
    const days = c.daysUntilExpiry != null ? num(c.daysUntilExpiry) : null;
    const daysClass = days != null && days <= 14 ? 'color-red'
                    : days != null && days <= 30 ? 'color-orange' : '';
    const displayLevel = c.isExpired ? 'Expired' : c.alertLevel;
    return `<tr>
    <td><strong>${esc(c.subjectCn)}</strong></td>
    <td>${esc(c.serverName)}</td>
    <td>${fmtDate(c.validTo)}</td>
    <td class="${daysClass}"><strong>${days != null ? days + 'd' : '\u2014'}</strong></td>
    <td>${alertBadge(displayLevel)}</td>
  </tr>`;
  }).join('');

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
    if (prev) prev.onclick = () => { certPage--; renderCertTable(_filteredCerts); };
    if (next) next.onclick = () => { certPage++; renderCertTable(_filteredCerts); };
  } else if (pag) {
    pag.remove();
  }
}

export function filterCerts() {
  certPage = 0;
  const level = document.getElementById('alertFilter').value;
  const server = document.getElementById('certServerSearch').value.toLowerCase().trim();
  const filtered = allCerts.filter(c => {
    if (level === 'expired') { if (!c.isExpired) return false; }
    else if (level) { if ((c.alertLevel || '').toLowerCase() !== level || c.isExpired) return false; }
    if (server && !(c.serverName||'').toLowerCase().includes(server)) return false;
    return true;
  });
  renderCertTable(filtered);
  syncCriticalCardSelection('certCards', level);
}
