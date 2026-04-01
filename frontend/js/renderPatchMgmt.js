import { esc, badge, fmtDate, debounce } from './utils.js';
import { api, apiPost, usingDemo } from './api.js';

const PATCHING_TEAM_EMAIL = 'patching-team@company.com';

let _selectedServerIds = new Set();
let _currentExclusions = [];

const ENV_COLORS = {
  production: 'red', development: 'blue', uat: 'orange', staging: 'yellow',
  systest: 'teal', 'live support': 'pink', 'shared services': 'lime',
  training: 'purple', 'proof of concept': 'cyan', 'continuous integration': 'indigo'
};

function envBadge(env) {
  return badge(env || 'Unknown', ENV_COLORS[(env || '').toLowerCase()] || 'muted');
}

// ── Server search table (top section) ──

export async function filterPatchExclServers() {
  const search = document.getElementById('patchExclSearch').value.trim();
  const env = document.getElementById('patchExclEnvFilter').value;

  let servers, total;

  if (usingDemo) {
    let filtered = _DEMO_SERVERS;
    if (env) filtered = filtered.filter(s => s.environment === env);
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(s =>
        s.serverName.toLowerCase().includes(q) ||
        (s.service || '').toLowerCase().includes(q) ||
        (s.application || '').toLowerCase().includes(q) ||
        (s.patchGroup || '').toLowerCase().includes(q));
    }
    servers = filtered;
    total = filtered.length;
  } else {
    let path = `/patching/exclusions/servers?limit=50&offset=0`;
    if (search) path += `&search=${encodeURIComponent(search)}`;
    const data = await api(path);
    servers = data ? data.items : [];
    total = data ? data.totalCount : 0;
    // Client-side env filter on top of server results
    if (env) servers = servers.filter(s => s.environment === env);
  }

  _renderServerSearchTable(servers);
  document.getElementById('patchExclCountIndicator').textContent =
    `Showing ${servers.length} of ${total}`;
}

function _renderServerSearchTable(servers) {
  const tbody = document.getElementById('patchExclServerTable');
  const selectAll = document.getElementById('patchExclSelectAll');

  if (!servers || servers.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-muted">No servers found. Enter a search term above.</td></tr>';
    selectAll.checked = false;
    selectAll.disabled = true;
    _updateExcludeButton();
    return;
  }

  selectAll.disabled = false;
  selectAll.checked = false;

  tbody.innerHTML = servers.map(s => `
    <tr>
      <td><input type="checkbox" class="excl-cb" data-id="${s.serverId}" data-name="${esc(s.serverName)}" aria-label="Select ${esc(s.serverName)}"></td>
      <td>${esc(s.serverName)}</td>
      <td>${esc(s.patchGroup || '')}</td>
      <td>${esc(s.service || '')}</td>
      <td>${esc(s.application || '')}</td>
      <td>${envBadge(s.environment)}</td>
    </tr>`).join('');

  // Restore checked state for previously selected servers still in view
  tbody.querySelectorAll('.excl-cb').forEach(cb => {
    if (_selectedServerIds.has(Number(cb.dataset.id))) cb.checked = true;
    cb.addEventListener('change', () => {
      const id = Number(cb.dataset.id);
      if (cb.checked) _selectedServerIds.add(id);
      else _selectedServerIds.delete(id);
      _updateExcludeButton();
      _syncSelectAll();
    });
  });

  _syncSelectAll();
  _updateExcludeButton();
}

function _syncSelectAll() {
  const cbs = document.querySelectorAll('#patchExclServerTable .excl-cb');
  const allChecked = cbs.length > 0 && [...cbs].every(c => c.checked);
  document.getElementById('patchExclSelectAll').checked = allChecked;
}

function _updateExcludeButton() {
  const btn = document.getElementById('excludeSelectedBtn');
  const count = _selectedServerIds.size;
  btn.disabled = count === 0;
  btn.textContent = count > 0 ? `Exclude ${count} Server${count !== 1 ? 's' : ''} from Patching` : 'Exclude from Patching';
}

// ── Exclusion form ──

