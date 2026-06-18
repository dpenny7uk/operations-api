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

  // Shared DOM builder — defined in op-h.js, loaded before this script.
  const h = window.H;

  // ================================================================
  // ROUTER — hash-based, persists in localStorage via op-app.js state
  // ================================================================
  const ROUTES = [
    {id:'health',    idx:'01', label:'Health'},
    {id:'servers',   idx:'02', label:'Servers'},
    {id:'patching',  idx:'03', label:'Patching Schedules'},
    {id:'patchmgmt', idx:'04', label:'Patch Management'},
    {id:'certs',     idx:'05', label:'Certificates'},
    {id:'eol',       idx:'06', label:'End of Life'},
    {id:'disks',     idx:'07', label:'Disk Monitoring'},
    {id:'licensing', idx:'08', label:'Licensing'},
    {id:'auditing',  idx:'09', label:'Auditing'},
  ];

  // currentRoute returns the base route id (e.g. 'servers' for both '#servers'
  // and '#servers/42'). currentRouteParam returns the slash-suffix (e.g. '42'
  // for '#servers/42') or null. Pages dispatch on the base id and look at the
  // param to decide between inventory and detail views.
  function currentRoute() {
    const raw = (location.hash || '#health').replace(/^#/, '').toLowerCase();
    const base = raw.split('/')[0];
    return ROUTES.find(r => r.id === base) ? base : 'health';
  }

  function currentRouteParam() {
    const raw = (location.hash || '').replace(/^#/, '');
    const idx = raw.indexOf('/');
    return idx >= 0 ? raw.slice(idx + 1) : null;
  }

  function goto(id) {
    // Accept both bare ids ('servers') and parameterised forms ('servers/42').
    const base = (id || '').split('/')[0];
    if (!ROUTES.find(r => r.id === base)) id = 'health';
    if (location.hash !== '#' + id) {
      location.hash = '#' + id;
    } else {
      // hash unchanged — force a re-render
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    }
  }

  window.ROUTER = { ROUTES, currentRoute, currentRouteParam, goto };

  // Canonical business-unit values — mirrors derive_business_unit() in
  // sync/servers/sync_server_list.py. Used as the dropdown option list on
  // every BU filter across the app.
  const BU_VALUES = [
    'Contoso UK',
    'UK & I',
    'Contoso US',
    'Contoso Europe',
    'Contoso London Market',
    'Contoso Re & ILS',
    'Contoso Group Support',
    'Contoso Special Risks',
    'ITS',
    'Infosec',
    'Unknown',
  ];
  // Expose the static fallback list so op-app.js's BuScope() in the rail can
  // render dropdown options before /api/servers/summary resolves (or when it
  // fails). Once SERVERS_DATA.SRV_BU lands, BuScope prefers the live list.
  window.BU_VALUES = BU_VALUES;

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
    const fqdns = ['azure.contoso.com','contoso.com','aws.contoso.com','internal.contoso.com','corp.contoso.com'];
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
          bu: pick(BU_VALUES),
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

  // op-boot.js overwrites window.SERVERS_DATA with API data after fetch. The
  // render functions must read live-or-demo rather than the demo-only local
  // consts, otherwise the page stays pinned to synthesised rows.
  function liveSrv() {
    const D = window.SERVERS_DATA || {};
    const env = Array.isArray(D.SRV_ENV) && D.SRV_ENV.length ? D.SRV_ENV : SRV_ENV;
    const bu  = Array.isArray(D.SRV_BU) ? D.SRV_BU : [];
    return {
      servers:     Array.isArray(D.servers)     && D.servers.length     ? D.servers     : SRV.servers,
      unreachable: Array.isArray(D.unreachable)                         ? D.unreachable : SRV.unreachable,
      unmatched:   Array.isArray(D.unmatched)                           ? D.unmatched   : SRV.unmatched,
      env,
      bu,
      total: (D.SRV_TOTAL != null) ? D.SRV_TOTAL : SRV_TOTAL,
      envMax: env.length ? Math.max(...env.map(e => e.count)) : SRV_ENV_MAX,
    };
  }

  // ================================================================
  // DATA — CERTIFICATES
  // ================================================================
  function buildCerts() {
    const rng = (() => { let s = 0xCE271F; return () => (s = (s*1103515245 + 12345) >>> 0) / 0x100000000; })();
    const certs = [];
    // 2 expired
    certs.push({name:'kandr_sanctions.contoso.com', server:'PR0604-26002-00', service:'fcrm',            expires:'Apr 12, 2026', days:-9,  level:'expired'});
    certs.push({name:'kandr_sanctions.contoso.com', server:'KNR-Prod',        service:'fcrm',            expires:'Apr 12, 2026', days:-9,  level:'expired'});
    // 2 critical (<14d)
    certs.push({name:'dv0702-14001-00.contoso.com', server:'DV0702-14001-00', service:'tosca',           expires:'Apr 22, 2026', days:1,   level:'crit'});
    certs.push({name:'signal.contoso.de',           server:'Signal Germany',  service:'signal',          expires:'May 1, 2026',  days:10,  level:'crit'});
    // 4 warning (15-30d)
    certs.push({name:'alteryx.contoso.com',         server:'PR0602-11001-00', service:'alteryx',         expires:'May 15, 2026', days:24,  level:'warn'});
    certs.push({name:'alteryx.contoso.com',         server:'Alteryx-Prod',    service:'alteryx',         expires:'May 15, 2026', days:24,  level:'warn'});
    certs.push({name:'alteryx-staging.contoso.com', server:'ST0602-11001-00', service:'alteryx',         expires:'May 15, 2026', days:24,  level:'warn'});
    certs.push({name:'alteryx-staging.contoso.com', server:'Alteryx-Staging', service:'alteryx',         expires:'May 15, 2026', days:24,  level:'warn'});
    // Fill with OK certs
    const services = ['exchange_online','citrix','webmethods','active_directory','api-gateway','ldap','mail','portal','cache','metrics'];
    const suffixes = ['contoso.com','contoso.co.uk','contoso.de','internal.contoso.com','corp.contoso.com'];
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

  function liveCerts() {
    const D = window.CERTS_DATA || {};
    const list = Array.isArray(D.CERTS) && D.CERTS.length ? D.CERTS : CERTS;
    const counts = D.CERT_COUNTS && Object.keys(D.CERT_COUNTS).length ? D.CERT_COUNTS : CERT_COUNTS;
    return { list, counts };
  }

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

  function liveEol() {
    const D = window.EOL_DATA || {};
    const products = Array.isArray(D.EOL_PRODUCTS) && D.EOL_PRODUCTS.length ? D.EOL_PRODUCTS : EOL_PRODUCTS;
    const totals = D.EOL_TOTALS && Object.keys(D.EOL_TOTALS).length ? D.EOL_TOTALS : EOL_TOTALS;
    return { products, totals };
  }

  // Per-product affected-servers cache keyed by "product@version". Values:
  //   undefined       → never requested
  //   'loading'       → fetch in flight
  //   Array           → real machine_name list from /api/eol/{product}/{version}
  // On first access we kick off the fetch and return 'loading'; the fetch
  // populates the cache and re-renders the page. Callers must handle the
  // three states (null/loading/array).
  const EOL_HOST_CACHE = new Map();
  function eolCacheKey(product, version) {
    const bu = (window.SELECTED_BU && window.SELECTED_BU !== '__all') ? window.SELECTED_BU : '';
    return product + '@' + version + '@' + bu;
  }
  // Peek the cache without triggering a fetch. Returns undefined | 'loading' | Array.
  // Used by search-time host matching and the auto-expand check, both of which
  // must not fan out N+1 fetches across every row.
  function eolHostsCached(product, version) {
    return EOL_HOST_CACHE.get(eolCacheKey(product, version));
  }
  function eolHostsFor(product, version) {
    const key = eolCacheKey(product, version);
    const cached = EOL_HOST_CACHE.get(key);
    if (cached !== undefined) return cached;
    EOL_HOST_CACHE.set(key, 'loading');
    if (window.OC_API && window.OC_API.getEolDetail) {
      const bu = (window.SELECTED_BU && window.SELECTED_BU !== '__all') ? window.SELECTED_BU : null;
      window.OC_API.getEolDetail(product, version, bu).then(detail => {
        const assets = (detail && Array.isArray(detail.assets)) ? detail.assets : [];
        const list = assets.map((name, i) => ({
          idx: i + 1,
          host: String(name || ''),
          fqdn: String(name || '').toLowerCase(),
        }));
        EOL_HOST_CACHE.set(key, list);
        const m = document.querySelector('.page-mount');
        if (m && window.RERENDER_PAGE) window.RERENDER_PAGE(m);
      }).catch(() => { EOL_HOST_CACHE.delete(key); });
    }
    return 'loading';
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

  // Prepends a DEMO pill to a page when the endpoints powering it failed and
  // the view is showing the pre-seeded demo data instead of live data.
  function demoRibbon(widgetKey) {
    const set = (typeof window !== 'undefined' ? window.DEMO_WIDGETS : null);
    if (!set || !(set instanceof Set) || !set.has(widgetKey)) return null;
    return h('div.demo-ribbon-row', { role: 'status', 'aria-label': 'This widget is showing demo data' },
      h('span.demo-ribbon', null, 'DEMO DATA'),
      h('span.demo-ribbon-note', null, 'live fetch failed — figures below are placeholders, not current.'),
    );
  }

  function stamp(kind, text) {
    // Reuses .affected-chip visual vocabulary — tone classes crit/warn/ok/info
    // Unified chip (STEP 9): crit stamps go solid so loud states shout; the
    // rest use the tone wash. Same call sites and labels as before.
    const cls = kind === 'crit' ? '.solid.crit'
              : kind === 'warn' ? '.warn'
              : kind === 'info' ? '.info'
              : '.ok';
    return h('span.chip.sm'+cls, null, text);
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
    let rows = liveSrv().servers;
    if (srvState.env !== '__all') rows = rows.filter(r => r.env === srvState.env);
    // BU filter is applied server-side via OC_API.fetchServers (which reads
    // window.SELECTED_BU), so the rows in liveSrv().servers are already
    // scoped. No client-side BU filter needed here.
    if (q) rows = rows.filter(r =>
      r.name.toLowerCase().includes(q) ||
      (r.fqdn || '').toLowerCase().includes(q) ||
      (r.app || '').toLowerCase().includes(q) ||
      (r.pg || '').toLowerCase().includes(q) ||
      (r.env || '').toLowerCase().includes(q) ||
      (r.bu || '').toLowerCase().includes(q));
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
    const ribbon = demoRibbon('servers'); if (ribbon) page.appendChild(ribbon);
    const live = liveSrv();

    // Inventory count + env split
    const inv = h('div.split.wide-left', null,
      (function(){
        const col = h('div');
        col.appendChild(sectionLabel('Server inventory'));
        col.appendChild(h('div.inv-card', null,
          h('div.inv-big', null, live.total.toLocaleString()),
          h('div.inv-lbl', null, 'active servers tracked'),
          h('div.inv-sub', null,
            h('span', null, h('b', null, String(live.unreachable.length)), ' unreachable'),
            ' · ',
            h('span', null, h('b', null, String(live.unmatched.length)), ' unmatched'),
          ),
        ));
        return col;
      })(),
      (function(){
        const col = h('div');
        const envActive = srvState.env && srvState.env !== '__all';
        col.appendChild(sectionLabel(
          'Servers by environment',
          live.env.length,
          envActive ? h('button.btn.xs', {
            style:{marginLeft:'auto'},
            on:{click:()=>{ srvState.env='__all'; srvState.page=1; window.RERENDER_PAGE(mount); }},
          }, 'Clear filter') : null,
        ));
        const bars = h('div.env-bars');
        live.env.forEach(e => {
          const w = Math.max(2, Math.round(e.count / live.envMax * 100));
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

    // Env dropdown: cross-facet-scoped counts via /api/servers/summary.
    // Picking it triggers a server-side refetch through OC_API.fetchServers
    // so the table, the env bar chart at the top, and the dropdown counts all
    // reflect the new intersection. BU scope comes from the global rail
    // selector (window.SELECTED_BU), which fetchServers reads automatically.
    const refetchServers = async () => {
      const refetched = (window.OC_API && typeof window.OC_API.fetchServers === 'function')
        ? await window.OC_API.fetchServers({ env: srvState.env })
        : null;
      if (!refetched) window.RERENDER_PAGE(mount);
    };
    const envOpts = [['__all','All environments']].concat(live.env.map(e => [e.name, e.name + ' ('+e.count+')']));
    const search = h('input', {'data-fk':'servers-search',
      type:'text', placeholder:'Search name, FQDN, application, patch group…',
      value: srvState.q,
      on:{input:(e)=>{ srvState.q = e.target.value; srvState.page = 1; window.RERENDER_PAGE(mount); }},
    });
    const envSel = h('select', { on:{change: async (e)=>{ srvState.env = e.target.value; srvState.page = 1; await refetchServers(); }}},
      envOpts.map(([v,l]) => h('option'+(srvState.env===v?'.on':''), {value:v, selected: srvState.env===v}, l)));
    const clearBtn = h('button.btn', { on:{click: async ()=>{
      const wasEnv = srvState.env;
      srvState.q=''; srvState.env='__all'; srvState.page=1;
      if (wasEnv !== '__all') {
        await refetchServers();
      } else {
        window.RERENDER_PAGE(mount);
      }
    }}}, 'Reset');
    const exportBtn = h('button.btn', { on:{click:()=>exportCsv('servers', rows, ['name','fqdn','env','bu','app','pg','active'])}}, 'Export CSV');
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
      sortableTh('bu','Business unit'),
      sortableTh('app','Application'),
      sortableTh('pg','Patch group'),
      sortableTh('active','Active'),
    )));
    const tbody = h('tbody');
    const q = srvState.q;
    paged.forEach(r => {
      const activeCell = r.active
        ? h('td', null, h('span.chip.ok', null, h('span.dot'), 'Active'))
        : h('td', null, h('span.chip.crit', null, h('span.dot'), 'Inactive'));
      // Click anywhere on the row → detail view at #servers/{id}. Keyboard
      // parity matches the rail nav-items (role=button + tabindex=0). Skipped
      // when r.id is missing (demo data shape) so the row stays inert.
      const rowProps = r.id ? {
        role:'button', tabindex:'0',
        style:{ cursor:'pointer' },
        on:{
          click:()=>{ if (window.ROUTER) window.ROUTER.goto('servers/' + r.id); },
          keydown:(e)=>{ if ((e.key === 'Enter' || e.key === ' ') && window.ROUTER) {
            e.preventDefault(); window.ROUTER.goto('servers/' + r.id);
          }},
        },
      } : null;
      tbody.appendChild(h('tr'+(r.active?'':'.sev-crit')+(r.id?'.clickable':''), rowProps,
        h('td.host', null, mark(r.name, q)),
        h('td.muted', null, mark(r.fqdn, q)),
        h('td', null, h('span.chip.sm', null, mark(r.env, q))),
        h('td.muted', null, mark(r.bu || 'Unknown', q)),
        h('td.muted', null, mark(r.app, q)),
        h('td', null, h('span.chip'+(r.pg==='NO PATCH GROUP FOUND'?'.warn':''), null, r.pg==='NO PATCH GROUP FOUND'?null:h('span.dot'), mark(r.pg, q))),
        activeCell,
      ));
    });
    if (paged.length === 0) {
      tbody.appendChild(h('tr', null, h('td', {colspan:7}, h('div.no-hits', null, 'No servers match ', h('b', null, srvState.q || srvState.env || (window.SELECTED_BU !== '__all' ? window.SELECTED_BU : ''))))));
    }
    table.appendChild(tbody);
    tbl.appendChild(table);
    tbl.appendChild(paginationBar(pag, p => { srvState.page = p; window.RERENDER_PAGE(mount); }));
    page.appendChild(tbl);

    // Unreachable (errors — made loud)
    page.appendChild(sectionLabel('Unreachable hosts', live.unreachable.length, h('span.ct', {style:{marginLeft:'auto'}}, 'no check-in · manual investigation')));
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
    live.unreachable.forEach(r => {
      utb.appendChild(h('tr.sev-crit', null,
        h('td.host', null, r.name),
        h('td', null, h('span.chip.sm', null, r.env)),
        h('td.muted', null, r.lastSeen),
        h('td', null, r.duration || ''),
        h('td', null, stamp('crit','UNREACHABLE')),
      ));
    });
    ut.appendChild(utb);
    utbl.appendChild(ut);
    page.appendChild(utbl);

    // Unmatched (kept at the bottom)
    const uq = srvUnmatchedState.q.toLowerCase();
    let urows = live.unmatched;
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
        h('td', null, h('span.chip.info', null, h('span.dot'), mark(r.source, uq2))),
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
    let rows = liveCerts().list;
    if (certState.level !== '__all') rows = rows.filter(r => r.level === certState.level);
    // BU filter is applied server-side via OC_API.fetchCerts (which reads
    // window.SELECTED_BU from the global rail selector).
    if (q) rows = rows.filter(r =>
      (r.name || '').toLowerCase().includes(q) ||
      (r.server || '').toLowerCase().includes(q) ||
      (r.service || '').toLowerCase().includes(q) ||
      (r.bu || '').toLowerCase().includes(q));
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

  // (Step 10.5) Certificate expiry timeline — plots certs expiring within 90 days
  // along a day axis (coloured by level) plus per-bucket counts. Pairs with the
  // certs table in the .split2.s-certs wide-screen layout. Reuses the .cert-strip
  // CSS already shipped in op-components.css.
  function renderCertTimeline(certs) {
    const WINDOW = 90;
    const list = Array.isArray(certs) ? certs : [];
    const within = list.filter(c => typeof c.days === 'number' && c.days <= WINDOW);
    const beyond = list.filter(c => typeof c.days === 'number' && c.days > WINDOW).length;
    const wrap = h('div.cert-strip');
    wrap.appendChild(h('div', { style:{fontFamily:'var(--mono)',fontSize:'10px',letterSpacing:'0.14em',textTransform:'uppercase',color:'var(--ink-3)',marginBottom:'18px'} },
      'Expiry timeline · next 90 days'));
    const axis = h('div.cert-strip-axis');
    [[7,'7d'],[30,'30d'],[60,'60d'],[90,'90d']].forEach(([d,label]) =>
      axis.appendChild(h('div.tick', { style:{left:(d/WINDOW*100)+'%'} }, label)));
    axis.appendChild(h('div.now', { style:{left:'0%'} }));
    within.forEach(c => {
      const pos = Math.max(0, Math.min(WINDOW, c.days)) / WINDOW * 100;
      const colour = (c.level==='expired'||c.level==='crit') ? 'var(--crit)'
                   : c.level==='warn' ? 'var(--warn)' : 'var(--ok)';
      axis.appendChild(h('div', {
        title: (c.name||'cert') + ' · ' + (c.days<0 ? ('expired '+Math.abs(c.days)+'d') : ('in '+c.days+'d')),
        style:{ position:'absolute', left:pos+'%', bottom:'8px', width:'8px', height:'8px',
                marginLeft:'-4px', borderRadius:'50%', background:colour, opacity:'0.85',
                boxShadow:'0 0 0 2px var(--card)' },
      }));
    });
    wrap.appendChild(axis);
    const lanes = h('div.cert-strip-lanes');
    const bucket = (lvl) => within.filter(c => c.level === lvl).length;
    [['expired','Expired',bucket('expired')],
     ['crit','≤ 7 days',bucket('crit')],
     ['warn','≤ 30 days',bucket('warn')],
     ['ok','31-90 days',bucket('ok')]].forEach(([cls,label,n]) => {
      lanes.appendChild(h('div.cert-lane.'+cls, null,
        h('div.lbl', null, label),
        h('div.track', null, h('div.seg', { style:{left:'0', width:(within.length ? (n/within.length*100) : 0)+'%'} })),
        h('div.n', null, String(n)),
      ));
    });
    wrap.appendChild(lanes);
    if (beyond > 0) {
      wrap.appendChild(h('div', { style:{marginTop:'16px',paddingTop:'14px',borderTop:'1px dashed var(--rule)',fontFamily:'var(--mono)',fontSize:'11px',color:'var(--ink-3)'} },
        h('b', { style:{color:'var(--ink)'} }, beyond.toLocaleString()), ' certificates healthy beyond 90 days'));
    }
    return wrap;
  }

  function renderCertsPage(mount) {
    const page = h('div.page');
    const ribbon = demoRibbon('certs'); if (ribbon) page.appendChild(ribbon);
    const { list: CERTS, counts: CERT_COUNTS } = liveCerts();

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

    // Filter row — cross-facet scoped counts when API breakdown is loaded.
    // Level options use the API per-level counts (scoped by current BU);
    // BU options use the API per-BU counts (scoped by current level).
    // Falls back to client-side derived counts (CERT_COUNTS) and the static
    // BU_VALUES list when the breakdown isn't loaded (demo path).
    const breakdown = (window.CERTS_DATA && window.CERTS_DATA.CERT_BREAKDOWN) || { levels: [], businessUnits: [] };
    const levelByCode = {};
    breakdown.levels.forEach(l => { levelByCode[l.level] = l.totalCount; });
    const levelTotal = breakdown.levels.length
      ? breakdown.levels.reduce((sum, l) => sum + l.totalCount, 0)
      : CERTS.length;
    const lvCount = (code) => breakdown.levels.length ? (levelByCode[code] || 0) : (CERT_COUNTS[code] || 0);
    const levelOpts = [
      ['__all','All levels ('+levelTotal+')'],
      ['expired','Expired ('+lvCount('expired')+')'],
      ['crit','Critical ('+lvCount('crit')+')'],
      ['warn','Warning ('+lvCount('warn')+')'],
      ['ok','OK ('+lvCount('ok')+')'],
    ];
    const rows = applyCertFilters();
    const pag = paginate(rows.length, certState.page, certState.per);
    certState.page = pag.cur;
    const paged = rows.slice(pag.start, pag.end);

    // BU scope comes from the global rail selector. fetchCerts reads
    // window.SELECTED_BU automatically when no bu is passed.
    const refetchCerts = async () => {
      const refetched = (window.OC_API && typeof window.OC_API.fetchCerts === 'function')
        ? await window.OC_API.fetchCerts({ level: certState.level })
        : null;
      if (!refetched) window.RERENDER_PAGE(mount);
    };

    const levelSel = h('select', { on:{change: async (e)=>{
      certState.level=e.target.value; certState.page=1; await refetchCerts();
    }}},
      levelOpts.map(([v,l]) => h('option', {value:v, selected: certState.level===v}, l)));
    const q = h('input', {'data-fk':'certs-search', type:'text', placeholder:'Filter by server or service…', value: certState.q,
      on:{input:(e)=>{ certState.q=e.target.value; certState.page=1; window.RERENDER_PAGE(mount); }}});
    const reset = h('button.btn', { on:{click: async ()=>{
      const wasLevel = certState.level;
      certState.q=''; certState.level='__all'; certState.page=1;
      if (wasLevel !== '__all') {
        await refetchCerts();
      } else {
        window.RERENDER_PAGE(mount);
      }
    }}}, 'Reset');
    const exportBtn = h('button.btn', { on:{click:()=>exportCsv('certificates', rows, ['name','server','service','bu','expires','days','level'])}}, 'Export CSV');
    const count = h('span.ct', null, 'Showing ' + (pag.start+1) + '–' + pag.end + ' of ' + rows.length);
    const fbar = filterBar([levelSel, q, reset, h('span.spacer'), count, exportBtn]);

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
      sortableTh('bu','Business unit'),
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
        h('td.muted', null, mark(r.bu || 'Unknown', cq)),
        h('td', null, r.expires),
        h('td.num'+((r.level==='expired'||r.level==='crit')?'.strong':''),
          {style: r.level==='expired'?{color:'var(--crit)',fontWeight:'600'}:r.level==='crit'?{color:'var(--crit)',fontWeight:'600'}:r.level==='warn'?{color:'var(--warn)',fontWeight:'600'}:null},
          (r.days<0?r.days+'d':r.days+'d')),
        h('td', null, levelChip(r.level)),
      ));
    });
    if (paged.length === 0) {
      tbody.appendChild(h('tr', null, h('td', {colspan:7}, h('div.no-hits', null, 'No certificates match filter'))));
    }
    table.appendChild(tbody);
    tbl.appendChild(table);
    tbl.appendChild(paginationBar(pag, p => { certState.page = p; window.RERENDER_PAGE(mount); }));
    // (Step 10.5) wide-screen split: cert table | expiry-timeline panel at >=1500px
    page.appendChild(h('div.split2.s-certs', null,
      h('div.col', null, fbar, tbl),
      h('div.col', null, renderCertTimeline(CERTS)),
    ));

    mount.innerHTML = '';
    mount.appendChild(page);
  }

  // ================================================================
  // END OF LIFE PAGE
  // ================================================================
  const eolState = { q:'', status:'__all', showAll:false, sort:'servers', sortDir:-1, expanded:{} };

  function applyEolFilters() {
    const q = eolState.q.trim().toLowerCase();
    let rows = liveEol().products.slice();
    if (eolState.status === 'action') rows = rows.filter(r => r.status === 'eol' || r.status === 'extended');
    else if (eolState.status !== '__all') rows = rows.filter(r => r.status === eolState.status);
    if (q) {
      rows = rows.filter(r => {
        if (r.product.toLowerCase().includes(q)) return true;
        if (String(r.version).toLowerCase().includes(q)) return true;
        // Best-effort host match against the cache only — never trigger a fetch
        // here. Triggering N fetches per keystroke would saturate the API and
        // earn us 429s. Hosts populate as users open rows; subsequent filter
        // passes will then include them.
        const hosts = eolHostsCached(r.product, r.version);
        if (!Array.isArray(hosts)) return false;
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
    const ribbon = demoRibbon('eol'); if (ribbon) page.appendChild(ribbon);
    const { products: EOL_PRODUCTS, totals: EOL_TOTALS } = liveEol();

    // Hero strip — STAMPED EOL counts (loud)
    const strip = h('div.crit-strip');
    strip.appendChild(h('div.cs-cell.status-cell'+(EOL_TOTALS.eol>0?'.crit':EOL_TOTALS.extended>0?'.warn':'.ok'),
      { on:{click:()=>{ eolState.status = (EOL_TOTALS.eol + EOL_TOTALS.extended)>0 ? 'action' : '__all'; window.RERENDER_PAGE(mount); }}},
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
      ['action','Action required ('+(EOL_TOTALS.eol + EOL_TOTALS.extended)+')'],
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
      const key = r.product + '@' + r.version;
      // Auto-expand on host-match uses cache-only data — no fan-out fetches.
      const cachedHosts = eolHostsCached(r.product, r.version);
      const cachedHostList = Array.isArray(cachedHosts) ? cachedHosts : [];
      const hostMatches = (qStr && cachedHostList.length) ? cachedHostList.filter(hh => hh.fqdn.includes(qStr) || hh.host.toLowerCase().includes(qStr)) : [];
      const hasHostMatch = hostMatches.length > 0;
      const isOpen = !!eolState.expanded[key] || hasHostMatch;
      // Only fire the per-product detail fetch when the row is actually open.
      // This is what avoids N×500 calls and the resulting 429 storm.
      const hostsOrState = isOpen ? eolHostsFor(r.product, r.version) : cachedHosts;
      const hosts = Array.isArray(hostsOrState) ? hostsOrState : [];
      const isLoading = hostsOrState === 'loading';
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
            const hdrCount = isLoading ? 'loading\u2026'
              : hasHostMatch ? (hostMatches.length + ' of ' + r.servers)
              : String(hosts.length || r.servers);
            const hdr = h('div', {style:{fontFamily:'var(--mono)',fontSize:'10.5px',letterSpacing:'0.14em',textTransform:'uppercase',color:'var(--ink-3)',marginBottom:'10px',display:'flex',alignItems:'center',gap:'14px'}},
              h('span', null, hasHostMatch ? 'Matching hosts \u00b7 ' : 'Affected servers \u00b7 ',
                h('b', {style:{color:'var(--ink)'}}, hdrCount)));
            if (hasHostMatch) hdr.appendChild(h('a', {href:'#',
              style:{fontFamily:'var(--mono)',fontSize:'10.5px',color:'var(--signal)',textDecoration:'underline',cursor:'pointer'},
              on:{click:(e)=>{ e.preventDefault(); e.stopPropagation(); eolState.q=''; window.RERENDER_PAGE(mount); }}}, 'clear filter to show all'));
            wrap.appendChild(hdr);
            if (isLoading) {
              wrap.appendChild(h('div', {style:{padding:'18px 0',fontFamily:'var(--mono)',fontSize:'11.5px',color:'var(--ink-3)',letterSpacing:'0.06em'}},
                'Loading affected servers\u2026'));
            } else if (!hosts.length) {
              wrap.appendChild(h('div', {style:{padding:'18px 0',fontFamily:'var(--mono)',fontSize:'11.5px',color:'var(--ink-3)',letterSpacing:'0.06em'}},
                'No affected servers returned by the API for this product.'));
            } else {
              const grid = h('div', {style:{display:'grid',gridTemplateColumns:'repeat(2, 1fr)',gap:'2px 24px',fontFamily:'var(--mono)',fontSize:'11.5px',maxHeight:'420px',overflowY:'auto',paddingRight:'6px'}});
              shown.forEach(hh => {
                grid.appendChild(h('div', {style:{padding:'4px 0',borderBottom:'1px dashed var(--rule)',display:'flex',gap:'10px'}},
                  h('span', {style:{color:'var(--ink-4)',minWidth:'34px'}}, String(hh.idx).padStart(4,' ')),
                  h('span', null, mark(hh.fqdn, qStr)),
                ));
              });
              wrap.appendChild(grid);
            }
            return wrap;
          })()
        ));
        tbody.appendChild(affected);
      }
    });
    table.appendChild(tbody);
    tbl.appendChild(table);
    page.appendChild(tbl);

    // Unmatched EOL software work-list. Populated by op-boot's /eol/unmatched
    // fetch; rows are installed-software strings the sync's SOFTWARE_PATTERNS
    // catalogue did not recognise. Sorted by frequency so the highest-payoff
    // pattern-catalogue additions surface first.
    const unmatched = Array.isArray(window.EOL_DATA && window.EOL_DATA.EOL_UNMATCHED)
      ? window.EOL_DATA.EOL_UNMATCHED : [];
    page.appendChild(h('div.section-label', null,
      h('span', null, 'Unmatched EOL software'),
      h('span.count', null, String(unmatched.length)),
      h('span', { style:{marginLeft:'auto',fontSize:'10px',color:'var(--ink-4)',letterSpacing:'.1em',textTransform:'uppercase',fontFamily:'var(--mono)'} },
        'work-list for catalogue expansion')));
    const uwrap = h('div.table-wrap');
    const utbl = h('table.op');
    utbl.appendChild(h('thead', null, h('tr', null,
      h('th', null, 'Software'),
      h('th', null, 'Version'),
      h('th', null, 'Sample machine'),
      h('th', { style:{textAlign:'right'} }, 'Occurrences'),
      h('th', null, 'Last seen'),
    )));
    const utbody = h('tbody');
    if (!unmatched.length) {
      utbody.appendChild(h('tr', null, h('td', { colspan:5,
        style:{padding:'20px',textAlign:'center',color:'var(--ink-3)',fontFamily:'var(--mono)',fontSize:'11.5px',letterSpacing:'.1em',textTransform:'uppercase'} },
        'No unmatched EOL software. Pattern catalogue covers everything the sync has seen.')));
    } else {
      for (const u of unmatched) {
        const last = u.lastSeenAt ? new Date(u.lastSeenAt).toLocaleString('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : '—';
        utbody.appendChild(h('tr', null,
          h('td.host', null, u.rawSoftwareName || '—'),
          h('td.mono.muted', null, u.rawSoftwareVersion || '—'),
          h('td.mono.muted', null, u.sampleMachineName || '—'),
          h('td.num.strong', null, String(u.occurrenceCount || 0)),
          h('td.mono.muted', null, last),
        ));
      }
    }
    utbl.appendChild(utbody);
    uwrap.appendChild(utbl);
    page.appendChild(uwrap);

    mount.innerHTML = '';
    mount.appendChild(page);
  }

  // =============================================================
  // DATA — PATCHING SCHEDULES
  // =============================================================
  // Live getter — reads window.PATCH_GROUPS populated by op-boot.js from
  // /api/patching/next (serversByGroup). Adapts the boot shape {name, servers,
  // date, window, services} to this page's shape {id, servers, window, cycle}.
  // Empty until the API fetch resolves.
  function getPatchGroups() {
    const live = Array.isArray(window.PATCH_GROUPS) ? window.PATCH_GROUPS : [];
    return live.map(g => ({
      id: g.id || g.name,
      servers: g.servers || 0,
      window: g.date instanceof Date
        ? g.date.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) + (g.window && g.window !== '—' ? ' · ' + g.window : '')
        : (g.window || '—'),
      cycle: g.cycle || '',
      status: g.status || 'queued',
      last: g.last || null,
    }));
  }
  function getPatchTotal() { return getPatchGroups().reduce((s, g) => s + g.servers, 0); }

  // Cycle history (most recent first). op-boot.js populates window.PATCH_CYCLES
  // from /api/patching/cycles?upcomingOnly=false. Fall back to a last-known
  // demo list when the API hasn't responded (offline dev).
  function getPatchCycles() {
    const liveGroups = getPatchGroups();
    const liveCycles = Array.isArray(window.PATCH_CYCLES) ? window.PATCH_CYCLES : null;
    if (liveCycles && liveCycles.length) {
      const upcoming = liveCycles.find(c => c.status === 'queued' || c.status === 'scheduled');
      const liveTotal = getPatchTotal();
      if (upcoming && !upcoming.servers && liveTotal) upcoming.servers = liveTotal;
      if (upcoming && !upcoming.groups && liveGroups.length) upcoming.groups = liveGroups.length;
      return liveCycles;
    }
    return [
    {id:'April 2026',    window:'Apr 23–26, 2026', status:'queued',   servers:getPatchTotal(), completed:0,    failed:0,  skipped:0, groups:liveGroups.length, notes:'T-3 days'},
    {id:'March 2026',    window:'Mar 26–29, 2026', status:'partial',  servers:1020,        completed:977,  failed:43, skipped:0, groups:16,                  notes:'GROUP3B blocked on WU-8102 \u2014 3A/3B rerun queued'},
    {id:'February 2026', window:'Feb 26–Mar 1 2026', status:'success', servers:1014,        completed:1014, failed:0,  skipped:0, groups:16,                  notes:'Clean pass'},
    {id:'January 2026',  window:'Jan 22–25, 2026', status:'success',  servers:1008,        completed:1005, failed:0,  skipped:3, groups:16,                  notes:'3 maintenance-window conflicts (skipped, rescheduled)'},
    {id:'December 2025', window:'Dec 18–21, 2025', status:'partial',  servers:989,         completed:964,  failed:25, skipped:0, groups:16,                  notes:'LSASS kb5054234 known-issue on legacy DCs'},
    {id:'November 2025', window:'Nov 20–23, 2025', status:'success',  servers:983,         completed:983,  failed:0,  skipped:0, groups:15,                  notes:'Clean pass'},
    ];
  }

  // Known issues / blockers
  const PATCH_ISSUES = [
    {id:'WU-8102', severity:'crit', product:'Windows Server 2016', kb:'KB5041578', servers:31, group:'GROUP3B', first:'Mar 27, 2026', status:'blocking', title:'LSASS service restart loop after post-patch reboot',
     notes:'Microsoft advisory ADV250318 \u2014 rollback KB5041578 or apply hotfix KB5041580. 31 servers in GROUP3B currently excluded pending fix. Cycle April 2026 is at risk if unresolved by Apr 22.'},
    {id:'WU-7691', severity:'warn', product:'SQL Server 2019',     kb:'KB5030841', servers:12, group:'2B',       first:'Mar 15, 2026', status:'workaround', title:'SSAS tabular-mode cubes fail to load post-patch',
     notes:'Workaround documented in runbook R-229. Affected SSAS instances have been pre-flagged; ops team will apply fix manually before patching.'},
    {id:'WU-7604', severity:'warn', product:'Windows Server 2019', kb:'KB5040434', servers:4,  group:'7A',       first:'Mar 04, 2026', status:'workaround', title:'Cluster shared volumes occasionally go offline after patch',
     notes:'Reproduces only on failover clusters older than 3.2. Pre-patch health check now validates cluster state before install.'},
    {id:'WU-7412', severity:'info', product:'Windows Server 2022', kb:'KB5036893', servers:0,  group:'\u2014',   first:'Feb 27, 2026', status:'resolved',   title:'Hyper-V saved-state restore failure (fixed in cumulative)',
     notes:'Resolved by March cumulative. Kept for audit trail.'},
  ];

  // Live accessor — op-boot.js populates window.PATCH_ISSUES from
  // /api/patching/issues. Call at render time so updates are picked up.
  function getPatchIssues() {
    const live = Array.isArray(window.PATCH_ISSUES) ? window.PATCH_ISSUES : null;
    return (live && live.length) ? live : PATCH_ISSUES;
  }

  // =============================================================
  // DATA — PATCH MANAGEMENT
  // =============================================================
  const EXCLUSION_REASONS = [
    'Vendor advisory \u2014 pending hotfix',
    'Application change-freeze',
    'Hardware refresh in progress',
    'Regulatory window',
    'Database migration in-flight',
    'Customer-facing release period',
    'Other',
  ];

  // Demo defaults. op-boot.js overwrites window.EXCLUSIONS with real data.
  // Render-time reads always go through window.EXCLUSIONS so they pick up updates.
  // until/requested are anchored to "today" via day-offsets so the offline view stays
  // realistic; state is derived from the offset with the same rule the backend uses.
  window.EXCLUSIONS = window.EXCLUSIONS || (function () {
    const today = todayLocal();
    const rows = [
      {id:'EX-0412', server:'PR0604-26002-00', fqdn:'kandr_sanctions.contoso.com', group:'2A', service:'fcrm',        func:'Sanctions screening',    reason:'Vendor advisory \u2014 pending hotfix', untilOff:4,   reqOff:-81, requester:'r.kapoor'},
      {id:'EX-0411', server:'PR0702-11102-01', fqdn:'alteryx.contoso.com',         group:'7A', service:'alteryx',     func:'Analytics engine',       reason:'Application change-freeze',            untilOff:2,   reqOff:-76, requester:'l.becker'},
      {id:'EX-0410', server:'PR0605-14001-00', fqdn:'signal.contoso.de',           group:'5A', service:'signal',      func:'Regulatory reporting',   reason:'Regulatory window',                     untilOff:16,  reqOff:-77, requester:'n.harris'},
      {id:'EX-0406', server:'PR0308-22034-00', fqdn:'app.contoso.com',             group:'3A', service:'webmethods',  func:'Customer portal',        reason:'Customer-facing release period',        untilOff:-3,  reqOff:-79, requester:'d.zhao'},
      {id:'EX-0405', server:'PR0308-22035-00', fqdn:'app.contoso.com',             group:'3A', service:'webmethods',  func:'Customer portal',        reason:'Customer-facing release period',        untilOff:-3,  reqOff:-79, requester:'d.zhao'},
      {id:'EX-0403', server:'DV0402-11201-02', fqdn:'dv-db.contoso.com',           group:'4A', service:'sql',         func:'Database node',          reason:'Database migration in-flight',          untilOff:30,  reqOff:-74, requester:'o.silva'},
      {id:'EX-0402', server:'PR0801-14404-00', fqdn:'thunderhead.contoso.com',     group:'7B', service:'thunderhead', func:'Document composition',   reason:'Hardware refresh in progress',          untilOff:21,  reqOff:-77, requester:'e.adeyemi'},
      {id:'EX-0399', server:'PR0604-26003-00', fqdn:'kandr_sanctions.contoso.com', group:'2A', service:'fcrm',        func:'Sanctions screening',    reason:'Vendor advisory \u2014 pending hotfix', untilOff:6,   reqOff:-81, requester:'r.kapoor'},
      {id:'EX-0397', server:'PR0605-14002-00', fqdn:'signal.contoso.de',           group:'5A', service:'signal',      func:'Regulatory reporting',   reason:'Other',                                 untilOff:45,  reqOff:-75, requester:'c.fischer'},
      {id:'EX-0394', server:'DV0402-11201-03', fqdn:'dv-db.contoso.com',           group:'4A', service:'sql',         func:'Database node',          reason:'Database migration in-flight',          untilOff:30,  reqOff:-74, requester:'o.silva'},
      {id:'EX-0388', server:'PR0308-22036-00', fqdn:'app.contoso.com',             group:'3A', service:'webmethods',  func:'Customer portal',        reason:'Customer-facing release period',        untilOff:-8,  reqOff:-79, requester:'d.zhao'},
    ];
    return rows.map(function (r) {
      const untilDate = addDays(today, r.untilOff);
      return {
        id:r.id, server:r.server, fqdn:r.fqdn, group:r.group, service:r.service, func:r.func,
        reason:r.reason, until:fmtUntil(untilDate), requester:r.requester,
        requested:fmtUntil(addDays(today, r.reqOff)),
        state:deriveState(untilDate, today), // pass the Date, not a re-parsed display string
      };
    });
  })();
  // Live getter — recomputes on each access so it stays in sync with window.EXCLUSIONS.
  Object.defineProperty(window, 'EXCL_COUNTS', {
    configurable: true,
    get() { return (this.EXCLUSIONS || []).reduce((a, e) => (a[e.state] = (a[e.state]||0) + 1, a), {}); }
  });

  // =============================================================
  // PATCHING SCHEDULES PAGE
  // =============================================================
  const patchState = {
    tab: 'groups',   // groups | history | issues
    groupQ: '',
    historyQ: '',
    expandedGroup: null,   // id of the currently expanded group
    groupInnerQ: '',        // search within the expanded group
  };

  function renderPatchingPage(mount) {
    const page = h('div.page');
    const ribbon = demoRibbon('patching'); if (ribbon) page.appendChild(ribbon);
    const PATCH_ISSUES = getPatchIssues();

    // Hero text defaults to demo strings (needed for offline dev). When live
    // data arrives via window.PATCH_NEXT_CYCLE the hero shows the real cycle
    // date and count. When the API flags isStale (source HTML schedule has
    // not been updated), the hero pivots to "Last Cycle / Completed X" with
    // an explicit subtitle so users know the data is behind the cadence.
    let heroCount = '3';
    let heroUnit = 'days';
    let heroTitle = 'Next Cycle';
    let heroDate = 'April 2026 · begins Apr 23, 2026';
    let heroSub = getPatchTotal().toLocaleString() + ' servers across '
      + (new Set(getPatchGroups().map(g => g.id)).size) + ' groups · '
      + (PATCH_ISSUES.filter(i => i.status==='blocking').length > 0
          ? PATCH_ISSUES.filter(i => i.status==='blocking').length + ' open blocker'
          : 'no open blockers');

    const cycle = window.PATCH_NEXT_CYCLE;
    if (cycle && cycle.cycleDate) {
      const dateStr = new Date(cycle.cycleDate).toLocaleDateString('en-GB',
        { day: 'numeric', month: 'long', year: 'numeric' });
      if (cycle.isStale) {
        const n = cycle.daysOverdue || 0;
        heroCount = String(n);
        heroUnit = n === 1 ? 'day behind' : 'days behind';
        heroTitle = 'Last Cycle';
        heroDate = 'Completed ' + dateStr;
        heroSub = 'Source schedule has not been updated — awaiting next cycle dates from the schedule owner';
      } else {
        const d = cycle.daysUntil != null ? cycle.daysUntil : 0;
        heroCount = String(d);
        heroUnit = d === 1 ? 'day' : 'days';
        heroDate = 'Begins ' + dateStr;
      }
    }

    // HERO — countdown + cycle meta + group bars
    const hero = h('div.patch-banner', null,
      h('div.countdown', null, h('span.n', null, heroCount), h('span.unit', null, heroUnit)),
      h('div.meta', null,
        h('span.t', null, heroTitle),
        h('span.d', null, heroDate),
        h('span.sub', null, heroSub)),
      h('div.groups', null,
        ...getPatchGroups().slice(0, 12).map(g =>
          h('div.group', null,
            h('span.gn', null, g.id),
            h('span.gbar', null, h('span', {style:{width: Math.min(100, g.servers/181*100)+'%'}})),
            h('span.gc', null, String(g.servers)))),
      ),
    );
    page.appendChild(hero);

    // STATUS STRIP — blockers + overdue exclusions + queued volume
    const blockers = PATCH_ISSUES.filter(i => i.status === 'blocking').length;
    const overdueExcl = (window.EXCL_COUNTS.overdue || 0);
    const strip = h('div.crit-strip');
    strip.appendChild(h('div.cs-cell'+(blockers>0?'.crit':'.ok'),
      { on:{click:()=>{ patchState.tab='issues'; window.RERENDER_PAGE(mount); }}},
      h('div.cs-label', null, 'Known issues'),
      h('div.cs-value', null, String(blockers), h('span.cs-unit', null, 'blocking')),
      h('div.cs-sub', null, PATCH_ISSUES.filter(i => i.status==='workaround').length+' with workaround · '+PATCH_ISSUES.filter(i => i.status==='resolved').length+' resolved'),
      blockers>0 ? h('div.cs-link', null, 'Show issues') : null,
    ));
    strip.appendChild(h('div.cs-cell'+(overdueExcl>0?'.crit':'.ok'),
      { on:{click:()=>{ if (window.ROUTER) window.ROUTER.goto('patchmgmt'); }}},
      h('div.cs-label', null, 'Exclusions overdue'),
      h('div.cs-value', null, String(overdueExcl), h('span.cs-unit', null, 'past hold date')),
      h('div.cs-sub', null, overdueExcl>0 ? 'Needs reconciliation before cycle starts' : 'All exclusions current'),
      overdueExcl>0 ? h('div.cs-link', null, 'Open Patch Management') : null,
    ));
    strip.appendChild(h('div.cs-cell.ok', null,
      h('div.cs-label', null, 'Servers queued'),
      h('div.cs-value', null, getPatchTotal().toLocaleString(), h('span.cs-unit', null, 'in April')),
      h('div.cs-sub', null, (new Set(getPatchGroups().map(g => g.id)).size)+' patch groups'),
    ));
    page.appendChild(strip);

    // TAB STRIP
    const tab = (id, label, n) => {
      const on = patchState.tab === id;
      return h('button.tab'+(on?'.on':''), { on:{click:()=>{ patchState.tab=id; window.RERENDER_PAGE(mount); }}},
        label, n != null ? h('span.n', null, String(n)) : null);
    };
    page.appendChild(h('div.tabs', null,
      tab('groups',  'Patch groups',     new Set(getPatchGroups().map(g => g.id)).size),
      tab('history', 'Cycle history',    getPatchCycles().length),
      tab('issues',  'Known issues',     PATCH_ISSUES.length),
    ));

    if (patchState.tab === 'groups')  page.appendChild(renderPatchGroups(mount));
    if (patchState.tab === 'history') page.appendChild(renderPatchHistory(mount));
    if (patchState.tab === 'issues')  page.appendChild(renderPatchIssues(mount));

    mount.innerHTML = '';
    mount.appendChild(page);
  }

  function renderPatchGroups(mount) {
    const wrap = h('div', {style:{display:'flex',flexDirection:'column',gap:'18px'}});

    const q = patchState.groupQ.trim().toLowerCase();
    const allServers = window.SERVERS_DATA?.servers || [];
    // Group search matches group id or window — AND also group id implied by a server/service/function match
    const groupIdsMatchedByServers = new Set();
    if (q) {
      allServers.forEach(s => {
        if ((s.name||'').toLowerCase().includes(q) ||
            (s.service||'').toLowerCase().includes(q) ||
            (s.func||'').toLowerCase().includes(q) ||
            (s.fqdn||'').toLowerCase().includes(q) ||
            (s.app||'').toLowerCase().includes(q)) {
          groupIdsMatchedByServers.add(s.pg);
        }
      });
    }
    const allGroups = getPatchGroups();
    const rows = q
      ? allGroups.filter(g => (g.id||'').toLowerCase().includes(q) || (g.window||'').toLowerCase().includes(q) || groupIdsMatchedByServers.has(g.id))
      : allGroups;

    const search = h('input', {'data-fk':'patch-groups-search', type:'text', placeholder:'Search group, server, service, function…', value: patchState.groupQ,
      on:{input:(e)=>{ patchState.groupQ = e.target.value; window.RERENDER_PAGE(mount); }}});
    const reset = h('button.btn', { on:{click:()=>{ patchState.groupQ=''; patchState.expandedGroup=null; patchState.groupInnerQ=''; window.RERENDER_PAGE(mount); }}}, 'Reset');
    const count = h('span.ct', null, 'Showing '+rows.length+' of '+allGroups.length+' groups');
    wrap.appendChild(filterBar([search, reset, h('span.spacer'), count]));

    const tbl = h('div.table-wrap');
    const table = h('table.op');
    table.appendChild(h('thead', null, h('tr', null,
      h('th', {style:{width:'28px'}}, ''),
      h('th', null, 'Group'),
      h('th.num', null, 'Servers'),
      h('th', null, 'Next window'),
      h('th', null, 'Last run'),
      h('th', {style:{textAlign:'right'}}, 'Actions'),
    )));
    const tbody = h('tbody');
    rows.forEach(g => {
      const isOpen = patchState.expandedGroup === g.id;
      const caret = h('span', {style:{
        display:'inline-block',width:'16px',color:'var(--ink-3)',fontFamily:'var(--mono)',
        transform: isOpen?'rotate(90deg)':'none',transition:'transform var(--t)',
      }}, '›');
      const rowCls = isOpen ? '.row-expanded' : '';
      const toggleRow = ()=>{
        patchState.expandedGroup = isOpen ? null : g.id;
        patchState.groupInnerQ = '';
        window.RERENDER_PAGE(mount);
      };
      tbody.appendChild(h('tr'+rowCls, {style:{cursor:'pointer'}, on:{click:toggleRow}},
        h('td', null, caret),
        h('td.host', null, mark(g.id, q)),
        h('td.num', null, g.servers.toLocaleString()),
        h('td.muted', null, mark(g.window, q)),
        h('td.muted', null, (g.last && g.last.date) || '—'),
        h('td', {style:{textAlign:'right'}}, h('button.btn', {
          on:{click:(e)=>{ e.stopPropagation(); toggleRow(); }}
        }, isOpen ? 'Hide servers' : 'View servers')),
      ));
      if (isOpen) {
        tbody.appendChild(renderGroupServersRow(g, mount));
      }
    });
    if (rows.length === 0) tbody.appendChild(h('tr', null, h('td', {colspan:6}, h('div.no-hits', null, 'No groups match ', h('b', null, patchState.groupQ)))));
    table.appendChild(tbody);
    tbl.appendChild(table);
    wrap.appendChild(tbl);
    return wrap;
  }

  // Expanded server list for a patch group — inline sub-table with its own search
  function renderGroupServersRow(g, mount) {
    const all = (window.SERVERS_DATA?.servers || []).filter(s => s.pg === g.id);
    // If we have fewer synthesized servers than the group's nominal count, that's expected — the UI explains it
    const iq = (patchState.groupInnerQ || '').trim().toLowerCase();
    const hits = iq
      ? all.filter(s =>
          (s.name||'').toLowerCase().includes(iq) ||
          (s.fqdn||'').toLowerCase().includes(iq) ||
          (s.service||'').toLowerCase().includes(iq) ||
          (s.func||'').toLowerCase().includes(iq) ||
          (s.app||'').toLowerCase().includes(iq) ||
          (s.bu||'').toLowerCase().includes(iq))
      : all;

    const tr = h('tr.row-expansion', {style:{background:'var(--paper-2)'}},
      h('td', {colspan:6, style:{padding:'0',borderTop:'1px solid var(--rule)'}},
        h('div', {style:{padding:'16px 22px',display:'flex',flexDirection:'column',gap:'12px'}},
          // Sub-header with inner search
          h('div', {style:{display:'flex',alignItems:'center',gap:'12px'}},
            h('span', {style:{fontFamily:'var(--mono)',fontSize:'10px',letterSpacing:'0.14em',textTransform:'uppercase',color:'var(--ink-3)'}},
              g.id + ' · ' + all.length + ' servers'),
            h('span', {style:{flex:'1'}}),
            h('input', {'data-fk':'patch-group-inner-search', type:'text', placeholder:'Search servers, service, function within '+g.id+'…',
              value: patchState.groupInnerQ,
              style:{
                height:'32px',width:'340px',padding:'0 12px',
                border:'1px solid var(--rule-2)',background:'var(--paper)',color:'var(--ink)',
                fontFamily:'var(--mono)',fontSize:'12px',
              },
              on:{click:(e)=>e.stopPropagation(), input:(e)=>{ patchState.groupInnerQ = e.target.value; window.RERENDER_PAGE(mount); }},
            }),
          ),
          // Inner table
          renderGroupServersTable(hits, iq, g.id),
          // Count readout
          h('div', {style:{fontFamily:'var(--mono)',fontSize:'11px',color:'var(--ink-3)',letterSpacing:'0.06em'}},
            iq ? hits.length + ' match' + (hits.length===1?'':'es') + ' in ' + g.id : 'Showing all servers in ' + g.id),
        ),
      ),
    );
    // stop row-click bubble on inner table clicks too
    tr.addEventListener('click', e => e.stopPropagation());
    return tr;
  }

  function renderGroupServersTable(rows, iq, groupId) {
    if (rows.length === 0) {
      return h('div', {style:{padding:'24px',background:'var(--paper)',border:'1px dashed var(--rule)',
        fontFamily:'var(--mono)',fontSize:'12px',color:'var(--ink-3)',textAlign:'center'}},
        'No servers in '+groupId+' match the current filter.');
    }
    const wrap = h('div', {style:{border:'1px solid var(--rule)',background:'var(--paper)',maxHeight:'420px',overflowY:'auto'}});
    const table = h('table.op.inner', {style:{margin:'0'}});
    table.appendChild(h('thead', null, h('tr', null,
      h('th', null, 'Server'),
      h('th', null, 'Patch group'),
      h('th', null, 'Business unit'),
      h('th', null, 'Scheduled'),
      h('th', null, 'Service'),
      h('th', null, 'Function'),
      h('th', {style:{textAlign:'right'}}, 'Issues'),
    )));
    const tb = h('tbody');
    rows.forEach(s => {
      tb.appendChild(h('tr', null,
        h('td.host', null, mark(s.name, iq)),
        h('td', null, h('span.chip', null, h('span.dot'), s.pg)),
        h('td.muted', null, mark(s.bu || 'Unknown', iq)),
        h('td.muted', null, s.active ? '14:00–16:00' : '—'),
        h('td', null, mark(s.service || '—', iq)),
        h('td.muted', null, mark(s.func || '—', iq)),
        h('td', {style:{textAlign:'right'}},
          h('span', {style:{
            display:'inline-flex',alignItems:'center',gap:'6px',
            fontFamily:'var(--mono)',fontSize:'11.5px',color: s.active ? 'var(--ok)' : 'var(--warn)',
          }},
            h('span', {style:{width:'6px',height:'6px',borderRadius:'50%',background:s.active?'var(--ok)':'var(--warn)'}}),
            s.active ? 'None' : 'Unreachable'),
        ),
      ));
    });
    table.appendChild(tb);
    wrap.appendChild(table);
    return wrap;
  }

  function renderPatchHistory(mount) {
    const wrap = h('div', {style:{display:'flex',flexDirection:'column',gap:'18px'}});
    const cycles = getPatchCycles();
    const allGroups = getPatchGroups();
    wrap.appendChild(sectionLabel('Cycle outcomes', cycles.length,
      h('div', {style:{marginLeft:'auto',display:'flex',gap:'14px',alignItems:'baseline'}},
        h('span.ct', null, 'per-server counts pending Ivanti integration'),
        h('span.ct', null, 'most recent first'),
      ),
    ));

    const tbl = h('div.table-wrap');
    const table = h('table.op');
    table.appendChild(h('thead', null, h('tr', null,
      h('th', null, 'Cycle'),
      h('th', null, 'Window'),
      h('th', null, 'Outcome'),
      h('th.num', null, 'Servers'),
      h('th.num', null, 'Completed'),
      h('th.num', null, 'Failed'),
      h('th.num', null, 'Skipped'),
      h('th', null, 'Notes'),
    )));
    const tbody = h('tbody');
    // Backend DisplayStatus values (lowercased by mapPatchCycles): upcoming,
    // active, completed, cancelled, past. Legacy demo uses queued, success,
    // partial, failed. We handle both vocabularies so live and demo render
    // consistently, and 'completed' with 0 counts degrades to "COMPLETED"
    // rather than a misleading "CLEAN PASS · 0%" — per-server completion
    // tracking in patch_schedule.patch_status isn't currently populated, so
    // aggregated completed/failed counts come back zero for most cycles.
    const cycleBadge = (c) => {
      const pct = c.servers ? (c.completed / c.servers * 100).toFixed(1) : '0.0';
      switch (c.status) {
        case 'queued':
        case 'upcoming':  return { tone: 'info', el: stamp('info', 'QUEUED') };
        case 'active':    return { tone: 'info', el: stamp('info', 'IN PROGRESS') };
        case 'cancelled': return { tone: 'warn', el: stamp('warn', 'CANCELLED') };
        case 'success':
        case 'completed':
        case 'past':
          if (c.failed > 0 && c.completed > 0) return { tone: 'warn', el: stamp('warn', c.failed + ' FAILED · ' + pct + '%') };
          if (c.failed > 0)                    return { tone: 'crit', el: stamp('crit', 'FAILED') };
          if (c.completed > 0)                 return { tone: 'ok',   el: stamp('ok',   'CLEAN PASS · ' + pct + '%') };
          return { tone: 'ok', el: stamp('ok', 'COMPLETED') };
        case 'partial':   return { tone: 'warn', el: stamp('warn', c.failed + ' FAILED · ' + pct + '%') };
        case 'failed':    return { tone: 'crit', el: stamp('crit', 'FAILED') };
        default:          return { tone: 'info', el: stamp('info', (c.status || 'unknown').toUpperCase()) };
      }
    };
    cycles.forEach(c => {
      const { tone, el } = cycleBadge(c);
      const rowCls = tone === 'warn' ? '.sev-warn' : tone === 'crit' ? '.sev-crit' : '';
      tbody.appendChild(h('tr'+rowCls, null,
        h('td.host', null, c.id),
        h('td.muted', null, c.window),
        h('td', null, el),
        h('td.num', null, c.servers.toLocaleString()),
        h('td.num', null, c.completed.toLocaleString()),
        h('td.num'+(c.failed>0?'.strong':''), {style: c.failed>0?{color:'var(--crit)'}:null}, c.failed.toLocaleString()),
        h('td.num'+(c.skipped>0?'.strong':''), {style: c.skipped>0?{color:'var(--warn)'}:null}, c.skipped.toLocaleString()),
        h('td.muted', {style:{maxWidth:'360px'}}, c.notes),
      ));
    });
    table.appendChild(tbody);
    tbl.appendChild(table);
    wrap.appendChild(tbl);

    // Per-group success ledger for the most recent completed cycle. Real
    // per-group outcome history isn't yet served by the API — skip the
    // ledger when g.last isn't present.
    const last = cycles.find(c => c.status !== 'queued');
    const groupsWithHistory = allGroups.filter(g => g.last && g.last.result);
    if (!last || !groupsWithHistory.length) return wrap;
    wrap.appendChild(sectionLabel('Per-group outcome · '+last.id, groupsWithHistory.length));
    const ledger = h('div', {style:{display:'grid',gridTemplateColumns:'repeat(4, 1fr)',gap:'1px',background:'var(--rule)',border:'1px solid var(--rule)'}});
    groupsWithHistory.forEach(g => {
      const tone = g.last.result === 'success' ? 'ok' : g.last.result === 'partial' ? 'warn' : 'crit';
      ledger.appendChild(h('div', {style:{padding:'14px 16px',background:'var(--card)',display:'flex',flexDirection:'column',gap:'6px'}},
        h('div', {style:{display:'flex',justifyContent:'space-between',alignItems:'baseline'}},
          h('span', {style:{fontFamily:'var(--mono)',fontSize:'11.5px',fontWeight:'600',color:'var(--ink)'}}, g.id),
          h('span', {style:{fontFamily:'var(--mono)',fontSize:'10.5px',letterSpacing:'0.08em',textTransform:'uppercase',color:tone==='crit'?'var(--crit)':tone==='warn'?'var(--warn)':'var(--ok)'}}, g.last.result.toUpperCase())),
        h('div', {style:{display:'flex',height:'6px',background:'var(--paper-2)',overflow:'hidden'}},
          h('span', {style:{width:g.last.pct+'%',background:tone==='crit'?'var(--crit)':tone==='warn'?'var(--warn)':'var(--ok)'}})),
        h('div', {style:{fontFamily:'var(--mono)',fontSize:'11px',color:'var(--ink-3)',display:'flex',justifyContent:'space-between'}},
          h('span', null, g.last.pct+'% patched'),
          h('span', null, g.last.failed > 0 ? g.last.failed+' failed' : 'all reboots clean')),
      ));
    });
    wrap.appendChild(ledger);
    return wrap;
  }

  function renderPatchIssues(mount) {
    const wrap = h('div', {style:{display:'flex',flexDirection:'column',gap:'18px'}});
    const PATCH_ISSUES = getPatchIssues();
    wrap.appendChild(sectionLabel('Known issues & blockers', PATCH_ISSUES.length, h('span.ct', {style:{marginLeft:'auto'}}, 'Sorted by severity')));

    PATCH_ISSUES.forEach(issue => {
      const tone = issue.severity; // 'crit' | 'warn' | 'info'
      const statusChip = issue.status === 'blocking'   ? stamp('crit', 'BLOCKING CYCLE') :
                         issue.status === 'workaround' ? stamp('warn', 'WORKAROUND') :
                                                         stamp('ok',   'RESOLVED');
      const card = h('div', {style:{
        border:'1px solid var(--rule)', borderLeft:'3px solid '+(tone==='crit'?'var(--crit)':tone==='warn'?'var(--warn)':'var(--ok)'),
        background:'var(--card)', padding:'20px 24px', display:'grid',
        gridTemplateColumns:'1fr auto', gap:'14px 32px',
      }});
      // Header
      card.appendChild(h('div', {style:{gridColumn:'1 / -1',display:'flex',alignItems:'center',gap:'12px',flexWrap:'wrap'}},
        h('span', {style:{fontFamily:'var(--mono)',fontSize:'11.5px',fontWeight:'600',color:'var(--ink)'}}, issue.id),
        h('span', {style:{fontFamily:'var(--mono)',fontSize:'10.5px',color:'var(--ink-3)'}}, issue.kb),
        statusChip,
        h('span', {style:{flex:'1'}}),
        h('span', {style:{fontFamily:'var(--mono)',fontSize:'10.5px',color:'var(--ink-3)'}}, 'first seen '+issue.first),
      ));
      // Title
      card.appendChild(h('div', {style:{gridColumn:'1 / -1',fontFamily:'var(--display)',fontSize:'22px',letterSpacing:'-0.01em',color:'var(--ink)',fontWeight:'400'}}, issue.title));
      // Body
      card.appendChild(h('div', {style:{fontSize:'13.5px',color:'var(--ink-2)',lineHeight:'1.55',maxWidth:'70ch'}}, issue.notes));
      // Side stats
      card.appendChild(h('div', {style:{display:'flex',flexDirection:'column',gap:'14px',borderLeft:'1px dashed var(--rule-2)',paddingLeft:'24px',minWidth:'220px'}},
        h('div', null,
          h('div', {style:{fontFamily:'var(--mono)',fontSize:'10px',letterSpacing:'0.14em',textTransform:'uppercase',color:'var(--ink-3)'}}, 'Affected'),
          h('div', {style:{fontFamily:'var(--display)',fontSize:'28px',letterSpacing:'-0.01em',color:tone==='crit'?'var(--crit)':'var(--ink)'}}, issue.servers.toLocaleString()+' servers')),
        h('div', null,
          h('div', {style:{fontFamily:'var(--mono)',fontSize:'10px',letterSpacing:'0.14em',textTransform:'uppercase',color:'var(--ink-3)'}}, 'Product'),
          h('div', {style:{fontSize:'13px',color:'var(--ink)'}}, issue.product),
          h('div', {style:{fontSize:'12px',color:'var(--ink-3)',marginTop:'2px'}}, 'Group '+issue.group)),
      ));
      wrap.appendChild(card);
    });

    return wrap;
  }

  // =============================================================
  // PATCH MANAGEMENT PAGE
  // =============================================================
  const pmState = {
    tab: 'excluded',   // excluded | add | bulk | expiring
    q: '',
    stateFilter: '__all',
    sort: 'until',
    sortDir: 1,
    page: 1,
    per: 20,
    // add-exclusion wizard. untilIso is the canonical yyyy-mm-dd (what gets
    // submitted); until is the en-GB display string. error holds the last
    // submit failure for the inline banner.
    add: { step: 1, serverQuery: '', selectedServers: [], reason: '', otherReason: '', until: '', untilIso: '', notes: '', calOffset: 0, error: null },
    // bulk
    bulk: { scope: 'group', group: 'GROUP0', env: 'Production', reason: '', otherReason: '', until: '', untilIso: '', calOffset: 0, error: null },
  };

  function renderPatchMgmtPage(mount) {
    const page = h('div.page');
    const ribbon = demoRibbon('exclusions'); if (ribbon) page.appendChild(ribbon);

    // Hero strip — exclusions health
    const strip = h('div.crit-strip');
    const overdue = window.EXCL_COUNTS.overdue || 0;
    const expiring = window.EXCL_COUNTS['expiring-soon'] || 0;
    const active = window.EXCL_COUNTS.active || 0;
    strip.appendChild(h('div.cs-cell.status-cell'+(overdue>0?'.crit':expiring>0?'.warn':'.ok'),
      { on:{click:()=>{ pmState.tab='excluded'; pmState.stateFilter=overdue>0?'overdue':expiring>0?'expiring-soon':'__all'; window.RERENDER_PAGE(mount); }}},
      h('div.cs-label', null, 'Exclusions · action required'),
      h('div.cs-value', null, String(overdue + expiring),
        h('span.cs-unit', null, 'need review')),
      h('div.cs-sub', null, overdue>0 ? overdue+' past hold date \u2014 reconcile before April cycle' : expiring>0 ? expiring+' expire within 7 days' : 'All exclusions current'),
      h('div.cs-link', null, 'Filter to action-required'),
    ));
    strip.appendChild(h('div.cs-cell.crit', { on:{click:()=>{ pmState.tab='excluded'; pmState.stateFilter='overdue'; window.RERENDER_PAGE(mount); }}},
      h('div.cs-label', null, 'Overdue'),
      h('div.cs-value', null, String(overdue), h('span.cs-unit', null, 'past hold-until')),
      h('div.cs-sub', null, 'Will be patched next cycle unless renewed'),
      overdue>0 ? h('div.cs-link', null, 'Show overdue') : null,
    ));
    strip.appendChild(h('div.cs-cell.warn', { on:{click:()=>{ pmState.tab='expiring'; window.RERENDER_PAGE(mount); }}},
      h('div.cs-label', null, 'Expiring soon'),
      h('div.cs-value', null, String(expiring), h('span.cs-unit', null, '≤ 7 days')),
      h('div.cs-sub', null, 'Renewal needed or scheduled cleanup'),
      expiring>0 ? h('div.cs-link', null, 'Open renewals') : null,
    ));
    strip.appendChild(h('div.cs-cell.ok', { on:{click:()=>{ pmState.tab='excluded'; pmState.stateFilter='active'; window.RERENDER_PAGE(mount); }}},
      h('div.cs-label', null, 'Active exclusions'),
      h('div.cs-value', null, String(active), h('span.cs-unit', null, 'in effect')),
      h('div.cs-sub', null, 'Within agreed hold windows'),
    ));
    strip.appendChild(h('div.cs-cell.ok', null,
      h('div.cs-label', null, 'Eligible pool'),
      h('div.cs-value', null, getPatchTotal().toLocaleString(), h('span.cs-unit', null, 'servers')),
      h('div.cs-sub', null, 'Will receive the April cycle'),
    ));
    page.appendChild(strip);

    // Tabs
    const tab = (id, label, n) => {
      const on = pmState.tab === id;
      return h('button.tab'+(on?'.on':''), { on:{click:()=>{ pmState.tab=id; window.RERENDER_PAGE(mount); }}},
        label, n != null ? h('span.n', null, String(n)) : null);
    };
    page.appendChild(h('div.tabs', null,
      tab('excluded', 'Currently excluded', window.EXCLUSIONS.length),
      tab('add',      'Add exclusion'),
      tab('bulk',     'Bulk exclude'),
      tab('expiring', 'Expiring renewals', expiring + overdue),
    ));

    if (pmState.tab === 'excluded') page.appendChild(renderExcludedTable(mount));
    if (pmState.tab === 'add')      page.appendChild(renderAddExclusion(mount));
    if (pmState.tab === 'bulk')     page.appendChild(renderBulkExclude(mount));
    if (pmState.tab === 'expiring') page.appendChild(renderExpiringRenewals(mount));

    mount.innerHTML = '';
    mount.appendChild(page);
  }

  function filteredExclusions() {
    const q = pmState.q.trim().toLowerCase();
    let rows = window.EXCLUSIONS.slice();
    if (pmState.stateFilter !== '__all') rows = rows.filter(r => r.state === pmState.stateFilter);
    // BU filter is applied server-side via OC_API.fetchExclusions (which
    // reads window.SELECTED_BU from the global rail selector).
    if (q) rows = rows.filter(r =>
      (r.server || '').toLowerCase().includes(q) ||
      (r.service || '').toLowerCase().includes(q) ||
      (r.func || '').toLowerCase().includes(q) ||
      (r.reason || '').toLowerCase().includes(q) ||
      (r.requester || '').toLowerCase().includes(q) ||
      (r.group || '').toLowerCase().includes(q) ||
      (r.bu || '').toLowerCase().includes(q) ||
      (r.id || '').toLowerCase().includes(q));
    const key = pmState.sort;
    const dir = pmState.sortDir;
    rows.sort((a, b) => {
      const av = a[key], bv = b[key];
      if (av < bv) return -1 * dir;
      if (av > bv) return  1 * dir;
      return 0;
    });
    return rows;
  }

  function renderExcludedTable(mount) {
    const wrap = h('div', {style:{display:'flex',flexDirection:'column',gap:'18px'}});
    const rows = filteredExclusions();
    const pag = paginate(rows.length, pmState.page, pmState.per);
    pmState.page = pag.cur;
    const paged = rows.slice(pag.start, pag.end);

    // Cross-facet scoped state + BU dropdowns when API breakdown is loaded.
    // Falls back to the client-side EXCL_COUNTS getter and static BU_VALUES on
    // demo/no-API path.
    const exBreakdown = (window.EXCL_BREAKDOWN) || { states: [], businessUnits: [], totalExcluded: window.EXCLUSIONS.length };
    const stByCode = {};
    exBreakdown.states.forEach(s => { stByCode[s.state] = s.totalCount; });
    const stCount = (code) => exBreakdown.states.length ? (stByCode[code] || 0) : ((window.EXCL_COUNTS && window.EXCL_COUNTS[code]) || 0);
    const stateOpts = [
      ['__all','All states (' + (exBreakdown.totalExcluded != null ? exBreakdown.totalExcluded : window.EXCLUSIONS.length) + ')'],
      ['overdue','Overdue ('+stCount('overdue')+')'],
      ['expiring-soon','Expiring soon ('+stCount('expiring-soon')+')'],
      ['active','Active ('+stCount('active')+')'],
    ];

    // BU scope comes from the global rail selector. fetchExclusions reads
    // window.SELECTED_BU automatically when no bu is passed.
    const refetchExclusions = async () => {
      const refetched = (window.OC_API && typeof window.OC_API.fetchExclusions === 'function')
        ? await window.OC_API.fetchExclusions({ state: pmState.stateFilter })
        : null;
      if (!refetched) window.RERENDER_PAGE(mount);
    };

    const q = h('input', {'data-fk':'patchmgmt-search', type:'text', placeholder:'Filter by server, service, function, reason, requester…', value: pmState.q,
      on:{input:(e)=>{
        pmState.q=e.target.value; pmState.page=1;
        // Debounce: filtering/sorting/paginating the full exclusions list on
        // every keystroke is the main render cost on this page. data-fk keeps
        // caret/focus across the re-render.
        clearTimeout(pmState._qTimer);
        pmState._qTimer = setTimeout(()=>window.RERENDER_PAGE(mount), 160);
      }}});
    const stateSel = h('select', { on:{change: async (e)=>{
      pmState.stateFilter=e.target.value; pmState.page=1; await refetchExclusions();
    }}},
      stateOpts.map(([v,l]) => h('option', {value:v, selected: pmState.stateFilter===v}, l)));
    const reset = h('button.btn', { on:{click: async ()=>{
      const wasState = pmState.stateFilter;
      pmState.q=''; pmState.stateFilter='__all'; pmState.page=1;
      if (wasState !== '__all') {
        await refetchExclusions();
      } else {
        window.RERENDER_PAGE(mount);
      }
    }}}, 'Reset');
    const addBtn = h('button.btn.primary', { on:{click:()=>{ pmState.tab='add'; window.RERENDER_PAGE(mount); }}}, '+ Add exclusion');
    const count = h('span.ct', null, 'Showing '+(pag.start+1)+'–'+pag.end+' of '+rows.length);
    wrap.appendChild(filterBar([stateSel, q, reset, h('span.spacer'), count, addBtn]));

    const tbl = h('div.table-wrap');
    const table = h('table.op');
    const sortableTh = (key, label, extraCls) => {
      const on = pmState.sort === key;
      return h('th'+(extraCls?'.'+extraCls:'')+'.sortable'+(on?'.sorted':''),
        { on:{click:()=>{
          if (pmState.sort===key) pmState.sortDir *= -1;
          else { pmState.sort=key; pmState.sortDir=1; }
          window.RERENDER_PAGE(mount);
        }}},
        label, h('span.caret', null, on ? (pmState.sortDir===1?'↑':'↓') : '·'));
    };
    table.appendChild(h('thead', null, h('tr', null,
      sortableTh('id','ID'),
      sortableTh('server','Server'),
      sortableTh('group','Group'),
      sortableTh('bu','Business unit'),
      sortableTh('service','Service'),
      sortableTh('func','Function'),
      sortableTh('reason','Reason'),
      sortableTh('until','Hold until'),
      sortableTh('requester','Requester'),
      h('th', null, 'State'),
      h('th', null, 'Actions'),
    )));
    const tbody = h('tbody');
    const qq = pmState.q;
    const stateChip = (s) => s === 'overdue' ? stamp('crit', 'OVERDUE') :
                             s === 'expiring-soon' ? stamp('warn', 'EXPIRING SOON') :
                                                      stamp('ok',   'ACTIVE');
    paged.forEach(r => {
      const rowCls = r.state === 'overdue' ? '.sev-crit' : r.state === 'expiring-soon' ? '.sev-warn' : '';
      tbody.appendChild(h('tr'+rowCls, null,
        h('td.host', null, mark(r.id, qq)),
        h('td.host', null, mark(r.server, qq)),
        h('td', null, h('span.chip', null, h('span.dot'), mark(r.group, qq))),
        h('td.muted', null, mark(r.bu || 'Unknown', qq)),
        h('td', null, mark(r.service || '—', qq)),
        h('td.muted', null, mark(r.func || '—', qq)),
        h('td.muted', null, mark(r.reason, qq)),
        h('td'+(r.state==='overdue'?'.strong':''), {style: r.state==='overdue'?{color:'var(--crit)',fontWeight:'600'}:r.state==='expiring-soon'?{color:'var(--warn)',fontWeight:'600'}:null}, r.until),
        h('td.muted', null, mark(r.requester, qq)),
        h('td', null, stateChip(r.state)),
        h('td', null, h('div', {style:{display:'flex',gap:'6px'}},
          h('button.btn', { on:{click:()=>{
            const act = window.OC_ACTIONS && window.OC_ACTIONS.renewExclusion;
            if (act) act(r); else toast('Renewed '+r.id+' (demo)');
          }}}, 'Renew'),
          h('button.btn.danger', { on:{click:()=>{
            const act = window.OC_ACTIONS && window.OC_ACTIONS.releaseExclusion;
            if (act) act(r); else toast('Released '+r.id+' (demo)');
          }}}, 'Release'),
        )),
      ));
    });
    if (paged.length === 0) tbody.appendChild(h('tr', null, h('td', {colspan:11}, h('div.no-hits', null, 'No exclusions match filter'))));
    table.appendChild(tbody);
    tbl.appendChild(table);
    tbl.appendChild(paginationBar(pag, p => { pmState.page=p; window.RERENDER_PAGE(mount); }));
    wrap.appendChild(tbl);
    return wrap;
  }

  // ---------- Calendar date picker ----------
  // Canonical date parsing/derivation lives in op-datekit.js (window.OP_DATEKIT,
  // loaded before this script) so the frontend and the Node tests share one
  // implementation and the en-GB display string <-> Date round-trip can't fail
  // silently (e.g. the CLDR-42 "Sept" form that new Date() rejects). The inline
  // fallbacks below only run if that module somehow failed to load.
  function parseUntil(s) {
    if (window.OP_DATEKIT) return window.OP_DATEKIT.parseLoose(s);
    if (!s) return null;
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  // Date -> canonical "yyyy-mm-dd" from LOCAL components (no UTC drift).
  function isoLocal(d) {
    if (window.OP_DATEKIT) return window.OP_DATEKIT.isoLocal(d);
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function fmtUntil(d) {
    return d.toLocaleDateString('en-GB', {day:'numeric', month:'short', year:'numeric'});
  }
  // Date at local midnight today - anchor for relative offsets and "is it past" checks.
  function todayLocal() {
    if (window.OP_DATEKIT) return window.OP_DATEKIT.todayLocal();
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  }
  // Calendar arithmetic (not ms) so it stays correct across DST transitions.
  function addDays(base, n) {
    if (window.OP_DATEKIT) return window.OP_DATEKIT.addDays(base, n);
    return new Date(base.getFullYear(), base.getMonth(), base.getDate() + n);
  }
  // Mirrors the backend's hold-state rule (PatchExclusionService.StateClauseFor):
  // overdue = until < today; expiring-soon = today <= until < today+7d; active otherwise.
  // Accepts a Date or any string parseUntil understands for `until`.
  function deriveState(until, today) {
    if (window.OP_DATEKIT) return window.OP_DATEKIT.deriveState(until, today);
    const u = parseUntil(until);
    if (!u || !today) return 'active';
    const days = Math.round((u - today) / 86400000);
    if (days < 0) return 'overdue';
    if (days < 7) return 'expiring-soon';
    return 'active';
  }
  // Inline, dismissible error banner used by the exclusion wizards instead of
  // window.alert() - keeps the user in flow and is announced via role=alert.
  function wizardError(msg, onDismiss) {
    return h('div', {role:'alert', style:{
      display:'flex',alignItems:'center',gap:'12px',padding:'12px 14px',marginBottom:'4px',
      border:'1px solid var(--crit)',background:'var(--crit-wash, rgba(200,40,40,0.08))',borderLeft:'3px solid var(--crit)',
    }},
      h('span', {style:{fontSize:'13px',color:'var(--ink)'}}, msg),
      h('button.btn', {style:{marginLeft:'auto'}, on:{click:onDismiss}}, 'Dismiss'),
    );
  }
  function sameDay(a, b) {
    return a && b && a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate();
  }
  function renderCalendarPicker(today, mount, stateObj) {
    stateObj = stateObj || pmState.add;
    const sel = parseUntil(stateObj.until);
    const base = new Date(today.getFullYear(), today.getMonth()+1+(stateObj.calOffset||0), 1); // start on next month to emphasise future-dates
    const months = [0, 1].map(i => new Date(base.getFullYear(), base.getMonth()+i, 1));
    const minDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const maxDate = new Date(today.getFullYear()+1, today.getMonth(), today.getDate()); // 12mo horizon

    const wrap = h('div', {style:{border:'1px solid var(--rule)',background:'var(--paper-2)',padding:'14px 16px'}});

    // Nav row
    const nav = h('div', {style:{display:'flex',alignItems:'center',gap:'12px',marginBottom:'12px'}});
    const prevBtn = h('button.btn', { on:{click:()=>{ stateObj.calOffset = (stateObj.calOffset||0) - 1; window.RERENDER_PAGE(mount); }}}, '←');
    const nextBtn = h('button.btn', { on:{click:()=>{ stateObj.calOffset = (stateObj.calOffset||0) + 1; window.RERENDER_PAGE(mount); }}}, '→');
    nav.appendChild(prevBtn);
    nav.appendChild(h('span', {style:{flex:'1',fontFamily:'var(--mono)',fontSize:'11px',letterSpacing:'0.1em',textTransform:'uppercase',color:'var(--ink-3)',textAlign:'center'}},
      months[0].toLocaleDateString('en-GB',{month:'long',year:'numeric'}) + '  —  ' + months[1].toLocaleDateString('en-GB',{month:'long',year:'numeric'})));
    nav.appendChild(nextBtn);
    // selected date display
    const readout = h('span', {style:{fontFamily:'var(--mono)',fontSize:'11.5px',color:sel?'var(--ink)':'var(--ink-4)',minWidth:'120px',textAlign:'right'}},
      sel ? fmtUntil(sel) : 'no date selected');
    nav.appendChild(readout);
    wrap.appendChild(nav);

    // Two-month grid
    const grid = h('div', {style:{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'24px'}});
    months.forEach(m => grid.appendChild(renderMonthGrid(m, sel, minDate, maxDate, (d) => {
      stateObj.until = fmtUntil(d);     // display
      stateObj.untilIso = isoLocal(d);  // canonical wire value (no string round-trip)
      window.RERENDER_PAGE(mount);
    })));
    wrap.appendChild(grid);

    // Hint
    wrap.appendChild(h('div', {style:{fontFamily:'var(--mono)',fontSize:'10px',letterSpacing:'0.1em',color:'var(--ink-4)',marginTop:'10px'}},
      'Today ' + fmtUntil(today) + ' · hold windows capped at 12 months'));

    return wrap;
  }
  function renderMonthGrid(monthDate, selDate, minDate, maxDate, onPick) {
    const y = monthDate.getFullYear(), m = monthDate.getMonth();
    const first = new Date(y, m, 1);
    const last = new Date(y, m+1, 0);
    const startDow = (first.getDay() + 6) % 7; // Monday-first
    const daysInMonth = last.getDate();
    const wrap = h('div');
    wrap.appendChild(h('div', {style:{fontFamily:'var(--display)',fontSize:'14px',color:'var(--ink)',marginBottom:'8px',letterSpacing:'-0.005em'}},
      monthDate.toLocaleDateString('en-GB',{month:'long',year:'numeric'})));
    const days = h('div', {style:{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:'2px'}});
    ['M','T','W','T','F','S','S'].forEach(d => days.appendChild(h('div', {style:{
      fontFamily:'var(--mono)',fontSize:'10px',letterSpacing:'0.08em',color:'var(--ink-4)',
      textAlign:'center',padding:'6px 0 4px',textTransform:'uppercase',
    }}, d)));
    // blank cells for week start
    for (let i = 0; i < startDow; i++) days.appendChild(h('div'));
    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(y, m, day);
      const isSel = sameDay(d, selDate);
      const isToday = sameDay(d, minDate);
      const isPast = d < minDate;
      const isBeyond = d > maxDate;
      const disabled = isPast || isBeyond;
      const cell = h('button', {
        type:'button',
        disabled,
        style:{
          appearance:'none',border:'1px solid '+(isSel?'var(--signal)':isToday?'var(--rule-2)':'transparent'),
          background: isSel ? 'var(--signal)' : isToday ? 'var(--paper)' : 'transparent',
          color: isSel ? 'var(--paper)' : disabled ? 'var(--ink-4)' : 'var(--ink)',
          fontFamily:'var(--mono)',fontSize:'12px',fontWeight: isSel||isToday ? '600' : '400',
          padding:'8px 0',cursor: disabled?'not-allowed':'pointer',
          opacity: disabled?'0.35':'1',
          transition:'background var(--t), border-color var(--t), color var(--t)',
        },
        on: disabled ? {} : {click:()=>onPick(d), mouseenter:(e)=>{
          if (!isSel) { e.target.style.background='var(--signal-wash)'; e.target.style.borderColor='var(--signal)'; }
        }, mouseleave:(e)=>{
          if (!isSel) { e.target.style.background=isToday?'var(--paper)':'transparent'; e.target.style.borderColor=isToday?'var(--rule-2)':'transparent'; }
        }},
      }, String(day));
      days.appendChild(cell);
    }
    wrap.appendChild(days);
    return wrap;
  }

  function renderAddExclusion(mount) {
    const wrap = h('div', {style:{display:'flex',flexDirection:'column',gap:'18px',maxWidth:'980px'}});
    wrap.appendChild(sectionLabel('Add exclusion', null, h('span.ct', {style:{marginLeft:'auto'}}, 'Step '+pmState.add.step+' of 4')));

    // Stepper
    const steps = [
      {n:1, label:'Select server'},
      {n:2, label:'Choose reason'},
      {n:3, label:'Set hold-until'},
      {n:4, label:'Confirm'},
    ];
    const stepper = h('div', {style:{display:'grid',gridTemplateColumns:'repeat(4, 1fr)',gap:'1px',background:'var(--rule)',border:'1px solid var(--rule)',marginBottom:'4px'}});
    steps.forEach(s => {
      const isCurrent = pmState.add.step === s.n;
      const isDone = pmState.add.step > s.n;
      stepper.appendChild(h('div', {style:{
        padding:'14px 18px',
        background: isCurrent ? 'var(--signal-wash)' : 'var(--card)',
        borderLeft: isCurrent ? '3px solid var(--signal)' : isDone ? '3px solid var(--ok)' : '3px solid var(--rule-2)',
        display:'flex',alignItems:'center',gap:'12px',cursor: isDone?'pointer':'default',
      },
        on: isDone ? {click:()=>{ pmState.add.step = s.n; window.RERENDER_PAGE(mount); }} : {}},
        h('span', {style:{fontFamily:'var(--mono)',fontSize:'20px',color:isCurrent?'var(--signal)':isDone?'var(--ok)':'var(--ink-4)',fontWeight:'600',minWidth:'24px'}}, isDone?'✓':String(s.n)),
        h('div', {style:{display:'flex',flexDirection:'column'}},
          h('span', {style:{fontFamily:'var(--mono)',fontSize:'10px',letterSpacing:'0.14em',textTransform:'uppercase',color:'var(--ink-3)'}}, 'Step '+s.n),
          h('span', {style:{fontSize:'13px',fontWeight:isCurrent?'600':'400',color:'var(--ink)'}}, s.label)),
      ));
    });
    wrap.appendChild(stepper);

    // Content card per step
    const panel = h('div', {style:{border:'1px solid var(--rule)',background:'var(--card)',padding:'28px 32px',display:'flex',flexDirection:'column',gap:'18px',minHeight:'380px'}});

    const footer = h('div', {style:{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:'auto',paddingTop:'20px',borderTop:'1px dashed var(--rule)'}});

    if (pmState.add.step === 1) {
      panel.appendChild(h('div', {style:{fontFamily:'var(--display)',fontSize:'22px',letterSpacing:'-0.01em',color:'var(--ink)',fontWeight:'400'}}, 'Which servers should be held out of the next cycle?'));
      panel.appendChild(h('div', {style:{fontSize:'13px',color:'var(--ink-2)',maxWidth:'60ch'}}, 'Search and pick one or more. Each held server skips patching during its hold window, and is automatically flagged for reconciliation when that window closes.'));

      const input = h('input', {'data-fk':'add-excl-server-search', type:'text', placeholder:'Search name, FQDN, application…', value: pmState.add.serverQuery,
        style:{height:'44px',padding:'0 16px',border:'1px solid var(--rule-2)',fontSize:'14px',background:'var(--paper)',color:'var(--ink)',fontFamily:'var(--mono)'},
        on:{input:(e)=>{ pmState.add.serverQuery=e.target.value; window.RERENDER_PAGE(mount); }},
      });
      panel.appendChild(input);

      const sq = pmState.add.serverQuery.trim().toLowerCase();
      const selNames = new Set((pmState.add.selectedServers||[]).map(s=>s.name));
      const hits = sq ? (window.SERVERS_DATA?.servers || []).filter(s =>
        s.name.toLowerCase().includes(sq) || s.fqdn.toLowerCase().includes(sq) || s.app.toLowerCase().includes(sq)
      ).slice(0, 20) : [];

      const toggleServer = (s) => {
        const i = pmState.add.selectedServers.findIndex(x => x.name === s.name);
        if (i >= 0) pmState.add.selectedServers.splice(i, 1);
        else pmState.add.selectedServers.push(s);
        window.RERENDER_PAGE(mount);
      };

      if (sq && hits.length > 0) {
        // "Select all visible" row
        const allVisibleSelected = hits.every(s => selNames.has(s.name));
        const bar = h('div', {style:{display:'flex',alignItems:'center',gap:'10px',padding:'8px 14px',background:'var(--paper-2)',border:'1px solid var(--rule)',borderBottom:'none'}},
          h('button.btn', {style:{padding:'4px 10px',fontSize:'11px'},
            on:{click:()=>{
              if (allVisibleSelected) {
                const hitNames = new Set(hits.map(s=>s.name));
                pmState.add.selectedServers = pmState.add.selectedServers.filter(s => !hitNames.has(s.name));
              } else {
                const existingNames = new Set(pmState.add.selectedServers.map(s=>s.name));
                hits.forEach(s => { if (!existingNames.has(s.name)) pmState.add.selectedServers.push(s); });
              }
              window.RERENDER_PAGE(mount);
            }}}, allVisibleSelected ? 'Deselect all' : 'Select all ' + hits.length),
          h('span', {style:{fontFamily:'var(--mono)',fontSize:'11px',color:'var(--ink-3)',letterSpacing:'0.06em'}}, hits.length + ' match' + (hits.length===1?'':'es')),
        );
        panel.appendChild(bar);

        const list = h('div', {style:{border:'1px solid var(--rule)',background:'var(--paper-2)',maxHeight:'300px',overflowY:'auto'}});
        hits.forEach(s => {
          const isSelected = selNames.has(s.name);
          list.appendChild(h('div', {style:{
            padding:'12px 16px',borderBottom:'1px dashed var(--rule)',cursor:'pointer',
            background: isSelected ? 'var(--signal-wash)' : 'transparent',
            borderLeft: isSelected ? '3px solid var(--signal)' : '3px solid transparent',
            display:'grid',gridTemplateColumns:'22px 1fr 1fr 140px 100px',gap:'14px',alignItems:'center',
          }, on:{click:()=>toggleServer(s)}},
            // checkbox
            h('span', {style:{
              width:'16px',height:'16px',border:'1.5px solid '+(isSelected?'var(--signal)':'var(--rule-2)'),
              background: isSelected ? 'var(--signal)' : 'transparent',
              display:'inline-flex',alignItems:'center',justifyContent:'center',
              fontSize:'11px',color:'var(--paper)',fontWeight:'700',lineHeight:'1',
            }}, isSelected ? '✓' : ''),
            h('span', {style:{fontFamily:'var(--mono)',fontSize:'12px',fontWeight:'600',color:'var(--ink)'}}, mark(s.name, sq)),
            h('span', {style:{fontFamily:'var(--mono)',fontSize:'11.5px',color:'var(--ink-2)'}}, mark(s.fqdn, sq)),
            h('span', {style:{fontSize:'12px',color:'var(--ink-3)'}}, s.env),
            h('span', {style:{fontSize:'11.5px',color:'var(--ink-3)',fontFamily:'var(--mono)'}}, s.pg),
          ));
        });
        panel.appendChild(list);
      } else if (sq && hits.length === 0) {
        panel.appendChild(h('div.no-hits', null, 'No servers match ', h('b', null, pmState.add.serverQuery)));
      }

      const selected = pmState.add.selectedServers || [];
      if (selected.length > 0) {
        const chipsWrap = h('div', {style:{padding:'14px 18px',background:'var(--signal-wash)',border:'1px solid var(--signal)',display:'flex',flexDirection:'column',gap:'10px'}},
          h('div', {style:{display:'flex',alignItems:'center',gap:'12px'}},
            h('span', {style:{fontFamily:'var(--mono)',fontSize:'10.5px',letterSpacing:'0.14em',textTransform:'uppercase',color:'var(--signal-2)'}}, 'Selected · ' + selected.length),
            h('span', {style:{flex:'1'}}),
            h('button', {style:{
              background:'transparent',border:'none',fontFamily:'var(--mono)',fontSize:'11px',
              letterSpacing:'0.08em',textTransform:'uppercase',color:'var(--ink-3)',cursor:'pointer',padding:'2px 4px',
            }, on:{click:()=>{ pmState.add.selectedServers=[]; window.RERENDER_PAGE(mount); }}}, 'Clear all')),
          h('div', {style:{display:'flex',flexWrap:'wrap',gap:'6px'}},
            ...selected.map(s => h('span', {style:{
              display:'inline-flex',alignItems:'center',gap:'8px',
              padding:'4px 6px 4px 10px',background:'var(--paper)',border:'1px solid var(--signal)',
              fontFamily:'var(--mono)',fontSize:'11.5px',color:'var(--ink)',
            }},
              s.name,
              h('button', {style:{
                border:'none',background:'transparent',color:'var(--ink-3)',cursor:'pointer',
                padding:'0 4px',fontSize:'14px',lineHeight:'1',
              }, title:'Remove', on:{click:(e)=>{ e.stopPropagation(); toggleServer(s); }}}, '×'),
            )),
          ));
        panel.appendChild(chipsWrap);
      }

      footer.appendChild(h('button.btn', { on:{click:()=>{ pmState.tab='excluded'; window.RERENDER_PAGE(mount); }}}, 'Cancel'));
      const canNext = selected.length > 0;
      const cont = h('button.btn.primary', {
        disabled: !canNext,
        style: canNext ? null : {opacity:'0.4',cursor:'not-allowed'},
        on:{click:()=>{ if (canNext) { pmState.add.step=2; window.RERENDER_PAGE(mount); }}},
      }, selected.length > 1 ? 'Next · Reason for ' + selected.length + ' servers →' : 'Next · Reason →');
      footer.appendChild(cont);
    }

    if (pmState.add.step === 2) {
      panel.appendChild(h('div', {style:{fontFamily:'var(--display)',fontSize:'22px',letterSpacing:'-0.01em',color:'var(--ink)',fontWeight:'400'}}, 'Why is this server being held?'));
      panel.appendChild(h('div', {style:{fontSize:'13px',color:'var(--ink-2)',maxWidth:'60ch'}}, 'The reason is attached to the audit trail. Pick the closest category — any extra context goes in the notes field on the confirmation step.'));

      const grid = h('div', {style:{display:'grid',gridTemplateColumns:'repeat(2, 1fr)',gap:'8px'}});
      EXCLUSION_REASONS.forEach(rs => {
        const isSel = pmState.add.reason === rs;
        grid.appendChild(h('div', {style:{
          padding:'16px 18px',border:'1px solid var(--rule)',
          background: isSel ? 'var(--signal-wash)' : 'var(--paper-2)',
          borderLeft: isSel ? '3px solid var(--signal)' : '3px solid var(--rule-2)',
          cursor:'pointer',display:'flex',alignItems:'center',gap:'12px',
        }, on:{click:()=>{ pmState.add.reason = rs; window.RERENDER_PAGE(mount); }}},
          h('span', {style:{width:'16px',height:'16px',border:'1px solid '+(isSel?'var(--signal)':'var(--rule-2)'),borderRadius:'50%',display:'inline-flex',alignItems:'center',justifyContent:'center'}},
            isSel ? h('span', {style:{width:'8px',height:'8px',borderRadius:'50%',background:'var(--signal)'}}) : null),
          h('span', {style:{fontSize:'13.5px',color:'var(--ink)'}}, rs)));
      });
      panel.appendChild(grid);

      // When "Other" is picked, capture the free-text reason inline. It becomes
      // the reason stored on the audit trail (backend accepts free text up to
      // 2000 chars; the slug resolves to 'custom'). data-fk preserves focus; the Next gate is toggled in place as you type (no full re-render).
      if (pmState.add.reason === 'Other') {
        panel.appendChild(h('div', {style:{fontFamily:'var(--mono)',fontSize:'10px',letterSpacing:'0.14em',textTransform:'uppercase',color:'var(--ink-3)',marginTop:'4px'}}, 'Describe the reason'));
        panel.appendChild(h('input', {'data-fk':'add-excl-other-reason', type:'text', maxlength:'2000',
          placeholder:'Add patch exclusion reason',
          value: pmState.add.otherReason || '',
          style:{height:'44px',padding:'0 16px',border:'1px solid var(--rule-2)',fontSize:'14px',background:'var(--paper)',color:'var(--ink)',fontFamily:'var(--mono)'},
          on:{input:(e)=>{
            pmState.add.otherReason = e.target.value;
            // Toggle the Next gate in place - no full-page re-render per keystroke.
            const ok = e.target.value.trim().length > 0;
            if (cont) { cont.disabled = !ok; cont.style.opacity = ok ? '' : '0.4'; cont.style.cursor = ok ? '' : 'not-allowed'; }
          }},
        }));
        panel.appendChild(h('div', {style:{fontSize:'12px',color:'var(--ink-3)'}}, 'This text is stored as the exclusion reason on the audit trail.'));
      }

      footer.appendChild(h('button.btn', { on:{click:()=>{ pmState.add.step=1; window.RERENDER_PAGE(mount); }}}, '← Back'));
      const canNext = !!pmState.add.reason && (pmState.add.reason !== 'Other' || (pmState.add.otherReason || '').trim().length > 0);
      const cont = h('button.btn.primary', {
        disabled: !canNext,
        style: canNext ? null : {opacity:'0.4',cursor:'not-allowed'},
        on:{click:()=>{ if (canNext) { pmState.add.step=3; window.RERENDER_PAGE(mount); }}},
      }, 'Next · Hold-until →');
      footer.appendChild(cont);
    }

    if (pmState.add.step === 3) {
      panel.appendChild(h('div', {style:{fontFamily:'var(--display)',fontSize:'22px',letterSpacing:'-0.01em',color:'var(--ink)',fontWeight:'400'}}, 'How long should this hold last?'));
      panel.appendChild(h('div', {style:{fontSize:'13px',color:'var(--ink-2)',maxWidth:'60ch'}}, 'Pick a specific date or one of the common windows. After this date, the server returns to the next scheduled cycle automatically — you\u2019ll see it in Expiring renewals the week before.'));

      const today = todayLocal();
      const fmt = (d) => d.toLocaleDateString('en-GB', {day:'numeric', month:'short', year:'numeric'});
      const presets = [
        {label:'Next week',      date: addDays(today, 7)},
        {label:'2 weeks',        date: addDays(today, 14)},
        {label:'1 month',        date: addDays(today, 30)},
        {label:'1 quarter',      date: addDays(today, 90)},
      ];
      // "This cycle only" is grounded in the live imminent cycle date (window.PATCH_NEXT_CYCLE,
      // populated by op-boot.js from /api/patching/next). The cycle AFTER it isn't reliably
      // knowable - group coverage is HTML-scrape driven with no cadence rule - so there is no
      // "Next cycle" preset. Omit this one entirely when the date is unknown, stale, or past.
      const nextCycle = window.PATCH_NEXT_CYCLE;
      if (nextCycle && nextCycle.cycleDate && !nextCycle.isStale) {
        const cd = parseUntil(nextCycle.cycleDate);
        if (cd && cd >= today) {
          presets.push({label:'This cycle only (until ' + fmtUntil(cd) + ')', date: cd});
        }
      }
      const presetGrid = h('div', {style:{display:'grid',gridTemplateColumns:'repeat(3, 1fr)',gap:'8px'}});
      presets.forEach(p => {
        const val = fmt(p.date);
        const iso = isoLocal(p.date);
        const isSel = pmState.add.until === val;
        presetGrid.appendChild(h('div', {style:{
          padding:'14px 16px',border:'1px solid var(--rule)',
          background: isSel ? 'var(--signal-wash)' : 'var(--paper-2)',
          borderLeft: isSel ? '3px solid var(--signal)' : '3px solid var(--rule-2)',
          cursor:'pointer',display:'flex',flexDirection:'column',gap:'4px',
        }, on:{click:()=>{ pmState.add.until = val; pmState.add.untilIso = iso; window.RERENDER_PAGE(mount); }}},
          h('span', {style:{fontSize:'13.5px',color:'var(--ink)',fontWeight:'500'}}, p.label),
          h('span', {style:{fontFamily:'var(--mono)',fontSize:'11px',color:'var(--ink-3)'}}, val),
        ));
      });
      panel.appendChild(h('div', {style:{fontFamily:'var(--mono)',fontSize:'10px',letterSpacing:'0.14em',textTransform:'uppercase',color:'var(--ink-3)'}}, 'Common windows'));
      panel.appendChild(presetGrid);

      panel.appendChild(h('div', {style:{fontFamily:'var(--mono)',fontSize:'10px',letterSpacing:'0.14em',textTransform:'uppercase',color:'var(--ink-3)',marginTop:'8px'}}, 'Or pick a specific date'));
      panel.appendChild(renderCalendarPicker(today, mount));

      footer.appendChild(h('button.btn', { on:{click:()=>{ pmState.add.step=2; window.RERENDER_PAGE(mount); }}}, '← Back'));
      const cont = h('button.btn.primary', {
        disabled: !pmState.add.until,
        style: pmState.add.until ? null : {opacity:'0.4',cursor:'not-allowed'},
        on:{click:()=>{ if (pmState.add.until) { pmState.add.step=4; window.RERENDER_PAGE(mount); }}},
      }, 'Next · Confirm →');
      footer.appendChild(cont);
    }

    if (pmState.add.step === 4) {
      const servers = pmState.add.selectedServers || [];
      const isBulk = servers.length > 1;
      const first = servers[0];
      // For "Other", the typed free-text is the reason that gets stored.
      const effectiveReason = pmState.add.reason === 'Other'
        ? ((pmState.add.otherReason || '').trim() || 'Other')
        : pmState.add.reason;
      // Slug is driven by the selected category, not a free-text scan, so an
      // "Other" free text can never collide with a keyword (-> always 'custom').
      const reasonSlug = window.OP_DATEKIT
        ? window.OP_DATEKIT.slugifyReason(pmState.add.reason, pmState.add.reason === 'Other')
        : undefined;
      if (pmState.add.error) panel.appendChild(wizardError(pmState.add.error, () => { pmState.add.error = null; window.RERENDER_PAGE(mount); }));
      panel.appendChild(h('div', {style:{fontFamily:'var(--display)',fontSize:'22px',letterSpacing:'-0.01em',color:'var(--ink)',fontWeight:'400'}},
        isBulk ? 'Confirm '+servers.length+' exclusions' : 'Confirm this exclusion'));

      const kv = h('div', {style:{display:'grid',gridTemplateColumns:'180px 1fr',gap:'12px 24px',fontSize:'13.5px',padding:'18px 0'}});
      const row = (k, v) => [
        h('div', {style:{fontFamily:'var(--mono)',fontSize:'10.5px',letterSpacing:'0.14em',textTransform:'uppercase',color:'var(--ink-3)'}}, k),
        h('div', {style:{color:'var(--ink)'}}, v),
      ];
      if (isBulk) {
        // server summary: count + chips (capped)
        const envCounts = {};
        servers.forEach(sv => { envCounts[sv.env] = (envCounts[sv.env]||0)+1; });
        const envSummary = Object.entries(envCounts).map(([k,v]) => k+' ×'+v).join(' · ');
        row('Servers', servers.length + ' selected').forEach(x => kv.appendChild(x));
        row('Environments', envSummary).forEach(x => kv.appendChild(x));
        // chip list
        const chipRow = h('div', {style:{color:'var(--ink)',display:'flex',flexWrap:'wrap',gap:'4px'}},
          ...servers.slice(0,20).map(sv => h('span', {style:{
            fontFamily:'var(--mono)',fontSize:'11px',padding:'2px 8px',
            border:'1px solid var(--rule)',background:'var(--paper-2)',
          }}, sv.name)),
          servers.length > 20 ? h('span', {style:{fontFamily:'var(--mono)',fontSize:'11px',color:'var(--ink-3)',padding:'2px 6px'}}, '+'+(servers.length-20)+' more') : null,
        );
        kv.appendChild(h('div', {style:{fontFamily:'var(--mono)',fontSize:'10.5px',letterSpacing:'0.14em',textTransform:'uppercase',color:'var(--ink-3)'}}, 'Server list'));
        kv.appendChild(chipRow);
      } else {
        row('Server',        first ? first.name : '—').forEach(x => kv.appendChild(x));
        row('FQDN',          first ? first.fqdn : '—').forEach(x => kv.appendChild(x));
        row('Environment',   first ? first.env  : '—').forEach(x => kv.appendChild(x));
        row('Patch group',   first ? first.pg   : '—').forEach(x => kv.appendChild(x));
      }
      row('Reason',        effectiveReason || '—').forEach(x => kv.appendChild(x));
      row('Hold until',    pmState.add.until  || '—').forEach(x => kv.appendChild(x));
      row('Requester',     window.CURRENT_USER && window.CURRENT_USER.username
                              ? 'you (' + window.CURRENT_USER.username + ')'
                              : 'you').forEach(x => kv.appendChild(x));
      panel.appendChild(kv);

      panel.appendChild(h('div', {style:{fontFamily:'var(--mono)',fontSize:'10px',letterSpacing:'0.14em',textTransform:'uppercase',color:'var(--ink-3)'}}, 'Optional notes'));
      const notesInput = h('textarea', {'data-fk':'add-excl-notes', 
        placeholder:'Anything ops should know when renewing or releasing this hold…',
        value: pmState.add.notes,
        style:{minHeight:'80px',padding:'12px 14px',border:'1px solid var(--rule-2)',fontSize:'13px',background:'var(--paper)',color:'var(--ink)',fontFamily:'var(--mono)',resize:'vertical',width:'100%',boxSizing:'border-box'},
        on:{input:(e)=>{ pmState.add.notes = e.target.value; }},
      });
      panel.appendChild(notesInput);

      footer.appendChild(h('button.btn', { on:{click:()=>{ pmState.add.step=3; window.RERENDER_PAGE(mount); }}}, '← Back'));
      const submit = h('button.btn.primary', { on:{click:()=>{
        pmState.add.error = null;
        const payload = {
          servers: servers.slice(),
          reason: effectiveReason,
          reasonSlug: reasonSlug,
          until: pmState.add.until,
          untilIso: pmState.add.untilIso, // canonical wire value
          notes: pmState.add.notes,
        };
        const reset = () => {
          pmState.add = { step: 1, serverQuery: '', selectedServers: [], reason: '', otherReason: '', until: '', untilIso: '', notes: '', calOffset: 0, error: null };
          pmState.tab = 'excluded';
          window.RERENDER_PAGE(mount);
        };
        const fail = (msg) => { pmState.add.error = msg; window.RERENDER_PAGE(mount); };
        const act = window.OC_ACTIONS && window.OC_ACTIONS.addExclusion;
        if (act) {
          act(payload, reset, fail);
        } else {
          toast(isBulk ? 'Created '+servers.length+' exclusions (demo)' : 'Exclusion created for '+(first?first.name:'')+' (demo)');
          reset();
        }
      }}}, isBulk ? 'Create '+servers.length+' exclusions' : 'Create exclusion');
      footer.appendChild(submit);
    }

    panel.appendChild(footer);
    wrap.appendChild(panel);
    return wrap;
  }

  function renderBulkExclude(mount) {
    const wrap = h('div', {style:{display:'flex',flexDirection:'column',gap:'18px',maxWidth:'980px'}});
    wrap.appendChild(sectionLabel('Bulk exclude', null, h('span.ct', {style:{marginLeft:'auto'}}, 'For change-freezes, vendor advisories, platform-wide holds')));

    const panel = h('div', {style:{border:'1px solid var(--rule)',background:'var(--card)',padding:'28px 32px',display:'flex',flexDirection:'column',gap:'22px'}});
    panel.appendChild(h('div', {style:{fontFamily:'var(--display)',fontSize:'22px',letterSpacing:'-0.01em',color:'var(--ink)',fontWeight:'400'}}, 'Hold a whole group or environment at once'));
    panel.appendChild(h('div', {style:{fontSize:'13px',color:'var(--ink-2)',maxWidth:'65ch'}}, 'Scope selects which servers will be held. Every exclusion created this way shares the same reason, hold-until, and requester — and shows up individually in the excluded table below for renewal or release.'));

    // Scope picker
    panel.appendChild(h('div', {style:{fontFamily:'var(--mono)',fontSize:'10px',letterSpacing:'0.14em',textTransform:'uppercase',color:'var(--ink-3)'}}, 'Scope'));
    const scopeRow = h('div', {style:{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px'}});
    [['group','By patch group','Hold every server in a patch group'],['env','By environment','Hold every server in an environment']].forEach(([id, label, desc]) => {
      const isSel = pmState.bulk.scope === id;
      scopeRow.appendChild(h('div', {style:{
        padding:'16px 18px',border:'1px solid var(--rule)',
        background:isSel?'var(--signal-wash)':'var(--paper-2)',
        borderLeft:isSel?'3px solid var(--signal)':'3px solid var(--rule-2)',
        cursor:'pointer',display:'flex',flexDirection:'column',gap:'4px',
      }, on:{click:()=>{ pmState.bulk.scope = id; window.RERENDER_PAGE(mount); }}},
        h('span', {style:{fontSize:'14px',fontWeight:'600',color:'var(--ink)'}}, label),
        h('span', {style:{fontSize:'12px',color:'var(--ink-3)'}}, desc)));
    });
    panel.appendChild(scopeRow);

    // Target + reason + until
    const form = h('div', {style:{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'18px 24px'}});
    const field = (label, child) => [
      h('div', {style:{fontFamily:'var(--mono)',fontSize:'10px',letterSpacing:'0.14em',textTransform:'uppercase',color:'var(--ink-3)',marginBottom:'6px'}}, label),
      child,
    ].forEach(x => form.appendChild(x));

    let affectedCount = 0;
    if (pmState.bulk.scope === 'group') {
      const sel = h('select', {
        style:{height:'44px',padding:'0 14px',border:'1px solid var(--rule-2)',fontSize:'14px',fontFamily:'var(--mono)',background:'var(--paper)'},
        on:{change:(e)=>{ pmState.bulk.group = e.target.value; window.RERENDER_PAGE(mount); }},
      }, getPatchGroups().map(g => h('option', {value:g.id, selected: pmState.bulk.group===g.id}, g.id+' ('+g.servers+' servers)')));
      const g = getPatchGroups().find(x => x.id === pmState.bulk.group);
      affectedCount = g ? g.servers : 0;
      field('Target group', sel);
    } else {
      const envs = (window.SERVERS_DATA?.SRV_ENV || []);
      const sel = h('select', {
        style:{height:'44px',padding:'0 14px',border:'1px solid var(--rule-2)',fontSize:'14px',fontFamily:'var(--mono)',background:'var(--paper)'},
        on:{change:(e)=>{ pmState.bulk.env = e.target.value; window.RERENDER_PAGE(mount); }},
      }, envs.map(e => h('option', {value:e.name, selected: pmState.bulk.env===e.name}, e.name+' ('+e.count+' servers)')));
      const e = envs.find(x => x.name === pmState.bulk.env);
      affectedCount = e ? e.count : 0;
      field('Target environment', sel);
    }

    const reasonSel = h('select', {
      style:{height:'44px',padding:'0 14px',border:'1px solid var(--rule-2)',fontSize:'14px',background:'var(--paper)',color:'var(--ink)'},
      on:{change:(e)=>{ pmState.bulk.reason = e.target.value; window.RERENDER_PAGE(mount); }},
    }, [h('option', {value:''}, 'Pick a reason…'), ...EXCLUSION_REASONS.map(r => h('option', {value:r, selected: pmState.bulk.reason===r}, r))]);
    field('Reason', reasonSel);

    // When "Other" is picked, capture the free-text reason inline (same backend
    // contract as the single-server wizard: free text, slug 'custom').
    if (pmState.bulk.reason === 'Other') {
      field('Describe the reason', h('input', {'data-fk':'bulk-excl-other-reason', type:'text', maxlength:'2000',
        placeholder:'Add patch exclusion reason',
        value: pmState.bulk.otherReason || '',
        style:{height:'44px',padding:'0 14px',border:'1px solid var(--rule-2)',fontSize:'14px',background:'var(--paper)',color:'var(--ink)',fontFamily:'var(--mono)'},
        on:{input:(e)=>{
          pmState.bulk.otherReason = e.target.value;
          // Toggle the Create gate in place - no full-page re-render per keystroke.
          const ready = e.target.value.trim().length > 0 && !!pmState.bulk.until;
          if (btn) { btn.disabled = !ready; btn.style.opacity = ready ? '' : '0.4'; btn.style.cursor = ready ? '' : 'not-allowed'; }
        }},
      }));
    }

    // show current pick as a disabled-looking readout to fill the 2nd grid column
    const untilReadout = h('div', {style:{
      height:'44px',padding:'0 14px',border:'1px solid var(--rule-2)',background:'var(--paper)',
      display:'flex',alignItems:'center',fontFamily:'var(--mono)',fontSize:'14px',
      color: pmState.bulk.until ? 'var(--ink)' : 'var(--ink-4)',
    }}, pmState.bulk.until || 'Pick from the calendar below');
    field('Hold until', untilReadout);

    panel.appendChild(form);

    // Calendar picker for bulk "hold until"
    const today = todayLocal();
    panel.appendChild(h('div', {style:{fontFamily:'var(--mono)',fontSize:'10px',letterSpacing:'0.14em',textTransform:'uppercase',color:'var(--ink-3)'}}, 'Hold-until date'));
    panel.appendChild(renderCalendarPicker(today, mount, pmState.bulk));

    // Impact preview — stamped LOUD
    panel.appendChild(h('div', {style:{
      padding:'18px 22px', border:'1px solid var(--warn)', background:'var(--warn-wash)',
      borderLeft:'3px solid var(--warn)', display:'grid', gridTemplateColumns:'auto 1fr auto', gap:'18px', alignItems:'center',
    }},
      h('div', {style:{fontFamily:'var(--display)',fontSize:'44px',color:'var(--ink)',lineHeight:'1',letterSpacing:'-0.02em'}}, affectedCount.toLocaleString()),
      h('div', {style:{display:'flex',flexDirection:'column',gap:'4px'}},
        h('div', {style:{fontFamily:'var(--mono)',fontSize:'10.5px',letterSpacing:'0.14em',textTransform:'uppercase',color:'var(--ink-3)'}}, 'Impact preview'),
        h('div', {style:{fontSize:'14px',color:'var(--ink)'}}, 'servers will be excluded from the next patch cycle'),
        h('div', {style:{fontSize:'12px',color:'var(--ink-2)'}}, 'Each gets its own exclusion ID and appears in the table below.')),
      h('span.chip.sm.warn', null, 'REVERSIBLE'),
    ));

    // Action - for "Other", the typed free-text is the reason that gets stored.
    const bulkEffectiveReason = pmState.bulk.reason === 'Other'
      ? ((pmState.bulk.otherReason || '').trim() || 'Other')
      : pmState.bulk.reason;
    // Slug driven by the selected category, never a free-text scan.
    const bulkReasonSlug = window.OP_DATEKIT
      ? window.OP_DATEKIT.slugifyReason(pmState.bulk.reason, pmState.bulk.reason === 'Other')
      : undefined;
    const bulkReasonOk = !!pmState.bulk.reason
      && (pmState.bulk.reason !== 'Other' || (pmState.bulk.otherReason || '').trim().length > 0);
    const bulkReady = bulkReasonOk && !!pmState.bulk.until;
    if (pmState.bulk.error) panel.appendChild(wizardError(pmState.bulk.error, () => { pmState.bulk.error = null; window.RERENDER_PAGE(mount); }));
    const btn = h('button.btn.primary', {
      disabled: !bulkReady,
      style: !bulkReady ? {opacity:'0.4',cursor:'not-allowed',alignSelf:'flex-start'} : {alignSelf:'flex-start'},
      on:{click:()=>{
        if (bulkReady) {
          pmState.bulk.error = null;
          const payload = {
            kind: pmState.bulk.scope, // 'group' | 'env'
            target: pmState.bulk.scope === 'group' ? pmState.bulk.group : pmState.bulk.env,
            reason: bulkEffectiveReason,
            reasonSlug: bulkReasonSlug,
            until: pmState.bulk.until,
            untilIso: pmState.bulk.untilIso, // canonical wire value
            affectedCount: affectedCount,
          };
          const reset = () => {
            pmState.bulk = { scope: 'group', group: 'GROUP0', env: 'Production', reason: '', otherReason: '', until: '', untilIso: '', calOffset: 0, error: null };
            pmState.tab = 'excluded';
            window.RERENDER_PAGE(mount);
          };
          const fail = (msg) => { pmState.bulk.error = msg; window.RERENDER_PAGE(mount); };
          const act = window.OC_ACTIONS && window.OC_ACTIONS.bulkExclude;
          if (act) {
            act(payload, reset, fail);
          } else {
            toast('Bulk exclusion created for '+affectedCount+' servers (demo)');
            reset();
          }
        }
      }},
    }, 'Create '+affectedCount+' exclusions');
    panel.appendChild(btn);

    wrap.appendChild(panel);
    return wrap;
  }

  function renderExpiringRenewals(mount) {
    const wrap = h('div', {style:{display:'flex',flexDirection:'column',gap:'18px'}});
    const overdueRows = window.EXCLUSIONS.filter(e => e.state === 'overdue');
    const expiringRows = window.EXCLUSIONS.filter(e => e.state === 'expiring-soon');

    if (overdueRows.length > 0) {
      wrap.appendChild(sectionLabel('Overdue — past hold-until date', overdueRows.length, h('span.ct', {style:{marginLeft:'auto',color:'var(--crit)'}}, 'will be patched next cycle unless renewed')));
      wrap.appendChild(renderExclusionCards(overdueRows, 'crit', mount));
    }

    if (expiringRows.length > 0) {
      wrap.appendChild(sectionLabel('Expiring within 7 days', expiringRows.length));
      wrap.appendChild(renderExclusionCards(expiringRows, 'warn', mount));
    }

    if (overdueRows.length === 0 && expiringRows.length === 0) {
      wrap.appendChild(h('div', {style:{padding:'40px 32px',background:'var(--card)',border:'1px dashed var(--rule-2)',textAlign:'center'}},
        h('div', {style:{fontFamily:'var(--display)',fontSize:'24px',color:'var(--ink)',letterSpacing:'-0.01em',fontWeight:'400'}}, 'All exclusions current'),
        h('div', {style:{fontSize:'13px',color:'var(--ink-2)',marginTop:'8px'}}, 'Nothing is expiring in the next seven days. Next check runs automatically Monday 06:00.')));
    }

    return wrap;
  }

  function renderExclusionCards(rows, tone, mount) {
    const grid = h('div', {style:{display:'grid',gridTemplateColumns:'repeat(2, 1fr)',gap:'14px'}});
    rows.forEach(r => {
      const borderColor = tone === 'crit' ? 'var(--crit)' : 'var(--warn)';
      grid.appendChild(h('div', {style:{
        border:'1px solid var(--rule)', borderLeft:'3px solid '+borderColor,
        background:'var(--card)', padding:'20px 22px', display:'flex', flexDirection:'column', gap:'12px',
      }},
        h('div', {style:{display:'flex',alignItems:'baseline',gap:'14px',flexWrap:'wrap'}},
          h('span', {style:{fontFamily:'var(--mono)',fontSize:'11px',fontWeight:'600',color:'var(--ink)'}}, r.id),
          tone === 'crit' ? stamp('crit','OVERDUE') : stamp('warn','EXPIRING SOON'),
          h('span', {style:{flex:'1'}}),
          h('span', {style:{fontFamily:'var(--mono)',fontSize:'11px',color:tone==='crit'?'var(--crit)':'var(--warn)',fontWeight:'600'}}, 'until '+r.until),
        ),
        h('div', {style:{fontFamily:'var(--display)',fontSize:'20px',letterSpacing:'-0.005em',color:'var(--ink)',fontWeight:'400'}}, r.server),
        h('div', {style:{fontFamily:'var(--mono)',fontSize:'11.5px',color:'var(--ink-2)'}}, r.group+' · '+(r.service||'—')+' · '+(r.func||'—')),
        h('div', {style:{display:'flex',flexDirection:'column',gap:'4px',paddingTop:'8px',borderTop:'1px dashed var(--rule)'}},
          h('span', {style:{fontFamily:'var(--mono)',fontSize:'10px',letterSpacing:'0.14em',textTransform:'uppercase',color:'var(--ink-3)'}}, 'Reason'),
          h('span', {style:{fontSize:'13px',color:'var(--ink)'}}, r.reason),
          h('span', {style:{fontFamily:'var(--mono)',fontSize:'11px',color:'var(--ink-3)',marginTop:'4px'}}, 'Requested by '+r.requester+' on '+r.requested),
        ),
        h('div', {style:{display:'flex',gap:'8px',marginTop:'4px'}},
          h('button.btn.primary', {style:{flex:'1'}, on:{click:()=>{
            const act = window.OC_ACTIONS && window.OC_ACTIONS.renewExclusion;
            if (act) act(r, 30); else toast('Renewed '+r.id+' for 30 days (demo)');
          }}}, 'Renew 30 days'),
          h('button.btn', { on:{click:()=>{
            const act = window.OC_ACTIONS && window.OC_ACTIONS.renewExclusion;
            if (act) act(r, 7); else toast('Snoozed '+r.id+' 7 days (demo)');
          }}}, 'Snooze 7d'),
          h('button.btn.danger', { on:{click:()=>{
            const act = window.OC_ACTIONS && window.OC_ACTIONS.releaseExclusion;
            if (act) act(r); else toast('Released '+r.id+' (demo)');
          }}}, 'Release'),
        ),
      ));
    });
    return grid;
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
  // DISK MONITORING — replaces the Tableau disk dashboard. SolarWinds-sourced.
  // ================================================================
  // Synthetic seed for demo mode and pre-API renders. Mirrors the API's
  // /api/disks `items` shape so render code only needs one path.
  function buildDisks() {
    const rng = (() => { let s = 0xD15C00; return () => (s = (s*1103515245 + 12345) >>> 0) / 0x100000000; })();
    const servers = [
      {name:'PR0603-07012-00', service:'tyme', env:'Production',  owner:'Alex Morgan',     bu:'Contoso UK'},
      {name:'PR0603-25002-00', service:'cms',  env:'Production',  owner:'Jamie Carter', bu:'Contoso London Market'},
      {name:'PR0603-31002-00', service:'tyche',env:'Production',  owner:'Taylor Reid', bu:'Contoso Re & ILS'},
      {name:'DV0801-12001-00', service:'tyme', env:'Development', owner:'Alex Morgan',     bu:'Contoso UK'},
      {name:'UT0901-04001-00', service:'cms',  env:'UAT',         owner:'Jamie Carter', bu:'Contoso London Market'},
    ];
    const labels = ['C:\\', 'D:\\', 'E:\\SQL_RND_01', 'E:\\SQL_RND_04', 'F:\\Logs', 'G:\\Backups'];
    // Spread of statuses: ~70% ok, ~20% warn, ~10% crit.
    const buckets = [1,1,1,1,1,1,1,2,2,3];
    const disks = [];
    let i = 0;
    for (const srv of servers) {
      const n = 3 + Math.floor(rng() * 3); // 3-5 disks per server
      for (let k = 0; k < n; k++) {
        const status = buckets[Math.floor(rng() * buckets.length)];
        const size = Math.round((50 + rng()*1500) / 10) * 10;
        const pct = status === 3 ? 90 + rng()*8
                  : status === 2 ? 80 + rng()*9
                  : 20 + rng()*55;
        const used = Math.round(size * pct / 100 * 10) / 10;
        const free = Math.round((size - used) * 10) / 10;
        // Most disks growing slowly; a couple shrinking; one ticking down to crit.
        const slope = (rng() < 0.15) ? -0.1 - rng()*0.5 : 0.05 + rng()*0.4;
        const critGb = size * 0.9;
        const remaining = critGb - used;
        const days = (slope > 0 && remaining > 0) ? remaining / slope : null;
        // Force one disk under 7 days for badge demo.
        const daysFinal = (i === 6) ? 4 : days;
        disks.push({
          id: ++i,
          serverName: srv.name,
          diskLabel: labels[k % labels.length],
          service: srv.service,
          environment: srv.env,
          technicalOwner: srv.owner,
          businessUnit: srv.bu,
          volumeSizeGb: size,
          usedGb: used,
          freeGb: free,
          percentUsed: Math.round(pct * 10) / 10,
          alertStatus: status,
          thresholdWarnPct: 80,
          thresholdCritPct: 90,
          daysUntilCritical: daysFinal,
        });
      }
    }
    return disks;
  }

  const DISKS_DEMO = buildDisks();
  window.DISKS_DATA = { items: DISKS_DEMO, totalCount: DISKS_DEMO.length };

  function liveDisks() {
    const D = window.DISKS_DATA || {};
    const items = Array.isArray(D.items) && D.items.length ? D.items : DISKS_DEMO;
    return { items, total: D.totalCount != null ? D.totalCount : items.length };
  }

  // Filter state — single-select per dimension. Default env is 'Production'
  // (not '__all') because non-prod is noise for the ops team. BU is now
  // controlled globally via the rail BuScope (window.SELECTED_BU); the BU
  // bar chart on this page deep-links into that global selector.
  const diskState = {
    status: '__all',
    owner:  '__all',
    env:    'Production',
    service:'__all',
    sort:'percentUsed',
    sortDir:-1,
    page:1,
    per:50,
  };

  // Derived helpers --------------------------------------------------------
  function diskUniqValues(items, field) {
    const set = new Set();
    items.forEach(d => { const v = d[field]; if (v) set.add(v); });
    return Array.from(set).sort();
  }

  function diskStatusKpis(items) {
    const k = { total: items.length, ok: 0, warn: 0, crit: 0 };
    items.forEach(d => {
      if (d.alertStatus === 1) k.ok++;
      else if (d.alertStatus === 2) k.warn++;
      else if (d.alertStatus === 3) k.crit++;
    });
    return k;
  }

  function applyDiskFilters() {
    let rows = liveDisks().items.slice();
    if (diskState.status !== '__all') rows = rows.filter(d => String(d.alertStatus) === diskState.status);
    if (diskState.owner !== '__all')  rows = rows.filter(d => (d.technicalOwner || '') === diskState.owner);
    if (diskState.env !== '__all')    rows = rows.filter(d => (d.environment || '') === diskState.env);
    // BU filter is applied server-side via OC_API.fetchDisks (which reads
    // window.SELECTED_BU from the global rail selector).
    if (diskState.service !== '__all')rows = rows.filter(d => (d.service || '') === diskState.service);
    rows.sort((a, b) => {
      // Primary: alertStatus desc (CRITICAL=3, WARNING=2, OK=1). Custom
      // per-server thresholds mean a 90% disk can be CRITICAL while a 95%
      // disk on a different server is only WARNING; sorting by raw
      // percentUsed alone hides the actionable rows underneath the larger
      // (but healthy) ones.
      const sa = a.alertStatus || 0;
      const sb = b.alertStatus || 0;
      if (sa !== sb) return sb - sa;

      const av = a[diskState.sort], bv = b[diskState.sort];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av < bv) return -1 * diskState.sortDir;
      if (av > bv) return  1 * diskState.sortDir;
      return 0;
    });
    return rows;
  }

  // Inline SVG sparkline. ~80 LoC, no charting library.
  function diskSparkline(history, width, height) {
    if (!history || history.length < 2) return null;
    const w = width || 120;
    const ht = height || 24;
    const xs = history.map((_, i) => i);
    const ys = history.map(p => Number(p.usedGb) || 0);
    const xMin = 0, xMax = xs.length - 1;
    const yMin = Math.min(...ys), yMax = Math.max(...ys);
    const yRange = (yMax - yMin) || 1;
    const path = xs.map((x, i) => {
      const px = (x - xMin) / (xMax - xMin || 1) * (w - 2) + 1;
      const py = ht - 1 - ((ys[i] - yMin) / yRange) * (ht - 2);
      return (i === 0 ? 'M' : 'L') + px.toFixed(1) + ',' + py.toFixed(1);
    }).join(' ');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', String(w));
    svg.setAttribute('height', String(ht));
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + ht);
    svg.style.display = 'inline-block';
    svg.style.verticalAlign = 'middle';
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', path);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-width', '1.2');
    svg.appendChild(p);
    return svg;
  }

  // Inline usage bar styled to match the dark/light tokens used elsewhere.
  // We don't use `.env-row .bar .fill` because that selector is grid-scoped;
  // these styles are intentionally local so the bar renders inside table cells.
  function diskUsageBar(d) {
    const pct = Math.min(100, Math.max(0, Number(d.percentUsed) || 0));
    const toneVar = d.alertStatus === 3 ? 'var(--crit)'
                  : d.alertStatus === 2 ? 'var(--warn)'
                  : 'var(--ok)';
    return h('div', {
      style: {
        width: '140px',
        height: '8px',
        background: 'var(--paper-2)',
        borderRadius: '1px',
        overflow: 'hidden',
        position: 'relative',
      },
    },
      h('div', {
        style: {
          position: 'absolute',
          left: '0', top: '0', bottom: '0',
          width: pct + '%',
          background: toneVar,
        },
      }),
    );
  }

  // Days-until-critical badge. Reuses the .affected-chip vocabulary which only
  // ships crit/warn/ok tones — we render a muted plain-text "stable" instead of
  // inventing a non-existent .info tone. Projections beyond 90d switch to
  // months so the chip stays compact and reads as "plenty of time" rather than
  // a noisy day count. The service caps anything > 365d as null upstream.
  function diskDaysBadge(days) {
    if (days == null) return h('span.muted', null, 'stable');
    if (days <= 0)    return stamp('crit', 'over');
    const rounded = Math.round(days);
    if (rounded < 7)  return stamp('crit', rounded + 'd');
    if (rounded < 30) return stamp('warn', rounded + 'd');
    if (rounded < 90) return stamp('ok', rounded + 'd');
    const months = Math.round(rounded / 30);
    return stamp('ok', months + 'mo');
  }

  // History cache for sparklines — populated lazily by op-boot.js if available.
  // Falls back to a synthesised series so demo rows still render a line.
  function diskHistoryFor(disk) {
    const cache = (window.DISKS_DATA && window.DISKS_DATA.history) || {};
    const key = disk.serverName + '|' + disk.diskLabel;
    if (Array.isArray(cache[key]) && cache[key].length >= 2) return cache[key];
    // Synthesise: 30 points walking from (used - small change) to current.
    const pts = [];
    const slope = disk.daysUntilCritical && disk.daysUntilCritical > 0
      ? (disk.volumeSizeGb * 0.9 - disk.usedGb) / disk.daysUntilCritical
      : 0;
    const start = Number(disk.usedGb) - slope * 30;
    for (let i = 0; i < 30; i++) {
      pts.push({ usedGb: start + slope * i });
    }
    return pts;
  }

  // Resolve KPI counts for the active env+BU intersection. The summary
  // endpoint is filter-aware: window.DISK_SUMMARY top-level totals reflect
  // whatever filters were last sent via OC_API.fetchDisks (env + bu compose
  // with AND server-side). When neither filter is set, top-level totals are
  // the unfiltered grand totals from the boot fetch. Demo path falls back to
  // client-side compute over loaded items.
  function diskKpisForFilter(fallbackItems) {
    const summary = window.DISK_SUMMARY;
    if (!summary) return diskStatusKpis(fallbackItems);
    return {
      total: summary.totalCount,
      ok:    summary.okCount,
      warn:  summary.warningCount,
      crit:  summary.criticalCount,
    };
  }

  function renderDiskMonitoringPage(mount) {
    const page = h('div.page');
    const ribbon = demoRibbon('disks'); if (ribbon) page.appendChild(ribbon);
    const allItems = liveDisks().items;
    // KPI strip honors the active env + BU filter intersection (server-side
    // summary keeps the top-level counts in sync). Client-side compute is the
    // fallback for demo mode and pre-summary boots.
    const kpis = diskKpisForFilter(allItems);

    // KPI strip — mirrors the Health page CritStrip vocabulary so the visual
    // language of "current state at a glance" is consistent across surfaces.
    const strip = h('div.crit-strip');
    const overallTone = kpis.crit > 0 ? 'crit' : kpis.warn > 0 ? 'warn' : 'ok';
    const overallWord = kpis.crit > 0 ? 'Critical' : kpis.warn > 0 ? 'Attention' : 'Healthy';
    strip.appendChild(h('div.cs-cell.status-cell.'+overallTone, null,
      h('div.cs-label', null, 'Disk capacity'),
      h('div.cs-value', null, overallWord),
      h('div.cs-sub', null, kpis.total + ' disks tracked'),
    ));
    const applyDiskStatus = async (code) => {
      diskState.status = code;
      diskState.page = 1;
      if (window.OC_API && typeof window.OC_API.fetchDisks === 'function') {
        const refetched = await window.OC_API.fetchDisks({ env: diskState.env, status: code });
        if (refetched) return;
      }
      window.RERENDER_PAGE(mount);
    };
    strip.appendChild(h('div.cs-cell.crit',
      kpis.crit ? { style:{cursor:'pointer'}, on:{click: () => applyDiskStatus('3')} } : null,
      h('div.cs-label', null, 'Critical'),
      h('div.cs-value', null, String(kpis.crit), h('span.cs-unit', null, '≥ 90% used')),
      h('div.cs-sub', null, kpis.crit ? 'over crit threshold' : 'none over crit'),
      kpis.crit ? h('div.cs-link', null, 'Show critical') : null,
    ));
    strip.appendChild(h('div.cs-cell.warn',
      kpis.warn ? { style:{cursor:'pointer'}, on:{click: () => applyDiskStatus('2')} } : null,
      h('div.cs-label', null, 'Warning'),
      h('div.cs-value', null, String(kpis.warn), h('span.cs-unit', null, '≥ 80% used')),
      h('div.cs-sub', null, kpis.warn ? 'approaching crit' : 'none over warn'),
      kpis.warn ? h('div.cs-link', null, 'Show warnings') : null,
    ));
    strip.appendChild(h('div.cs-cell.ok', null,
      h('div.cs-label', null, 'Healthy'),
      h('div.cs-value', null, String(kpis.ok)),
      h('div.cs-sub', null, '< 80% used'),
    ));
    page.appendChild(strip);

    // Per-BU overview — compact 2-column grid of OK/Warn/Crit stacked bars.
    // Halves the vertical footprint vs. a single-column list while staying
    // legible. Clicking a row deep-links the global BU scope via OC_SET_BU,
    // so all pages refilter to that BU (same effect as picking it in the rail).
    const buBreakdown = (window.DISK_SUMMARY && window.DISK_SUMMARY.businessUnits) || [];
    if (buBreakdown.length > 0) {
      const globalBu = window.SELECTED_BU;
      const buActive = globalBu && globalBu !== '__all';
      const buMax = Math.max(1, ...buBreakdown.map(b => b.totalCount));
      const buSection = h('div', { style:{margin:'8px 0 14px'} });
      buSection.appendChild(sectionLabel(
        'Disks by business unit',
        buBreakdown.length,
        buActive ? h('button.btn.xs', {
          style:{marginLeft:'auto'},
          on:{click: () => { if (window.OC_SET_BU) window.OC_SET_BU('__all'); }},
        }, 'Clear filter') : null,
      ));
      const buBars = h('div', {
        style:{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          columnGap: '32px',
          rowGap: '2px',
          border: '1px solid var(--rule)',
          background: 'var(--card)',
          padding: '8px 14px',
        }
      });
      // Hand-rolled row layout (intentionally not .env-row) so we control the
      // column widths cleanly and skip the SELECTED pill / dashed-divider
      // chrome. Single-line per BU, mirrors the Servers page's "by env" feel.
      buBreakdown.slice().sort((a,b) => b.totalCount - a.totalCount).forEach(b => {
        const isActive = globalBu === b.businessUnit;
        const totalW = Math.max(2, Math.round(b.totalCount / buMax * 100));
        const okW   = b.totalCount ? (b.okCount   / b.totalCount * totalW) : 0;
        const warnW = b.totalCount ? (b.warningCount / b.totalCount * totalW) : 0;
        const critW = b.totalCount ? (b.criticalCount / b.totalCount * totalW) : 0;
        const row = h('div',
          { role:'button', 'aria-pressed':String(isActive), tabindex:'0',
            style:{
              display: 'grid',
              // Generous name column to avoid wrap on 'CONTOSO GROUP SUPPORT' /
              // 'CONTOSO LONDON MARKET' / 'CONTINUOUS INTEGRATION'.
              gridTemplateColumns: '170px minmax(0, 1fr) 48px',
              gap: '10px',
              alignItems: 'center',
              padding: '3px 6px',
              cursor: 'pointer',
              borderRadius: '2px',
              background: isActive ? 'var(--signal-wash, rgba(99,179,237,0.14))' : 'transparent',
              boxShadow: isActive ? 'inset 0 0 0 1px var(--signal, #63b3ed)' : 'none',
            },
            on:{click: () => {
              const nextBu = isActive ? '__all' : b.businessUnit;
              if (window.OC_SET_BU) window.OC_SET_BU(nextBu);
            }} },
          h('div', {
            style:{
              fontFamily: 'var(--mono)',
              fontSize: '10.5px',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              color: isActive ? 'var(--ink)' : 'var(--ink-2)',
              fontWeight: isActive ? '600' : '400',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }
          }, b.businessUnit || 'Unknown'),
          // Bar capped at 280px so it doesn't stretch the full column —
          // visually compact and consistent across BUs of different counts.
          h('div', {
            style:{
              display:'flex', overflow:'hidden', height:'7px',
              background:'var(--paper-2)', borderRadius:'1px',
              maxWidth: '280px',
            }
          },
            h('div', { style:{width: okW + '%',   background:'var(--ok)'} }),
            h('div', { style:{width: warnW + '%', background:'var(--warn)'} }),
            h('div', { style:{width: critW + '%', background:'var(--crit)'} }),
          ),
          h('div', {
            style:{
              fontFamily: 'var(--mono)',
              fontVariantNumeric: 'tabular-nums',
              fontSize: '10.5px',
              textAlign: 'right',
              color: 'var(--ink-2)',
            }
          }, b.totalCount.toLocaleString()),
        );
        buBars.appendChild(row);
      });
      buSection.appendChild(buBars);
      page.appendChild(buSection);
    }

    // Compute filtered rows once so the count display, table, and CSV export
    // all share the same view.
    const filtered = applyDiskFilters();
    const pg = paginate(filtered.length, diskState.page, diskState.per);
    const slice = filtered.slice(pg.start, pg.end);

    // Filters — plain <select>s styled by `.filters select`. First option per
    // dropdown is the "All ..." reset. Single-select for v3.
    const mkSelect = (field, allLabel, opts) => h('select',
      { on:{change:(e)=>{ diskState[field]=e.target.value; diskState.page=1; window.RERENDER_PAGE(mount); }}},
      h('option', { value:'__all', selected: diskState[field]==='__all' }, allLabel),
      ...opts.map(([v,l]) => h('option', { value:v, selected: diskState[field]===v }, l))
    );

    // Env / Status dropdowns: labels include cross-facet-scoped counts from
    // the summary endpoint, narrowed by the global BU. Changing either
    // triggers a server-side refetch via OC_API.fetchDisks (which reads
    // window.SELECTED_BU automatically).
    const refetchDisks = async () => {
      const refetched = (window.OC_API && typeof window.OC_API.fetchDisks === 'function')
        ? await window.OC_API.fetchDisks({ env: diskState.env, status: diskState.status })
        : null;
      if (!refetched) window.RERENDER_PAGE(mount);
    };

    const envSummary = (window.DISK_SUMMARY && window.DISK_SUMMARY.environments) || [];
    const envOpts = envSummary.length
      ? envSummary.map(e => [e.environment, e.environment + ' (' + e.totalCount + ')'])
      : diskUniqValues(allItems, 'environment').map(v => [v, v]);
    const envSel = h('select',
      { on:{change: async (e) => {
        diskState.env = e.target.value;
        diskState.page = 1;
        await refetchDisks();
      }}},
      h('option', { value:'__all', selected: diskState.env==='__all' }, 'All environments'),
      ...envOpts.map(([v,l]) => h('option', { value:v, selected: diskState.env===v }, l))
    );

    // BU is controlled globally via the rail BuScope and the BU bar chart
    // above — no per-page BU dropdown here.

    // Status dropdown: API-driven counts (was hardcoded with no counts before).
    // Falls back to the static list when summary hasn't loaded (demo path).
    const statusBreakdown = (window.DISK_SUMMARY && window.DISK_SUMMARY.alertStatuses) || [];
    const statusLabel = { 1: 'OK', 2: 'Warning', 3: 'Critical' };
    const statusByCode = {};
    statusBreakdown.forEach(s => { statusByCode[String(s.alertStatus)] = s.totalCount; });
    const statusOpts = statusBreakdown.length
      ? [1, 2, 3].map(code => [String(code),
          statusLabel[code] + ' (' + (statusByCode[String(code)] || 0) + ')'])
      : [['1','OK'],['2','Warning'],['3','Critical']];
    const statusSel = h('select',
      { on:{change: async (e) => {
        diskState.status = e.target.value;
        diskState.page = 1;
        await refetchDisks();
      }}},
      h('option', { value:'__all', selected: diskState.status==='__all' }, 'All alert levels'),
      ...statusOpts.map(([v,l]) => h('option', { value:v, selected: diskState.status===v }, l))
    );

    page.appendChild(filterBar([
      statusSel,
      mkSelect('owner', 'All technical owners', diskUniqValues(allItems, 'technicalOwner').map(v => [v,v])),
      envSel,
      mkSelect('service','All services',        diskUniqValues(allItems, 'service').map(v => [v,v])),
      h('button.btn', { on:{click: async () => {
        const wasEnv = diskState.env;
        const wasStatus = diskState.status;
        diskState.status='__all'; diskState.owner='__all';
        diskState.env='Production';
        diskState.service='__all'; diskState.page=1;
        // Reset to the canonical "Production / All statuses" landing — does
        // NOT clear the global BU scope (that's controlled from the rail).
        // Refetch only if the server-side filters actually changed.
        if ((wasEnv !== 'Production' || wasStatus !== '__all') && window.OC_API && typeof window.OC_API.fetchDisks === 'function') {
          const refetched = await window.OC_API.fetchDisks({ env: 'Production', status: '__all' });
          if (refetched) return; // refetch triggers its own rerender
        }
        window.RERENDER_PAGE(mount);
      }}}, 'Reset'),
      h('span.spacer'),
      h('span.ct', null, 'Showing ' + (pg.start+1) + '–' + pg.end + ' of ' + filtered.length),
      h('button.btn', { on:{click:()=>exportCsv('disks', filtered,
        ['serverName','diskLabel','service','environment','businessUnit','technicalOwner',
         'volumeSizeGb','usedGb','percentUsed','thresholdCritPct',
         'alertStatus','daysUntilCritical'])}}, 'Export CSV'),
    ]));

    // Table — `table.op` inside a `.table-wrap` for the dark/light card surface.

    const sortableTh = (key, label, extraCls) => {
      const on = diskState.sort === key;
      return h('th'+(extraCls?'.'+extraCls:'')+'.sortable'+(on?'.sorted':''),
        { on:{click:()=>{
          if (diskState.sort===key) diskState.sortDir *= -1;
          else { diskState.sort=key; diskState.sortDir = (key==='serverName'||key==='diskLabel') ? 1 : -1; }
          window.RERENDER_PAGE(mount);
        }}},
        label, h('span.caret', null, on ? (diskState.sortDir===1?'↑':'↓') : '·'));
    };

    const tableWrap = h('div.table-wrap');
    const table = h('table.op');
    table.appendChild(h('thead', null, h('tr', null,
      sortableTh('serverName',   'Server'),
      sortableTh('businessUnit', 'BU'),
      sortableTh('service',      'Service'),
      sortableTh('diskLabel',    'Disk'),
      h('th', null, 'Usage'),
      sortableTh('percentUsed',  'Used %', 'num'),
      sortableTh('thresholdCritPct', 'Crit @', 'num'),
      h('th.num', null, 'Used / Total'),
      sortableTh('daysUntilCritical', 'Days to crit', 'num'),
      h('th', null, 'Alert'),
      h('th', null, '30d trend'),
    )));
    const tbody = h('tbody');
    const rowCls = (s) => s === 3 ? '.sev-crit' : s === 2 ? '.sev-warn' : '';
    const statusChip = (s) => s === 3 ? stamp('crit', 'CRITICAL')
                            : s === 2 ? stamp('warn', 'WARNING')
                            : stamp('ok', 'OK');

    slice.forEach(d => {
      const tr = h('tr'+rowCls(d.alertStatus), null,
        h('td.host', null, d.serverName),
        h('td.muted', null, d.businessUnit || '—'),
        h('td.muted', null, d.service || '—'),
        h('td.mono', null, d.diskLabel),
        h('td', null, diskUsageBar(d)),
        h('td.num'+(d.alertStatus>=2?'.strong':''),
          { style: d.alertStatus===3 ? {color:'var(--crit)',fontWeight:'600'}
                 : d.alertStatus===2 ? {color:'var(--warn)',fontWeight:'600'}
                 : null },
          Number(d.percentUsed).toFixed(1) + '%'),
        // Per-disk crit threshold from SolarWinds Volumes.ALERT_VOL (default 90).
        // Showing it inline makes "97.9% is only Warning?" answer itself.
        h('td.num.muted',
          { title: Number(d.thresholdCritPct) === 90
              ? 'Default crit threshold (90%)'
              : 'Custom crit threshold from SolarWinds (Volumes.ALERT_VOL)' },
          Number(d.thresholdCritPct).toFixed(0) + '%'),
        h('td.num.muted', null, Math.round(d.usedGb).toLocaleString() + ' / ' + Math.round(d.volumeSizeGb).toLocaleString() + ' GB'),
        h('td.num', null, diskDaysBadge(d.daysUntilCritical)),
        h('td', null, statusChip(d.alertStatus)),
        (function(){
          const cell = h('td');
          const spark = diskSparkline(diskHistoryFor(d));
          if (spark) {
            cell.style.color = d.alertStatus === 3 ? 'var(--crit)'
                             : d.alertStatus === 2 ? 'var(--warn)'
                             : 'var(--ink-3)';
            cell.appendChild(spark);
          } else {
            cell.appendChild(h('span.muted', null, '—'));
          }
          return cell;
        })(),
      );
      tbody.appendChild(tr);
    });
    if (slice.length === 0) {
      tbody.appendChild(h('tr', null, h('td', { colspan: 11 },
        h('div.no-hits', null, 'No disks match filter'))));
    }
    table.appendChild(tbody);
    tableWrap.appendChild(table);
    tableWrap.appendChild(paginationBar(pg, p => { diskState.page = p; window.RERENDER_PAGE(mount); }));
    page.appendChild(tableWrap);

    mount.innerHTML = '';
    mount.appendChild(page);
  }

  // ================================================================
  // SERVER DETAIL PAGE — fetched on demand at #servers/{id}.
  // ================================================================
  // Cache the latest fetched detail keyed by id so RERENDER_PAGE storms (from
  // sibling state changes) don't re-fetch on every tick. The cache survives
  // the lifetime of the module — accept a small staleness window (the
  // alternative is invalidating on OC_API.retry, which adds plumbing for
  // little value in v1).
  let _serverDetailLoaded = null;  // { id, data } — data null on 404/error
  let _serverDetailLoading = null; // { id }

  // Header (host + italic .domain) is now rendered by the global statusline
  // via surfaceHero, so the page itself doesn't repeat it. Action row and
  // application/function/service breadcrumb live here on the page body.
  function _serverDetailActions(server) {
    const breadcrumbBits = [server && server.applicationName, server && server.func, server && server.service]
      .filter(Boolean);
    const breadcrumb = breadcrumbBits.length
      ? h('div.sd-breadcrumb', null, ...breadcrumbBits.flatMap((bit, i) => i === breadcrumbBits.length - 1
          ? [h('b', null, bit)]
          : [bit, ' · ']))
      : null;
    return h('div.sd-actions', null,
      h('button.btn', { on:{click:()=>{ if (window.ROUTER) window.ROUTER.goto('servers'); }}},
        '← Back to inventory'),
      // v1: link out to PatchMgmt; pre-selecting this server in the wizard is
      // a follow-up. The PatchMgmt search includes server-name filter so the
      // operator can find this row quickly.
      h('button.btn', { on:{click:()=>{ if (window.ROUTER) window.ROUTER.goto('patchmgmt'); }}},
        '+ Add patch hold'),
      breadcrumb,
    );
  }

  function _serverDetailEmpty(mount, lead, sub) {
    const page = h('div.page');
    page.appendChild(_serverDetailActions(null));
    page.appendChild(h('div', { style:{padding:'40px 20px', textAlign:'center'} },
      h('h2', null, lead),
      sub ? h('p.muted', null, sub) : null,
    ));
    mount.innerHTML = '';
    mount.appendChild(page);
  }

  function _serverDetailLoadingView(mount) {
    const page = h('div.page');
    page.appendChild(_serverDetailActions(null));
    page.appendChild(h('div', { style:{padding:'40px 20px', textAlign:'center'} },
      h('p.muted', null, 'Loading server detail…'),
    ));
    mount.innerHTML = '';
    mount.appendChild(page);
  }

  // Card head: serif mixed-case title left, small mono uppercase subtitle
  // (e.g. "4 volumes") right. Mirrors the design example in image 3.
  function _sdCardHead(title, subtitle) {
    return h('div.sd-card-head', null,
      h('div.sd-card-title', null, title),
      subtitle ? h('div.sd-card-sub', null, subtitle) : null,
    );
  }

  function _disksCard(disks) {
    const card = h('div.sd-card');
    card.appendChild(_sdCardHead('Disks', disks.length ? disks.length + ' volumes' : null));
    const body = h('div.sd-card-body');
    if (disks.length === 0) {
      body.appendChild(h('div.muted', { style:{padding:'16px 20px'} }, 'No disks reported for this server.'));
      card.appendChild(body); return card;
    }
    const tw = h('div.table-wrap'); const tbl = h('table.op');
    tbl.appendChild(h('thead', null, h('tr', null,
      h('th', null, 'Vol'),
      h('th', null, 'Used'),
      h('th', null, 'Size'),
      h('th', null, 'Status'),
    )));
    const tb = h('tbody');
    disks.forEach(d => {
      const tone = d.alertStatus === 3 ? 'crit' : d.alertStatus === 2 ? 'warn' : 'ok';
      const label = d.alertStatus === 3 ? 'Critical' : d.alertStatus === 2 ? 'Warning' : 'OK';
      const used = d.percentUsed != null ? (Math.round(d.percentUsed * 10) / 10) + '%' : '—';
      const size = d.volumeSizeGb != null ? d.volumeSizeGb + ' GB' : '—';
      tb.appendChild(h('tr', null,
        h('td.host', null, d.diskLabel || '—'),
        h('td', null, used),
        h('td.muted', null, size),
        h('td', null, h('span.chip.'+tone, null, h('span.dot'), label)),
      ));
    });
    tbl.appendChild(tb); tw.appendChild(tbl); body.appendChild(tw);
    card.appendChild(body); return card;
  }

  function _lifecycleCard(s) {
    const card = h('div.sd-card');
    card.appendChild(_sdCardHead('Lifecycle & ownership', null));
    const dl = h('div.sd-lifecycle');
    const row = (k, v, tone) => {
      dl.appendChild(h('div.k', null, k));
      dl.appendChild(h('div.v'+(tone?'.'+tone:''), null, v || '—'));
    };
    row('Application', s.applicationName);
    row('Function', s.func);
    row('Service', s.service);
    row('Business unit', s.businessUnit);
    row('Operating system', s.operatingSystem);
    row('Patch group', s.patchGroup);
    row('Environment', s.environment);
    row('Last seen', s.lastSeen ? new Date(s.lastSeen).toLocaleString() : '—');
    row('Reachable', s.isActive ? 'Yes' : 'No', s.isActive ? null : 'crit');
    card.appendChild(dl);
    return card;
  }

  function _certsCard(certs) {
    const card = h('div.sd-card');
    card.appendChild(_sdCardHead('Certificates', certs.length ? certs.length + ' bound' : null));
    const body = h('div.sd-card-body');
    if (certs.length === 0) {
      body.appendChild(h('div.muted', { style:{padding:'16px 20px'} }, 'No certificates bound to this server.'));
      card.appendChild(body); return card;
    }
    const tw = h('div.table-wrap'); const tbl = h('table.op');
    tbl.appendChild(h('thead', null, h('tr', null,
      h('th', null, 'Subject'),
      h('th', null, 'Expires'),
      h('th', null, 'Days'),
      h('th', null, 'Status'),
    )));
    const tb = h('tbody');
    certs.forEach(c => {
      const lvl = (c.alertLevel || '').toLowerCase();
      const expired = c.isExpired || lvl === 'expired';
      const tone = expired ? 'crit' : lvl === 'critical' ? 'crit' : lvl === 'warning' ? 'warn' : 'ok';
      const label = expired ? 'Expired' : lvl ? lvl[0].toUpperCase() + lvl.slice(1) : '—';
      const expires = c.validTo
        ? new Date(c.validTo).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})
        : '—';
      tb.appendChild(h('tr', null,
        h('td.host', null, c.subjectCn || '—'),
        h('td.muted', null, expires),
        h('td', null, c.daysUntilExpiry != null ? String(c.daysUntilExpiry) + 'd' : '—'),
        h('td', null, h('span.chip.'+tone, null, h('span.dot'), label)),
      ));
    });
    tbl.appendChild(tb); tw.appendChild(tbl); body.appendChild(tw);
    card.appendChild(body); return card;
  }

  function _patchHistoryCard(history) {
    const card = h('div.sd-card');
    card.appendChild(_sdCardHead('Patch history', history.length ? history.length + ' cycles' : null));
    const body = h('div.sd-card-body');
    if (history.length === 0) {
      body.appendChild(h('div.muted', { style:{padding:'16px 20px'} }, 'No patch history available.'));
      card.appendChild(body); return card;
    }
    const tw = h('div.table-wrap'); const tbl = h('table.op');
    tbl.appendChild(h('thead', null, h('tr', null,
      h('th', null, 'Cycle'),
      h('th', null, 'Date'),
      h('th', null, 'Outcome'),
    )));
    const tb = h('tbody');
    history.forEach(c => {
      const tone = c.status === 'held' ? 'warn' : c.status === 'patched' ? 'ok' : '';
      const label = c.status === 'held' ? 'Held' : c.status === 'patched' ? 'Patched' : 'Scheduled';
      const date = c.cycleDate
        ? new Date(c.cycleDate).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})
        : '—';
      tb.appendChild(h('tr', null,
        h('td.host', null, c.patchGroup || '—'),
        h('td.muted', null, date),
        h('td', null, h('span.chip'+(tone?'.'+tone:''), null, h('span.dot'), label)),
      ));
    });
    tbl.appendChild(tb); tw.appendChild(tbl); body.appendChild(tw);
    card.appendChild(body); return card;
  }

  function _serverDetailContent(mount, detail) {
    const s = detail.server;
    const disksRaw = detail.disks;
    const disks = Array.isArray(disksRaw) ? disksRaw
                : (disksRaw && Array.isArray(disksRaw.items) ? disksRaw.items : []);
    const certs = Array.isArray(detail.certs) ? detail.certs : [];
    const history = Array.isArray(detail.history) ? detail.history : [];

    const page = h('div.page');
    const ribbon = demoRibbon('server-detail'); if (ribbon) page.appendChild(ribbon);
    page.appendChild(_serverDetailActions(s));

    const grid = h('div.sd-grid');
    grid.appendChild(_disksCard(disks));
    grid.appendChild(_lifecycleCard(s));
    grid.appendChild(_certsCard(certs));
    grid.appendChild(_patchHistoryCard(history));
    page.appendChild(grid);

    mount.innerHTML = '';
    mount.appendChild(page);
  }

  function renderServerDetailPage(mount, idStr) {
    const id = parseInt(idStr, 10);
    if (!id || Number.isNaN(id) || id <= 0) {
      _serverDetailEmpty(mount, 'Invalid server id', 'Use the Back to inventory button to return.');
      return;
    }
    if (_serverDetailLoaded && _serverDetailLoaded.id === id) {
      if (!_serverDetailLoaded.data) {
        _serverDetailEmpty(mount, 'Server not found', 'Server #' + id + ' is not in the inventory.');
      } else {
        _serverDetailContent(mount, _serverDetailLoaded.data);
      }
      return;
    }
    if (_serverDetailLoading && _serverDetailLoading.id === id) {
      _serverDetailLoadingView(mount);
      return;
    }
    if (!window.OC_API || !window.OC_API.getServerDetail) {
      _serverDetailEmpty(mount, 'API not ready', 'Refresh the page to retry.');
      return;
    }
    _serverDetailLoading = { id };
    _serverDetailLoadingView(mount);
    const stillOnSamePage = () =>
      window.ROUTER && window.ROUTER.currentRoute() === 'servers'
      && window.ROUTER.currentRouteParam() === idStr;
    window.OC_API.getServerDetail(id).then(data => {
      _serverDetailLoaded = { id, data };
      _serverDetailLoading = null;
      // RERENDER_SHELL (not RERENDER_PAGE) so the Statusline re-evaluates
      // surfaceHero() and replaces "Loading server…" with the real host name.
      if (stillOnSamePage()) window.RERENDER_SHELL ? window.RERENDER_SHELL() : window.RERENDER_PAGE(mount);
    }).catch(() => {
      _serverDetailLoaded = { id, data: null };
      _serverDetailLoading = null;
      if (stillOnSamePage()) window.RERENDER_SHELL ? window.RERENDER_SHELL() : window.RERENDER_PAGE(mount);
    });
  }

  // Read-only accessor for op-app.js's Statusline / surfaceHero so they can
  // tailor the page header to the loaded server when on #servers/{id}.
  // Returns null when nothing is loaded for that id (still in flight, or
  // a different id is in the cache slot).
  window.GET_SERVER_DETAIL = function (id) {
    const numId = typeof id === 'number' ? id : parseInt(id, 10);
    if (!_serverDetailLoaded || _serverDetailLoaded.id !== numId) return null;
    return _serverDetailLoaded.data;
  };

  // ================================================================
  // LICENSING (08) — Phase 0 prototype. All data sourced from
  // window.LICENSING_DATA (defined in licensing-demo-data.js). Swap to real
  // /api/licensing/* in Phase 1 by replacing the data reads with apiLicensing.*.
  // ================================================================
  const licState = { bucket: '__all', vendor: '__all', status: '__all', q: '', selectedId: null, showAddForm: false };

  function _licData() { return window.LICENSING_DATA || null; }
  const BUCKET_LABEL = {
    expired:   'Expired',
    under30:   '≤ 30 days',
    under3mo:  '≤ 3 months',
    under6mo:  '≤ 6 months',
    healthy:   'Healthy (> 6 mo)',
  };
  const BUCKET_TONE = {
    expired:   'crit',
    under30:   'crit',
    under3mo:  'warn',
    under6mo:  'warn',
    healthy:   'ok',
  };
  const BUCKET_SUB = {
    expired:   'Out of contract — escalate',
    under30:   'Procurement must close now',
    under3mo:  'Within 3 months — engaged or escalating',
    under6mo:  'Within 6 months — should be on procurement radar',
    healthy:   'No action needed yet',
  };

  function _fmtLicDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''));
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
  }

  function _filteredLicences() {
    const D = _licData();
    if (!D) return [];
    let rows = D.LICENCES.slice();
    if (licState.bucket !== '__all') rows = rows.filter(l => D.getBucket(l) === licState.bucket);
    if (licState.vendor !== '__all') rows = rows.filter(l => l.vendor === licState.vendor);
    if (licState.status !== '__all') rows = rows.filter(l => l.status_flag === licState.status);
    if (licState.q.trim()) {
      const q = licState.q.trim().toLowerCase();
      rows = rows.filter(l =>
        (l.application_name || '').toLowerCase().includes(q) ||
        (l.vendor || '').toLowerCase().includes(q) ||
        (l.product || '').toLowerCase().includes(q) ||
        (l.notes || '').toLowerCase().includes(q));
    }
    // Sort by days-remaining ascending so the most urgent are at the top.
    rows.sort((a, b) => D.daysUntilExpiry(a) - D.daysUntilExpiry(b));
    return rows;
  }

  function renderLicensingPage(mount) {
    const D = _licData();
    const page = h('div.page');

    page.appendChild(h('div.page-head', null,
      h('span.counter', null, '08 / 09'),
      h('span.title', null, 'Licensing'),
      h('span.note', null, 'Vendor licence expiry tracking. Surfaces contracts expiring in the next 6 months, 3 months, and 30 days — same threshold pattern as Certificates and EOL — so procurement has the runway to negotiate before renewal terms become urgent.'),
    ));

    if (!D) {
      page.appendChild(h('div.loud-banner.warn', null,
        h('div.lead', null, 'Demo data not loaded'),
        h('div.msg', { html: '<b>licensing-demo-data.js</b> did not load. Check that the script tag is in index.html and the file exists at frontend/js/licensing-demo-data.js.' }),
      ));
      mount.innerHTML = '';
      mount.appendChild(page);
      return;
    }

    // Phase 0 disclosure ribbon
    page.appendChild(h('div.demo-ribbon-row', { role: 'status', 'aria-label': 'Phase 0 prototype' },
      h('span.demo-ribbon', null, 'DEMO DATA'),
      h('span.demo-ribbon-note', null, 'Phase 0 prototype — fixtures from licensing-demo-data.js. No backend, no Teams alerts. Click-through and add/edit are in-memory only.'),
    ));

    // 6-cell crit strip (matches the existing .crit-strip-6 variant)
    const counts = D.getCounts();
    const total = D.LICENCES.length;
    const actionRequired = counts.expired + counts.under30 + counts.under3mo + counts.under6mo;

    const strip = h('div.crit-strip.crit-strip-6');

    // Action-required status cell
    const statusTone = counts.expired > 0 || counts.under30 > 0 ? 'crit'
                     : counts.under3mo > 0 || counts.under6mo > 0 ? 'warn' : 'ok';
    strip.appendChild(h('div.cs-cell.status-cell.'+statusTone, {
      on:{click:()=>{ licState.bucket = counts.expired > 0 ? 'expired' : counts.under30 > 0 ? 'under30' : counts.under3mo > 0 ? 'under3mo' : 'under6mo'; window.RERENDER_PAGE(mount); }},
    },
      h('div.cs-label', null, 'Licences · action required'),
      h('div.cs-value', null, String(actionRequired), h('span.cs-unit', null, 'of ' + total + ' tracked')),
      h('div.cs-sub', null, counts.expired > 0 ? counts.expired + ' expired — service impact possible' : counts.under30 > 0 ? 'Within 30 days — emergency procurement risk' : counts.under3mo > 0 ? 'Within 3 months — should be engaged' : counts.under6mo > 0 ? 'Within 6 months — procurement runway shrinking' : 'All licences > 6 months out'),
      h('div.cs-link', null, 'Filter to action-required'),
    ));

    // Bucket cells
    const bucketCell = (bucketKey) => {
      const cnt = counts[bucketKey];
      const tone = BUCKET_TONE[bucketKey];
      const label = BUCKET_LABEL[bucketKey];
      const sub = BUCKET_SUB[bucketKey];
      return h('div.cs-cell.'+tone, {
        on:{click:()=>{ licState.bucket = bucketKey; window.RERENDER_PAGE(mount); }},
      },
        h('div.cs-label', null, label),
        h('div.cs-value', null, String(cnt), h('span.cs-unit', null, cnt === 1 ? 'licence' : 'licences')),
        h('div.cs-sub', null, sub),
        cnt > 0 ? h('div.cs-link', null, 'Show ' + label.toLowerCase()) : null,
      );
    };

    strip.appendChild(bucketCell('expired'));
    strip.appendChild(bucketCell('under30'));
    strip.appendChild(bucketCell('under3mo'));
    strip.appendChild(bucketCell('under6mo'));
    strip.appendChild(bucketCell('healthy'));
    page.appendChild(strip);

    // Filter bar
    const bucketOpts = [
      ['__all',    'All buckets (' + total + ')'],
      ['expired',  'Expired (' + counts.expired + ')'],
      ['under30',  '≤ 30 days (' + counts.under30 + ')'],
      ['under3mo', '≤ 3 months (' + counts.under3mo + ')'],
      ['under6mo', '≤ 6 months (' + counts.under6mo + ')'],
      ['healthy',  'Healthy (' + counts.healthy + ')'],
    ];
    const bucketSel = h('select', { on:{change:(e)=>{ licState.bucket=e.target.value; window.RERENDER_PAGE(mount); }}},
      bucketOpts.map(([v,l]) => h('option', { value:v, selected: licState.bucket===v }, l)));

    const vendorOpts = [['__all', 'All vendors']].concat(D.getVendors().map(v => [v, v]));
    const vendorSel = h('select', { on:{change:(e)=>{ licState.vendor=e.target.value; window.RERENDER_PAGE(mount); }}},
      vendorOpts.map(([v,l]) => h('option', { value:v, selected: licState.vendor===v }, l)));

    const statusOpts = [
      ['__all',   'All statuses'],
      ['tracked', 'Tracked'],
      ['engaged', 'Engaged'],
    ];
    const statusSel = h('select', { on:{change:(e)=>{ licState.status=e.target.value; window.RERENDER_PAGE(mount); }}},
      statusOpts.map(([v,l]) => h('option', { value:v, selected: licState.status===v }, l)));

    const search = h('input', { 'data-fk':'lic-search', type:'text', placeholder:'Filter by application, vendor, product, notes…', value: licState.q,
      on:{input:(e)=>{ licState.q=e.target.value; window.RERENDER_PAGE(mount); }}});
    const resetBtn = h('button.btn', { on:{click:()=>{ licState.bucket='__all'; licState.vendor='__all'; licState.status='__all'; licState.q=''; window.RERENDER_PAGE(mount); }}}, 'Reset');
    const addBtn = h('button.btn', { on:{click:()=>{ licState.showAddForm = !licState.showAddForm; window.RERENDER_PAGE(mount); }}}, licState.showAddForm ? 'Cancel' : '+ Add licence');

    page.appendChild(filterBar([bucketSel, vendorSel, statusSel, search, resetBtn, h('span.spacer'), addBtn]));

    if (licState.showAddForm) {
      page.appendChild(renderLicensingAddForm(mount));
    }

    // Table
    const rows = _filteredLicences();
    const tblWrap = h('div.table-wrap');
    const table = h('table.op');
    table.appendChild(h('thead', null, h('tr', null,
      h('th', null, 'Application'),
      h('th', null, 'Vendor'),
      h('th', null, 'Product'),
      h('th.num', null, 'Seats'),
      h('th', null, 'Expires'),
      h('th.num', null, 'Days'),
      h('th', null, 'Status'),
      h('th', null, 'Renewal owner'),
      h('th', null, 'Bucket'),
    )));
    const tbody = h('tbody');
    if (!rows.length) {
      tbody.appendChild(h('tr', null, h('td', { colspan: 9, style:{padding:'24px',textAlign:'center',color:'var(--ink-3)',fontFamily:'var(--mono)',fontSize:'11.5px'} }, 'No licences match the current filters.')));
    } else {
      rows.forEach(l => {
        const bucket = D.getBucket(l);
        const days = D.daysUntilExpiry(l);
        const tone = BUCKET_TONE[bucket];
        const sevRow = (bucket === 'expired' || bucket === 'under30') ? '.sev-crit'
                     : (bucket === 'under3mo') ? '.sev-warn' : '';
        const daysColor = bucket === 'expired' ? 'var(--crit)' : bucket === 'under30' ? 'var(--crit)' : bucket === 'under3mo' ? 'var(--warn)' : bucket === 'under6mo' ? 'var(--warn)' : 'var(--ink-2)';
        const bucketStamp = stamp(tone, BUCKET_LABEL[bucket].toUpperCase());
        // Inline status editor — overlay a transparent <select> over the badge
        // so the user can change status without expanding the row. Click
        // events are stopped so the row's own click handler (which toggles
        // the expanded detail) doesn't fire. Only two states: tracked /
        // engaged. Renewal is an action (in the row detail), not a status.
        const badgeCls = l.status_flag === 'engaged' ? 'chip.warn' : 'chip';
        const statusLabel = l.status_flag === 'engaged' ? 'Engaged' : 'Tracked';
        const statusBadge = h('label', {
          style:{ position:'relative', display:'inline-block', cursor:'pointer' },
          on:{ click:(e)=>e.stopPropagation() },
        },
          h('span.'+badgeCls, null,
            l.status_flag === 'engaged' ? h('span.dot') : null,
            statusLabel,
            h('span', { style:{marginLeft:'5px',opacity:0.55,fontSize:'9px'} }, '▾'),
          ),
          h('select', {
            style:{ position:'absolute', inset:0, opacity:0, cursor:'pointer', width:'100%', height:'100%', border:'none' },
            on:{
              click:(e)=>e.stopPropagation(),
              change:(e)=>{ l.status_flag = e.target.value; window.RERENDER_PAGE(mount); },
            },
          },
            h('option', { value:'tracked', selected: l.status_flag === 'tracked' }, 'Tracked'),
            h('option', { value:'engaged', selected: l.status_flag === 'engaged' }, 'Engaged'),
          ),
        );
        tbody.appendChild(h('tr'+sevRow, {
          on:{click:()=>{ licState.selectedId = (licState.selectedId === l.licence_id ? null : l.licence_id); window.RERENDER_PAGE(mount); }},
          style:{cursor:'pointer'},
        },
          h('td.host', null, l.application_name),
          h('td', null, l.vendor),
          h('td.muted', null, l.product),
          h('td.num', null, l.seats ? l.seats.toLocaleString() : '—'),
          h('td.mono.muted', null, _fmtLicDate(l.expires_at)),
          h('td.num', { style:{color: daysColor, fontWeight: (bucket === 'expired' || bucket === 'under30') ? '600' : '500'} },
            (days < 0 ? days + 'd' : days + 'd')),
          h('td', null, statusBadge),
          h('td.muted', null, l.renewal_owner_sam || '—'),
          h('td', null, bucketStamp),
        ));

        // Expanded detail row
        if (licState.selectedId === l.licence_id) {
          tbody.appendChild(renderLicensingDetailRow(mount, l));
        }
      });
    }
    table.appendChild(tbody);
    tblWrap.appendChild(table);
    page.appendChild(tblWrap);

    mount.innerHTML = '';
    mount.appendChild(page);
  }

  function renderLicensingDetailRow(mount, l) {
    const D = _licData();
    const tr = h('tr', { style:{background:'var(--paper-2)'} });
    const td = h('td', { colspan: 9, style:{padding:'18px 20px'} });

    const grid = h('div', { style:{display:'grid',gridTemplateColumns:'2fr 1fr',gap:'24px'} });

    // Notes column
    const notesCol = h('div', { style:{display:'flex',flexDirection:'column',gap:'10px'} },
      h('div', { style:{fontFamily:'var(--mono)',fontSize:'10px',letterSpacing:'.1em',textTransform:'uppercase',color:'var(--ink-3)'} }, 'Notes / context'),
      h('div', { style:{fontSize:'13px',color:'var(--ink-2)',lineHeight:'1.55'} }, l.notes || h('span', { style:{color:'var(--ink-3)',fontStyle:'italic'} }, 'No notes recorded.')),
      h('div', { style:{display:'flex',flexWrap:'wrap',gap:'18px',fontFamily:'var(--mono)',fontSize:'11px',color:'var(--ink-3)',marginTop:'4px'} },
        h('span', null, 'Type: ', h('b', { style:{color:'var(--ink-2)'} }, D.fmtLicenceType(l.licence_type))),
        l.starts_at ? h('span', null, 'Started: ', h('b', { style:{color:'var(--ink-2)'} }, _fmtLicDate(l.starts_at))) : null,
        h('span', null, 'Notice period: ', h('b', { style:{color:'var(--ink-2)'} }, (l.notice_period_days || 0) + ' days')),
      ),
    );
    grid.appendChild(notesCol);

    // Right column: Mark as renewed action + Teams alert preview
    const actionCol = h('div', { style:{display:'flex',flexDirection:'column',gap:'10px'} });
    actionCol.appendChild(h('div', { style:{fontFamily:'var(--mono)',fontSize:'10px',letterSpacing:'.1em',textTransform:'uppercase',color:'var(--ink-3)'} }, 'Renew this licence'));
    actionCol.appendChild(renderLicensingRenewBlock(mount, l));

    // Teams alert preview
    const alertThreshold = D.getAlertThreshold(l);
    if (alertThreshold) {
      const alertLabel = ({ expired: 'EXPIRED', thirty_d: '≤ 30 DAYS', three_mo: '≤ 3 MONTHS', six_mo: '≤ 6 MONTHS' })[alertThreshold];
      const alertTone = (alertThreshold === 'expired' || alertThreshold === 'thirty_d') ? 'crit' : 'warn';
      actionCol.appendChild(h('div', { style:{marginTop:'8px',padding:'10px 12px',border:'1px solid var(--rule)',background:'var(--card)'} },
        h('div', { style:{fontFamily:'var(--mono)',fontSize:'10px',letterSpacing:'.1em',textTransform:'uppercase',color:'var(--ink-3)',marginBottom:'4px'} }, 'Teams alert (Phase 1+)'),
        h('div', { style:{display:'flex',alignItems:'center',gap:'8px'} },
          stamp(alertTone, alertLabel),
          h('span', { style:{fontFamily:'var(--mono)',fontSize:'11px',color:'var(--ink-2)'} }, 'will fire to the operations Teams channel'),
        ),
      ));
    }
    grid.appendChild(actionCol);

    td.appendChild(grid);

    // Renewal history (full-width below the 2-column grid)
    td.appendChild(renderLicensingRenewalHistory(l));

    tr.appendChild(td);
    return tr;
  }

  // Per-licence renewal form state, keyed by licence_id. Allows the form to
  // stay open across re-renders without leaking between licences.
  const _renewFormState = {};

  function renderLicensingRenewBlock(mount, l) {
    const wrap = h('div', { style:{padding:'10px 12px',border:'1px solid var(--rule)',background:'var(--card)',display:'flex',flexDirection:'column',gap:'10px'} });
    const state = _renewFormState[l.licence_id] || (_renewFormState[l.licence_id] = { open: false, new_expires: '', notes: '' });

    if (!state.open) {
      wrap.appendChild(h('div', { style:{fontFamily:'var(--mono)',fontSize:'11.5px',color:'var(--ink-2)',lineHeight:'1.5'} },
        'Mark as renewed when the new contract is in place. The current cycle (expiring ',
        h('b', { style:{color:'var(--ink)'} }, _fmtLicDate(l.expires_at)),
        ') moves to history, status resets to ',
        h('b', { style:{color:'var(--ink)'} }, 'Tracked'),
        ', and threshold alerts re-arm for the next cycle.'));
      wrap.appendChild(h('button.btn', {
        style:{alignSelf:'flex-start'},
        on:{click:()=>{ state.open = true; window.RERENDER_PAGE(mount); }},
      }, 'Mark as renewed'));
      return wrap;
    }

    // Open form
    const labelStyle = { fontFamily:'var(--mono)',fontSize:'10px',letterSpacing:'.1em',textTransform:'uppercase',color:'var(--ink-3)' };
    const inputStyle = { padding:'7px 9px',border:'1px solid var(--rule)',background:'var(--card)',fontFamily:'inherit',fontSize:'13px' };
    const fieldStyle = { display:'flex',flexDirection:'column',gap:'4px' };

    wrap.appendChild(h('label', { style: fieldStyle },
      h('span', { style: labelStyle }, 'New expiry date'),
      h('input', { 'data-fk':'lic-renew-exp-'+l.licence_id, type:'date', style: inputStyle, value: state.new_expires,
        on:{input:(e)=>{ state.new_expires = e.target.value; }}}),
    ));
    wrap.appendChild(h('label', { style: fieldStyle },
      h('span', { style: labelStyle }, 'Renewal notes (optional)'),
      h('input', { 'data-fk':'lic-renew-notes-'+l.licence_id, type:'text', style: inputStyle, value: state.notes, placeholder:'e.g. 1-year renewal, 4% uplift held back',
        on:{input:(e)=>{ state.notes = e.target.value; }}}),
    ));

    const canSubmit = !!state.new_expires && state.new_expires > l.expires_at;
    const submitBtn = h('button.btn', {
      style: canSubmit ? null : { opacity: 0.5, cursor:'not-allowed' },
      on:{click:()=>{
        if (!canSubmit) return;
        const D = _licData();
        D.markRenewed(l, state.new_expires, state.notes);
        _renewFormState[l.licence_id] = { open: false, new_expires: '', notes: '' };
        window.RERENDER_PAGE(mount);
      }},
    }, 'Confirm renewal');
    const cancelBtn = h('button.btn', {
      on:{click:()=>{ _renewFormState[l.licence_id] = { open: false, new_expires: '', notes: '' }; window.RERENDER_PAGE(mount); }},
    }, 'Cancel');

    wrap.appendChild(h('div', { style:{display:'flex',gap:'8px',alignItems:'center'} },
      submitBtn, cancelBtn,
      h('span', { style:{fontFamily:'var(--mono)',fontSize:'10.5px',color:'var(--ink-3)'} },
        canSubmit ? '' : (state.new_expires ? 'New expiry must be after the current one' : 'Enter a new expiry date')),
    ));
    return wrap;
  }

  function renderLicensingRenewalHistory(l) {
    const D = _licData();
    const renewals = D.getRenewalsForLicence(l.licence_id);
    const wrap = h('div', { style:{marginTop:'18px',paddingTop:'14px',borderTop:'1px solid var(--rule)',display:'flex',flexDirection:'column',gap:'8px'} });
    wrap.appendChild(h('div', { style:{display:'flex',alignItems:'center',gap:'10px'} },
      h('span', { style:{fontFamily:'var(--mono)',fontSize:'10px',letterSpacing:'.1em',textTransform:'uppercase',color:'var(--ink-3)'} }, 'Renewal history'),
      h('span', { style:{fontFamily:'var(--mono)',fontSize:'11px',color:'var(--ink-3)'} }, renewals.length + ' cycle' + (renewals.length === 1 ? '' : 's')),
    ));

    if (!renewals.length) {
      wrap.appendChild(h('div', { style:{padding:'12px',border:'1px dashed var(--rule)',fontFamily:'var(--mono)',fontSize:'11.5px',color:'var(--ink-3)',textAlign:'center'} },
        'First cycle — no prior renewals recorded.'));
      return wrap;
    }

    const tblWrap = h('div.table-wrap');
    const tbl = h('table.op');
    tbl.appendChild(h('thead', null, h('tr', null,
      h('th', null, 'Cycle ended'),
      h('th', null, 'Renewed on'),
      h('th', null, 'New expiry'),
      h('th', null, 'Renewed by'),
      h('th', null, 'Notes'),
    )));
    const tb = h('tbody');
    renewals.forEach(r => {
      tb.appendChild(h('tr', null,
        h('td.mono.muted', null, _fmtLicDate(r.cycle_ended)),
        h('td.mono.muted', null, _fmtLicDate(r.renewed_on)),
        h('td.mono', null, _fmtLicDate(r.new_expires)),
        h('td.muted', null, r.renewed_by || '—'),
        h('td.muted', null, r.notes || '—'),
      ));
    });
    tbl.appendChild(tb);
    tblWrap.appendChild(tbl);
    wrap.appendChild(tblWrap);
    return wrap;
  }

  function renderLicensingAddForm(mount) {
    const D = _licData();
    const formState = renderLicensingAddForm._s || (renderLicensingAddForm._s = {
      application_name: '', vendor: '', product: '', licence_type: 'saas',
      seats: '', expires_at: '', notice_period_days: 60,
      renewal_owner_sam: '', status_flag: 'tracked', notes: '',
    });

    const wrap = h('div', { style:{border:'1px solid var(--rule)',background:'var(--card)',padding:'20px 22px',display:'flex',flexDirection:'column',gap:'14px',maxWidth:'880px'} });
    wrap.appendChild(h('div', { style:{fontFamily:'var(--mono)',fontSize:'10px',letterSpacing:'.12em',textTransform:'uppercase',color:'var(--ink-3)'} }, 'Add a licence'));

    const labelStyle = { fontFamily:'var(--mono)',fontSize:'10px',letterSpacing:'.1em',textTransform:'uppercase',color:'var(--ink-3)' };
    const inputStyle = { padding:'8px 10px',border:'1px solid var(--rule)',background:'var(--card)',fontFamily:'inherit',fontSize:'13px',color:'var(--ink)' };
    const fieldStyle = { display:'flex',flexDirection:'column',gap:'4px' };

    const grid = h('div', { style:{display:'grid',gridTemplateColumns:'repeat(auto-fit, minmax(220px, 1fr))',gap:'12px'} });

    grid.appendChild(h('label', { style: fieldStyle },
      h('span', { style: labelStyle }, 'Application name'),
      h('input', { 'data-fk':'lic-add-app', type:'text', style: inputStyle, value: formState.application_name, placeholder:'e.g. Tableau Server',
        on:{input:(e)=>{ formState.application_name = e.target.value; }}}),
    ));
    grid.appendChild(h('label', { style: fieldStyle },
      h('span', { style: labelStyle }, 'Vendor'),
      h('input', { 'data-fk':'lic-add-vendor', type:'text', style: inputStyle, value: formState.vendor, placeholder:'e.g. Tableau',
        on:{input:(e)=>{ formState.vendor = e.target.value; }}}),
    ));
    grid.appendChild(h('label', { style: fieldStyle },
      h('span', { style: labelStyle }, 'Product'),
      h('input', { 'data-fk':'lic-add-product', type:'text', style: inputStyle, value: formState.product,
        on:{input:(e)=>{ formState.product = e.target.value; }}}),
    ));
    grid.appendChild(h('label', { style: fieldStyle },
      h('span', { style: labelStyle }, 'Expiry date'),
      h('input', { 'data-fk':'lic-add-exp', type:'date', style: inputStyle, value: formState.expires_at,
        on:{input:(e)=>{ formState.expires_at = e.target.value; }}}),
    ));
    grid.appendChild(h('label', { style: fieldStyle },
      h('span', { style: labelStyle }, 'Licence type'),
      h('select', { style: inputStyle,
        on:{change:(e)=>{ formState.licence_type = e.target.value; }}},
        h('option', { value:'saas',                    selected: formState.licence_type==='saas' },                    'SaaS'),
        h('option', { value:'onprem_subscription',     selected: formState.licence_type==='onprem_subscription' },     'On-prem subscription'),
        h('option', { value:'perpetual_maintenance',   selected: formState.licence_type==='perpetual_maintenance' },   'Perpetual + maintenance'),
      ),
    ));
    grid.appendChild(h('label', { style: fieldStyle },
      h('span', { style: labelStyle }, 'Seats'),
      h('input', { 'data-fk':'lic-add-seats', type:'number', style: inputStyle, value: String(formState.seats || ''), placeholder:'e.g. 200',
        on:{input:(e)=>{ formState.seats = parseInt(e.target.value, 10) || 0; }}}),
    ));
    grid.appendChild(h('label', { style: fieldStyle },
      h('span', { style: labelStyle }, 'Notice period (days)'),
      h('input', { 'data-fk':'lic-add-notice', type:'number', style: inputStyle, value: String(formState.notice_period_days || ''),
        on:{input:(e)=>{ formState.notice_period_days = parseInt(e.target.value, 10) || 0; }}}),
    ));
    grid.appendChild(h('label', { style: fieldStyle },
      h('span', { style: labelStyle }, 'Renewal owner'),
      h('input', { 'data-fk':'lic-add-owner', type:'text', style: inputStyle, value: formState.renewal_owner_sam, placeholder:'sam.account',
        on:{input:(e)=>{ formState.renewal_owner_sam = e.target.value; }}}),
    ));

    wrap.appendChild(grid);

    // Status flag — two values only. Most new licences start as 'tracked'.
    // 'Engaged' as initial would mean procurement was already working on it
    // before ops registered the licence — uncommon but possible.
    wrap.appendChild(h('label', { style: Object.assign({}, fieldStyle, { maxWidth:'260px' }) },
      h('span', { style: labelStyle }, 'Initial status'),
      h('select', { style: inputStyle, on:{change:(e)=>{ formState.status_flag = e.target.value; }}},
        h('option', { value:'tracked', selected: formState.status_flag==='tracked' }, 'Tracked — in the system, no procurement action yet'),
        h('option', { value:'engaged', selected: formState.status_flag==='engaged' }, 'Engaged — procurement already working it'),
      ),
    ));

    wrap.appendChild(h('label', { style: fieldStyle },
      h('span', { style: labelStyle }, 'Notes'),
      h('textarea', { 'data-fk':'lic-add-notes', style: Object.assign({}, inputStyle, { resize:'vertical', minHeight:'56px' }), value: formState.notes,
        on:{input:(e)=>{ formState.notes = e.target.value; }}}),
    ));

    // Submit (in-memory only)
    const canSubmit = formState.application_name && formState.vendor && formState.product && formState.expires_at;
    const submitBtn = h('button.btn', {
      style: canSubmit ? null : { opacity: 0.5, cursor:'not-allowed' },
      on:{click:()=>{
        if (!canSubmit) return;
        const nextId = (D.LICENCES.reduce((m, l) => Math.max(m, l.licence_id), 0) || 0) + 1;
        D.LICENCES.push({
          licence_id: nextId,
          application_name: formState.application_name,
          vendor: formState.vendor,
          product: formState.product,
          licence_type: formState.licence_type,
          seats: formState.seats || 0,
          expires_at: formState.expires_at,
          notice_period_days: formState.notice_period_days || 0,
          renewal_owner_sam: formState.renewal_owner_sam,
          status_flag: formState.status_flag,
          notes: formState.notes,
        });
        // Reset form
        renderLicensingAddForm._s = null;
        licState.showAddForm = false;
        window.RERENDER_PAGE(mount);
      }},
    }, 'Add licence');
    wrap.appendChild(h('div', { style:{display:'flex',gap:'10px',alignItems:'center',paddingTop:'4px'} },
      submitBtn,
      h('span', { style:{fontFamily:'var(--mono)',fontSize:'10.5px',color:'var(--ink-3)'} },
        canSubmit ? 'Phase 0: appends to the in-memory fixture only.' : 'Application, vendor, product and expiry date are required.'),
    ));

    return wrap;
  }

  // ================================================================
  // AUDITING (09) — Phase 0 prototype. All data sourced from
  // window.AUDITING_DATA (defined in auditing-demo-data.js). Swap to real
  // /api/auditing/* in Phase 1 by replacing the data reads with apiAuditing.*.
  // ================================================================
  const aState = { tab: 'apps', selectedAppId: null, selectedCampaignId: null, showAddAppForm: false };

  function _audData() { return window.AUDITING_DATA || null; }
  function _fmtDateTime(s) {
    if (!s) return '—';
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    return d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) +
      ' ' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
  }
  function _fmtDate(s) {
    if (!s) return '—';
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    return d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
  }
  function _shortGroup(dn) {
    const m = /^CN=([^,]+)/i.exec(dn || '');
    return m ? m[1] : (dn || '');
  }

  function renderAuditingPage(mount) {
    const D = _audData();
    const page = h('div.page');

    page.appendChild(h('div.page-head', null,
      h('span.counter', null, '09 / 09'),
      h('span.title', null, 'Auditing'),
      h('span.note', null, 'Application access attestation. Register apps and the AD groups that gate them, then launch campaigns that ask each group’s owner to keep or revoke every member.'),
    ));

    if (!D) {
      page.appendChild(h('div.loud-banner.warn', null,
        h('div.lead', null, 'Demo data not loaded'),
        h('div.msg', { html: '<b>auditing-demo-data.js</b> did not load. Check that the script tag is in index.html and the file exists at frontend/js/auditing-demo-data.js.' }),
      ));
      mount.innerHTML = '';
      mount.appendChild(page);
      return;
    }

    // Phase 0 disclosure ribbon so reviewers know this is not yet wired up.
    page.appendChild(h('div.demo-ribbon-row', { role: 'status', 'aria-label': 'Phase 0 prototype' },
      h('span.demo-ribbon', null, 'DEMO DATA'),
      h('span.demo-ribbon-note', null, 'Phase 0 prototype — fixtures from auditing-demo-data.js. No backend, no AD sync, no email. Click-through only.'),
    ));

    // 6-cell crit strip — same shape as 05 Certificates / 06 EOL / 08 Licensing
    page.appendChild(renderAuditingCritStrip(mount));

    // Tabs
    const activeCampaigns = D.CAMPAIGNS.filter(c => c.status === 'active').length;
    const tab = (id, label, n) => {
      const on = aState.tab === id;
      return h('button.tab'+(on?'.on':''), {
        on:{click:()=>{ aState.tab=id; aState.selectedAppId=null; aState.selectedCampaignId=null; window.RERENDER_PAGE(mount); }},
      }, label, n != null ? h('span.n', null, String(n)) : null);
    };
    page.appendChild(h('div.tabs', null,
      tab('apps', 'Applications', D.APPLICATIONS.length),
      tab('campaigns', 'Campaigns', D.CAMPAIGNS.length),
      tab('new', 'New campaign'),
    ));

    if (aState.tab === 'apps') {
      if (aState.selectedAppId) page.appendChild(renderAuditingAppDetail(mount));
      else                       page.appendChild(renderAuditingAppsList(mount));
    } else if (aState.tab === 'campaigns') {
      if (aState.selectedCampaignId) page.appendChild(renderAuditingCampaignDetail(mount));
      else                            page.appendChild(renderAuditingCampaignsList(mount, activeCampaigns));
    } else if (aState.tab === 'new') {
      page.appendChild(renderAuditingNewCampaign(mount));
    }

    mount.innerHTML = '';
    mount.appendChild(page);
  }

  function renderAuditingAddAppForm(mount) {
    const D = _audData();
    const formState = renderAuditingAddAppForm._s || (renderAuditingAddAppForm._s = {
      name: '', business_owner: '', technical_owner: '',
      audit_routing_mode: 'line_manager',
      audit_frequency_months: 12,
      audit_due_period_days: 21,
      auto_launch: false,
      bindings: [],
    });

    const wrap = h('div', { style:{border:'1px solid var(--rule)',background:'var(--card)',padding:'20px 22px',display:'flex',flexDirection:'column',gap:'14px'} });
    wrap.appendChild(h('div', { style:{fontFamily:'var(--mono)',fontSize:'10px',letterSpacing:'.12em',textTransform:'uppercase',color:'var(--ink-3)'} }, 'New application'));

    const labelStyle = { fontFamily:'var(--mono)',fontSize:'10px',letterSpacing:'.1em',textTransform:'uppercase',color:'var(--ink-3)' };
    const inputStyle = { padding:'8px 10px',border:'1px solid var(--rule)',background:'var(--card)',fontFamily:'inherit',fontSize:'13px',color:'var(--ink)' };
    const fieldStyle = { display:'flex',flexDirection:'column',gap:'4px' };

    // Top grid: Name, business owner, technical owner
    const grid1 = h('div', { style:{display:'grid',gridTemplateColumns:'repeat(auto-fit, minmax(220px, 1fr))',gap:'12px'} });
    grid1.appendChild(h('label', { style: fieldStyle },
      h('span', { style: labelStyle }, 'Application name *'),
      h('input', { 'data-fk':'aud-newapp-name', type:'text', style: inputStyle, value: formState.name, placeholder:'e.g. Confluence Data Center',
        on:{input:(e)=>{ formState.name = e.target.value; }}}),
    ));
    grid1.appendChild(h('label', { style: fieldStyle },
      h('span', { style: labelStyle }, 'Business owner *'),
      h('select', { style: inputStyle, on:{change:(e)=>{ formState.business_owner = e.target.value; }}},
        h('option', { value:'', selected: !formState.business_owner }, '— Pick a person —'),
        ...D.USERS.map(u => h('option', { value: u.sam, selected: formState.business_owner === u.sam }, u.display + ' (' + u.sam + ')')),
      ),
    ));
    grid1.appendChild(h('label', { style: fieldStyle },
      h('span', { style: labelStyle }, 'Technical owner (optional)'),
      h('select', { style: inputStyle, on:{change:(e)=>{ formState.technical_owner = e.target.value; }}},
        h('option', { value:'' }, '— None —'),
        ...D.USERS.map(u => h('option', { value: u.sam, selected: formState.technical_owner === u.sam }, u.display + ' (' + u.sam + ')')),
      ),
    ));
    wrap.appendChild(grid1);

    // Bindings: search-by-name picker (live AD lookup in production)
    wrap.appendChild(h('div', { style: fieldStyle },
      h('span', { style: labelStyle }, 'Bound AD groups *'),
      h('div', { style:{fontFamily:'var(--mono)',fontSize:'10.5px',color:'var(--ink-3)',marginBottom:'4px'} },
        'Search for a group by name. At least one binding is required.'),
    ));

    // Selected bindings list
    const bindingsList = h('div', { style:{display:'flex',flexDirection:'column',gap:'4px'} });
    if (!formState.bindings.length) {
      bindingsList.appendChild(h('div', { style:{padding:'10px',border:'1px dashed var(--rule)',fontFamily:'var(--mono)',fontSize:'11.5px',color:'var(--ink-3)',textAlign:'center'} },
        'No groups bound yet.'));
    } else {
      formState.bindings.forEach((dn, idx) => {
        const grp = D.getGroup(dn);
        bindingsList.appendChild(h('div', { style:{display:'flex',alignItems:'center',gap:'10px',padding:'7px 10px',background:'var(--paper-2)',border:'1px solid var(--rule)',fontFamily:'var(--mono)',fontSize:'11.5px'} },
          h('b', { style:{color:'var(--ink)'} }, _shortGroup(dn)),
          h('span', { style:{color:'var(--ink-3)'} }, grp ? '· ' + grp.type : '· custom DN'),
          h('span', { style:{color:'var(--ink-4)',fontSize:'10.5px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',flex:'1'} }, dn),
          h('button', {
            style:{padding:'4px 10px',background:'transparent',border:'1px solid var(--rule)',color:'var(--ink-3)',cursor:'pointer',fontFamily:'var(--mono)',fontSize:'10.5px',letterSpacing:'.06em',textTransform:'uppercase'},
            on:{click:()=>{ formState.bindings.splice(idx, 1); window.RERENDER_PAGE(mount); }},
          }, 'Remove'),
        ));
      });
    }
    wrap.appendChild(bindingsList);

    // Search-by-name binding picker — Phase 0 filters the fixture; Phase 1
    // will call GET /api/auditing/ad-groups/search?q=... which hits LDAP live.
    const pickState = renderAuditingAddAppForm._pick || (renderAuditingAddAppForm._pick = { q: '' });
    wrap.appendChild(_renderGroupNameSearch(mount, pickState, formState.bindings, (dn) => {
      if (!formState.bindings.includes(dn)) formState.bindings.push(dn);
      pickState.q = '';
    }));

    // Routing / cadence / due / auto grid
    const grid2 = h('div', { style:{display:'grid',gridTemplateColumns:'repeat(auto-fit, minmax(200px, 1fr))',gap:'12px',marginTop:'4px',paddingTop:'10px',borderTop:'1px solid var(--rule)'} });
    grid2.appendChild(h('label', { style: fieldStyle },
      h('span', { style: labelStyle }, 'Routing mode'),
      h('select', { style: inputStyle, on:{change:(e)=>{ formState.audit_routing_mode = e.target.value; }}},
        h('option', { value:'line_manager', selected: formState.audit_routing_mode === 'line_manager' }, 'Line manager (ALL must submit)'),
        h('option', { value:'nominees',     selected: formState.audit_routing_mode === 'nominees' },     'Nominees (ANY closes)'),
      ),
    ));
    grid2.appendChild(h('label', { style: fieldStyle },
      h('span', { style: labelStyle }, 'Cadence'),
      h('select', { style: inputStyle, on:{change:(e)=>{ formState.audit_frequency_months = parseInt(e.target.value, 10); }}},
        h('option', { value:'6',  selected: formState.audit_frequency_months === 6  }, 'Every 6 months'),
        h('option', { value:'12', selected: formState.audit_frequency_months === 12 }, 'Annual'),
        h('option', { value:'24', selected: formState.audit_frequency_months === 24 }, 'Every 2 years'),
      ),
    ));
    grid2.appendChild(h('label', { style: fieldStyle },
      h('span', { style: labelStyle }, 'Due period (days)'),
      h('input', { type:'number', min:'1', max:'120', style: inputStyle, value: String(formState.audit_due_period_days),
        on:{input:(e)=>{ formState.audit_due_period_days = parseInt(e.target.value, 10) || 21; }}}),
    ));
    grid2.appendChild(h('label', { style:{display:'flex',alignItems:'center',gap:'8px',cursor:'pointer',padding:'8px 10px',border:'1px solid var(--rule)',background:'var(--card)',marginTop:'14px'} },
      h('input', { type:'checkbox', checked: formState.auto_launch,
        on:{change:(e)=>{ formState.auto_launch = e.target.checked; }}}),
      h('span', { style:{fontFamily:'var(--mono)',fontSize:'12px'} }, 'Auto-launch on due date'),
    ));
    wrap.appendChild(grid2);

    // Hint for nominees mode
    if (formState.audit_routing_mode === 'nominees') {
      wrap.appendChild(h('div', { style:{fontFamily:'var(--mono)',fontSize:'10.5px',color:'var(--warn)',padding:'8px 10px',background:'var(--warn-wash)',border:'1px solid var(--rule)'} },
        'Nominees mode — after creating the app, open its detail page to add nominees. The campaign can\'t launch until at least one is configured.'));
    }

    // Submit
    const canSubmit = formState.name.trim() && formState.business_owner && formState.bindings.length > 0;
    const submitBtn = h('button.btn', {
      style: canSubmit ? null : { opacity: 0.5, cursor:'not-allowed' },
      on:{click:()=>{
        if (!canSubmit) return;
        const nextId = (D.APPLICATIONS.reduce((m, a) => Math.max(m, a.application_id), 0) || 0) + 1;
        D.APPLICATIONS.push({
          application_id: nextId,
          name: formState.name.trim(),
          business_owner: formState.business_owner,
          technical_owner: formState.technical_owner || '',
          support_email: '',
          bindings: formState.bindings.slice(),
          audit_frequency_months: formState.audit_frequency_months,
          auto_launch: formState.auto_launch,
          audit_routing_mode: formState.audit_routing_mode,
          audit_due_period_days: formState.audit_due_period_days,
          nominees: [],
        });
        // Reset form, close it, drill into the new app so the user sees what they created
        renderAuditingAddAppForm._s = null;
        renderAuditingAddAppForm._pick = null;
        aState.showAddAppForm = false;
        aState.selectedAppId = nextId;
        window.RERENDER_PAGE(mount);
      }},
    }, 'Create application');

    wrap.appendChild(h('div', { style:{display:'flex',gap:'10px',alignItems:'center',paddingTop:'4px'} },
      submitBtn,
      h('span', { style:{fontFamily:'var(--mono)',fontSize:'10.5px',color:'var(--ink-3)'} },
        canSubmit
          ? 'Phase 0: appends to the in-memory fixture. Phase 1 will POST to /api/auditing/applications.'
          : 'Name, business owner, and at least one bound group are required.'),
    ));

    return wrap;
  }

  function renderAuditingCritStrip(mount) {
    const D = _audData();
    const c = D.getAuditingCritCounts();
    const strip = h('div.crit-strip.crit-strip-6');

    // Action required (status cell)
    const arTone = c.actionRequired === 0 ? 'ok' : c.overdue > 0 ? 'crit' : 'warn';
    strip.appendChild(h('div.cs-cell.status-cell.' + arTone, {
      on:{click:()=>{ aState.tab = 'apps'; aState.selectedAppId = null; window.RERENDER_PAGE(mount); }},
    },
      h('div.cs-label', null, 'Auditing · action required'),
      h('div.cs-value', null, String(c.actionRequired), h('span.cs-unit', null, 'of ' + c.total + ' apps')),
      h('div.cs-sub', null,
        c.actionRequired === 0
          ? 'All apps on schedule and launch-ready'
          : c.overdue > 0
          ? c.overdue + ' overdue · review or launch'
          : 'Routing config gaps blocking launch'),
      c.actionRequired > 0 ? h('div.cs-link', null, 'Review applications') : null,
    ));

    // Overdue audits
    strip.appendChild(h('div.cs-cell.' + (c.overdue > 0 ? 'crit' : 'info'), {
      on:{click:()=>{ aState.tab = 'apps'; aState.selectedAppId = null; window.RERENDER_PAGE(mount); }},
    },
      h('div.cs-label', null, 'Overdue audits'),
      h('div.cs-value', null, String(c.overdue), h('span.cs-unit', null, c.overdue === 1 ? 'app' : 'apps')),
      h('div.cs-sub', null, c.overdue > 0 ? 'Past next-due date — launch a campaign' : 'No overdue audits'),
      c.overdue > 0 ? h('div.cs-link', null, 'Show overdue') : null,
    ));

    // Reminders due this week
    strip.appendChild(h('div.cs-cell.' + (c.remindersDue > 0 ? 'warn' : 'info'), {
      on:{click:()=>{ aState.tab = 'campaigns'; aState.selectedCampaignId = null; window.RERENDER_PAGE(mount); }},
    },
      h('div.cs-label', null, 'Reminders due this week'),
      h('div.cs-value', null, String(c.remindersDue), h('span.cs-unit', null, c.remindersDue === 1 ? 'packet' : 'packets')),
      h('div.cs-sub', null, c.remindersDue > 0
        ? 'Will fire on the next daily tick'
        : 'No reminders queued this week'),
      c.remindersDue > 0 ? h('div.cs-link', null, 'Review campaigns') : null,
    ));

    // Active campaigns
    strip.appendChild(h('div.cs-cell.' + (c.activeCampaigns > 0 ? 'warn' : 'info'), {
      on:{click:()=>{ aState.tab = 'campaigns'; aState.selectedCampaignId = null; window.RERENDER_PAGE(mount); }},
    },
      h('div.cs-label', null, 'Active campaigns'),
      h('div.cs-value', null, String(c.activeCampaigns), h('span.cs-unit', null, 'in flight')),
      h('div.cs-sub', null, c.activeCampaigns > 0 ? 'Awaiting recipient submissions' : 'No campaigns running'),
      c.activeCampaigns > 0 ? h('div.cs-link', null, 'Open campaigns tab') : null,
    ));

    // Pending packets
    strip.appendChild(h('div.cs-cell.' + (c.pendingPackets > 0 ? 'warn' : 'info'), {
      on:{click:()=>{ aState.tab = 'campaigns'; aState.selectedCampaignId = null; window.RERENDER_PAGE(mount); }},
    },
      h('div.cs-label', null, 'Pending packets'),
      h('div.cs-value', null, String(c.pendingPackets), h('span.cs-unit', null, 'unsubmitted')),
      h('div.cs-sub', null, c.pendingPackets > 0
        ? 'Across all in-flight campaigns'
        : 'Every recipient has responded'),
      c.pendingPackets > 0 ? h('div.cs-link', null, 'See recipients') : null,
    ));

    // Healthy
    strip.appendChild(h('div.cs-cell.ok', null,
      h('div.cs-label', null, 'Healthy'),
      h('div.cs-value', null, String(c.healthy), h('span.cs-unit', null, c.healthy === 1 ? 'app' : 'apps')),
      h('div.cs-sub', null, 'On schedule · launch-ready · no action needed'),
    ));

    return strip;
  }

  function renderAuditingAppsList(mount) {
    const D = _audData();
    const wrap = h('div', { style:{display:'flex',flexDirection:'column',gap:'18px'} });

    // Top action row — "+ Add application" toggle
    wrap.appendChild(h('div', { style:{display:'flex',justifyContent:'flex-end'} },
      h('button.btn', {
        on:{click:()=>{ aState.showAddAppForm = !aState.showAddAppForm; window.RERENDER_PAGE(mount); }},
      }, aState.showAddAppForm ? 'Cancel' : '+ Add application'),
    ));
    if (aState.showAddAppForm) {
      wrap.appendChild(renderAuditingAddAppForm(mount));
    }

    // Overdue summary — apps past their next-due date and not currently active.
    const overdueApps = D.APPLICATIONS.filter(a => D.getAuditStatus(a.application_id).status === 'overdue');
    if (overdueApps.length) {
      const autoCount = overdueApps.filter(a => a.auto_launch).length;
      const manualCount = overdueApps.length - autoCount;
      wrap.appendChild(h('div.loud-banner.crit', null,
        h('div.lead', null, 'Audits overdue'),
        h('div.msg', { html:
          '<b>' + overdueApps.length + ' application' + (overdueApps.length===1?'':'s') + '</b> past the scheduled audit date. '
          + (autoCount ? autoCount + ' will be picked up by the auto-launch job. ' : '')
          + (manualCount ? manualCount + ' require manual launch from this page.' : '')
        }),
      ));
    }

    // Launch-readiness check per app: in nominees mode, refuses if zero enabled
    // nominees; in line_manager mode, warns if a high proportion of subjects
    // have no resolvable manager (and the business_owner fallback wouldn't catch them).
    const notReady = D.APPLICATIONS.filter(a => {
      if (a.audit_routing_mode === 'nominees') {
        return D.getNomineesOfApp(a.application_id).filter(n => n.enabled).length === 0;
      }
      return false;
    });
    if (notReady.length) {
      wrap.appendChild(h('div.loud-banner.warn', null,
        h('div.lead', null, 'Routing not ready'),
        h('div.msg', { html: '<b>' + notReady.length + ' application' + (notReady.length===1?'':'s') + '</b> in nominees mode have zero enabled nominees configured. Campaigns cannot be launched until at least one nominee is added.' }),
      ));
    }

    const tblWrap = h('div.table-wrap');
    const tbl = h('table.op');
    tbl.appendChild(h('thead', null, h('tr', null,
      h('th', null, 'Application'),
      h('th', null, 'Business owner'),
      h('th', null, 'Bound groups'),
      h('th.num', null, 'Members'),
      h('th', null, 'Routing'),
      h('th', null, 'Cadence'),
      h('th.num', null, 'Due (d)'),
      h('th', null, 'Last audit'),
      h('th', null, 'Next due'),
      h('th', null, 'Auto'),
      h('th', null, ''),
    )));
    const tb = h('tbody');
    for (const app of D.APPLICATIONS) {
      const totalMembers = new Set();
      app.bindings.forEach(dn => {
        D.getMembersOfGroup(dn).forEach(u => totalMembers.add(u.sam));
      });
      const bo = D.getUser(app.business_owner);
      const chips = h('div', { style:{display:'flex',flexWrap:'wrap',gap:'4px'} },
        ...app.bindings.map(dn => h('span.chip.neutral', null, _shortGroup(dn))));

      const status = D.getAuditStatus(app.application_id);
      const lastAudit = D.getLastAuditDate(app.application_id);
      const nextDue = D.getNextAuditDue(app.application_id);
      const cadence = app.audit_frequency_months
        ? (app.audit_frequency_months === 6 ? '6-monthly' : app.audit_frequency_months === 12 ? 'Annual' : app.audit_frequency_months + ' months')
        : '—';

      // Routing summary cell
      let routingCell;
      if (app.audit_routing_mode === 'nominees') {
        const noms = D.getNomineesOfApp(app.application_id);
        const enabled = noms.filter(n => n.enabled).length;
        routingCell = h('span', { style:{display:'inline-flex',alignItems:'center',gap:'6px'} },
          h('span.chip.neutral', null, 'Nominees'),
          h('span', { style:{fontFamily:'var(--mono)',fontSize:'11px',color: enabled === 0 ? 'var(--crit)' : 'var(--ink-3)'} },
            enabled + ' enabled' + (enabled !== noms.length ? ' / ' + noms.length : '')),
        );
      } else {
        const buckets = D.getSubjectsByManager(app.application_id);
        const realMgrs = Object.keys(buckets).filter(k => !k.startsWith('__fallback__')).length;
        const hasFallback = Object.keys(buckets).some(k => k.startsWith('__fallback__'));
        routingCell = h('span', { style:{display:'inline-flex',alignItems:'center',gap:'6px'} },
          h('span.chip.neutral', null, 'Line mgr'),
          h('span', { style:{fontFamily:'var(--mono)',fontSize:'11px',color:'var(--ink-3)'} },
            realMgrs + ' mgr' + (realMgrs === 1 ? '' : 's') + (hasFallback ? ' + fb' : '')),
        );
      }

      let nextDueCell;
      if (status.status === 'active') {
        nextDueCell = h('span.chip.warn', null, h('span.dot'), 'In flight');
      } else if (status.status === 'never') {
        nextDueCell = h('span', { style:{fontFamily:'var(--mono)',fontSize:'11.5px',color:'var(--ink-3)'} }, 'Never audited');
      } else if (status.status === 'overdue') {
        nextDueCell = h('span.chip.crit', null, h('span.dot'), Math.abs(status.daysUntilDue) + 'd overdue');
      } else if (status.status === 'due_soon') {
        nextDueCell = h('span.chip.warn', null, h('span.dot'), 'Due in ' + status.daysUntilDue + 'd');
      } else {
        nextDueCell = h('span', { style:{fontFamily:'var(--mono)',fontSize:'11.5px',color:'var(--ink-2)'} },
          _fmtDate(nextDue),
          h('span', { style:{color:'var(--ink-4)',marginLeft:'6px'} }, '(' + status.daysUntilDue + 'd)'),
        );
      }

      const autoCell = app.auto_launch
        ? h('span.chip.ok', null, h('span.dot'), 'On')
        : h('span', { style:{fontFamily:'var(--mono)',fontSize:'11px',color:'var(--ink-3)'} }, 'Manual');

      const sevCls = status.status === 'overdue' ? '.sev-crit' : status.status === 'due_soon' ? '.sev-warn' : '';

      tb.appendChild(h('tr'+sevCls, {
        on:{click:()=>{ aState.selectedAppId = app.application_id; window.RERENDER_PAGE(mount); }},
        style:{cursor:'pointer'},
      },
        h('td.host', null, app.name),
        h('td', null, bo ? bo.display : app.business_owner || '—'),
        h('td', null, chips),
        h('td.num', null, String(totalMembers.size)),
        h('td', null, routingCell),
        h('td.mono.muted', null, cadence),
        h('td.num.mono', null, String(app.audit_due_period_days || 21)),
        h('td.mono.muted', null, lastAudit ? _fmtDate(lastAudit) : '—'),
        h('td', null, nextDueCell),
        h('td', null, autoCell),
        h('td', null, h('span', { style:{color:'var(--ink-3)',fontFamily:'var(--mono)',fontSize:'11px'} }, 'View →')),
      ));
    }
    tbl.appendChild(tb);
    tblWrap.appendChild(tbl);
    wrap.appendChild(tblWrap);

    return wrap;
  }

  function renderAuditingAppDetail(mount) {
    const D = _audData();
    const app = D.getApp(aState.selectedAppId);
    const wrap = h('div', { style:{display:'flex',flexDirection:'column',gap:'18px'} });
    if (!app) {
      wrap.appendChild(h('div', null, 'Application not found.'));
      return wrap;
    }

    wrap.appendChild(h('div', { style:{display:'flex',alignItems:'center',gap:'12px'} },
      h('button.tab', { on:{click:()=>{ aState.selectedAppId=null; window.RERENDER_PAGE(mount); }}}, '← Back to applications'),
      h('span', { style:{fontFamily:'var(--display)',fontSize:'22px',color:'var(--ink)'} }, app.name),
    ));

    const meta = h('div', { style:{display:'flex',flexWrap:'wrap',gap:'20px',fontFamily:'var(--mono)',fontSize:'11.5px',color:'var(--ink-2)'} },
      h('span', null, 'Business owner: ', h('b', { style:{color:'var(--ink)'} }, (D.getUser(app.business_owner) || {}).display || '—')),
      h('span', null, 'Technical owner: ', h('b', { style:{color:'var(--ink)'} }, (D.getUser(app.technical_owner) || {}).display || '—')),
      h('span', null, 'Support: ', h('b', { style:{color:'var(--ink)'} }, app.support_email || '—')),
    );
    wrap.appendChild(meta);

    // Attestation routing panel (line manager vs nominees)
    wrap.appendChild(renderAuditingAppRouting(mount, app));

    // Audit cadence & automation panel
    wrap.appendChild(renderAuditingAppCadence(mount, app));

    // Audit history (past campaigns)
    wrap.appendChild(renderAuditingAppHistory(mount, app));

    // Bound groups section header + "Bind a group" control
    wrap.appendChild(renderAuditingAppBindingControls(mount, app));

    // Per-group panel: members + owners (informational only — managedBy is
    // no longer used for routing as of 2026-05-29 routing-model change).
    for (const dn of app.bindings) {
      const group = D.getGroup(dn);
      const members = D.getMembersOfGroup(dn);
      const owners = D.getOwnersOfGroup(dn);
      const panel = h('div', { style:{border:'1px solid var(--rule)',background:'var(--card)',padding:'18px 20px',display:'flex',flexDirection:'column',gap:'10px'} });
      panel.appendChild(h('div', { style:{display:'flex',alignItems:'center',gap:'12px',flexWrap:'wrap'} },
        h('span', { style:{fontFamily:'var(--mono)',fontSize:'12px',letterSpacing:'.08em',textTransform:'uppercase',color:'var(--ink)'} }, _shortGroup(dn)),
        h('span.chip.neutral', null, (group && group.type) || 'Security'),
        h('span', { style:{color:'var(--ink-3)',fontFamily:'var(--mono)',fontSize:'11px'} }, members.length + ' member' + (members.length === 1 ? '' : 's')),
        owners.length === 0
          ? h('span.chip.neutral', null, 'No managedBy set')
          : h('span.chip.neutral', null, owners.length + ' owner' + (owners.length === 1 ? '' : 's') + ' (info only)'),
        h('button', {
          style:{marginLeft:'auto',padding:'4px 10px',background:'transparent',border:'1px solid var(--rule)',color:'var(--ink-3)',cursor:'pointer',fontFamily:'var(--mono)',fontSize:'10.5px',letterSpacing:'.06em',textTransform:'uppercase'},
          on:{click:()=>{
            const i = app.bindings.indexOf(dn);
            if (i >= 0) app.bindings.splice(i, 1);
            window.RERENDER_PAGE(mount);
          }},
        }, 'Remove binding'),
      ));

      // Owners list — informational only
      if (owners.length) {
        const ownerLine = h('div', { style:{fontFamily:'var(--mono)',fontSize:'11.5px',color:'var(--ink-3)'} },
          'Managed by (info only — not used for routing): ',
          ...owners.flatMap((o, i) => [
            i > 0 ? h('span', { style:{color:'var(--ink-4)'} }, ' · ') : null,
            h('b', { style:{color:'var(--ink-2)'} }, o.display || o.owner_sam),
          ]),
        );
        panel.appendChild(ownerLine);
      }

      // Members table
      const mtbl = h('table.op');
      mtbl.appendChild(h('thead', null, h('tr', null,
        h('th', null, 'Display name'),
        h('th', null, 'Sam'),
        h('th', null, 'Email'),
        h('th', null, 'Status'),
      )));
      const mtb = h('tbody');
      if (!members.length) {
        mtb.appendChild(h('tr', null, h('td', { colspan: 4, style:{padding:'12px',color:'var(--ink-3)',fontFamily:'var(--mono)',fontSize:'11px',textAlign:'center'} }, 'No members.')));
      } else {
        for (const u of members) {
          mtb.appendChild(h('tr', null,
            h('td.host', null, u.display),
            h('td.mono.muted', null, u.sam),
            h('td.muted', null, u.email),
            h('td', null, u.enabled ? h('span.chip.ok', null, 'Enabled') : h('span.chip.crit', null, 'Disabled')),
          ));
        }
      }
      mtbl.appendChild(mtb);
      panel.appendChild(h('div.table-wrap', null, mtbl));

      wrap.appendChild(panel);
    }

    return wrap;
  }

  function renderAuditingAppBindingControls(mount, app) {
    const wrap = h('div', { style:{display:'flex',flexDirection:'column',gap:'10px'} });
    wrap.appendChild(h('div', { style:{display:'flex',alignItems:'center',gap:'12px'} },
      h('span', { style:{fontFamily:'var(--mono)',fontSize:'10px',letterSpacing:'.12em',textTransform:'uppercase',color:'var(--ink-3)'} }, 'Bound AD groups'),
      h('span', { style:{fontFamily:'var(--mono)',fontSize:'11px',color:'var(--ink-3)'} }, app.bindings.length + ' bound'),
    ));

    // Per-app search state (keyed so multiple apps don't clobber each other)
    const stateKey = 'app-' + app.application_id;
    if (!renderAuditingAppBindingControls._s) renderAuditingAppBindingControls._s = {};
    if (!renderAuditingAppBindingControls._s[stateKey]) renderAuditingAppBindingControls._s[stateKey] = { q: '' };
    const s = renderAuditingAppBindingControls._s[stateKey];

    wrap.appendChild(_renderGroupNameSearch(mount, s, app.bindings, (dn) => {
      if (!app.bindings.includes(dn)) app.bindings.push(dn);
      s.q = '';
    }));
    return wrap;
  }

  // Shared group-name search picker — used by both Add-app form and the
  // existing-app binding controls. Phase 0 filters the fixture; Phase 1 will
  // call GET /api/auditing/ad-groups/search?q=... which hits LDAP live.
  // Args: searchState ({q:string}), alreadyBoundDNs (string[]), onBind(dn).
  function _renderGroupNameSearch(mount, searchState, alreadyBoundDNs, onBind) {
    const D = _audData();
    const inputStyle = { padding:'8px 10px',border:'1px solid var(--rule)',background:'var(--card)',fontFamily:'inherit',fontSize:'12.5px',color:'var(--ink)' };
    const q = (searchState.q || '').trim().toLowerCase();
    const matches = q
      ? D.GROUPS.filter(g => !alreadyBoundDNs.includes(g.dn) && g.sam.toLowerCase().includes(q)).slice(0, 8)
      : [];

    const wrap = h('div', { style:{display:'flex',flexDirection:'column',gap:'4px'} });

    wrap.appendChild(h('div', { style:{display:'flex',gap:'8px',alignItems:'center'} },
      h('input', {
        type:'text', placeholder:'Search AD group name (e.g. APP-Tableau)',
        style: Object.assign({}, inputStyle, { flex:'1' }),
        value: searchState.q || '',
        on:{input:(e)=>{ searchState.q = e.target.value; window.RERENDER_PAGE(mount); }},
      }),
      h('span', { style:{fontFamily:'var(--mono)',fontSize:'10.5px',color:'var(--ink-3)'} },
        q ? 'live AD search would query here' : 'live AD search'),
    ));

    if (q) {
      const results = h('div', { style:{border:'1px solid var(--rule)',background:'var(--card)',maxHeight:'180px',overflowY:'auto'} });
      if (!matches.length) {
        results.appendChild(h('div', { style:{padding:'10px 12px',fontFamily:'var(--mono)',fontSize:'11.5px',color:'var(--ink-3)',fontStyle:'italic'} },
          'No matching groups in the demo fixture. In production, the live AD search would query Active Directory for "', h('b', { style:{color:'var(--ink-2)'} }, searchState.q), '".'));
      } else {
        matches.forEach(g => {
          const row = h('div', {
            style:{display:'flex',gap:'10px',alignItems:'center',padding:'8px 12px',cursor:'pointer',borderBottom:'1px solid var(--rule)',fontFamily:'var(--mono)',fontSize:'11.5px'},
            on:{
              click:()=>{ onBind(g.dn); window.RERENDER_PAGE(mount); },
              mouseenter:(e)=>{ e.currentTarget.style.background = 'var(--paper-2)'; },
              mouseleave:(e)=>{ e.currentTarget.style.background = 'transparent'; },
            },
          },
            h('b', { style:{color:'var(--ink)'} }, g.sam),
            h('span.chip.neutral', null, g.type),
            h('span', { style:{color:'var(--ink-4)',fontSize:'10.5px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',flex:'1'} }, g.dn),
            h('span', { style:{color:'var(--signal)',fontFamily:'var(--mono)',fontSize:'10.5px',letterSpacing:'.06em',textTransform:'uppercase'} }, '+ Bind'),
          );
          results.appendChild(row);
        });
      }
      wrap.appendChild(results);
    }

    return wrap;
  }

  function renderAuditingAppRouting(mount, app) {
    const D = _audData();
    const isLineManager = app.audit_routing_mode === 'line_manager';
    const isNominees    = app.audit_routing_mode === 'nominees';

    const panel = h('div', { style:{border:'1px solid var(--rule)',background:'var(--card)',padding:'18px 20px',display:'flex',flexDirection:'column',gap:'14px'} });
    panel.appendChild(h('div', { style:{display:'flex',alignItems:'center',gap:'12px'} },
      h('span', { style:{fontFamily:'var(--mono)',fontSize:'10px',letterSpacing:'.12em',textTransform:'uppercase',color:'var(--ink-3)'} }, 'Attestation routing'),
      isLineManager
        ? h('span.chip.neutral', null, 'Line manager mode')
        : h('span.chip.neutral', null, 'Nominees mode'),
    ));

    // Mode toggle
    const toggle = h('div', { style:{display:'flex',gap:'8px',padding:'2px',border:'1px solid var(--rule)',background:'var(--paper-2)',width:'fit-content'} });
    const mkOpt = (mode, label) => {
      const on = app.audit_routing_mode === mode;
      return h('button', {
        style:{padding:'8px 16px',border:'none',background: on ? 'var(--ink)' : 'transparent',color: on ? 'var(--paper)' : 'var(--ink-2)',cursor:'pointer',fontFamily:'var(--mono)',fontSize:'11px',letterSpacing:'.08em',textTransform:'uppercase',fontWeight:'600'},
        on:{click:()=>{ app.audit_routing_mode = mode; window.RERENDER_PAGE(mount); }},
      }, label);
    };
    toggle.appendChild(mkOpt('line_manager', 'Line manager'));
    toggle.appendChild(mkOpt('nominees', 'Nominees'));
    panel.appendChild(toggle);

    if (isLineManager) {
      // Show subjects-by-manager breakdown
      const buckets = D.getSubjectsByManager(app.application_id);
      const bucketKeys = Object.keys(buckets);
      const totalSubjects = bucketKeys.reduce((n, k) => n + buckets[k].subjects.length, 0);
      const realManagers = bucketKeys.filter(k => !k.startsWith('__fallback__')).length;
      const fallbackBucket = bucketKeys.find(k => k.startsWith('__fallback__'));

      panel.appendChild(h('div', { style:{fontFamily:'var(--mono)',fontSize:'12px',color:'var(--ink-2)',lineHeight:'1.55'} },
        h('b', { style:{color:'var(--ink)'} }, String(totalSubjects)), ' subject' + (totalSubjects === 1 ? '' : 's'),
        ' across ', h('b', { style:{color:'var(--ink)'} }, String(app.bindings.length)), ' bound group' + (app.bindings.length === 1 ? '' : 's'),
        ' → ', h('b', { style:{color:'var(--ink)'} }, String(realManagers)), ' manager packet' + (realManagers === 1 ? '' : 's'),
        fallbackBucket ? h('span', { style:{color:'var(--warn)'} }, ' + 1 fallback packet (subjects with no manager_sam)') : null,
      ));

      const list = h('div', { style:{display:'flex',flexDirection:'column',gap:'4px'} });
      bucketKeys.forEach(k => {
        const b = buckets[k];
        const isFallback = !!b.is_fallback;
        list.appendChild(h('div', { style:{display:'flex',gap:'10px',alignItems:'center',fontFamily:'var(--mono)',fontSize:'11.5px',padding:'6px 10px',background: isFallback ? 'var(--warn-wash)' : 'var(--paper-2)',border:'1px solid var(--rule)'} },
          isFallback
            ? h('span.chip.warn', null, 'Fallback')
            : h('span.chip.neutral', null, 'Manager'),
          h('b', { style:{color:'var(--ink)'} }, b.manager ? b.manager.display : '— no recipient —'),
          h('span', { style:{color:'var(--ink-3)'} }, '→ ', h('b', { style:{color:'var(--ink-2)'} }, String(b.subjects.length)), ' subject' + (b.subjects.length === 1 ? '' : 's')),
          isFallback ? h('span', { style:{color:'var(--ink-3)',fontSize:'10.5px'} }, '(business_owner — subjects had no manager_sam)') : null,
        ));
      });
      panel.appendChild(list);

      panel.appendChild(h('div', { style:{fontFamily:'var(--mono)',fontSize:'11px',color:'var(--ink-3)',lineHeight:'1.55',borderTop:'1px solid var(--rule)',paddingTop:'10px'} },
        'On launch, each manager receives one email listing only their direct reports in this app. ',
        'Phase 1: subject lookup runs at launch time so the packets snapshot exactly who was in scope.',
      ));
    } else if (isNominees) {
      const nominees = D.getNomineesOfApp(app.application_id);
      const enabledCount = nominees.filter(n => n.enabled).length;
      panel.appendChild(h('div', { style:{fontFamily:'var(--mono)',fontSize:'12px',color:'var(--ink-2)',lineHeight:'1.55'} },
        h('b', { style:{color:'var(--ink)'} }, String(nominees.length)), ' nominee' + (nominees.length === 1 ? '' : 's'),
        ' configured · ', h('b', { style:{color: enabledCount === nominees.length ? 'var(--ink)' : 'var(--warn)'} }, String(enabledCount)), ' enabled.',
        ' ANY one nominee submission closes the campaign.',
      ));

      const list = h('div', { style:{display:'flex',flexDirection:'column',gap:'6px'} });
      if (!nominees.length) {
        list.appendChild(h('div', { style:{padding:'12px',border:'1px dashed var(--rule)',fontFamily:'var(--mono)',fontSize:'11.5px',color:'var(--crit)',textAlign:'center'} },
          'No nominees configured. Add at least one before launching a campaign.'));
      } else {
        nominees.forEach((n, idx) => {
          list.appendChild(h('div', { style:{display:'flex',gap:'10px',alignItems:'center',fontFamily:'var(--mono)',fontSize:'11.5px',padding:'8px 12px',background:'var(--paper-2)',border:'1px solid var(--rule)'} },
            h('b', { style:{color:'var(--ink)'} }, n.display || n.nominee_sam),
            h('span', { style:{color:'var(--ink-3)'} }, n.role_note ? '· ' + n.role_note : ''),
            n.enabled
              ? h('span.chip.ok', null, h('span.dot'), 'Enabled')
              : h('span.chip.crit', null, h('span.dot'), 'Disabled in AD'),
            h('button', {
              style:{marginLeft:'auto',padding:'4px 10px',background:'transparent',border:'1px solid var(--rule)',color:'var(--ink-3)',cursor:'pointer',fontFamily:'var(--mono)',fontSize:'10.5px',letterSpacing:'.06em',textTransform:'uppercase'},
              on:{click:()=>{ app.nominees.splice(idx, 1); window.RERENDER_PAGE(mount); }},
            }, 'Remove'),
          ));
        });
      }
      panel.appendChild(list);

      // Add nominee form
      const addState = renderAuditingAppRouting._addState || (renderAuditingAppRouting._addState = {});
      const k = 'app-' + app.application_id;
      if (!addState[k]) addState[k] = { sam: '', role: '' };
      const s = addState[k];

      panel.appendChild(h('div', { style:{display:'flex',gap:'8px',alignItems:'center',marginTop:'4px'} },
        h('select', {
          style:{padding:'7px 9px',border:'1px solid var(--rule)',background:'var(--card)',fontFamily:'inherit',fontSize:'12.5px',flex:'1'},
          on:{change:(e)=>{ s.sam = e.target.value; }},
        },
          h('option', { value:'' }, '— Pick a person —'),
          ...D.USERS.filter(u => !app.nominees.some(n => n.nominee_sam === u.sam)).map(u =>
            h('option', { value: u.sam, selected: s.sam === u.sam }, u.display + ' (' + u.sam + ')')),
        ),
        h('input', {
          'data-fk':'aud-nom-role-'+app.application_id,
          type:'text', placeholder:'Role note (e.g. Tech owner)', value: s.role,
          style:{padding:'7px 9px',border:'1px solid var(--rule)',background:'var(--card)',fontFamily:'inherit',fontSize:'12.5px',flex:'1'},
          on:{input:(e)=>{ s.role = e.target.value; }},
        }),
        h('button.btn', {
          style: s.sam ? null : { opacity: 0.5, cursor:'not-allowed' },
          on:{click:()=>{
            if (!s.sam) return;
            app.nominees.push({ nominee_sam: s.sam, role_note: s.role });
            s.sam = ''; s.role = '';
            window.RERENDER_PAGE(mount);
          }},
        }, 'Add nominee'),
      ));

      panel.appendChild(h('div', { style:{fontFamily:'var(--mono)',fontSize:'11px',color:'var(--ink-3)',lineHeight:'1.55',borderTop:'1px solid var(--rule)',paddingTop:'10px'} },
        'On launch, each nominee gets their OWN email with the full roster. ',
        'First nominee to submit closes the campaign; the rest see a read-only banner.',
      ));
    }

    return panel;
  }

  function renderAuditingAppCadence(mount, app) {
    const D = _audData();
    const status = D.getAuditStatus(app.application_id);
    const lastAudit = D.getLastAuditDate(app.application_id);
    const nextDue = D.getNextAuditDue(app.application_id);

    const panel = h('div', { style:{border:'1px solid var(--rule)',background:'var(--card)',padding:'18px 20px',display:'flex',flexDirection:'column',gap:'14px'} });
    panel.appendChild(h('div', { style:{display:'flex',alignItems:'center',gap:'12px'} },
      h('span', { style:{fontFamily:'var(--mono)',fontSize:'10px',letterSpacing:'.12em',textTransform:'uppercase',color:'var(--ink-3)'} }, 'Audit schedule'),
      status.status === 'overdue'
        ? h('span.chip.crit', null, h('span.dot'), 'Overdue by ' + Math.abs(status.daysUntilDue) + ' days')
        : status.status === 'due_soon'
        ? h('span.chip.warn', null, h('span.dot'), 'Due in ' + status.daysUntilDue + ' days')
        : status.status === 'active'
        ? h('span.chip.warn', null, h('span.dot'), 'Campaign in flight')
        : status.status === 'never'
        ? h('span.chip.neutral', null, 'Never audited')
        : h('span.chip.ok', null, h('span.dot'), 'On schedule'),
    ));

    const grid = h('div', { style:{display:'grid',gridTemplateColumns:'repeat(auto-fit, minmax(220px, 1fr))',gap:'18px'} });

    // Cadence selector
    const cadenceCol = h('div', { style:{display:'flex',flexDirection:'column',gap:'6px'} },
      h('span', { style:{fontFamily:'var(--mono)',fontSize:'10px',letterSpacing:'.1em',textTransform:'uppercase',color:'var(--ink-3)'} }, 'Cadence'),
      h('select', {
        'data-fk':'audit-cadence-' + app.application_id,
        style:{padding:'8px 10px',border:'1px solid var(--rule)',background:'var(--card)',fontFamily:'inherit',fontSize:'13px'},
        value: String(app.audit_frequency_months || 12),
        on:{change:(e)=>{ app.audit_frequency_months = parseInt(e.target.value, 10); window.RERENDER_PAGE(mount); }},
      },
        h('option', { value: '6',  selected: app.audit_frequency_months === 6  }, 'Every 6 months'),
        h('option', { value: '12', selected: app.audit_frequency_months === 12 }, 'Annual (12 months)'),
        h('option', { value: '24', selected: app.audit_frequency_months === 24 }, 'Every 2 years'),
      ),
    );
    grid.appendChild(cadenceCol);

    // Auto-launch toggle
    const autoCol = h('div', { style:{display:'flex',flexDirection:'column',gap:'6px'} },
      h('span', { style:{fontFamily:'var(--mono)',fontSize:'10px',letterSpacing:'.1em',textTransform:'uppercase',color:'var(--ink-3)'} }, 'Automation'),
      h('label', { style:{display:'flex',alignItems:'center',gap:'10px',cursor:'pointer',padding:'8px 10px',border:'1px solid var(--rule)',background:'var(--card)'} },
        h('input', { type:'checkbox', checked: !!app.auto_launch,
          on:{change:(e)=>{ app.auto_launch = e.target.checked; window.RERENDER_PAGE(mount); }},
        }),
        h('span', { style:{fontFamily:'var(--mono)',fontSize:'12px'} },
          app.auto_launch ? 'Auto-launch on due date' : 'Manual launch only'),
      ),
    );
    grid.appendChild(autoCol);

    // Audit due period (days) — campaign due_at = launched_at + this many days
    const duePeriodCol = h('div', { style:{display:'flex',flexDirection:'column',gap:'6px'} },
      h('span', { style:{fontFamily:'var(--mono)',fontSize:'10px',letterSpacing:'.1em',textTransform:'uppercase',color:'var(--ink-3)'} }, 'Due period (days)'),
      h('input', {
        'data-fk':'audit-due-' + app.application_id,
        type:'number', min:'1', max:'120',
        style:{padding:'8px 10px',border:'1px solid var(--rule)',background:'var(--card)',fontFamily:'inherit',fontSize:'13px'},
        value: String(app.audit_due_period_days || 21),
        on:{input:(e)=>{ app.audit_due_period_days = parseInt(e.target.value, 10) || 21; }},
      }),
      app.audit_due_period_days <= 7
        ? h('span', { style:{fontFamily:'var(--mono)',fontSize:'10.5px',color:'var(--warn)'} }, '7-day reminder will be suppressed')
        : h('span', { style:{fontFamily:'var(--mono)',fontSize:'10.5px',color:'var(--ink-3)'} }, 'Reminder fires 7 days before due'),
    );
    grid.appendChild(duePeriodCol);

    // Last audit
    grid.appendChild(h('div', { style:{display:'flex',flexDirection:'column',gap:'6px'} },
      h('span', { style:{fontFamily:'var(--mono)',fontSize:'10px',letterSpacing:'.1em',textTransform:'uppercase',color:'var(--ink-3)'} }, 'Last audit'),
      h('span', { style:{fontFamily:'var(--mono)',fontSize:'13px',color:'var(--ink)'} }, lastAudit ? _fmtDate(lastAudit) : 'Never'),
      lastAudit ? h('span', { style:{fontFamily:'var(--mono)',fontSize:'11px',color:'var(--ink-3)'} },
        Math.floor((Date.now() - new Date(lastAudit).getTime()) / 86400000) + ' days ago') : null,
    ));

    // Next due
    grid.appendChild(h('div', { style:{display:'flex',flexDirection:'column',gap:'6px'} },
      h('span', { style:{fontFamily:'var(--mono)',fontSize:'10px',letterSpacing:'.1em',textTransform:'uppercase',color:'var(--ink-3)'} }, 'Next audit due'),
      h('span', { style:{fontFamily:'var(--mono)',fontSize:'13px',color: status.status === 'overdue' ? 'var(--crit)' : 'var(--ink)'} },
        nextDue ? _fmtDate(nextDue) : (status.status === 'never' ? 'After first audit' : '—')),
      status.daysUntilDue != null ? h('span', { style:{fontFamily:'var(--mono)',fontSize:'11px',color: status.status === 'overdue' ? 'var(--crit)' : 'var(--ink-3)'} },
        status.daysUntilDue < 0 ? Math.abs(status.daysUntilDue) + ' days overdue' : 'in ' + status.daysUntilDue + ' days') : null,
    ));

    panel.appendChild(grid);

    panel.appendChild(h('div', { style:{fontFamily:'var(--mono)',fontSize:'11px',color:'var(--ink-3)',lineHeight:'1.55',borderTop:'1px solid var(--rule)',paddingTop:'10px'} },
      app.auto_launch
        ? 'When the next-due date is reached, the audit will be launched automatically using the routing mode configured above. (Phase 1: BackgroundService nightly tick.)'
        : 'You will need to manually launch the next audit from the Campaigns tab when due. Enable Auto-launch above to have the system kick it off automatically using the configured routing mode.',
    ));

    return panel;
  }

  function renderAuditingAppHistory(mount, app) {
    const D = _audData();
    const history = D.getAuditHistory(app.application_id);
    const panel = h('div', { style:{display:'flex',flexDirection:'column',gap:'10px'} });
    panel.appendChild(h('div', { style:{display:'flex',alignItems:'center',gap:'12px'} },
      h('span', { style:{fontFamily:'var(--mono)',fontSize:'10px',letterSpacing:'.12em',textTransform:'uppercase',color:'var(--ink-3)'} }, 'Audit history'),
      h('span', { style:{fontFamily:'var(--mono)',fontSize:'11px',color:'var(--ink-3)'} }, history.length + ' campaign' + (history.length === 1 ? '' : 's')),
    ));

    if (!history.length) {
      panel.appendChild(h('div', { style:{padding:'18px',border:'1px dashed var(--rule)',fontFamily:'var(--mono)',fontSize:'11.5px',color:'var(--ink-3)',textAlign:'center'} },
        'No audit campaigns have been run for this application yet.'));
      return panel;
    }

    const tblWrap = h('div.table-wrap');
    const tbl = h('table.op');
    tbl.appendChild(h('thead', null, h('tr', null,
      h('th', null, 'Campaign'),
      h('th', null, 'Status'),
      h('th', null, 'Launch'),
      h('th', null, 'Due'),
      h('th', null, 'Closed'),
      h('th.num', null, 'Outcome'),
      h('th', null, ''),
    )));
    const tb = h('tbody');
    for (const c of history) {
      const summary = D.summarizeCampaignDecisions(c.campaign_id);
      const prog = D.getCampaignProgress(c.campaign_id);
      const statusBadge = c.status === 'active'
        ? h('span.chip.warn', null, h('span.dot'), 'Active')
        : c.status === 'closed'
        ? h('span.chip.ok', null, h('span.dot'), 'Closed')
        : h('span.chip.neutral', null, 'Draft');
      const launchBadge = c.launch_kind === 'auto'
        ? h('span.chip.neutral', null, 'Auto')
        : h('span.chip.neutral', null, 'Manual');
      const outcome = c.status === 'closed'
        ? (summary.total > 0
            ? h('span', { style:{fontFamily:'var(--mono)',fontSize:'11.5px'} },
                h('b', { style:{color:'var(--ok)'} }, String(summary.keep)), ' kept · ',
                h('b', { style:{color:'var(--crit)'} }, String(summary.revoke)), ' revoked')
            : '—')
        : c.status === 'active'
        ? h('span', { style:{fontFamily:'var(--mono)',fontSize:'11.5px',color:'var(--ink-3)'} }, prog.submitted + ' / ' + prog.total + ' submitted')
        : '—';
      tb.appendChild(h('tr', {
        on:{click:()=>{ aState.tab='campaigns'; aState.selectedAppId=null; aState.selectedCampaignId=c.campaign_id; window.RERENDER_PAGE(mount); }},
        style:{cursor:'pointer'},
      },
        h('td.host', null, c.name),
        h('td', null, statusBadge),
        h('td', null, launchBadge),
        h('td.mono.muted', null, _fmtDate(c.due_at)),
        h('td.mono.muted', null, _fmtDate(c.closed_at)),
        h('td.num', null, outcome),
        h('td', null, h('span', { style:{color:'var(--ink-3)',fontFamily:'var(--mono)',fontSize:'11px'} }, 'View →')),
      ));
    }
    tbl.appendChild(tb);
    tblWrap.appendChild(tbl);
    panel.appendChild(tblWrap);

    return panel;
  }

  function renderAuditingCampaignsList(mount) {
    const D = _audData();
    const wrap = h('div', { style:{display:'flex',flexDirection:'column',gap:'18px'} });

    const tblWrap = h('div.table-wrap');
    const tbl = h('table.op');
    tbl.appendChild(h('thead', null, h('tr', null,
      h('th', null, 'Campaign'),
      h('th', null, 'Application'),
      h('th', null, 'Status'),
      h('th', null, 'Due'),
      h('th', null, 'Progress'),
      h('th', null, 'Launched'),
      h('th', null, ''),
    )));
    const tb = h('tbody');
    const campaigns = D.CAMPAIGNS.slice().sort((a,b) => (b.created_at || '').localeCompare(a.created_at || ''));
    for (const c of campaigns) {
      const prog = D.getCampaignProgress(c.campaign_id);
      const statusBadge = c.status === 'active'
        ? h('span.chip.warn', null, h('span.dot'), 'Active')
        : c.status === 'closed'
        ? h('span.chip.ok', null, h('span.dot'), 'Closed')
        : h('span.chip.neutral', null, 'Draft');
      tb.appendChild(h('tr', {
        on:{click:()=>{ aState.selectedCampaignId = c.campaign_id; window.RERENDER_PAGE(mount); }},
        style:{cursor:'pointer'},
      },
        h('td.host', null, c.name),
        h('td', null, c.application_name),
        h('td', null, statusBadge),
        h('td.mono.muted', null, _fmtDate(c.due_at)),
        h('td.mono', null, prog.submitted + ' / ' + prog.total + ' submitted'),
        h('td.mono.muted', null, _fmtDate(c.created_at) + ' by ' + c.created_by),
        h('td', null, h('span', { style:{color:'var(--ink-3)',fontFamily:'var(--mono)',fontSize:'11px'} }, 'View →')),
      ));
    }
    tbl.appendChild(tb);
    tblWrap.appendChild(tbl);
    wrap.appendChild(tblWrap);

    return wrap;
  }

  function renderAuditingCampaignDetail(mount) {
    const D = _audData();
    const c = D.getCampaign(aState.selectedCampaignId);
    const wrap = h('div', { style:{display:'flex',flexDirection:'column',gap:'18px'} });
    if (!c) {
      wrap.appendChild(h('div', null, 'Campaign not found.'));
      return wrap;
    }

    wrap.appendChild(h('div', { style:{display:'flex',alignItems:'center',gap:'12px',flexWrap:'wrap'} },
      h('button.tab', { on:{click:()=>{ aState.selectedCampaignId=null; window.RERENDER_PAGE(mount); }}}, '← Back to campaigns'),
      h('span', { style:{fontFamily:'var(--display)',fontSize:'22px',color:'var(--ink)'} }, c.name),
      c.status === 'active'
        ? h('span.chip.warn', null, h('span.dot'), 'Active')
        : h('span.chip.ok', null, h('span.dot'), 'Closed'),
    ));

    const meta = h('div', { style:{display:'flex',flexWrap:'wrap',gap:'20px',fontFamily:'var(--mono)',fontSize:'11.5px',color:'var(--ink-2)'} },
      h('span', null, 'Application: ', h('b', { style:{color:'var(--ink)'} }, c.application_name)),
      h('span', null, 'Routing: ', h('b', { style:{color:'var(--ink)'} }, c.routing_mode === 'nominees' ? 'Nominees (ANY closes)' : 'Line manager (ALL close)')),
      h('span', null, 'Due: ', h('b', { style:{color:'var(--ink)'} }, _fmtDate(c.due_at))),
      h('span', null, 'Launched: ', h('b', { style:{color:'var(--ink)'} }, _fmtDateTime(c.created_at))),
      h('span', null, 'By: ', h('b', { style:{color:'var(--ink)'} }, c.created_by)),
      c.closed_at ? h('span', null, 'Closed: ', h('b', { style:{color:'var(--ink)'} }, _fmtDateTime(c.closed_at))) : null,
    );
    wrap.appendChild(meta);

    // Nominees-mode + closed: show the "closed by X" closure banner explaining the
    // ANY-closes semantics that left the other packets unsubmitted.
    if (c.status === 'closed' && c.closure_mode === 'any_packet') {
      const closingPkt = D.getClosingPacket(c.campaign_id);
      if (closingPkt) {
        wrap.appendChild(h('div', { style:{padding:'12px 16px',border:'1px solid var(--ok)',background:'var(--ok-wash)',fontFamily:'var(--mono)',fontSize:'12px',color:'var(--ink)'} },
          'Closed by ', h('b', null, closingPkt.submitted_by_display),
          ' on ', _fmtDateTime(closingPkt.submitted_at), '. Other nominees\' tokens still resolve but show a read-only banner with these decisions.'));
      }
    }

    // Active line_manager mode: show "waiting on N managers" so the closure
    // rule is visible — campaign won't close until every packet is in.
    if (c.status === 'active' && c.closure_mode === 'all_packets') {
      const allPackets = D.getPacketsOfCampaign(c.campaign_id);
      const pending = allPackets.filter(p => !p.submitted_at);
      const submitted = allPackets.length - pending.length;
      wrap.appendChild(h('div', { style:{padding:'12px 16px',border:'1px solid var(--warn)',background:'var(--warn-wash)',fontFamily:'var(--mono)',fontSize:'12px',color:'var(--ink)',display:'flex',flexDirection:'column',gap:'4px'} },
        h('div', null,
          h('b', null, String(submitted) + ' / ' + allPackets.length),
          ' packets submitted. Campaign closes only when every line manager has responded.'),
        pending.length
          ? h('div', { style:{color:'var(--ink-2)'} },
              'Waiting on: ',
              h('b', null, pending.map(p => p.recipient_display).join(', ')))
          : h('div', { style:{color:'var(--ok)'} }, 'All packets in — campaign should be auto-closing on the next tick.'),
      ));
    }

    const tblWrap = h('div.table-wrap');
    const tbl = h('table.op');
    tbl.appendChild(h('thead', null, h('tr', null,
      h('th', null, 'Recipient'),
      h('th', null, 'Kind'),
      h('th.num', null, 'Subjects'),
      h('th', null, 'Status'),
      h('th', null, 'Submitted by'),
      h('th', null, 'Submitted at'),
      h('th.num', null, 'Decisions'),
      h('th', null, 'Reminder'),
      h('th', null, 'Token'),
    )));
    const tb = h('tbody');
    const packets = D.getPacketsOfCampaign(c.campaign_id);
    for (const p of packets) {
      const submitted = !!p.submitted_at;
      const summary = D.summarizeDecisions(p.packet_id);
      // sev: in line_manager mode, unsubmitted packets are warn (still need action)
      // In nominees mode where campaign is already closed, leave neutral
      const isClosedByOther = c.status === 'closed' && c.closure_mode === 'any_packet' && !submitted;
      const sevRow = submitted ? '' : (isClosedByOther ? '' : '.sev-warn');
      tb.appendChild(h('tr'+sevRow, null,
        h('td.host', null, p.recipient_display + (p.role_note ? h('span', { style:{color:'var(--ink-3)',marginLeft:'8px',fontFamily:'var(--mono)',fontSize:'11px',fontWeight:'normal'} }, '· ' + p.role_note) : '')),
        h('td', null, p.recipient_kind === 'nominee'
          ? h('span.chip.neutral', null, 'Nominee')
          : h('span.chip.neutral', null, 'Manager')),
        h('td.num', null, String((p.subjects || []).length)),
        h('td', null, submitted
          ? h('span.chip.ok', null, h('span.dot'), 'Submitted')
          : isClosedByOther
          ? h('span.chip.neutral', null, 'Closed by other')
          : h('span.chip.warn', null, h('span.dot'), 'Pending')),
        h('td.muted', null, p.submitted_by_display || '—'),
        h('td.mono.muted', null, _fmtDateTime(p.submitted_at)),
        h('td.num', null, submitted ? (summary.keep + ' keep / ' + summary.revoke + ' revoke') : '—'),
        h('td.mono.muted', null, p.reminder_sent_at ? _fmtDate(p.reminder_sent_at) : (c.status === 'active' ? 'Not yet' : '—')),
        h('td', null, h('a', { href:'/attest.html?t=' + encodeURIComponent(p.token), target:'_blank', rel:'noopener',
            style:{fontFamily:'var(--mono)',fontSize:'11px',color:'var(--ink-2)'} }, 'Open link ↗')),
      ));
    }
    tbl.appendChild(tb);
    tblWrap.appendChild(tbl);
    wrap.appendChild(tblWrap);

    // Email log preview — every email that's been sent for this campaign
    wrap.appendChild(renderAuditingCampaignEmailLog(c.campaign_id));

    return wrap;
  }

  function renderAuditingCampaignEmailLog(campaignId) {
    const D = _audData();
    const log = D.getEmailLogForCampaign(campaignId);
    const wrap = h('div', { style:{display:'flex',flexDirection:'column',gap:'10px'} });
    wrap.appendChild(h('div', { style:{display:'flex',alignItems:'center',gap:'10px'} },
      h('span', { style:{fontFamily:'var(--mono)',fontSize:'10px',letterSpacing:'.12em',textTransform:'uppercase',color:'var(--ink-3)'} }, 'Email log'),
      h('span', { style:{fontFamily:'var(--mono)',fontSize:'11px',color:'var(--ink-3)'} }, log.length + ' send' + (log.length === 1 ? '' : 's') + ' recorded'),
    ));
    if (!log.length) {
      wrap.appendChild(h('div', { style:{padding:'12px',border:'1px dashed var(--rule)',fontFamily:'var(--mono)',fontSize:'11.5px',color:'var(--ink-3)',textAlign:'center'} },
        'No emails logged yet for this campaign.'));
      return wrap;
    }
    const tblWrap = h('div.table-wrap');
    const tbl = h('table.op');
    tbl.appendChild(h('thead', null, h('tr', null,
      h('th', null, 'Kind'),
      h('th', null, 'To'),
      h('th', null, 'CC'),
      h('th', null, 'Subject'),
      h('th', null, 'Sent at'),
      h('th', null, 'Result'),
    )));
    const tb = h('tbody');
    log.forEach(e => {
      const kindBadge = e.kind === 'invite'
        ? h('span.chip.neutral', null, 'Invite')
        : e.kind === 'reminder'
        ? h('span.chip.warn', null, h('span.dot'), 'Reminder')
        : h('span.chip.ok', null, 'Closure');
      tb.appendChild(h('tr', null,
        h('td', null, kindBadge),
        h('td.mono', null, e.to_addr),
        h('td.mono.muted', null, e.cc_addr || '—'),
        h('td.muted', null, e.subject),
        h('td.mono.muted', null, _fmtDateTime(e.sent_at)),
        h('td', null, e.success ? h('span.chip.ok', null, 'Delivered') : h('span.chip.crit', null, 'Failed')),
      ));
    });
    tbl.appendChild(tb);
    tblWrap.appendChild(tbl);
    wrap.appendChild(tblWrap);
    return wrap;
  }

  function renderAuditingNewCampaign(mount) {
    const D = _audData();
    const wrap = h('div', { style:{display:'flex',flexDirection:'column',gap:'18px',maxWidth:'720px'} });

    const formState = renderAuditingNewCampaign._s || (renderAuditingNewCampaign._s = {
      application_id: D.APPLICATIONS[0].application_id,
      name: '',
      due_at: '',
      // Routing semantics come from the app config; no per-launch overrides yet.
    });

    wrap.appendChild(h('div', { style:{fontFamily:'var(--mono)',fontSize:'11.5px',color:'var(--ink-2)',lineHeight:'1.55'} },
      'Pick an application and a due date. Phase 0: this form does NOT launch anything — it just shows what the launch UX will look like once the API is wired up.',
    ));

    const fieldStyle = { display:'flex',flexDirection:'column',gap:'6px' };
    const labelStyle = { fontFamily:'var(--mono)',fontSize:'10px',letterSpacing:'.1em',textTransform:'uppercase',color:'var(--ink-3)' };
    const inputStyle = { padding:'8px 10px',border:'1px solid var(--rule)',background:'var(--card)',fontFamily:'inherit',fontSize:'13px',color:'var(--ink)' };

    // Application picker
    wrap.appendChild(h('label', { style: fieldStyle },
      h('span', { style: labelStyle }, 'Application'),
      h('select', { 'data-fk':'audit-new-app', style: inputStyle, value: String(formState.application_id),
        on:{change:(e)=>{ formState.application_id = parseInt(e.target.value, 10); window.RERENDER_PAGE(mount); }},
      }, D.APPLICATIONS.map(a => h('option', { value: String(a.application_id), selected: a.application_id === formState.application_id }, a.name))),
    ));

    // Campaign name
    wrap.appendChild(h('label', { style: fieldStyle },
      h('span', { style: labelStyle }, 'Campaign name'),
      h('input', { 'data-fk':'audit-new-name', type:'text', style: inputStyle, value: formState.name,
        placeholder: 'e.g. 2026-Q2 ' + (D.getApp(formState.application_id) || {}).name + ' access review',
        on:{input:(e)=>{ formState.name = e.target.value; }},
      }),
    ));

    // Due date
    wrap.appendChild(h('label', { style: fieldStyle },
      h('span', { style: labelStyle }, 'Due date'),
      h('input', { 'data-fk':'audit-new-due', type:'date', style: inputStyle, value: formState.due_at,
        on:{input:(e)=>{ formState.due_at = e.target.value; }},
      }),
    ));

    // Launch preview — branches on the selected app's routing_mode.
    const app = D.getApp(formState.application_id);
    let canLaunch = false;
    if (app) {
      const preview = h('div', { style:{border:'1px solid var(--rule)',background:'var(--paper-2)',padding:'14px 16px',display:'flex',flexDirection:'column',gap:'8px'} });
      preview.appendChild(h('div', { style:{display:'flex',alignItems:'center',gap:'10px'} },
        h('span', { style:{fontFamily:'var(--mono)',fontSize:'10px',letterSpacing:'.1em',textTransform:'uppercase',color:'var(--ink-3)'} }, 'Launch preview'),
        app.audit_routing_mode === 'nominees'
          ? h('span.chip.neutral', null, 'Nominees mode — ANY closes')
          : h('span.chip.neutral', null, 'Line manager mode — ALL must submit'),
      ));

      if (app.audit_routing_mode === 'line_manager') {
        const buckets = D.getSubjectsByManager(app.application_id);
        const keys = Object.keys(buckets);
        const realMgrs = keys.filter(k => !k.startsWith('__fallback__'));
        const fallbackKey = keys.find(k => k.startsWith('__fallback__'));
        const totalSubjects = keys.reduce((n, k) => n + buckets[k].subjects.length, 0);
        canLaunch = keys.length > 0 && (!fallbackKey || !!app.business_owner);
        preview.appendChild(h('div', { style:{fontFamily:'var(--mono)',fontSize:'11.5px',color:'var(--ink-2)'} },
          h('b', { style:{color:'var(--ink)'} }, String(totalSubjects)), ' subject' + (totalSubjects === 1 ? '' : 's'),
          ' → ', h('b', { style:{color:'var(--ink)'} }, String(realMgrs.length)), ' manager packet' + (realMgrs.length === 1 ? '' : 's'),
          fallbackKey ? h('span', { style:{color:'var(--warn)'} }, ' + 1 fallback packet (business_owner)') : null,
        ));
        const list = h('div', { style:{display:'flex',flexDirection:'column',gap:'4px',marginTop:'4px'} });
        keys.forEach(k => {
          const b = buckets[k];
          list.appendChild(h('div', { style:{fontFamily:'var(--mono)',fontSize:'11.5px',color:'var(--ink-2)'} },
            b.is_fallback ? h('span', { style:{color:'var(--warn)'} }, '[fallback] ') : null,
            h('b', { style:{color:'var(--ink)'} }, b.manager ? b.manager.display : '— no recipient —'),
            ' → ', String(b.subjects.length), ' subject' + (b.subjects.length === 1 ? '' : 's'),
          ));
        });
        preview.appendChild(list);
      } else {
        // Nominees mode
        const nominees = D.getNomineesOfApp(app.application_id);
        const enabled = nominees.filter(n => n.enabled);
        const roster = D.getAppRoster(app.application_id);
        canLaunch = enabled.length > 0;
        preview.appendChild(h('div', { style:{fontFamily:'var(--mono)',fontSize:'11.5px',color:'var(--ink-2)'} },
          h('b', { style:{color:'var(--ink)'} }, String(enabled.length)), ' nominee packet' + (enabled.length === 1 ? '' : 's'),
          ' · each with full roster of ', h('b', { style:{color:'var(--ink)'} }, String(roster.length)), ' subjects',
        ));
        if (!enabled.length) {
          preview.appendChild(h('div', { style:{fontFamily:'var(--mono)',fontSize:'11.5px',color:'var(--crit)'} },
            'No enabled nominees — cannot launch. Add nominees from the application detail page.'));
        } else {
          const list = h('div', { style:{display:'flex',flexDirection:'column',gap:'4px',marginTop:'4px'} });
          nominees.forEach(n => {
            list.appendChild(h('div', { style:{fontFamily:'var(--mono)',fontSize:'11.5px',color: n.enabled ? 'var(--ink-2)' : 'var(--ink-4)'} },
              h('b', { style:{color: n.enabled ? 'var(--ink)' : 'var(--ink-3)'} }, n.display || n.nominee_sam),
              n.role_note ? ' · ' + n.role_note : '',
              n.enabled ? null : h('span', { style:{color:'var(--crit)',marginLeft:'8px'} }, '(disabled — skipped)'),
            ));
          });
          preview.appendChild(list);
        }
      }

      // Due date + reminder note
      const duePeriod = app.audit_due_period_days || 21;
      preview.appendChild(h('div', { style:{fontFamily:'var(--mono)',fontSize:'11.5px',color:'var(--ink-3)',marginTop:'6px',borderTop:'1px solid var(--rule)',paddingTop:'8px'} },
        'Due ', h('b', { style:{color:'var(--ink-2)'} }, duePeriod + ' days'), ' from launch.',
        duePeriod <= 7
          ? h('span', { style:{color:'var(--warn)'} }, ' Reminder suppressed — due period ≤ 7 days.')
          : ' Reminder fires 7 days before due.',
      ));
      preview.appendChild(h('div', { style:{fontFamily:'var(--mono)',fontSize:'11px',color:'var(--ink-3)'} },
        'CC: ', h('span', { style:{color:'var(--ink-2)'} }, D.CC_AUDIT_MAILBOX),
      ));
      wrap.appendChild(preview);
    }

    // Launch button (demo only)
    const launchBtn = h('button.tab' + (canLaunch ? '.on' : ''), {
      style:{alignSelf:'flex-start',cursor: canLaunch ? 'pointer' : 'not-allowed', opacity: canLaunch ? 1 : 0.5},
      on:{click:()=>{
        if (!canLaunch) return;
        alert('Phase 0 prototype — not actually launching. In Phase 1 this POSTs to /api/auditing/campaigns and sends emails via MailKit, CCing ' + D.CC_AUDIT_MAILBOX + '.');
      }},
    }, 'Launch campaign (demo)');
    wrap.appendChild(launchBtn);

    return wrap;
  }

  // ================================================================
  // Expose
  // ================================================================
  window.RENDER_SERVERS       = renderServersPage;
  window.RENDER_SERVER_DETAIL = renderServerDetailPage;
  window.RENDER_CERTS         = renderCertsPage;
  window.RENDER_EOL           = renderEolPage;
  window.RENDER_PATCHING      = renderPatchingPage;
  window.RENDER_PATCHMGMT     = renderPatchMgmtPage;
  window.RENDER_DISKS         = renderDiskMonitoringPage;
  window.RENDER_AUDITING      = renderAuditingPage;
  window.RENDER_LICENSING     = renderLicensingPage;
})();
