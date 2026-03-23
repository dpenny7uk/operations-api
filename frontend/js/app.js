import { DEMO } from './demo.js';
import { api, usingDemo, apiError, setUsingDemo, setApiError } from './api.js';
import { renderHealth } from './renderHealth.js';
import { renderServers, filterServers } from './renderServers.js';
import { renderPatching, resetCycleServerCache } from './renderPatching.js';
import { renderCerts, filterCerts } from './renderCerts.js';
import { renderEol, filterEol, resetEolDetailCache } from './renderEol.js';
import { debounce, exportCsv } from './utils.js';
import { allServers, allCerts, allEol } from './api.js';

// --- Navigation ---
document.querySelectorAll('header nav button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('header nav button').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.page).classList.add('active');
  });
});

// --- Load all data ---
const refreshBtn = document.getElementById('refreshBtn');
const lastUpdatedEl = document.getElementById('lastUpdated');

let _loadInFlight = false;
async function loadAllData() {
  if (_loadInFlight) return;
  _loadInFlight = true;
  refreshBtn.classList.add('is-loading');
  refreshBtn.textContent = 'Loading\u2026';
  try { await _loadAllDataInner(); } finally {
    _loadInFlight = false;
    refreshBtn.classList.remove('is-loading');
    refreshBtn.textContent = 'Refresh';
  }
}
async function _loadAllDataInner() {
  setApiError(null);
  setUsingDemo(false);
  const [healthData, serverData, serverSummary, unmatched, next, cycles, issues, certSummary, certs, eolSummary, eolItems] =
    await Promise.all([
      api('/health'),
      api('/servers?limit=50&offset=0'),
      api('/servers/summary'),
      api('/servers/unmatched'),
      api('/patching/next'),
      api('/patching/cycles'),
      api('/patching/issues'),
      api('/certificates/summary'),
      api('/certificates?limit=200'),
      api('/eol/summary'),
      api('/eol?limit=200&hasServers=true'),
    ]);

  if (!healthData) setUsingDemo(true);

  const servers = serverData ? serverData.items : null;
  const serverTotalCount = serverData ? serverData.totalCount : 0;
  // Keep allServers populated for unmatched server name lookups
  if (servers) setAllServers(servers);

  // Hide initial page loader on first render
  const loader = document.getElementById('pageLoader');
  if (loader) loader.remove();

  renderHealth(healthData || DEMO.health, serverSummary || DEMO.serverSummary, unmatched || DEMO.unmatched, certSummary || DEMO.certSummary, certs || DEMO.certificates, next || DEMO.nextPatch);
  renderServers(serverSummary || DEMO.serverSummary, servers || DEMO.servers, serverTotalCount || DEMO.servers.length, unmatched || DEMO.unmatched);
  resetCycleServerCache();
  resetEolDetailCache();
  renderPatching(next || DEMO.nextPatch, cycles || DEMO.cycles, issues || DEMO.issues);
  renderCerts(certSummary || DEMO.certSummary, certs || DEMO.certificates);
  renderEol(eolSummary || DEMO.eolSummary, eolItems || DEMO.eolSoftware);

  // Show/hide demo banner
  const demoBanner = document.getElementById('demoBanner');
  if (demoBanner) demoBanner.style.display = usingDemo ? '' : 'none';

  if (apiError) {
    lastUpdatedEl.textContent = apiError;
    lastUpdatedEl.classList.add('color-red');
  } else if (usingDemo) {
    lastUpdatedEl.textContent = 'Demo Mode \u2014 API not connected';
    lastUpdatedEl.classList.add('color-red');
  } else {
    lastUpdatedEl.classList.remove('color-red');
  }
}

// --- Wire up event handlers ---
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
refreshBtn.addEventListener('click', loadAllData);
document.getElementById('serverSearch').addEventListener('input', debounce(filterServers));
document.getElementById('envFilter').addEventListener('change', filterServers);
document.getElementById('alertFilter').addEventListener('change', filterCerts);
document.getElementById('certServerSearch').addEventListener('input', debounce(filterCerts));
document.getElementById('eolAlertFilter').addEventListener('change', filterEol);
document.getElementById('eolProductSearch').addEventListener('input', debounce(filterEol));
document.getElementById('eolShowAll').addEventListener('change', filterEol);

// --- CSV export ---
document.getElementById('exportServersBtn').addEventListener('click', async () => {
  const btn = document.getElementById('exportServersBtn');
  btn.disabled = true;
  btn.textContent = 'Exporting\u2026';
  const data = await api('/servers?limit=10000&offset=0');
  const list = data ? data.items : allServers;
  const rows = list.map(s => [s.serverName, s.fqdn, s.environment, s.applicationName, s.patchGroup, s.isActive ? 'Yes' : 'No']);
  exportCsv('servers.csv', ['Name', 'FQDN', 'Environment', 'Application', 'Patch Group', 'Active'], rows);
  btn.disabled = false;
  btn.textContent = 'Export CSV';
});
document.getElementById('exportCertsBtn').addEventListener('click', () => {
  const rows = allCerts.map(c => [c.subjectCn, c.serverName, c.validTo, c.daysUntilExpiry, c.alertLevel]);
  exportCsv('certificates.csv', ['Certificate Name', 'Server', 'Expires', 'Days Left', 'Alert Level'], rows);
});
document.getElementById('exportEolBtn').addEventListener('click', () => {
  const rows = allEol.map(e => [e.product, e.version, e.endOfLife, e.endOfExtendedSupport, e.alertLevel, e.affectedAssets]);
  exportCsv('eol-software.csv', ['Product', 'Version', 'End of Life', 'Extended Support', 'Status', 'Servers'], rows);
});

// --- Theme toggle ---
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const btn = document.getElementById('themeToggle');
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