function _showExclusionForm() {
  const form = document.getElementById('exclusionForm');
  form.style.display = '';
  // Default held_until to 30 days from now
  const defaultDate = new Date();
  defaultDate.setDate(defaultDate.getDate() + 30);
  document.getElementById('exclusionHeldUntil').value = defaultDate.toISOString().split('T')[0];
  document.getElementById('exclusionReason').value = '';
  document.getElementById('exclusionReason').focus();
}

function _hideExclusionForm() {
  document.getElementById('exclusionForm').style.display = 'none';
}

async function _confirmExclusion() {
  const reason = document.getElementById('exclusionReason').value.trim();
  const heldUntil = document.getElementById('exclusionHeldUntil').value;

  if (!reason) { alert('Please enter a reason for the exclusion.'); return; }
  if (!heldUntil) { alert('Please select a hold-until date.'); return; }

  const btn = document.getElementById('confirmExcludeBtn');
  btn.disabled = true;
  btn.textContent = 'Excluding\u2026';

  const res = await apiPost('/patching/exclusions', {
    serverIds: [..._selectedServerIds],
    reason,
    heldUntil
  });

  btn.disabled = false;
  btn.textContent = 'Confirm Exclusion';

  if (res.ok) {
    _selectedServerIds.clear();
    _hideExclusionForm();
    _updateExcludeButton();
    // Uncheck all checkboxes
    document.querySelectorAll('#patchExclServerTable .excl-cb').forEach(c => c.checked = false);
    document.getElementById('patchExclSelectAll').checked = false;
    // Refresh excluded list
    await _loadExcludedServers();
  } else {
    alert('Failed to exclude servers: ' + (res.error || 'Unknown error'));
  }
}

// ── Demo exclusion data ──

const _DEMO_EXCLUSIONS = [
  { exclusionId: 1, serverId: 12, serverName: 'SQL-PR-03', patchGroup: '8b', service: 'Database', application: 'Data Warehouse', environment: 'Production', reason: 'Database migration in progress — cannot reboot until data migration completes across all shards', heldUntil: '2026-03-15', excludedBy: 'DOMAIN\\dpenn', excludedAt: '2026-02-10T09:30:00', holdExpired: true },
  { exclusionId: 2, serverId: 45, serverName: 'APP-PR-18', patchGroup: '8a', service: 'Application Services', application: 'Finance Batch', environment: 'Production', reason: 'Running critical month-end batch processing. Will return to patching after April close', heldUntil: '2026-04-05', excludedBy: 'DOMAIN\\jsmith', excludedAt: '2026-03-20T14:15:00', holdExpired: false },
  { exclusionId: 3, serverId: 78, serverName: 'WEB-UT-04', patchGroup: '9a', service: 'Web Services', application: 'Customer Portal', environment: 'UAT', reason: 'UAT regression testing in progress for Release 4.2 — environment must remain stable', heldUntil: '2026-04-12', excludedBy: 'DOMAIN\\dpenn', excludedAt: '2026-03-25T11:00:00', holdExpired: false },
  { exclusionId: 4, serverId: 102, serverName: 'SVC-PR-22', patchGroup: '9b', service: 'Identity & Access', application: 'SSO Platform', environment: 'Production', reason: 'Vendor support case open — patching may interfere with diagnostic data collection', heldUntil: '2026-05-01', excludedBy: 'DOMAIN\\mjones', excludedAt: '2026-03-18T16:45:00', holdExpired: false },
];

