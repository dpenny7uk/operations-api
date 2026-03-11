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
export let apiError = null;

export function setAllServers(v) { allServers = v; }
export function setAllCerts(v) { allCerts = v; }
export function setAllEol(v) { allEol = v; }
export function setUsingDemo(v) { usingDemo = v; }
export function setActiveCertFilter(v) { activeCertFilter = v; }
export function setActiveEolFilter(v) { activeEolFilter = v; }
export function setApiError(v) { apiError = v; }

// --- API fetch wrapper ---
export async function api(path) {
  try {
    const res = await fetch(API_BASE + path, { credentials: 'include' });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) setApiError('Authentication failed \u2014 check your credentials');
      else if (res.status === 429) setApiError('Rate limited \u2014 too many requests');
      else if (res.status >= 500) setApiError('Server error \u2014 data may be stale');
      else setApiError(`API error (${res.status})`);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.warn('API fetch failed:', path, e.message || e);
    if (!apiError) setApiError('Network error \u2014 API not reachable');
    return null;
  }
}
