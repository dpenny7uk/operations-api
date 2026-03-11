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

export function dot(color) { const c = (color || '').replace(/[^a-zA-Z0-9_-]/g, ''); return `<span class="status-dot ${c}"></span>`; }

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

export function debounce(fn, ms = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export function durationStr(iso) {
  if (!iso) return '\u2014';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60000) return '<1 min';
  if (ms < 3600000) return `${Math.floor(ms/60000)} min`;
  if (ms < 86400000) return `${Math.floor(ms/3600000)}h ${Math.floor((ms%3600000)/60000)}m`;
  return `${Math.floor(ms/86400000)}d`;
}

export function debounce(fn, delay = 250) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
}