const _DEMO_SERVERS = [
  { serverId: 200, serverName: 'WEB-PR-01', patchGroup: '8a', service: 'Web Services', application: 'Customer Portal', environment: 'Production' },
  { serverId: 201, serverName: 'WEB-PR-02', patchGroup: '8a', service: 'Web Services', application: 'Customer Portal', environment: 'Production' },
  { serverId: 202, serverName: 'SQL-PR-05', patchGroup: '8b', service: 'Database', application: 'Data Warehouse', environment: 'Production' },
  { serverId: 203, serverName: 'APP-DV-01', patchGroup: '9a', service: 'Application Services', application: 'API Gateway', environment: 'Development' },
  { serverId: 204, serverName: 'SVC-ST-03', patchGroup: '9b', service: 'Identity & Access', application: 'Identity Service', environment: 'Staging' },
  { serverId: 205, serverName: 'ETL-PR-07', patchGroup: '8b', service: 'Data Engineering', application: 'ETL Pipeline', environment: 'Production' },
  { serverId: 206, serverName: 'MON-SY-02', patchGroup: '9a', service: 'Infrastructure', application: 'Monitoring', environment: 'Systest' },
  { serverId: 207, serverName: 'BATCH-PR-11', patchGroup: '8a', service: 'Batch Processing', application: 'Finance Batch', environment: 'Production' },
  { serverId: 208, serverName: 'SQL-PR-12', patchGroup: '8b', service: 'Database', application: 'Customer Portal', environment: 'Production' },
  { serverId: 209, serverName: 'API-PR-04', patchGroup: '9a', service: 'API Services', application: 'API Gateway', environment: 'Production' },
  { serverId: 210, serverName: 'FILE-PR-02', patchGroup: '9b', service: 'File Services', application: 'File Share', environment: 'Production' },
  { serverId: 211, serverName: 'AUTH-PR-01', patchGroup: '8a', service: 'Identity & Access', application: 'SSO Platform', environment: 'Production' },
  { serverId: 212, serverName: 'MSG-PR-03', patchGroup: '8b', service: 'Messaging', application: 'Message Broker', environment: 'Production' },
  { serverId: 213, serverName: 'RPT-UT-01', patchGroup: '9a', service: 'Reporting', application: 'Reporting Engine', environment: 'UAT' },
  { serverId: 214, serverName: 'CACHE-PR-02', patchGroup: '9b', service: 'Infrastructure', application: 'Cache Layer', environment: 'Production' },
  { serverId: 215, serverName: 'LOG-PR-01', patchGroup: '8a', service: 'Observability', application: 'Log Aggregator', environment: 'Production' },
];

// ── Currently excluded table (bottom section) ──

async function _loadExcludedServers(search) {
  let items, total;

  if (usingDemo) {
    items = _DEMO_EXCLUSIONS;
    if (search) {
      const q = search.toLowerCase();
      items = items.filter(e => e.serverName.toLowerCase().includes(q) || e.reason.toLowerCase().includes(q));
    }
    total = items.length;
  } else {
    let path = '/patching/exclusions?limit=500&offset=0';
    if (search) path += `&search=${encodeURIComponent(search)}`;
    const data = await api(path);
    items = data ? data.items : [];
    total = data ? data.totalCount : 0;
  }

  _currentExclusions = items || [];

  const tbody = document.getElementById('patchExclTable');
  const countEl = document.getElementById('patchExclExcludedCount');
  const emailBtn = document.getElementById('emailExclBtn');
  const copyBtn = document.getElementById('copyExclBtn');

  emailBtn.disabled = _currentExclusions.length === 0;
  copyBtn.disabled = _currentExclusions.length === 0;

  if (_currentExclusions.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="text-muted">No servers currently excluded from patching.</td></tr>';
    countEl.textContent = '';
    return;
  }

  countEl.textContent = `${total} server${total !== 1 ? 's' : ''} excluded`;

  tbody.innerHTML = items.map(e => {
    const expiredBadge = e.holdExpired ? badge('Hold Expired', 'red') : '';
    return `
    <tr>
      <td>${esc(e.serverName)}</td>
      <td>${esc(e.patchGroup || '')}</td>
      <td>${esc(e.service || '')}</td>
      <td>${esc(e.application || '')}</td>
      <td>${envBadge(e.environment)}</td>
      <td>${fmtDate(e.excludedAt)}</td>
      <td>${fmtDate(e.heldUntil)} ${expiredBadge}</td>
      <td class="text-sm">${esc(e.reason)}</td>
      <td class="flex gap-xs">
        <button class="btn-sm btn-muted excl-extend-btn" data-id="${e.exclusionId}" title="Extend hold date">Extend</button>
        <button class="btn-sm btn-red excl-remove-btn" data-id="${e.exclusionId}" data-name="${esc(e.serverName)}" title="Remove from exclusion list">Remove</button>
      </td>
    </tr>`;
  }).join('');

  // Wire extend buttons
  tbody.querySelectorAll('.excl-extend-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const newDate = prompt('Enter new hold-until date (YYYY-MM-DD):');
      if (!newDate) return;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) { alert('Invalid date format. Use YYYY-MM-DD.'); return; }

      btn.disabled = true;
      btn.textContent = '\u2026';
      const res = await apiPost(`/patching/exclusions/${id}/extend`, { heldUntil: newDate });
      if (res.ok) {
        await _loadExcludedServers();
      } else {
        alert('Failed to extend: ' + (res.error || 'Unknown error'));
        btn.disabled = false;
        btn.textContent = 'Extend';
      }
    });
  });

  // Wire remove buttons
  tbody.querySelectorAll('.excl-remove-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const name = btn.dataset.name;
      if (!confirm(`Remove ${name} from the exclusion list? This server will be included in future patching cycles.`)) return;

      btn.disabled = true;
      btn.textContent = '\u2026';
      const res = await apiPost(`/patching/exclusions/${id}/remove`);
      if (res.ok) {
        await _loadExcludedServers();
      } else {
        alert('Failed to remove: ' + (res.error || 'Unknown error'));
        btn.disabled = false;
        btn.textContent = 'Remove';
      }
    });
  });
}

