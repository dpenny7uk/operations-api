// API base URL - auto-detects from current origin in production, falls back to localhost for dev
export const API_BASE = window.location.hostname === 'localhost'
    ? 'http://localhost:5000/api'
    : window.location.origin + '/api';

// --- Global state ---
export let allServers = [];
export let allCerts = [];
export let allEol = [];
export let usingDemo = false;
export let activeCertFilter = null;
export let activeEolFilter = null;
export let apiErrors = [];

export function setAllServers(v) { allServers = v; }
export function setAllCerts(v) { allCerts = v; }
export function setAllEol(v) { allEol = v; }
export function setUsingDemo(v) { usingDemo = v; }
export function setActiveCertFilter(v) { activeCertFilter = v; }
export function setActiveEolFilter(v) { activeEolFilter = v; }
let _apiErrorsListener = null;
export function setApiErrorsListener(fn) { _apiErrorsListener = fn; }
function _notifyApiErrors() {
  try { if (typeof window !== 'undefined') window.API_ERRORS = apiErrors.slice(); } catch (_) {}
  if (_apiErrorsListener) { try { _apiErrorsListener(); } catch (_) {} }
}
export function addApiError(v) { apiErrors.push(v); _notifyApiErrors(); }
export function clearApiErrors() { apiErrors = []; _notifyApiErrors(); }

// --- Per-widget demo-state flags ---
// When a boot-time fetch fails, the demo seed remains in place silently. Track
// which widget is affected so pages can render a DEMO ribbon on just that card.
export const demoWidgets = new Set();
function _publishDemo() {
  try { if (typeof window !== 'undefined') window.DEMO_WIDGETS = new Set(demoWidgets); } catch (_) {}
}
export function markDemo(key) { if (key) { demoWidgets.add(key); _publishDemo(); } }
export function clearDemo(key) { if (key) { demoWidgets.delete(key); _publishDemo(); } }
export function clearAllDemo() { demoWidgets.clear(); _publishDemo(); }
export function hasDemo(key) { return demoWidgets.has(key); }

const API_TIMEOUT_MS = 15000;

function recordHttpError(path, status) {
  if (status === 401 || status === 403) {
    if (!apiErrors.some(e => e.startsWith('Authentication'))) addApiError('Authentication failed \u2014 check your credentials');
  } else if (status === 429) {
    if (!apiErrors.some(e => e.startsWith('Rate'))) addApiError('Rate limited \u2014 too many requests');
  } else if (status >= 500) {
    if (!apiErrors.some(e => e.startsWith('Server'))) addApiError('Server error \u2014 data may be stale');
  } else {
    const clean = path.split('?')[0].replace(/^\//, '');
    addApiError(`${clean} (${status})`);
  }
}

function recordTransportError(path, e) {
  if (e && e.name === 'AbortError') {
    console.warn('API call timed out:', path);
    if (!apiErrors.some(x => x.startsWith('Request'))) addApiError('Request timed out \u2014 server may be slow');
    return 'Request timed out';
  }
  console.warn('API call failed:', path, (e && e.message) || e);
  if (!apiErrors.some(x => x.startsWith('Network'))) addApiError('Network error \u2014 API not reachable');
  return 'Network error';
}

// --- API fetch wrapper ---
export async function api(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const res = await fetch(API_BASE + path, { credentials: 'include', signal: controller.signal });
    if (!res.ok) {
      recordHttpError(path, res.status);
      return null;
    }
    return await res.json();
  } catch (e) {
    recordTransportError(path, e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// --- POST wrapper (returns { ok, status, error }) ---
// Errors are also recorded in the global apiErrors banner so users see a
// persistent signal, not just the caller's own alert/toast.
export async function apiPost(path, body = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const res = await fetch(API_BASE + path, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      recordHttpError(path, res.status);
      const text = await res.text().catch(() => '');
      return { ok: false, status: res.status, error: text || `Error ${res.status}` };
    }
    return { ok: true, status: res.status };
  } catch (e) {
    const msg = recordTransportError(path, e);
    return { ok: false, status: 0, error: msg };
  } finally {
    clearTimeout(timer);
  }
}
