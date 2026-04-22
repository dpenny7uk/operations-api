/* ======================================================
   Operations Console — additional surfaces (Servers, Certs,
   Patching Schedules, Patch Management, End of Life) + router
   Exposes on window:
     ROUTER, SERVERS_DATA, CERTS_DATA,
     ServersPage, CertsPage, StubPage,
     PatchingSchedulesPage, PatchManagementPage, EndOfLifePage
   ====================================================== */
(function () {
  'use strict';

  // ---------- tiny DOM helper (same contract as app.js) ----------
  function h(tag, props) {
    const m = tag.match(/^([a-z0-9]+)([\.#][^]*)?$/i) || ['', 'div'];
    const el = document.createElement(m[1] || 'div');
    if (m[2]) m[2].replace(/([\.#])([^.#]+)/g, (_, s, v) => s === '.' ? el.classList.add(v) : (el.id = v));
    if (props) for (const k in props) {
      const v = props[k]; if (v == null || v === false) continue;
      if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'on' && typeof v === 'object') for (const ev in v) el.addEventListener(ev, v[ev]);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'text') el.textContent = v;
      else if (k in el) { try { el[k] = v; } catch { el.setAttribute(k, v); } } else el.setAttribute(k, v);
    }
    for (let i = 2; i < arguments.length; i++) {
      const c = arguments[i]; if (c == null || c === false) continue;
      if (Array.isArray(c)) c.forEach(x => { if (x != null) el.append(x.nodeType ? x : document.createTextNode(x)); });
      else el.append(c.nodeType ? c : document.createTextNode(c));
    }
    return el;
  }

  // ================================================================
  // ROUTER — hash-based, persists in localStorage via app.js state
  // ================================================================
  const ROUTES = [
    {id:'health',    idx:'01', label:'Health'},
    {id:'servers',   idx:'02', label:'Servers'},
    {id:'patching',  idx:'03', label:'Patching Schedules'},
    {id:'patchmgmt', idx:'04', label:'Patch Management'},
    {id:'certs',     idx:'05', label:'Certificates'},
    {id:'eol',       idx:'06', label:'End of Life'},
  ];

  function currentRoute() {
    const h = (location.hash || '#health').replace(/^#/, '').toLowerCase();
    return ROUTES.find(r => r.id === h) ? h : 'health';
  }

  function goto(id) {
    if (!ROUTES.find(r => r.id === id)) id = 'health';
    if (location.hash !== '#' + id) {
      location.hash = '#' + id;
    } else {
      // hash unchanged — force a re-render
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    }
  }

  window.ROUTER = { ROUTES, currentRoute, goto };

  // ================================================================
  // DATA — SERVERS (modelled on the legacy screenshots)
  // ================================================================
  // Ten environments from the bar chart
  const SRV_ENV = [
    {name:'Production',             count:1130, active:1130, tone:'prod'},
    {name:'Development',            count: 412, active: 412, tone:'dev'},
    {name:'UAT',                    count: 151, active: 151, tone:'uat'},
    {name:'Staging',                count: 143, active: 143, tone:'staging'},
    {name:'Shared Services',        count: 107, active: 107, tone:'shared'},
    {name:'Systest',                count:  94, active:  94, tone:'systest'},
    {name:'Live Support',           count:  54, active:  54, tone:'livesup'},
    {name:'Proof of Concept',       count:  40, active:  40, tone:'poc'},
    {name:'Continuous Integration', count:  17, active:  17, tone:'ci'},
    {name:'Training',               count:   1, active:   1, tone:'training'},
  ];
  const SRV_TOTAL = SRV_ENV.reduce((s, e) => s + e.count, 0);
  const SRV_ENV_MAX = SRV_ENV.reduce((m, e) => Math.max(m, e.count), 1);

  // Synthesise a sizeable server inventory so search/filter/paginate feel real
  function buildServers() {
    const apps = ['webmethods','app','database','web','catman','thunderhead','basecamp','network_infrastructure','azure_integration','exchange_online','active_directory','nessus','servicenow','tosca','mustang','bud','portal_plus','magic','ldap','jenkins'];
    const services = ['ivanti','ucs','aad','ansible','nessus','compute_infrastructure','citrix','webmethods','sql','mq','kafka','redis','iis','apache','kubernetes','consul','vault','jenkins','splunk','tenable'];
    const functions = [
      'Ivanti Security Controls test server','server 2019 patch test server','Cyber Fusion Centre — Tenable Scanner',
      'VirtualWho Hypervisor RHEL enablement','Ansible Deployment Host','Ivanti Security Controls',
      'AAD Connect primary','Citrix session host','Exchange transport node','SQL replica — read pool',
      'Kafka broker','Redis cache node','Jenkins build agent','Splunk forwarder','WebMethods integration server',
      'Active Directory domain controller','LDAP proxy','Vault seal node','Consul server','API gateway node',
    ];
    const fqdns = ['azure.hiscox.com','hiscox.com','aws.hiscox.com','internal.hiscox.com','corp.hiscox.com'];
    const patchGroups = ['GROUP0','GROUP1','GROUP2','GROUP3','2A','2B','3A','3B','4A','4B','5A','5B','5C','6A','7A','7B','NO PATCH GROUP FOUND'];
    const rng = (() => { let s = 0xC1A5CE; return () => (s = (s*1103515245 + 12345) >>> 0) / 0x100000000; })();
    const pick = arr => arr[Math.floor(rng() * arr.length)];
    const servers = [];
    let n = 0;
    for (const env of SRV_ENV) {
      const prefix = env.name === 'Continuous Integration' ? 'CI' :
                     env.name === 'Production' ? 'PR' :
                     env.name === 'Development' ? 'DV' :
                     env.name === 'UAT' ? 'UT' :
                     env.name === 'Staging' ? 'ST' :
                     env.name === 'Shared Services' ? 'SS' :
                     env.name === 'Systest' ? 'SY' :
                     env.name === 'Live Support' ? 'LS' :
                     env.name === 'Proof of Concept' ? 'PC' :
                     'TR';
      // Cap synthesised rows so the table feels real without being huge
      const make = Math.min(env.count, env.name === 'Production' ? 260 : env.name === 'Development' ? 140 : 60);
      for (let i = 0; i < make; i++) {
        const block = String(Math.floor(rng() * 9000) + 1000);
        const seq = String(Math.floor(rng() * 99)).padStart(2, '0');
        servers.push({
          id: ++n,
          name: `${prefix}${block}-${String(Math.floor(rng()*90000)+10000).slice(0,5)}-${seq}`,
          fqdn: pick(fqdns),
          env: env.name,
          app: pick(apps),
          service: pick(services),
          func: pick(functions),
          pg: pick(patchGroups),
          active: rng() > 0.04, // ~96% active
        });
      }
    }
    // Inject a handful of unreachable hosts — these drive the new "error" highlighting
    const unreachable = [
      {name:'DVX032EUGSE-00', env:'Development', lastSeen:'2h ago', duration:'2h 12m'},
      {name:'DVX032EUCDN-00', env:'Development', lastSeen:'2h ago', duration:'2h 12m'},
      {name:'DVX032I42J2A-00',env:'Staging',     lastSeen:'2h ago', duration:'2h 12m'},
      {name:'DVX032GLWSD-00', env:'Development', lastSeen:'2h ago', duration:'2h 12m'},
      {name:'DVX032FHQCKV-01',env:'Development', lastSeen:'2h ago', duration:'2h 12m'},
    ];
    const unmatched = [
      {raw:'tc1ccmpub1', source:'PATCHING_HTML', times:28, first:'Mar 24, 2026', closest:null},
      {raw:'tc1cssm1',   source:'PATCHING_HTML', times:28, first:'Mar 24, 2026', closest:null},
      {raw:'hxb20290',   source:'PATCHING_HTML', times:28, first:'Mar 24, 2026', closest:null},
      {raw:'hxd20204',   source:'PATCHING_HTML', times:28, first:'Mar 24, 2026', closest:null},
      {raw:'hxs22510',   source:'PATCHING_HTML', times:28, first:'Mar 24, 2026', closest:null},
      {raw:'hxe20290',   source:'PATCHING_HTML', times:28, first:'Mar 24, 2026', closest:null},
      {raw:'dc1vplay1',  source:'PATCHING_HTML', times:28, first:'Mar 24, 2026', closest:null},
      {raw:'hxp20290',   source:'PATCHING_HTML', times:28, first:'Mar 24, 2026', closest:null},
      {raw:'dc1vplay2',  source:'PATCHING_HTML', times:28, first:'Mar 24, 2026', closest:null},
      {raw:'hxp22510',   source:'PATCHING_HTML', times:28, first:'Mar 24, 2026', closest:null},
    ];
    return {servers, unreachable, unmatched};
  }
  const SRV = buildServers();
  window.SERVERS_DATA = { SRV_ENV, SRV_TOTAL, SRV_ENV_MAX, ...SRV };

  // ================================================================
  // DATA — CERTIFICATES
  // ================================================================
  function buildCerts() {
    const rng = (() => { let s = 0xCE271F; return () => (s = (s*1103515245 + 12345) >>> 0) / 0x100000000; })();
    const certs = [];
    // 2 expired
    certs.push({name:'kandr_sanctions.hiscox.com', server:'PR0604-26002-00', service:'fcrm',            expires:'Apr 12, 2026', days:-9,  level:'expired'});
    certs.push({name:'kandr_sanctions.hiscox.com', server:'KNR-Prod',        service:'fcrm',            expires:'Apr 12, 2026', days:-9,  level:'expired'});
    // 2 critical (<14d)
    certs.push({name:'dv0702-14001-00.hiscox.com', server:'DV0702-14001-00', service:'tosca',           expires:'Apr 22, 2026', days:1,   level:'crit'});
    certs.push({name:'signal.hiscox.de',           server:'Signal Germany',  service:'signal',          expires:'May 1, 2026',  days:10,  level:'crit'});
    // 4 warning (15-30d)
    certs.push({name:'alteryx.hiscox.com',         server:'PR0602-11001-00', service:'alteryx',         expires:'May 15, 2026', days:24,  level:'warn'});
    certs.push({name:'alteryx.hiscox.com',         server:'Alteryx-Prod',    service:'alteryx',         expires:'May 15, 2026', days:24,  level:'warn'});
    certs.push({name:'alteryx-staging.hiscox.com', server:'ST0602-11001-00', service:'alteryx',         expires:'May 15, 2026', days:24,  level:'warn'});
    certs.push({name:'alteryx-staging.hiscox.com', server:'Alteryx-Staging', service:'alteryx',         expires:'May 15, 2026', days:24,  level:'warn'});
    // Fill with OK certs
    const services = ['exchange_online','citrix','webmethods','active_directory','api-gateway','ldap','mail','portal','cache','metrics'];
    const suffixes = ['hiscox.com','hiscox.co.uk','hiscox.de','internal.hiscox.com','corp.hiscox.com'];
    let ok = 0;
    while (ok < 192) {
      const block = String(Math.floor(rng()*90000) + 10000).slice(0,5);
      const seq = String(Math.floor(rng()*99)).padStart(2,'0');
      const host = (Math.floor(rng()*4) === 0 ? 'pr' : 'dv') + block + '-' + String(Math.floor(rng()*900)+100).padStart(3,'0') + '-' + seq;
      certs.push({
        name: host + '.' + suffixes[Math.floor(rng()*suffixes.length)],
        server: host.toUpperCase(),
        service: services[Math.floor(rng()*services.length)],
        expires: ['May 22, 2026','Jun 7, 2026','Jun 10, 2026','Jul 3, 2026','Aug 14, 2026','Sep 2, 2026','Oct 19, 2026'][Math.floor(rng()*7)],
        days: 30 + Math.floor(rng()*300),
        level: 'ok',
      });
      ok++;
    }
    return certs;
  }
  const CERTS = buildCerts();
  const CERT_COUNTS = CERTS.reduce((a, c) => (a[c.level] = (a[c.level]||0) + 1, a), {});
  window.CERTS_DATA = { CERTS, CERT_COUNTS };

  // ================================================================
  // DATA — END OF LIFE
  // ================================================================
  const EOL_PRODUCTS = [
    {product:'mssqlserver',    version:'11.0', eol:'Jan 14, 2014', ext:'Jul 8, 2025',  status:'eol',       servers:400},
    {product:'windows-server', version:'2022', eol:'Oct 14, 2031', ext:null,           status:'supported', servers:393},
    {product:'windows-server', version:'2016', eol:'Jan 12, 2027', ext:null,           status:'supported', servers:319},
    {product:'windows-server', version:'2019', eol:'Jan 9, 2029',  ext:null,           status:'supported', servers:192},
    {product:'windows-server', version:'2025', eol:'Oct 10, 2034', ext:null,           status:'supported', servers:167},
    {product:'mssqlserver',    version:'13.0', eol:'Jan 9, 2018',  ext:'Jul 17, 2029', status:'extended',  servers:157},
    {product:'mssqlserver',    version:'14.0', eol:'Oct 12, 2027', ext:null,           status:'supported', servers:111},
    {product:'mssqlserver',    version:'12.0', eol:'Jul 12, 2016', ext:'Jul 12, 2027', status:'extended',  servers:107},
    {product:'mssqlserver',    version:'15.0', eol:'Jan 8, 2030',  ext:null,           status:'supported', servers:89},
    {product:'mssqlserver',    version:'16.0', eol:'Jan 11, 2033', ext:null,           status:'supported', servers:85},
    {product:'centos',         version:'7',    eol:'Jun 30, 2024', ext:null,           status:'eol',       servers:12},
  ];
  const EOL_COUNTS = EOL_PRODUCTS.reduce((a, p) => (a[p.status] = (a[p.status]||0) + p.servers, a), {});
  const EOL_TOTALS = {
    products: EOL_PRODUCTS.length,
    eol: EOL_PRODUCTS.filter(p => p.status === 'eol').length,
    extended: EOL_PRODUCTS.filter(p => p.status === 'extended').length,
    approaching: 0, // none within 6 months in this dataset
    supported: EOL_PRODUCTS.filter(p => p.status === 'supported').length,
    affected: EOL_PRODUCTS.filter(p => p.status === 'eol').reduce((s,p) => s+p.servers, 0),
  };
  window.EOL_DATA = { EOL_PRODUCTS, EOL_COUNTS, EOL_TOTALS };

  // Stable per-product FQDN list so the search can match hosts and
  // the expansion panel renders the same names every time.
  const EOL_HOST_CACHE = new Map();
  function eolHostsFor(product, version, status, servers, i) {
    const key = product + '@' + version;
    if (EOL_HOST_CACHE.has(key)) return EOL_HOST_CACHE.get(key);
    const domains = ['hiscox.com','internal.hiscox.com','corp.hiscox.com','aws.hiscox.com','azure.hiscox.com'];
    const prefix = status==='eol' ? 'PR' : status==='extended' ? 'EX' : 'DV';
    const list = [];
    for (let j = 1; j <= servers; j++) {
      const block = String(5000 + (i*37 + j*29) % 4999).padStart(4,'0');
      const n = String((i*11 + j) % 99).padStart(2,'0');
      const host = prefix + '0' + String(j%9+1) + (j%10) + '-' + block + '-' + n;
      const fqdn = host.toLowerCase() + '.' + domains[(i*3 + j) % domains.length];
      list.push({ idx: j, host, fqdn });
    }
    EOL_HOST_CACHE.set(key, list);
    return list;
  }

  // ================================================================
  // Shared helpers
  // ================================================================
  function sectionLabel(label, count, rightExtra) {
    const el = h('div.section-label', null,
      h('span', null, label),
      count != null ? h('span.count', null, String(count)) : null,
    );
    if (rightExtra) el.appendChild(rightExtra);
    return el;
  }

  function stamp(kind, text) {
    // Reuses .affected-chip visual vocabulary — tone classes crit/warn/ok/info
    return h('span.affected-chip.'+kind, null, text);
  }

  function filterBar(children) {
    const bar = h('div.filters');
    children.filter(Boolean).forEach(c => bar.appendChild(c));
    return bar;
  }

  function paginate(total, page, per) {
    const pages = Math.max(1, Math.ceil(total / per));
    const cur = Math.min(Math.max(1, page), pages);
    return { pages, cur, start: (cur-1)*per, end: Math.min(total, cur*per) };
  }

  // Highlight all occurrences of `q` (case-insensitive) inside `text`.
  // Returns a document fragment safe to drop into any cell.
  // Map env display name → stable CSS slug for colour assignment.
  function envSlug(name) {
    return (name || '').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') || 'other';
  }

  function mark(text, q) {    const frag = document.createDocumentFragment();
    const s = String(text ?? '');
    if (!q) { frag.appendChild(document.createTextNode(s)); return frag; }
    const needle = q.trim().toLowerCase();
    if (!needle) { frag.appendChild(document.createTextNode(s)); return frag; }
    const hay = s.toLowerCase();
    let i = 0;
    while (i < s.length) {
      const at = hay.indexOf(needle, i);
      if (at < 0) { frag.appendChild(document.createTextNode(s.slice(i))); break; }
      if (at > i) frag.appendChild(document.createTextNode(s.slice(i, at)));
      const m = document.createElement('mark');
      m.textContent = s.slice(at, at + needle.length);
      m.style.cssText = 'background:var(--warn-wash);color:var(--ink);padding:0 2px;font-weight:600;border-radius:1px;';
      frag.appendChild(m);
      i = at + needle.length;
    }
    return frag;
  }

  // ================================================================
  // SERVERS PAGE
  // ================================================================
  // Per-page UI state. Kept outside React-ish state since we control render.
  const srvState = {
    q: '',
    env: '__all',
    sort: 'name',
    sortDir: 1,
    page: 1,
    per: 50,
  };
  const srvUnmatchedState = { q: '', page: 1, per: 10 };

  function applyServerFilters() {
    const q = srvState.q.trim().toLowerCase();
    let rows = SRV.servers;
    if (srvState.env !== '__all') rows = rows.filter(r => r.env === srvState.env);
    if (q) rows = rows.filter(r =>
      r.name.toLowerCase().includes(q) ||
      r.fqdn.toLowerCase().includes(q) ||
      r.app.toLowerCase().includes(q) ||
      r.pg.toLowerCase().includes(q) ||
      r.env.toLowerCase().includes(q));
    const key = srvState.sort;
    const dir = srvState.sortDir;
    rows = rows.slice().sort((a, b) => {
      const av = a[key], bv = b[key];
      if (av < bv) return -1 * dir;
      if (av > bv) return  1 * dir;
      return 0;
    });
    return rows;
  }

  function renderServersPage(mount) {
    const page = h('div.page');

    // Inventory count + env split
    const inv = h('div.split.wide-left', null,
      (function(){
        const col = h('div');
        col.appendChild(sectionLabel('Server inventory'));
        col.appendChild(h('div.inv-card', null,
          h('div.inv-big', null, SRV_TOTAL.toLocaleString()),
          h('div.inv-lbl', null, 'active servers tracked'),
          h('div.inv-sub', null,
            h('span', null, h('b', null, String(SRV.unreachable.length)), ' unreachable'),
            ' · ',
            h('span', null, h('b', null, String(SRV.unmatched.length)), ' unmatched'),
          ),
        ));
        return col;
      })(),
      (function(){
        const col = h('div');
        const envActive = srvState.env && srvState.env !== '__all';
        col.appendChild(sectionLabel(
          'Servers by environment',
          SRV_ENV.length,
          envActive ? h('button.btn.xs', {
            style:{marginLeft:'auto'},
            on:{click:()=>{ srvState.env='__all'; srvState.page=1; window.RERENDER_PAGE(mount); }},
          }, 'Clear filter') : null,
        ));
        const bars = h('div.env-bars');
        SRV_ENV.forEach(e => {
          const w = Math.max(2, Math.round(e.count / SRV_ENV_MAX * 100));
          const slug = envSlug(e.name);
          const isActive = srvState.env === e.name;
          const classes = 'div.env-row.env-'+slug + (isActive ? '.is-active' : '');
          const row = h(classes,
            { role:'button', 'aria-pressed':String(isActive), tabindex:'0',
              on:{click:()=>{
                srvState.env = isActive ? '__all' : e.name;
                srvState.page = 1;
                window.RERENDER_PAGE(mount);
              }} },
            h('div.name', null, e.name),
            h('div.bar', null, h('div.fill', {style:{width:w+'%'}})),
            h('div.count', null, e.count.toLocaleString()),
          );
          bars.appendChild(row);
        });
        col.appendChild(bars);
        return col;
      })(),
    );
    page.appendChild(inv);

    // Inventory table section
    const rows = applyServerFilters();
    const pag = paginate(rows.length, srvState.page, srvState.per);
    srvState.page = pag.cur;
    const paged = rows.slice(pag.start, pag.end);

    page.appendChild(sectionLabel('Server inventory', rows.length.toLocaleString()));

    const envOpts = [['__all','All environments']].concat(SRV_ENV.map(e => [e.name, e.name + ' ('+e.count+')']));
    const search = h('input', {'data-fk':'servers-search', 
      type:'text', placeholder:'Search name, FQDN, application, patch group…',
      value: srvState.q,
      on:{input:(e)=>{ srvState.q = e.target.value; srvState.page = 1; window.RERENDER_PAGE(mount); }},
    });
    const envSel = h('select', { on:{change:(e)=>{ srvState.env = e.target.value; srvState.page = 1; window.RERENDER_PAGE(mount); }}},
      envOpts.map(([v,l]) => h('option'+(srvState.env===v?'.on':''), {value:v, selected: srvState.env===v}, l)));
    const clearBtn = h('button.btn', { on:{click:()=>{ srvState.q=''; srvState.env='__all'; srvState.page=1; window.RERENDER_PAGE(mount); }}}, 'Reset');
    const exportBtn = h('button.btn', { on:{click:()=>exportCsv('servers', rows, ['name','fqdn','env','app','pg','active'])}}, 'Export CSV');
    const count = h('span.ct', null, 'Showing ' + (pag.start+1) + '–' + pag.end + ' of ' + rows.length.toLocaleString());
    page.appendChild(filterBar([search, envSel, clearBtn, h('span.spacer'), count, exportBtn]));

    const tbl = h('div.table-wrap');
    const table = h('table.op');
    const sortableTh = (key, label, extraCls) => {
      const on = srvState.sort === key;
      const th = h('th'+(extraCls?'.'+extraCls:'')+'.sortable'+(on?'.sorted':''),
        { on:{click:()=>{
          if (srvState.sort === key) srvState.sortDir *= -1;
          else { srvState.sort = key; srvState.sortDir = 1; }
          window.RERENDER_PAGE(mount);
        }}},
        label,
        h('span.caret', null, on ? (srvState.sortDir === 1 ? '↑' : '↓') : '·'),
      );
      return th;
    };
    table.appendChild(h('thead', null, h('tr', null,
      sortableTh('name','Name'),
      sortableTh('fqdn','FQDN'),
      sortableTh('env','Environment'),
      sortableTh('app','Application'),
      sortableTh('pg','Patch group'),
      sortableTh('active','Active'),
    )));
    const tbody = h('tbody');
    const q = srvState.q;
    paged.forEach(r => {
      const activeCell = r.active
        ? h('td', null, h('span.badge.ok', null, h('span.dot'), 'Active'))
        : h('td', null, h('span.badge.crit', null, h('span.dot'), 'Inactive'));
      tbody.appendChild(h('tr'+(r.active?'':'.sev-crit'), null,
        h('td.host', null, mark(r.name, q)),
        h('td.muted', null, mark(r.fqdn, q)),
        h('td', null, h('span.env-tag', null, mark(r.env, q))),
        h('td.muted', null, mark(r.app, q)),
        h('td', null, h('span.badge'+(r.pg==='NO PATCH GROUP FOUND'?'.warn':''), null, r.pg==='NO PATCH GROUP FOUND'?null:h('span.dot'), mark(r.pg, q))),
        activeCell,
      ));
    });
    if (paged.length === 0) {
      tbody.appendChild(h('tr', null, h('td', {colspan:6}, h('div.no-hits', null, 'No servers match ', h('b', null, srvState.q || srvState.env)))));
    }
    table.appendChild(tbody);
    tbl.appendChild(table);
    tbl.appendChild(paginationBar(pag, p => { srvState.page = p; window.RERENDER_PAGE(mount); }));
    page.appendChild(tbl);

    // Unreachable (errors — made loud)
    page.appendChild(sectionLabel('Unreachable hosts', SRV.unreachable.length, h('span.ct', {style:{marginLeft:'auto'}}, 'no check-in · manual investigation')));
    const utbl = h('div.table-wrap');
    const ut = h('table.op');
    ut.appendChild(h('thead', null, h('tr', null,
      h('th', null, 'Host'),
      h('th', null, 'Environment'),
      h('th', null, 'Last seen'),
      h('th', null, 'Offline for'),
      h('th', null, 'Severity'),
    )));
    const utb = h('tbody');
    SRV.unreachable.forEach(r => {
      utb.appendChild(h('tr.sev-crit', null,
        h('td.host', null, r.name),
        h('td', null, h('span.env-tag', null, r.env)),
        h('td.muted', null, r.lastSeen),
        h('td', null, r.duration),
        h('td', null, stamp('crit','UNREACHABLE')),
      ));
    });
    ut.appendChild(utb);
    utbl.appendChild(ut);
    page.appendChild(utbl);

    // Unmatched (kept at the bottom)
    const uq = srvUnmatchedState.q.toLowerCase();
    let urows = SRV.unmatched;
    if (uq) urows = urows.filter(r => r.raw.toLowerCase().includes(uq) || r.source.toLowerCase().includes(uq));
    const upag = paginate(urows.length, srvUnmatchedState.page, srvUnmatchedState.per);
    srvUnmatchedState.page = upag.cur;
    const upaged = urows.slice(upag.start, upag.end);

    page.appendChild(sectionLabel('Unmatched servers', urows.length));
    const usearch = h('input', {'data-fk':'servers-unmatched-search',  type:'text', placeholder:'Filter unmatched…', value: srvUnmatchedState.q,
      on:{input:(e)=>{ srvUnmatchedState.q = e.target.value; srvUnmatchedState.page = 1; window.RERENDER_PAGE(mount); }}});
    page.appendChild(filterBar([usearch]));

    const unmTbl = h('div.table-wrap');
    const unm = h('table.op');
    unm.appendChild(h('thead', null, h('tr', null,
      h('th', null, 'Raw name'),
      h('th', null, 'Source'),
      h('th', null, 'Times seen'),
      h('th', null, 'First seen'),
      h('th', null, 'Closest match'),
      h('th', null, 'Actions'),
    )));
    const unmBody = h('tbody');
    const uq2 = srvUnmatchedState.q;
    upaged.forEach(r => {
      const searchInput = h('input', {'data-fk':'rename-server-search',  type:'text', placeholder:'Search server…',
        style:{height:'28px',padding:'0 10px',border:'1px solid var(--rule-2)',fontSize:'12px',background:'var(--card)',width:'140px'}});
      unmBody.appendChild(h('tr', null,
        h('td.host', null, mark(r.raw, uq2)),
        h('td', null, h('span.badge.info', null, h('span.dot'), mark(r.source, uq2))),
        h('td.num', null, String(r.times)),
        h('td.muted', null, r.first),
        h('td.muted', null, r.closest || '—'),
        h('td', null, h('div', {style:{display:'flex',gap:'6px',alignItems:'center',flexWrap:'wrap'}},
          h('button.btn', { on:{click:()=>toast('Linked '+r.raw)}}, 'Link'),
          h('button.btn', { on:{click:()=>toast('Ignored '+r.raw)}}, 'Ignore'),
          searchInput,
          h('button.btn.danger', { on:{click:()=>toast('Linked '+r.raw+' → '+(searchInput.value||'…'))}}, 'Link'),
        )),
      ));
    });
    unm.appendChild(unmBody);
    unmTbl.appendChild(unm);
    unmTbl.appendChild(paginationBar(upag, p => { srvUnmatchedState.page = p; window.RERENDER_PAGE(mount); }));
    page.appendChild(unmTbl);

    mount.innerHTML = '';
    mount.appendChild(page);
  }

  // ================================================================
  // CERTIFICATES PAGE
  // ================================================================
  const certState = { q:'', level:'__all', sort:'days', sortDir:1, page:1, per:20 };

  function applyCertFilters() {
    const q = certState.q.trim().toLowerCase();
    let rows = CERTS;
    if (certState.level !== '__all') rows = rows.filter(r => r.level === certState.level);
    if (q) rows = rows.filter(r =>
      r.name.toLowerCase().includes(q) ||
      r.server.toLowerCase().includes(q) ||
      r.service.toLowerCase().includes(q));
    const key = certState.sort;
    const dir = certState.sortDir;
    rows = rows.slice().sort((a, b) => {
      const av = a[key], bv = b[key];
      if (av < bv) return -1 * dir;
      if (av > bv) return  1 * dir;
      return 0;
    });
    return rows;
  }

  function renderCertsPage(mount) {
    const page = h('div.page');

    // Hero status strip with STAMPED expired/crit counts — replaces the quiet tiles
    const strip = h('div.crit-strip');
    const actionRequired = (CERT_COUNTS.expired||0) + (CERT_COUNTS.crit||0) + (CERT_COUNTS.warn||0);

    strip.appendChild(h('div.cs-cell.status-cell'+(CERT_COUNTS.expired>0?'.crit':CERT_COUNTS.crit>0?'.crit':CERT_COUNTS.warn>0?'.warn':'.ok'),
      { on:{click:()=>{ certState.level=CERT_COUNTS.expired>0?'expired':'crit'; certState.page=1; window.RERENDER_PAGE(mount); }}},
      h('div.cs-label', null, 'Certificates · action required'),
      h('div.cs-value', null, String(actionRequired),
        h('span.cs-unit', null, 'of '+CERTS.length+' total')),
      h('div.cs-sub', null, CERT_COUNTS.expired>0 ? 'Immediate intervention required' : CERT_COUNTS.crit>0 ? 'Expiring within 14 days' : CERT_COUNTS.warn>0 ? 'Within 30-day warning window' : 'All certificates healthy'),
      h('div.cs-link', null, 'Filter to action-required'),
    ));

    strip.appendChild(h('div.cs-cell.crit', { on:{click:()=>{ certState.level='expired'; certState.page=1; window.RERENDER_PAGE(mount); }}},
      h('div.cs-label', null, 'Expired'),
      h('div.cs-value', null, String(CERT_COUNTS.expired||0), h('span.cs-unit', null, 'past expiry')),
      h('div.cs-sub', null, 'TLS handshakes will fail'),
      CERT_COUNTS.expired>0 ? h('div.cs-link', null, 'Show expired') : null,
    ));

    strip.appendChild(h('div.cs-cell.crit', { on:{click:()=>{ certState.level='crit'; certState.page=1; window.RERENDER_PAGE(mount); }}},
      h('div.cs-label', null, 'Critical'),
      h('div.cs-value', null, String(CERT_COUNTS.crit||0), h('span.cs-unit', null, '≤ 14 days')),
      h('div.cs-sub', null, 'Rotate now'),
      CERT_COUNTS.crit>0 ? h('div.cs-link', null, 'Show critical') : null,
    ));

    strip.appendChild(h('div.cs-cell.warn', { on:{click:()=>{ certState.level='warn'; certState.page=1; window.RERENDER_PAGE(mount); }}},
      h('div.cs-label', null, 'Warning'),
      h('div.cs-value', null, String(CERT_COUNTS.warn||0), h('span.cs-unit', null, '≤ 30 days')),
      h('div.cs-sub', null, 'Plan rotation'),
      CERT_COUNTS.warn>0 ? h('div.cs-link', null, 'Show warning') : null,
    ));

    strip.appendChild(h('div.cs-cell.ok', { on:{click:()=>{ certState.level='ok'; certState.page=1; window.RERENDER_PAGE(mount); }}},
      h('div.cs-label', null, 'Healthy'),
      h('div.cs-value', null, String(CERT_COUNTS.ok||0), h('span.cs-unit', null, '>30 days')),
      h('div.cs-sub', null, 'No action needed'),
    ));
    page.appendChild(strip);

    // Proportion bar — keeps the legacy visual
    const total = CERTS.length;
    const wExp = ((CERT_COUNTS.expired||0)/total*100);
    const wCri = ((CERT_COUNTS.crit||0)/total*100);
    const wWar = ((CERT_COUNTS.warn||0)/total*100);
    const wOk  = ((CERT_COUNTS.ok ||0)/total*100);
    const propRow = h('div.cert-proportion',
      {style:{display:'flex',alignItems:'center',gap:'14px',padding:'14px 18px',border:'1px solid var(--rule)',background:'var(--card)'}},
      h('div', {style:{flex:'1',height:'10px',display:'flex',overflow:'hidden',borderRadius:'2px'}},
        wExp>0 ? h('span', {style:{width:wExp+'%',background:'var(--ink)'}}) : null,
        wCri>0 ? h('span', {style:{width:wCri+'%',background:'var(--crit)'}}) : null,
        wWar>0 ? h('span', {style:{width:wWar+'%',background:'var(--warn)'}}) : null,
        wOk >0 ? h('span', {style:{width:wOk+'%',background:'var(--ok)'}}) : null,
      ),
      h('div', {style:{display:'flex',gap:'14px',fontFamily:'var(--mono)',fontSize:'10.5px',letterSpacing:'0.08em',textTransform:'uppercase',color:'var(--ink-3)'}},
        h('span', null, h('b', {style:{color:'var(--ink)'}}, String(CERT_COUNTS.expired||0)), ' expired'),
        h('span', null, h('b', {style:{color:'var(--crit)'}}, String(CERT_COUNTS.crit||0)), ' critical'),
        h('span', null, h('b', {style:{color:'var(--warn)'}}, String(CERT_COUNTS.warn||0)), ' warning'),
        h('span', null, h('b', {style:{color:'var(--ok)'}}, String(CERT_COUNTS.ok||0)), ' ok'),
      ),
    );
    page.appendChild(propRow);

    // Filter row
    const levelOpts = [
      ['__all','All levels ('+CERTS.length+')'],
      ['expired','Expired ('+(CERT_COUNTS.expired||0)+')'],
      ['crit','Critical ('+(CERT_COUNTS.crit||0)+')'],
      ['warn','Warning ('+(CERT_COUNTS.warn||0)+')'],
      ['ok','OK ('+(CERT_COUNTS.ok||0)+')'],
    ];
    const rows = applyCertFilters();
    const pag = paginate(rows.length, certState.page, certState.per);
    certState.page = pag.cur;
    const paged = rows.slice(pag.start, pag.end);

    const levelSel = h('select', { on:{change:(e)=>{ certState.level=e.target.value; certState.page=1; window.RERENDER_PAGE(mount); }}},
      levelOpts.map(([v,l]) => h('option', {value:v, selected: certState.level===v}, l)));
    const q = h('input', {'data-fk':'certs-search', type:'text', placeholder:'Filter by server or service…', value: certState.q,
      on:{input:(e)=>{ certState.q=e.target.value; certState.page=1; window.RERENDER_PAGE(mount); }}});
    const reset = h('button.btn', { on:{click:()=>{ certState.q=''; certState.level='__all'; certState.page=1; window.RERENDER_PAGE(mount); }}}, 'Reset');
    const exportBtn = h('button.btn', { on:{click:()=>exportCsv('certificates', rows, ['name','server','service','expires','days','level'])}}, 'Export CSV');
    const count = h('span.ct', null, 'Showing ' + (pag.start+1) + '–' + pag.end + ' of ' + rows.length);
    page.appendChild(filterBar([levelSel, q, reset, h('span.spacer'), count, exportBtn]));

    const tbl = h('div.table-wrap');
    const table = h('table.op');
    const sortableTh = (key, label, extraCls) => {
      const on = certState.sort === key;
      return h('th'+(extraCls?'.'+extraCls:'')+'.sortable'+(on?'.sorted':''),
        { on:{click:()=>{
          if (certState.sort===key) certState.sortDir *= -1;
          else { certState.sort=key; certState.sortDir=1; }
          window.RERENDER_PAGE(mount);
        }}},
        label, h('span.caret', null, on ? (certState.sortDir===1?'↑':'↓') : '·'));
    };
    table.appendChild(h('thead', null, h('tr', null,
      sortableTh('name','Certificate name'),
      sortableTh('server','Server'),
      sortableTh('service','Service'),
      sortableTh('expires','Expires'),
      sortableTh('days','Days left'),
      h('th', null, 'Alert level'),
    )));
    const tbody = h('tbody');
    const levelChip = (lvl) => {
      if (lvl === 'expired') return stamp('crit', 'EXPIRED');
      if (lvl === 'crit')    return stamp('crit', 'CRITICAL');
      if (lvl === 'warn')    return stamp('warn', 'WARNING');
      return stamp('ok', 'OK');
    };
    const rowCls = (lvl) => lvl === 'expired' || lvl === 'crit' ? '.sev-crit' : lvl === 'warn' ? '.sev-warn' : '';
    const cq = certState.q;
    paged.forEach(r => {
      tbody.appendChild(h('tr'+rowCls(r.level), null,
        h('td.host', null, mark(r.name, cq)),
        h('td.muted', null, mark(r.server, cq)),
        h('td.muted', null, mark(r.service, cq)),
        h('td', null, r.expires),
        h('td.num'+((r.level==='expired'||r.level==='crit')?'.strong':''),
          {style: r.level==='expired'?{color:'var(--crit)',fontWeight:'600'}:r.level==='crit'?{color:'var(--crit)',fontWeight:'600'}:r.level==='warn'?{color:'var(--warn)',fontWeight:'600'}:null},
          (r.days<0?r.days+'d':r.days+'d')),
        h('td', null, levelChip(r.level)),
      ));
    });
    if (paged.length === 0) {
      tbody.appendChild(h('tr', null, h('td', {colspan:6}, h('div.no-hits', null, 'No certificates match filter'))));
    }
    table.appendChild(tbody);
    tbl.appendChild(table);
    tbl.appendChild(paginationBar(pag, p => { certState.page = p; window.RERENDER_PAGE(mount); }));
    page.appendChild(tbl);

    mount.innerHTML = '';
    mount.appendChild(page);
  }

  // ================================================================
  // END OF LIFE PAGE
  // ================================================================
  const eolState = { q:'', status:'__all', showAll:false, sort:'servers', sortDir:-1, expanded:{} };

  function applyEolFilters() {
    const q = eolState.q.trim().toLowerCase();
    let rows = EOL_PRODUCTS.slice();
    if (eolState.status !== '__all') rows = rows.filter(r => r.status === eolState.status);
    if (q) {
      const origIndex = new Map(EOL_PRODUCTS.map((p, i) => [p, i]));
      rows = rows.filter(r => {
        if (r.product.toLowerCase().includes(q)) return true;
        if (String(r.version).toLowerCase().includes(q)) return true;
        // match against generated FQDNs/hosts for this product
        const hosts = eolHostsFor(r.product, r.version, r.status, r.servers, origIndex.get(r));
        return hosts.some(hh => hh.fqdn.includes(q) || hh.host.toLowerCase().includes(q));
      });
    }
    const key = eolState.sort;
    const dir = eolState.sortDir;
    rows = rows.slice().sort((a, b) => {
      const av = a[key], bv = b[key];
      if (av < bv) return -1 * dir;
      if (av > bv) return  1 * dir;
      return 0;
    });
    return rows;
  }

  function renderEolPage(mount) {
    const page = h('div.page');

    // Hero strip — STAMPED EOL counts (loud)
    const strip = h('div.crit-strip');
    strip.appendChild(h('div.cs-cell.status-cell'+(EOL_TOTALS.eol>0?'.crit':EOL_TOTALS.extended>0?'.warn':'.ok'),
      { on:{click:()=>{ eolState.status = EOL_TOTALS.eol>0?'eol':'extended'; window.RERENDER_PAGE(mount); }}},
      h('div.cs-label', null, 'End of life · action required'),
      h('div.cs-value', null, String(EOL_TOTALS.eol + EOL_TOTALS.extended),
        h('span.cs-unit', null, 'of '+EOL_TOTALS.products+' products')),
      h('div.cs-sub', null, EOL_TOTALS.affected.toLocaleString()+' servers affected — migration required'),
      h('div.cs-link', null, 'Show affected'),
    ));
    strip.appendChild(h('div.cs-cell.crit', { on:{click:()=>{ eolState.status='eol'; window.RERENDER_PAGE(mount); }}},
      h('div.cs-label', null, 'End of life'),
      h('div.cs-value', null, String(EOL_TOTALS.eol), h('span.cs-unit', null, 'past all support')),
      h('div.cs-sub', null, 'No patches, no vendor help'),
      EOL_TOTALS.eol>0 ? h('div.cs-link', null, 'Show EOL') : null,
    ));
    strip.appendChild(h('div.cs-cell.warn', { on:{click:()=>{ eolState.status='extended'; window.RERENDER_PAGE(mount); }}},
      h('div.cs-label', null, 'Extended support'),
      h('div.cs-value', null, String(EOL_TOTALS.extended), h('span.cs-unit', null, 'paid support only')),
      h('div.cs-sub', null, 'Past EOL — support contract active'),
      EOL_TOTALS.extended>0 ? h('div.cs-link', null, 'Show extended') : null,
    ));
    strip.appendChild(h('div.cs-cell.warn', null,
      h('div.cs-label', null, 'Approaching EOL'),
      h('div.cs-value', null, String(EOL_TOTALS.approaching), h('span.cs-unit', null, 'within 6 months')),
      h('div.cs-sub', null, EOL_TOTALS.approaching>0 ? 'Plan migration now' : 'No imminent deadlines'),
    ));
    strip.appendChild(h('div.cs-cell.ok', { on:{click:()=>{ eolState.status='supported'; window.RERENDER_PAGE(mount); }}},
      h('div.cs-label', null, 'Supported'),
      h('div.cs-value', null, String(EOL_TOTALS.supported), h('span.cs-unit', null, 'currently supported')),
      h('div.cs-sub', null, 'No action needed'),
    ));
    page.appendChild(strip);

    // Filter bar
    const rows = applyEolFilters();
    const statusOpts = [
      ['__all','All statuses ('+EOL_PRODUCTS.length+')'],
      ['eol','End of life ('+EOL_TOTALS.eol+')'],
      ['extended','Extended support ('+EOL_TOTALS.extended+')'],
      ['supported','Supported ('+EOL_TOTALS.supported+')'],
    ];
    const statusSel = h('select', { on:{change:(e)=>{ eolState.status=e.target.value; window.RERENDER_PAGE(mount); }}},
      statusOpts.map(([v,l]) => h('option', {value:v, selected: eolState.status===v}, l)));
    const q = h('input', {'data-fk':'eol-search', type:'text', placeholder:'Filter by product, version, or FQDN…', value: eolState.q,
      on:{input:(e)=>{ eolState.q=e.target.value; window.RERENDER_PAGE(mount); }}});
    const reset = h('button.btn', { on:{click:()=>{ eolState.q=''; eolState.status='__all'; window.RERENDER_PAGE(mount); }}}, 'Reset');
    const exportBtn = h('button.btn', { on:{click:()=>exportCsv('end-of-life', rows, ['product','version','eol','ext','status','servers'])}}, 'Export CSV');
    const count = h('span.ct', null, 'Showing '+rows.length+' of '+EOL_PRODUCTS.length+' products');
    page.appendChild(filterBar([statusSel, q, reset, h('span.spacer'), count, exportBtn]));

    // Table with expandable rows
    const tbl = h('div.table-wrap');
    const table = h('table.op');
    const sortableTh = (key, label, extraCls) => {
      const on = eolState.sort === key;
      return h('th'+(extraCls?'.'+extraCls:'')+'.sortable'+(on?'.sorted':''),
        { on:{click:()=>{
          if (eolState.sort===key) eolState.sortDir *= -1;
          else { eolState.sort=key; eolState.sortDir=(key==='servers'?-1:1); }
          window.RERENDER_PAGE(mount);
        }}}, label, h('span.caret', null, on ? (eolState.sortDir===1?'↑':'↓') : '·'));
    };
    table.appendChild(h('thead', null, h('tr', null,
      sortableTh('product','Product'),
      sortableTh('version','Version'),
      sortableTh('eol','End of life'),
      sortableTh('ext','Extended support'),
      h('th', null, 'Status'),
      sortableTh('servers','Servers','num'),
    )));
    const tbody = h('tbody');
    const statusChip = (s) => s==='eol' ? stamp('crit','EOL') : s==='extended' ? stamp('warn','EXTENDED SUPPORT') : stamp('ok','SUPPORTED');
    const qStr = eolState.q.trim().toLowerCase();
    rows.forEach((r, i) => {
      const origIdx = EOL_PRODUCTS.indexOf(r);
      const hosts = eolHostsFor(r.product, r.version, r.status, r.servers, origIdx);
      const hostMatches = qStr ? hosts.filter(hh => hh.fqdn.includes(qStr) || hh.host.toLowerCase().includes(qStr)) : [];
      const hasHostMatch = hostMatches.length > 0;
      // Auto-expand if the product matches via hosts, or the user explicitly expanded
      const key = r.product + '@' + r.version;
      const isOpen = !!eolState.expanded[key] || hasHostMatch;
      const toggle = h('span', {style:{display:'inline-block',width:'12px',marginRight:'4px',color:'var(--ink-3)'}}, isOpen ? '▾' : '▸');
      const rowCls = r.status==='eol' ? '.sev-crit' : r.status==='extended' ? '.sev-warn' : '';
      const matchBadge = hasHostMatch
        ? h('span', {style:{marginLeft:'10px',fontFamily:'var(--mono)',fontSize:'10px',letterSpacing:'0.08em',textTransform:'uppercase',color:'var(--signal)',background:'var(--signal-wash)',padding:'2px 6px',border:'1px solid var(--signal)'}},
            hostMatches.length + ' host ' + (hostMatches.length===1?'match':'matches'))
        : null;
      const tr = h('tr'+rowCls, {style:{cursor:'pointer'},
        on:{click:()=>{ eolState.expanded[key] = !(eolState.expanded[key] || hasHostMatch); window.RERENDER_PAGE(mount); }}},
        h('td.host', null, toggle, mark(r.product, qStr), matchBadge),
        h('td', null, mark(String(r.version), qStr)),
        h('td'+(r.status==='eol'?'.strong':'.muted'), {style: r.status==='eol'?{color:'var(--crit)'}:null}, r.eol),
        h('td.muted', null, r.ext || '—'),
        h('td', null, statusChip(r.status)),
        h('td.num.strong', null, r.servers.toLocaleString()),
      );
      tbody.appendChild(tr);
      if (isOpen) {
        const shown = hasHostMatch ? hostMatches : hosts;
        const affected = h('tr', null, h('td', {colspan:6, style:{padding:'0'}},
          (function(){
            const wrap = h('div', {style:{padding:'14px 20px',background:'var(--paper-2)',borderLeft:'3px solid var(--crit)'}});
            const hdr = h('div', {style:{fontFamily:'var(--mono)',fontSize:'10.5px',letterSpacing:'0.14em',textTransform:'uppercase',color:'var(--ink-3)',marginBottom:'10px',display:'flex',alignItems:'center',gap:'14px'}},
              h('span', null, hasHostMatch ? 'Matching hosts \u00b7 ' : 'Affected servers \u00b7 ',
                h('b', {style:{color:'var(--ink)'}}, hasHostMatch ? (hostMatches.length + ' of ' + r.servers) : String(r.servers))));
            if (hasHostMatch) hdr.appendChild(h('a', {href:'#',
              style:{fontFamily:'var(--mono)',fontSize:'10.5px',color:'var(--signal)',textDecoration:'underline',cursor:'pointer'},
              on:{click:(e)=>{ e.preventDefault(); e.stopPropagation(); eolState.q=''; window.RERENDER_PAGE(mount); }}}, 'clear filter to show all'));
            wrap.appendChild(hdr);
            const grid = h('div', {style:{display:'grid',gridTemplateColumns:'repeat(2, 1fr)',gap:'2px 24px',fontFamily:'var(--mono)',fontSize:'11.5px',maxHeight:'420px',overflowY:'auto',paddingRight:'6px'}});
            shown.forEach(hh => {
              grid.appendChild(h('div', {style:{padding:'4px 0',borderBottom:'1px dashed var(--rule)',display:'flex',gap:'10px'}},
                h('span', {style:{color:'var(--ink-4)',minWidth:'34px'}}, String(hh.idx).padStart(4,' ')),
                h('span', null, mark(hh.fqdn, qStr)),
              ));
            });
            wrap.appendChild(grid);
            return wrap;
          })()
        ));
        tbody.appendChild(affected);
      }
    });
    table.appendChild(tbody);
    tbl.appendChild(table);
    page.appendChild(tbl);

    mount.innerHTML = '';
    mount.appendChild(page);
  }

  // ================================================================
  // PATCHING SCHEDULES (stub with hero + coming-next-pass card)
  // ================================================================
  function renderPatchingPage(mount) {
    const page = h('div.page');
    page.appendChild(h('div.patch-banner', null,
      h('div.countdown', null, h('span.n', null, '3'), h('span.unit', null, 'days')),
      h('div.meta', null,
        h('span.t', null, 'Next patch cycle'),
        h('span.d', null, 'Apr 23, 2026'),
        h('span.sub', null, '800 servers across 12 groups · no known blockers')),
      h('div.groups', null,
        ...[['2b',72],['4a',50],['7a',181],['3b',45],['5a',97],['7b',68],['3a',88],['5c',6],['6a',6],['5b',30],['2a',101],['4b',56]].map(([g,c]) =>
          h('div.group', null, h('span.gn', null, g), h('span.gbar', null, h('span', {style:{width:Math.min(100, c/181*100)+'%'}})), h('span.gc', null, String(c)))),
      ),
    ));
    page.appendChild(stubCard('Patch cycles, expandable schedules, and known issues will be rebuilt here next. Nav is live; Health/Servers/Certificates/End of Life are the primary surfaces this pass.'));
    mount.innerHTML = ''; mount.appendChild(page);
  }

  function renderPatchMgmtPage(mount) {
    const page = h('div.page');
    page.appendChild(stubCard('Exclude-from-patching workflow (search → select → reason/hold-until → confirm) and the currently-excluded table will land here. Servers/Certs/EOL are done; this is next.'));
    mount.innerHTML = ''; mount.appendChild(page);
  }

  function stubCard(msg) {
    return h('div', {style:{padding:'28px 32px',border:'1px dashed var(--rule-2)',background:'var(--card)',display:'flex',flexDirection:'column',gap:'10px'}},
      h('div', {style:{fontFamily:'var(--mono)',fontSize:'10.5px',letterSpacing:'0.14em',textTransform:'uppercase',color:'var(--ink-3)'}}, 'Coming next pass'),
      h('div', {style:{fontFamily:'var(--display)',fontSize:'22px',letterSpacing:'-0.01em',color:'var(--ink)',fontWeight:'400'}}, 'Surface scaffolded · functionality inbound'),
      h('div', {style:{fontSize:'13px',color:'var(--ink-2)',lineHeight:'1.5',maxWidth:'62ch'}}, msg),
    );
  }

  // ================================================================
  // Shared UI bits
  // ================================================================
  function paginationBar(pag, go) {
    const el = h('div.pagination');
    el.appendChild(h('div', null, 'Page ' + pag.cur + ' of ' + pag.pages + ' · ' + (pag.start+1) + '–' + pag.end));
    const pages = h('div.pages');
    pages.appendChild(h('button', { disabled: pag.cur === 1, on:{click:()=>go(pag.cur-1)}}, '← Prev'));
    // render up to 5 page numbers centred on cur
    const from = Math.max(1, pag.cur - 2);
    const to = Math.min(pag.pages, from + 4);
    for (let p = from; p <= to; p++) {
      pages.appendChild(h('button'+(p===pag.cur?'.on':''), { on:{click:()=>go(p)}}, String(p)));
    }
    pages.appendChild(h('button', { disabled: pag.cur === pag.pages, on:{click:()=>go(pag.cur+1)}}, 'Next →'));
    el.appendChild(pages);
    return el;
  }

  function exportCsv(name, rows, cols) {
    const esc = (v) => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const csv = [cols.join(',')].concat(rows.map(r => cols.map(c => esc(r[c])).join(','))).join('\n');
    const blob = new Blob([csv], {type:'text/csv'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name + '.csv'; a.click();
    setTimeout(()=>URL.revokeObjectURL(url), 1000);
    toast('Exported ' + rows.length + ' rows');
  }

  let toastEl;
  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      Object.assign(toastEl.style, {
        position:'fixed', bottom:'24px', left:'50%', transform:'translateX(-50%)',
        background:'var(--ink)', color:'var(--paper)', padding:'10px 18px',
        fontFamily:'var(--mono)', fontSize:'11px', letterSpacing:'0.08em', textTransform:'uppercase',
        zIndex:'200', borderRadius:'2px', boxShadow:'0 10px 30px rgba(0,0,0,0.3)',
        transition:'opacity 200ms', opacity:'0', pointerEvents:'none',
      });
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.style.opacity = '1';
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { toastEl.style.opacity = '0'; }, 1800);
  }

  // ================================================================
  // Expose
  // ================================================================
  window.RENDER_SERVERS  = renderServersPage;
  window.RENDER_CERTS    = renderCertsPage;
  window.RENDER_EOL      = renderEolPage;
  window.RENDER_PATCHING = renderPatchingPage;
  window.RENDER_PATCHMGMT= renderPatchMgmtPage;
})();