// ── Email & Copy ──

function _emailExclusions() {
  if (_currentExclusions.length === 0) return;
  const count = _currentExclusions.length;
  const subject = `Patch Exclusion Update \u2014 ${count} server${count !== 1 ? 's' : ''} excluded from patching`;
  const serverLines = _currentExclusions.map(e =>
    `  \u2022 ${e.serverName} (${e.patchGroup || '?'}) \u2014 ${e.service || ''}/${e.application || ''} \u2014 ${e.environment || 'Unknown'} \u2014 Held until ${fmtDate(e.heldUntil)} \u2014 ${e.reason}`
  );
  const lines = [
    `Hi Patching Team,`,
    ``,
    `The following ${count} server${count !== 1 ? 's are' : ' is'} currently excluded from the patching cycle:`,
    ``,
    ...serverLines,
    ``,
    `Please ensure these servers are not included in upcoming patching runs until further notice.`,
    ``,
    `Regards`
  ];
  const body = lines.join('\n');
  window.location.href = `mailto:${PATCHING_TEAM_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function _copyExclusions() {
  if (_currentExclusions.length === 0) return;
  const lines = [
    `Server\tPatch Group\tService\tFunction\tEnvironment\tDate Excluded\tHeld Until\tReason`,
    ..._currentExclusions.map(e =>
      `${e.serverName}\t${e.patchGroup || ''}\t${e.service || ''}\t${e.application || ''}\t${e.environment || 'Unknown'}\t${fmtDate(e.excludedAt)}\t${fmtDate(e.heldUntil)}\t${e.reason}`
    )
  ];
  navigator.clipboard.writeText(lines.join('\n')).then(() => {
    const btn = document.getElementById('copyExclBtn');
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy to Clipboard'; }, 2000);
  });
}

// ── Main render + wiring ──

let _wired = false;

export function renderPatchMgmt() {
  _loadExcludedServers();
  filterPatchExclServers();

  if (_wired) return;
  _wired = true;

  // Wire select-all checkbox
  const selectAll = document.getElementById('patchExclSelectAll');
  selectAll.addEventListener('change', () => {
    document.querySelectorAll('#patchExclServerTable .excl-cb').forEach(cb => {
      cb.checked = selectAll.checked;
      const id = Number(cb.dataset.id);
      if (selectAll.checked) _selectedServerIds.add(id);
      else _selectedServerIds.delete(id);
    });
    _updateExcludeButton();
  });

  // Wire exclude button → show form
  document.getElementById('excludeSelectedBtn').addEventListener('click', _showExclusionForm);
  document.getElementById('cancelExcludeBtn').addEventListener('click', () => {
    _hideExclusionForm();
  });
  document.getElementById('confirmExcludeBtn').addEventListener('click', _confirmExclusion);
  document.getElementById('emailExclBtn').addEventListener('click', _emailExclusions);
  document.getElementById('copyExclBtn').addEventListener('click', _copyExclusions);
}
