export function esc(str) {
  const d = document.createElement('div');
  d.textContent = str ?? '';
  return d.innerHTML;
}

export function num(v) { return Number.isFinite(Number(v)) ? Number(v) : 0; }

export function badge(text, color) {
  const safeColor = (color || '').replace(/[^a-zA-Z0-9_-]/g, '');
  return `<span class="badge ${safeColor}">${esc(text)}</span>`;
}

export function alertBadge(level) {
  const l = (level || '').toLowerCase();
  const colors = { critical: 'red', warning: 'orange', ok: 'green' };
  return badge(level, colors[l] || 'muted');
}

export function statusBadge(status) {
  const s = (status || '').toLowerCase();
  if (s === 'success' || s === 'healthy' || s === 'completed' || s === 'active') return badge(status, 'green');
  if (s === 'warning' || s === 'stale' || s === 'scheduled') return badge(status, 'yellow');
  if (s === 'error' || s === 'failed' || s === 'critical') return badge(status, 'red');
  return badge(status, 'muted');
}

export function severityBadge(sev) {
  const s = (sev || '').toLowerCase();
  if (s === 'high' || s === 'critical') return badge(sev, 'red');
  if (s === 'medium') return badge(sev, 'orange');
  return badge(sev, 'yellow');
}

export function fmtDate(d) {
  if (!d) return '\u2014';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function fmtTime(d) {
  if (!d) return '\u2014';
  return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function dot(color, label) {
  const c = (color || '').replace(/[^a-zA-Z0-9_-]/g, '');
  const text = label || c;
  return `<span class="status-dot ${c}" role="img" aria-label="${text}"></span>`;
}

export function cardAlert(value, thresholds) {
  if (thresholds.red != null && value >= thresholds.red) return ' card-alert-red';
  if (thresholds.orange != null && value >= thresholds.orange) return ' card-alert-orange';
  if (thresholds.yellow != null && value >= thresholds.yellow) return ' card-alert-yellow';
  return '';
}



export function timeAgo(iso) {
  if (!iso) return '\u2014';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60000) return 'just now';
  if (ms < 3600000) return `${Math.floor(ms/60000)} min ago`;
  if (ms < 86400000) return `${Math.floor(ms/3600000)}h ago`;
  return fmtDate(iso);
}

export function debounce(fn, delay = 250) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

export function exportCsv(filename, headers, rows) {
  const csvContent = [headers, ...rows]
    .map(row => row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

export function navigateTo(page) {
  document.querySelectorAll('header nav button').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const navBtn = document.querySelector(`header nav button[data-page="${page}"]`);
  if (navBtn) navBtn.classList.add('active');
  document.getElementById(page)?.classList.add('active');
}

export function durationStr(iso) {
  if (!iso) return '\u2014';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60000) return '<1 min';
  if (ms < 3600000) return `${Math.floor(ms/60000)} min`;
  if (ms < 86400000) return `${Math.floor(ms/3600000)}h ${Math.floor((ms%3600000)/60000)}m`;
  return `${Math.floor(ms/86400000)}d`;
}
