/* Operations Console — pure vanilla core
   Helpers, state, DEMO data, and the top-level render loop. */

(function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════
  // DEMO DATA (ported from data.jsx)
  // ═══════════════════════════════════════════════════════════
  const DAY = 86400000;
  const DEMO = (() => {
    let _seed = 42;
    const rand = () => { _seed = (_seed * 16807) % 2147483647; return (_seed - 1) / 2147483646; };
    const pick = arr => arr[Math.floor(rand() * arr.length)];
    const pad = (n, w = 2) => String(n).padStart(w, '0');

    const envSpec = [
      ['Prod', 'PR', 180], ['Dev', 'DV', 80], ['Systest', 'SY', 50], ['UAT', 'UT', 50],
      ['Staging', 'ST', 50], ['Training', 'TR', 30], ['Live Support', 'LS', 30],
      ['Shared Services', 'SS', 20], ['Proof of Concept', 'PC', 20], ['Continuous Integration', 'CI', 10]
    ];
    const prefixes = ['WEB','SQL','APP','API','SVC','BATCH','ETL','RPT','MON','DC',
                      'FILE','CACHE','MSG','LOG','AUTH','VPN','DNS','NTP','SCAN','BACKUP'];
    const apps = ['Customer Portal','API Gateway','Database Cluster','Monitoring','CI/CD',
                  'Admin Panel','Reporting','Data Warehouse','Message Broker','Identity Service',
                  'File Share','Backup Service','DNS Service','VPN Gateway','Cache Layer',
                  'ETL Pipeline','Batch Processing','Log Aggregator','Security Scanner','Mail Relay'];
    const groups = ['Group-A','Group-B','Group-C','Group-D'];

    const servers = [];
    let sid = 1;
    for (const [env, short, count] of envSpec) {
      for (let i = 1; i <= count; i++) {
        const prefix = prefixes[(i - 1) % prefixes.length];
        const name = `${prefix}-${short}-${pad(i)}`;
        servers.push({
          serverId: sid++,
          serverName: name,
          fqdn: `${name.toLowerCase()}.corp.local`,
          environment: env,
          applicationName: apps[(i - 1) % apps.length],
          patchGroup: env === 'Dev' && rand() < 0.3 ? null : pick(groups),
          isActive: rand() > 0.05
        });
      }
    }

    const cnPrefixes = ['*.corp.local','api.corp.com','mail.corp.com','admin.corp.local',
      'monitor.corp.local','db.corp.local','ldap.corp.local','intranet.corp.local',
      'vpn.corp.com','sso.corp.com','tableau.corp.com','grafana.corp.local',
      'jenkins.corp.local','nexus.corp.local','sonar.corp.local','jira.corp.com',
      'confluence.corp.com','bitbucket.corp.com','artifactory.corp.local','vault.corp.local'];
    const certs = [];
    const certDist = [
      [15, -90, -1, 'expired', true],
      [30, 1, 14, 'critical', false],
      [120, 15, 60, 'warning', false],
      [350, 61, 365, 'ok', false]
    ];
    let cid = 1;
    for (const [count, minDays, maxDays, level, expired] of certDist) {
      for (let i = 0; i < count; i++) {
        const days = minDays + Math.floor(rand() * (maxDays - minDays + 1));
        const cn = i < cnPrefixes.length ? cnPrefixes[i] : `svc-${pad(cid, 4)}.corp.local`;
        const srv = pick(servers);
        certs.push({
          certId: cid++,
          subjectCn: cn,
          serverName: srv.serverName,
          serviceName: srv.applicationName || null,
          validTo: new Date(Date.now() + days * DAY).toISOString(),
          daysUntilExpiry: days,
          alertLevel: level,
          isExpired: expired
        });
      }
    }

    const certSummary = { criticalCount: 30, warningCount: 120, okCount: 350, expiredCount: 15, totalCount: 515 };

    const unreachable = [];
    const used = new Set();
    while (unreachable.length < 12) {
      const idx = Math.floor(rand() * servers.length);
      if (used.has(idx)) continue;
      used.add(idx);
      const s = servers[idx];
      unreachable.push({
        serverName: s.serverName,
        environment: s.environment,
        lastSeen: new Date(Date.now() - Math.floor(rand() * 3600000 * 8)).toISOString()
      });
    }

    const unmatchedRaw = ['WEBPROD01','SQLPRD1','APPPRD02','SVCPROD3','MONPROD1',
      'unknown-host-42','unknown-host-99','DEVBLD01','ETLSVR1','RPTPRD02',
      'CACHEPRD1','MSGPROD1','FILEPRD02','DNSPRD1','BKUPPROD1'];
    const sources = ['SCCM','Qualys','Splunk','CrowdStrike'];
    const unmatched = unmatchedRaw.map((raw, i) => ({
      serverNameRaw: raw,
      sourceSystem: sources[i % sources.length],
      occurrenceCount: 1 + Math.floor(rand() * 30),
      firstSeenAt: new Date(Date.now() - Math.floor(rand() * 90 * DAY)).toISOString(),
      closestMatch: raw.startsWith('unknown') ? null : servers[Math.floor(rand() * 50)].serverName
    }));

    const alerts = [
      { ts: Date.now() - 12*60000, level: 'crit', msg: 'Cert expired: api.corp.com', sub: 'Reissue required · affects 14 services' },
      { ts: Date.now() - 48*60000, level: 'crit', msg: 'SQL-PR-07 unreachable for 4h 12m', sub: 'Database Cluster · last seen 11:48 UTC' },
      { ts: Date.now() - 2.1*3600000, level: 'warn', msg: 'confluence_issues sync stale', sub: '2 consecutive failures · expected every 6h' },
      { ts: Date.now() - 3.4*3600000, level: 'warn', msg: '3 certificates expire within 7 days', sub: '*.corp.local · mail.corp.com · sso.corp.com' },
      { ts: Date.now() - 5.6*3600000, level: 'info', msg: 'Patch cycle #12 scheduled', sub: '260 servers · T-5 days' },
      { ts: Date.now() - 8.1*3600000, level: 'info', msg: '15 new unmatched hostnames ingested', sub: 'Review in Servers → Unmatched' }
    ];

    const envCounts = {};
    for (const s of servers) envCounts[s.environment] = (envCounts[s.environment] || 0) + 1;

    const issues = [
      { id: 1, title: 'KB5034441 fails on small recovery partition', severity: 'High', win: true, sql: false, fix: 'Resize recovery partition to 1 GB' },
      { id: 2, title: 'SQL CU requires SSMS restart', severity: 'Medium', win: false, sql: true, fix: 'Restart SSMS after patching' },
      { id: 3, title: '.NET 8 runtime conflict with legacy app', severity: 'High', win: true, sql: false, fix: 'Pin .NET runtime version' },
      { id: 4, title: 'Cluster failover during patch window', severity: 'Medium', win: true, sql: true, fix: 'Drain node before patching' },
      { id: 5, title: 'TLS 1.0 disabled after security update', severity: 'Low', win: true, sql: false, fix: 'Update legacy clients' },
    ];

    const cycles = [
      { id: 12, date: new Date(Date.now() + 5 * DAY).toISOString(), count: 260, status: 'Upcoming' },
      { id: 11, date: new Date(Date.now() - 3 * DAY).toISOString(), count: 255, status: 'Completed' },
      { id: 10, date: new Date(Date.now() - 34 * DAY).toISOString(), count: 248, status: 'Completed' },
      { id: 9,  date: new Date(Date.now() - 62 * DAY).toISOString(), count: 242, status: 'Completed' },
      { id: 8,  date: new Date(Date.now() - 90 * DAY).toISOString(), count: 235, status: 'Completed' },
    ];

    const exclusions = [
      { server: 'SQL-PR-14', group: 'Group-A', service: 'Database Cluster', fn: 'Primary OLTP', env: 'Prod', dateOut: '2026-03-28', heldUntil: '2026-05-01', notes: 'Q2 close — DBA approval required before patch' },
      { server: 'APP-PR-02', group: 'Group-B', service: 'Customer Portal', fn: 'Payment flow', env: 'Prod', dateOut: '2026-04-02', heldUntil: '2026-04-25', notes: 'Pending vendor hotfix' },
      { server: 'ETL-PR-03', group: 'Group-C', service: 'ETL Pipeline', fn: 'Nightly loads', env: 'Prod', dateOut: '2026-04-08', heldUntil: '2026-04-22', notes: 'Regulator reporting window' },
      { server: 'MON-PR-01', group: 'Group-A', service: 'Monitoring', fn: 'Primary collector', env: 'Prod', dateOut: '2026-04-14', heldUntil: '2026-04-18', notes: 'Hold expired — review' },
    ];

    const eol = [
      { product: 'Windows Server', version: '2012 R2', eol: '2023-10-10', ext: '2026-10-13', status: 'extended', assets: 25 },
      { product: 'SQL Server', version: '2014', eol: '2024-07-09', ext: '2024-07-09', status: 'eol', assets: 18 },
      { product: '.NET Framework', version: '4.6.1', eol: '2022-04-26', ext: '2026-11-10', status: 'extended', assets: 40 },
      { product: 'Windows Server', version: '2016', eol: '2027-01-12', ext: '2027-01-12', status: 'approaching', assets: 65 },
      { product: 'SQL Server', version: '2016', eol: '2026-07-14', ext: '2026-07-14', status: 'approaching', assets: 30 },
      { product: 'IIS', version: '10.0', eol: '2026-10-13', ext: null, status: 'approaching', assets: 22 },
      { product: 'Windows Server', version: '2019', eol: '2029-01-09', ext: '2029-01-09', status: 'supported', assets: 110 },
      { product: 'SQL Server', version: '2019', eol: '2030-01-08', ext: '2030-01-08', status: 'supported', assets: 75 },
      { product: 'Windows Server', version: '2022', eol: '2031-10-14', ext: '2031-10-14', status: 'supported', assets: 150 },
      { product: '.NET', version: '8.0', eol: '2026-11-10', ext: null, status: 'approaching', assets: 70 },
    ];

    const syncs = [
      { name: 'databricks_servers', status: 'success', lastSuccess: Date.now() - 3600000, hours: 1.0, records: 520, fails: 0, schedule: 'every 6h' },
      { name: 'patching_schedule_html', status: 'success', lastSuccess: Date.now() - 7200000, hours: 2.0, records: 260, fails: 0, schedule: 'every 12h' },
      { name: 'confluence_issues', status: 'warning', lastSuccess: Date.now() - 86400000, hours: 24.0, records: 28, fails: 2, schedule: 'every 6h', error: 'Timeout connecting to confluence.corp.com' },
      { name: 'certificate_scan', status: 'success', lastSuccess: Date.now() - 14400000, hours: 4.0, records: 1000, fails: 0, schedule: 'daily' },
      { name: 'eol_catalog', status: 'success', lastSuccess: Date.now() - 21*3600000, hours: 21.0, records: 42, fails: 0, schedule: 'daily' },
    ];

    return {
      servers, envCounts,
      serverTotal: servers.length,
      serverActive: servers.filter(s => s.isActive).length,
      certs, certSummary, unreachable, unmatched, alerts, issues, cycles, exclusions, eol, syncs,
      nextPatch: {
        days: 5, date: new Date(Date.now() + 5 * DAY).toISOString(), servers: 260,
        issues: { High: 2, Medium: 5, Low: 3 },
        groups: { 'Group-A': 73, 'Group-B': 68, 'Group-C': 65, 'Group-D': 54 },
      }
    };
  })();

  // ═══════════════════════════════════════════════════════════
  // UTIL FORMATTERS
  // ═══════════════════════════════════════════════════════════
  function fmtRel(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s/60)}m ago`;
    if (s < 86400) return `${Math.floor(s/3600)}h ago`;
    return `${Math.floor(s/86400)}d ago`;
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  function fmtShortDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  }

  // ── CSV export helpers ────────────────────────────────
  // toCsv(rows, columns) — columns: [{ key, label?, value?(row) }]
  function toCsv(rows, columns) {
    const esc = v => {
      if (v == null) return '';
      const s = String(v);
      return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const header = columns.map(c => esc(c.label || c.key)).join(',');
    const lines = rows.map(r => columns.map(c => {
      const v = c.value ? c.value(r) : r[c.key];
      return esc(v);
    }).join(','));
    return [header, ...lines].join('\r\n');
  }

  function isoDay() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function downloadCsv(filename, rows, columns) {
    const csv = toCsv(rows, columns);
    // BOM helps Excel auto-detect UTF-8.
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
  }

  // ═══════════════════════════════════════════════════════════
  // DOM HELPERS
  // ═══════════════════════════════════════════════════════════
  // h('div.foo', {onclick: fn}, child1, child2, ...)
  function h(sel, props, ...children) {
    let tag = 'div', id = null, classes = [];
    const m = sel.match(/^([a-z0-9]+)?([#.][^\s]+)?$/i);
    if (m) {
      if (m[1]) tag = m[1];
      const rest = sel.slice((m[1] || '').length);
      const parts = rest.split(/(?=[.#])/);
      for (const p of parts) {
        if (!p) continue;
        if (p[0] === '#') id = p.slice(1);
        else if (p[0] === '.') classes.push(p.slice(1));
      }
    } else {
      tag = sel;
    }
    const el = document.createElement(tag);
    if (id) el.id = id;
    if (classes.length) el.className = classes.join(' ');
    if (props) {
      for (const k in props) {
        const v = props[k];
        if (v == null || v === false) continue;
        if (k === 'class' || k === 'className') el.className = ((el.className ? el.className + ' ' : '') + v).trim();
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k === 'html') el.innerHTML = v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'dataset' && typeof v === 'object') Object.assign(el.dataset, v);
        else if (k === 'checked' || k === 'disabled' || k === 'autofocus') { if (v) el.setAttribute(k, ''); el[k] = !!v; }
        else if (k === 'value') el.value = v;
        else el.setAttribute(k, v);
      }
    }
    appendChildren(el, children);
    return el;
  }
  function appendChildren(el, children) {
    for (const c of children) {
      if (c == null || c === false || c === true) continue;
      if (Array.isArray(c)) appendChildren(el, c);
      else if (c instanceof Node) el.appendChild(c);
      else el.appendChild(document.createTextNode(String(c)));
    }
  }
  // shorthand
  const t = (s) => document.createTextNode(String(s));

  // ═══════════════════════════════════════════════════════════
  // PRIMITIVES
  // ═══════════════════════════════════════════════════════════
  function Badge(tone, label) {
    return h('span.badge.' + (tone || 'neutral'), null, h('span.dot'), label);
  }
  function SectionLabel(label, count, extra) {
    const el = h('div.section-label', null, h('span', null, label));
    if (count != null) el.appendChild(h('span.count', null, String(count)));
    if (extra) el.appendChild(extra);
    return el;
  }
  function PageHead(counter, title, note) {
    return h('div.page-head', null,
      h('div.counter', null, counter),
      h('div.title', null, title),
      note && h('div.note', null, note)
    );
  }
  function InlineSearch(value, onChange, placeholder) {
    const wrap = h('div.inline-search');
    const input = h('input', { type: 'text', value: value || '', placeholder: placeholder || 'Search…' });
    input.addEventListener('input', e => onChange(e.target.value));
    wrap.appendChild(input);
    if (value) {
      const clr = h('button.clear', { 'aria-label': 'Clear', onclick: () => onChange('') }, '×');
      wrap.appendChild(clr);
    }
    return wrap;
  }

  // SortableTable — stateful (sort key/dir persisted by id)
  const _sortState = {};
  function SortableTable({ id, columns, rows, renderRow, empty, defaultSort }) {
    empty = empty || 'No data';
    const key = 'tbl:' + (id || '_');
    if (!_sortState[key]) _sortState[key] = {
      sortKey: defaultSort ? defaultSort.key : null,
      sortDir: defaultSort ? defaultSort.dir : 'asc'
    };
    const st = _sortState[key];

    let sorted = rows;
    if (st.sortKey) {
      const col = columns.find(c => c.key === st.sortKey);
      const acc = (col && col.accessor) || (r => r[st.sortKey]);
      sorted = rows.slice().sort((a, b) => {
        const av = acc(a), bv = acc(b);
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        if (typeof av === 'number' && typeof bv === 'number') {
          return st.sortDir === 'asc' ? av - bv : bv - av;
        }
        return st.sortDir === 'asc'
          ? String(av).localeCompare(String(bv))
          : String(bv).localeCompare(String(av));
      });
    }

    const wrap = h('div.table-wrap');
    const table = h('table.op');
    const thead = h('thead');
    const trH = h('tr');
    for (const c of columns) {
      const cls = [];
      if (c.sortable !== false) cls.push('sortable');
      if (st.sortKey === c.key) cls.push('sorted');
      const th = h('th' + (cls.length ? '.' + cls.join('.') : ''), { style: c.width ? { width: c.width + 'px' } : null });
      th.appendChild(t(c.label));
      if (c.sortable !== false) {
        const caret = h('span.caret', null, st.sortKey === c.key ? (st.sortDir === 'asc' ? '↑' : '↓') : '·');
        th.appendChild(caret);
        th.addEventListener('click', () => {
          if (st.sortKey === c.key) st.sortDir = st.sortDir === 'asc' ? 'desc' : 'asc';
          else { st.sortKey = c.key; st.sortDir = 'asc'; }
          window.OC.render();
        });
      }
      trH.appendChild(th);
    }
    thead.appendChild(trH);
    table.appendChild(thead);

    const tbody = h('tbody');
    if (sorted.length === 0) {
      const tr = h('tr');
      tr.appendChild(h('td.empty', { colspan: columns.length }, empty));
      tbody.appendChild(tr);
    } else {
      for (let i = 0; i < sorted.length; i++) {
        tbody.appendChild(renderRow(sorted[i], i));
      }
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  // ═══════════════════════════════════════════════════════════
  // APP STATE + RENDER LOOP
  // ═══════════════════════════════════════════════════════════
  const PAGES = [
    { id: 'health',       idx: '01', label: 'Health' },
    { id: 'servers',      idx: '02', label: 'Servers' },
    { id: 'patching',     idx: '03', label: 'Patch schedule' },
    { id: 'patchmgmt',    idx: '04', label: 'Patch mgmt' },
    { id: 'certificates', idx: '05', label: 'Certificates' },
    { id: 'eol',          idx: '06', label: 'End of life' },
  ];

  const API_SCENARIOS = {
    live:     { label: 'Live', banner: null, errors: [], staleSince: null },
    degraded: { label: 'Degraded', banner: 'warn',
      headline: 'Partial outage — 2 endpoints failing, showing cached data where needed',
      errors: [
        { code: 504, ep: 'GET /api/certificates',     msg: 'Gateway timeout after 15s', tries: '3 retries' },
        { code: 429, ep: 'GET /api/patching/cycles',  msg: 'Rate limited — 429 Too Many Requests', tries: '1 retry' },
      ], staleSince: 4*60*1000 },
    stale:    { label: 'Stale cache', banner: 'warn',
      headline: 'Data is 14 minutes old — last successful sync at 14:02 UTC',
      errors: [
        { code: 500, ep: 'POST /api/health/validation/run', msg: '500 — database connection pool exhausted', tries: 'retrying in 42s' },
      ], staleSince: 14*60*1000 },
    offline:  { label: 'Offline', banner: 'crit',
      headline: 'API unreachable — showing cached data from the last successful connection',
      errors: [
        { code: 0, ep: 'GET /api/health',          msg: 'Network error — connection refused', tries: '6 retries' },
        { code: 0, ep: 'GET /api/servers',         msg: 'Network error — connection refused', tries: '6 retries' },
        { code: 0, ep: 'GET /api/certificates',    msg: 'Network error — connection refused', tries: '6 retries' },
        { code: 0, ep: 'GET /api/patching/cycles', msg: 'Network error — connection refused', tries: '6 retries' },
      ], staleSince: 47*60*1000 },
    auth:     { label: 'Auth failed', banner: 'crit',
      headline: 'Authentication failed — your session has expired',
      errors: [
        { code: 401, ep: 'GET /api/health',     msg: '401 Unauthorized — Windows auth token rejected', tries: 'no retry' },
        { code: 403, ep: 'GET /api/patching',   msg: '403 Forbidden — insufficient role for this resource', tries: 'no retry' },
      ], staleSince: 22*60*1000 },
  };

  const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
    "accent": "amber",
    "surface": "ivory",
    "density": "comfy",
    "mono": "off",
    "theme": "light",
    "api": "live"
  }/*EDITMODE-END*/;

  const state = {
    page: localStorage.getItem('opc:page') || 'health',
    now: new Date(),
    tweaks: Object.assign({}, TWEAK_DEFAULTS),
    tweaksEnabled: false,
    tweaksOpen: false,
    retrying: false,
    drawer: null,     // {kind, data}
    pageState: {},    // per-page transient (search terms, pagination)
    data: DEMO,       // live data, replaced by op-boot after API fetches
    usingDemo: true,  // true until a real API response lands
    apiErrors: [],    // real-time error list from api.js
    lastOkAt: null,   // ms timestamp of last successful health probe
    debug: (typeof location !== 'undefined' && new URLSearchParams(location.search).get('debug') === '1'),
  };

  // Effective API scenario: real state unless ?debug=1 and a non-live sim is picked.
  function getEffectiveScenario() {
    if (state.debug && state.tweaks.api && state.tweaks.api !== 'live') {
      return API_SCENARIOS[state.tweaks.api] || API_SCENARIOS.live;
    }
    if (state.usingDemo) {
      return { label: 'Demo', banner: 'warn',
        headline: 'Showing cached demo data — live API is not reachable from this browser.',
        errors: [{ code: 0, ep: 'GET /api/health', msg: 'Demo mode — API unreachable. Check VPN / corp network and retry.', tries: '—' }],
        staleSince: null,
        isDemo: true };
    }
    if (state.apiErrors.length === 0) return API_SCENARIOS.live;
    const hasAuth = state.apiErrors.some(e => typeof e === 'string' && e.startsWith('Authentication'));
    const errs = state.apiErrors.map(e => ({
      code: 0,
      ep: (typeof e === 'string' && /\((\d+)\)$/.test(e)) ? 'GET /api/' + e.replace(/ \(\d+\)$/, '') : '—',
      msg: typeof e === 'string' ? e : String(e),
      tries: '—'
    }));
    return {
      label: hasAuth ? 'Auth failed' : 'Degraded',
      banner: hasAuth ? 'crit' : 'warn',
      headline: hasAuth ? 'Authentication failed — your session may have expired'
                        : 'Partial outage — some endpoints failing, showing cached data where needed',
      errors: errs,
      staleSince: state.lastOkAt ? (Date.now() - state.lastOkAt) : null
    };
  }

  function setPage(p) {
    state.page = p;
    localStorage.setItem('opc:page', p);
    render();
  }
  function setTweak(k, v) {
    state.tweaks[k] = v;
    applyTweaks();
    try { window.parent.postMessage({ type: '__edit_mode_set_keys', edits: { [k]: v } }, '*'); } catch(e){}
    render();
  }
  function applyTweaks() {
    const tw = state.tweaks;
    document.body.setAttribute('data-accent', tw.accent);
    document.body.setAttribute('data-surface', tw.surface);
    document.body.setAttribute('data-density', tw.density);
    document.body.setAttribute('data-mono', tw.mono);
    document.body.setAttribute('data-theme', tw.theme);
    document.body.setAttribute('data-api', tw.api);
  }
  function openDrawer(kind, data) { state.drawer = { kind, data }; render(); }
  function closeDrawer() { state.drawer = null; render(); }
  function onRetry() {
    state.retrying = true;
    render();
    if (typeof window.OC?.refetch === 'function') {
      window.OC.refetch().finally(() => { state.retrying = false; render(); });
    } else {
      setTimeout(() => { state.retrying = false; render(); }, 1400);
    }
  }

  // per-page local state getter/setter
  function ps(pageId, key, initial) {
    if (!state.pageState[pageId]) state.pageState[pageId] = {};
    if (!(key in state.pageState[pageId])) state.pageState[pageId][key] = initial;
    return {
      get: () => state.pageState[pageId][key],
      set: (v) => { state.pageState[pageId][key] = v; render(); }
    };
  }

  // ═══════════════════════════════════════════════════════════
  // SHELL (rail + statusline)
  // ═══════════════════════════════════════════════════════════
  function renderRail() {
    const d = state.data;
    const critCount = d.unreachable.length + d.certSummary.expiredCount + d.certSummary.criticalCount;
    const scenario = getEffectiveScenario();
    const isDown = scenario.banner === 'crit';
    const isDegraded = scenario.banner === 'warn';

    const navList = h('ul.nav-list');
    for (const p of PAGES) {
      const flag =
        p.id === 'health' ? (critCount > 0 ? critCount : null) :
        p.id === 'certificates' ? d.certSummary.expiredCount + d.certSummary.criticalCount :
        p.id === 'servers' ? d.unmatched.length :
        p.id === 'patching' ? `T−${d.nextPatch.days}D` :
        null;
      const flagCrit = (p.id === 'health' || p.id === 'certificates') && flag > 0;
      const li = h('li.nav-item' + (state.page === p.id ? '.active' : ''),
        { onclick: () => setPage(p.id), dataset: { screenLabel: `${p.idx} ${p.label}` } },
        h('span.idx', null, p.idx),
        h('span.label', null, p.label),
        flag != null && h('span.flag' + (flagCrit ? '.crit' : ''), null, String(flag))
      );
      navList.appendChild(li);
    }

    return h('aside.rail', null,
      h('div.brand', null,
        h('div.mark', null, 'Service Operations'),
        h('div.sub', null, 'CORP / OPS-API v2.4.1')
      ),
      h('div', null,
        h('div.rail-section-label', null, 'Sections'),
        navList
      ),
      h('div.rail-footer', null,
        h('span.rail-api' + (isDown ? '.off' : isDegraded ? '.warn' : ''), null,
          h('span.d'),
          ' API ' + (isDown ? 'down' : isDegraded ? 'degraded' : 'live')
        ),
        h('span.clock', { style: { marginTop: '8px' } }, state.now.toUTCString().slice(17, 25) + ' UTC'),
        h('span', null, state.now.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' })),
        state.usingDemo && h('span.demo-flag', { style: { marginTop: '6px', alignSelf: 'flex-start' } }, 'DEMO MODE')
      )
    );
  }

  function renderStatusline() {
    const d = state.data;
    const scenario = getEffectiveScenario();
    const isDown = scenario.banner === 'crit';
    const isDegraded = scenario.banner === 'warn';
    const apiBad = isDown || isDegraded;
    const critCount = d.unreachable.length + d.certSummary.expiredCount + d.certSummary.criticalCount;
    const warnCount = d.certSummary.warningCount + d.syncs.filter(s => s.status !== 'success').length;
    const staleAgo = scenario.staleSince ? fmtRel(Date.now() - scenario.staleSince) : null;

    const tag = h('div.tag', null,
      'SERVICE OPERATIONS — ' + new Date().toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long' }).toUpperCase()
    );
    if (apiBad) tag.appendChild(h('span.stale-chip', { style: { marginLeft: '12px' } }, (isDown ? '◦ offline' : '◦ stale') + ' · ' + staleAgo));

    const headline = h('h1');
    if (isDown) { headline.appendChild(t('API is ')); headline.appendChild(h('em', null, 'unreachable')); headline.appendChild(t(' — working from cache.')); }
    else if (isDegraded) { headline.appendChild(t('Operating in ')); headline.appendChild(h('em', null, 'degraded mode')); headline.appendChild(t(' — some endpoints failing.')); }
    else if (critCount > 0) { headline.appendChild(t('Running with ')); headline.appendChild(h('em', null, `${critCount} critical signals`)); headline.appendChild(t(' across the estate.')); }
    else headline.appendChild(t('All systems nominal across the estate.'));

    const telegram = h('div.telegram', null,
      h('div.piece' + (critCount > 0 ? '.crit' : '.ok'), null, h('b', null, String(critCount)), ' critical'),
      h('div.piece.warn', null, h('b', null, String(warnCount)), ' warnings'),
      h('div.piece', null, h('b', null, String(d.serverTotal)), ' servers'),
      h('div.piece', null, h('b', null, String(d.certSummary.totalCount)), ' certs'),
      h('div.piece', null, h('b', null, `T−${d.nextPatch.days}d`), ' next patch')
    );

    const refreshBtn = h('button.refresh', { onclick: onRetry },
      h('span.dot', { style: { background: isDown ? 'var(--crit)' : isDegraded ? 'var(--warn)' : 'var(--ok)' } }),
      state.retrying ? 'Retrying…' : (apiBad ? 'Retry' : 'Refresh')
    );
    const themeBtn = h('button.refresh', {
      title: 'Toggle theme',
      style: { padding: '8px 12px' },
      onclick: () => setTweak('theme', state.tweaks.theme === 'dark' ? 'light' : 'dark')
    }, state.tweaks.theme === 'dark' ? '☀ Light' : '☾ Dark');

    return h('div.statusline', null,
      h('div', null,
        tag,
        h('div', { 'aria-live': 'polite', 'aria-atomic': 'true' }, headline),
        telegram
      ),
      h('div.right', null,
        h('div.timestamp', null, apiBad ? `LAST OK · ${staleAgo}` : `UPDATED ${fmtRel(Date.now() - 42000)}`),
        h('div', { style: { display: 'flex', gap: '8px' } }, themeBtn, refreshBtn)
      )
    );
  }

  function renderApiBanner() {
    const scenario = getEffectiveScenario();
    const isDown = scenario.banner === 'crit';
    const isDegraded = scenario.banner === 'warn';
    if (!isDown && !isDegraded) return null;

    const errs = h('div.errs', null,
      h('div.e', null, h('b', null, String(scenario.errors.length)), ' endpoint' + (scenario.errors.length > 1 ? 's' : '') + ' failing'),
      h('div.e', null, h('b', null, scenario.errors[0].ep), ' ' + scenario.errors[0].msg),
      scenario.errors.length > 1 && h('div.e', null, `+ ${scenario.errors.length - 1} more — see Health → API status`)
    );

    const leadText = scenario.isDemo ? 'DEMO MODE' : (isDown ? 'API DOWN' : 'API DEGRADED');
    const retryText = scenario.isDemo ? 'Retry connection' : 'Retry now';
    return h('div.api-banner' + (isDegraded ? '.warn' : ''), { role: 'status', 'aria-live': 'polite' },
      h('div.lead', null, h('span.pulse-dot'), leadText),
      errs,
      h('div.actions', null,
        !scenario.isDemo && h('button', null, 'View log'),
        h('button.primary', { onclick: onRetry }, state.retrying ? 'Retrying…' : retryText)
      )
    );
  }

  function renderTweaks() {
    if (!state.debug && !state.tweaksEnabled) return null;
    const scenario = getEffectiveScenario();
    const isDown = scenario.banner === 'crit';
    const isDegraded = scenario.banner === 'warn';
    const tw = state.tweaks;

    const fab = h('button.tweaks-fab', { onclick: () => { state.tweaksOpen = !state.tweaksOpen; render(); } },
      h('span.dot', { style: { background: isDown ? 'var(--crit)' : isDegraded ? 'var(--warn)' : 'var(--signal)' } }),
      state.tweaksOpen ? 'Close' : 'Tweaks'
    );

    if (!state.tweaksOpen) return fab;

    const lblStyle = { fontSize: '11px', color: 'var(--ink-3)', fontFamily: 'var(--mono)', letterSpacing: '.08em', textTransform: 'uppercase' };
    function row(label, cols, opts, key) {
      const btns = h('div.opts', { style: { gridTemplateColumns: cols } });
      for (const o of opts) {
        btns.appendChild(h('button' + (tw[key] === o ? '.on' : ''), { onclick: () => setTweak(key, o) }, o));
      }
      return h('div.tweaks-row', null, h('label', { style: lblStyle }, label), btns);
    }

    const swatch = h('div.tweaks-swatch');
    [['amber','oklch(0.58 0.17 35)'],['blue','oklch(0.52 0.16 245)'],['forest','oklch(0.45 0.12 155)'],['violet','oklch(0.50 0.16 295)']].forEach(([k, c]) => {
      swatch.appendChild(h('button' + (tw.accent === k ? '.on' : ''), {
        'aria-label': k, style: { background: c }, onclick: () => setTweak('accent', k)
      }));
    });

    const panel = h('div.tweaks-panel', null,
      h('h3', null, 'Tweaks'),
      row('API state', 'repeat(5, 1fr)', ['live','degraded','stale','offline','auth'], 'api'),
      h('div.tweaks-row', null, h('label', { style: lblStyle }, 'Accent'), swatch),
      row('Theme', '1fr 1fr', ['light','dark'], 'theme'),
      row('Density', 'repeat(3, 1fr)', ['compact','comfy','loose'], 'density'),
      row('Surface', null, ['ivory','pure','warm','cool'], 'surface'),
      row('Mono everywhere', '1fr 1fr', ['off','on'], 'mono')
    );

    return [fab, panel];
  }

  // ═══════════════════════════════════════════════════════════
  // MAIN RENDER
  // ═══════════════════════════════════════════════════════════
  function render() {
    const root = document.getElementById('root');
    const shell = h('div.shell');
    shell.appendChild(renderRail());

    const stage = h('main.stage');
    stage.appendChild(renderStatusline());
    const banner = renderApiBanner();
    if (banner) stage.appendChild(banner);

    const scenario = getEffectiveScenario();
    const pageRenderer = window.OC.pages[state.page];
    if (pageRenderer) stage.appendChild(pageRenderer(state.data, { setPage, openDrawer, apiScenario: scenario, ps }));

    shell.appendChild(stage);

    // drawer
    if (state.drawer) {
      const drawerRenderer = window.OC.drawers[state.drawer.kind];
      if (drawerRenderer) {
        const nodes = drawerRenderer(state.drawer.data, state.data, { closeDrawer, ps });
        if (Array.isArray(nodes)) nodes.forEach(n => shell.appendChild(n));
        else shell.appendChild(nodes);
      }
    }

    // tweaks panel
    const tweakNodes = renderTweaks();
    if (tweakNodes) {
      if (Array.isArray(tweakNodes)) tweakNodes.forEach(n => shell.appendChild(n));
      else shell.appendChild(tweakNodes);
    }

    root.innerHTML = '';
    root.appendChild(shell);
  }

  // ═══════════════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════════════
  function init() {
    applyTweaks();

    // tweaks postMessage protocol
    window.addEventListener('message', e => {
      if (!e.data || typeof e.data !== 'object') return;
      if (e.data.type === '__activate_edit_mode') { state.tweaksEnabled = true; render(); }
      if (e.data.type === '__deactivate_edit_mode') { state.tweaksEnabled = false; state.tweaksOpen = false; render(); }
    });
    try { window.parent.postMessage({ type: '__edit_mode_available' }, '*'); } catch(e){}

    // ESC closes drawer
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && state.drawer) closeDrawer();
    });

    // Clock tick
    setInterval(() => { state.now = new Date(); }, 30000);

    render();
  }

  // Expose for pages/drawers modules and the boot layer
  window.OC = {
    DEMO, fmtRel, fmtDate, fmtShortDate,
    toCsv, downloadCsv, isoDay,
    h, t, Badge, SectionLabel, PageHead, InlineSearch, SortableTable,
    state, setPage, setTweak, openDrawer, closeDrawer, onRetry, ps, render,
    getEffectiveScenario, API_SCENARIOS,
    pages: {}, drawers: {}, init
  };

  // Initial render uses DEMO data. op-boot.js fires API fetches in parallel
  // and re-renders as each resolves (progressive reveal).
  document.addEventListener('DOMContentLoaded', init);
})();
