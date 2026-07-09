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
  if (status === 401) {
    if (!apiErrors.some(e => e.startsWith('Authentication'))) addApiError('Authentication failed \u2014 check your credentials');
  } else if (status === 403) {
    // Authorization failure, NOT authentication: the user is signed in but lacks the
    // required role (e.g. OpsAdmin on a write). Recorded as a non-blanket, per-action
    // message so it does NOT match consoleState's ^(Authentication|Network|Request)
    // blanket regex and wrongly flip the whole console to "API unreachable / demo data".
    if (!apiErrors.some(e => e.startsWith('Not permitted'))) addApiError('Not permitted \u2014 you lack the required role for that action');
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

// --- Write wrappers (returns { ok, status, error }) ---
// Errors are also recorded in the global apiErrors banner so users see a
// persistent signal, not just the caller's own alert/toast.
//
// X-Requested-With: ops-api is the CSRF defence enforced by
// RequireRequestedWithHeaderMiddleware on the backend. Browsers cannot set
// custom headers on a simple cross-origin request, so a forged write from a
// foreign intranet origin will trip CORS preflight and never reach the API.
async function apiWrite(method, path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const init = {
      method,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'ops-api',
      },
      signal: controller.signal,
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await fetch(API_BASE + path, init);
    if (!res.ok) {
      recordHttpError(path, res.status);
      const text = await res.text().catch(() => '');
      // Error bodies are JSON { error: "..." } (409 conflicts and 500s alike). Surface
      // the message; fall back to the raw text for any non-JSON response.
      let message = text;
      try { const parsed = JSON.parse(text); if (parsed && parsed.error) message = parsed.error; } catch (_) {}
      return { ok: false, status: res.status, error: message || `Error ${res.status}` };
    }
    // Parse the success body when present (e.g. a launch result); empty/204 -> null.
    const data = await res.json().catch(() => null);
    return { ok: true, status: res.status, data };
  } catch (e) {
    const msg = recordTransportError(path, e);
    return { ok: false, status: 0, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

export async function apiPost(path, body = {})   { return apiWrite('POST',   path, body); }
export async function apiPatch(path, body = {})  { return apiWrite('PATCH',  path, body); }
export async function apiDelete(path)            { return apiWrite('DELETE', path, undefined); }

// --- Licensing (08) wrappers ---
// Reads return the parsed body (or null); writes return { ok, status, error }.
// The list endpoint embeds each licence's renewal history, so a single GET
// hydrates both the table and the detail panel.
export const apiLicensing = {
  list:   (params = {}) => {
    const entries = Object.entries(params).filter(([, v]) => v != null && v !== '');
    const qs = entries.length ? '?' + new URLSearchParams(entries).toString() : '';
    return api('/licensing/licences' + qs);
  },
  get:    (id)          => api(`/licensing/licences/${id}`),
  create: (body)        => apiPost('/licensing/licences', body),
  patch:  (id, body)    => apiPatch(`/licensing/licences/${id}`, body),
  renew:  (id, body)    => apiPost(`/licensing/licences/${id}/renew`, body),
  remove: (id)          => apiDelete(`/licensing/licences/${id}`),
};

// --- Auditing (09) wrappers ---
// Reads return the parsed body (or null); writes return { ok, status, error }.
// Slice 1 surface: applications + bindings + nominees (CRUD) and read-only
// campaign dashboards. Campaign launch / attestation submit arrive in later
// slices. Application detail embeds bindings[] + nominees[]; campaign detail
// embeds packets[] (with subjects[]) + decisions[] + email_log[].
export const apiAuditing = {
  // Applications
  listApps:   (q)              => api('/auditing/applications' + (q ? '?q=' + encodeURIComponent(q) : '')),
  getApp:     (id)             => api(`/auditing/applications/${id}`),
  createApp:  (body)           => apiPost('/auditing/applications', body),
  patchApp:   (id, body)       => apiPatch(`/auditing/applications/${id}`, body),
  deleteApp:  (id)             => apiDelete(`/auditing/applications/${id}`),
  // Bindings
  addBinding:    (id, body)        => apiPost(`/auditing/applications/${id}/bindings`, body),
  removeBinding: (id, bindingId)   => apiDelete(`/auditing/applications/${id}/bindings/${bindingId}`),
  // Nominees
  addNominee:    (id, body)        => apiPost(`/auditing/applications/${id}/nominees`, body),
  removeNominee: (id, nomineeId)   => apiDelete(`/auditing/applications/${id}/nominees/${nomineeId}`),
  // Campaigns
  listCampaigns:  ()           => api('/auditing/campaigns'),
  getCampaign:    (id)         => api(`/auditing/campaigns/${id}`),
  // Launch returns the minted attestation links (shown once); close ends a campaign.
  launchCampaign: (body)       => apiPost('/auditing/campaigns/launch', body),
  closeCampaign:  (id)         => apiPost(`/auditing/campaigns/${id}/close`, {}),
  remindCampaign: (id)         => apiPost(`/auditing/campaigns/${id}/remind`, {}),
  // Live AD search for the binding + owner pickers (null on 503/unreachable).
  searchGroups:   (q, limit=10)=> api('/auditing/ad-groups/search?q=' + encodeURIComponent(q) + '&limit=' + limit),
  searchUsers:    (q, limit=10)=> api('/auditing/ad-users/search?q=' + encodeURIComponent(q) + '&limit=' + limit),
};
