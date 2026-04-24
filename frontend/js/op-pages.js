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

  // Canonical business-unit values — mirrors derive_business_unit() in
  // sync/servers/sync_server_list.py. Used as the dropdown option list on
  // every BU filter across the app.
  const BU_VALUES = [
    'Hiscox UK',
    'UK & I',
    'Hiscox US',
    'Hiscox Europe',
    'Hiscox London Market',
    'Hiscox Re & ILS',
    'Hiscox Group Support',
    'Hiscox Special Risks',
    'ITS',
    'Infosec',
    'Unknown',
  ];

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
    return {
      servers:     Array.isArray(D.servers)     && D.servers.length     ? D.servers     : SRV.servers,
      unreachable: Array.isArray(D.unreachable)                         ? D.unreachable : SRV.unreachable,
      unmatched:   Array.isArray(D.unmatched)                           ? D.unmatched   : SRV.unmatched,
      env,
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
  function eolHostsFor(product, version) {
    const key = product + '@' + version;
    const cached = EOL_HOST_CACHE.get(key);
    if (cached !== undefined) return cached;
    EOL_HOST_CACHE.set(key, 'loading');
    if (window.OC_API && window.OC_API.getEolDetail) {
      window.OC_API.getEolDetail(product, version).then(detail => {
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
    bu: '__all',
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
    if (srvState.bu !== '__all') rows = rows.filter(r => (r.bu || 'Unknown') === srvState.bu);
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

    const envOpts = [['__all','All environments']].concat(live.env.map(e => [e.name, e.name + ' ('+e.count+')']));
    const search = h('input', {'data-fk':'servers-search', 
      type:'text', placeholder:'Search name, FQDN, application, patch group…',
      value: srvState.q,
      on:{input:(e)=>{ srvState.q = e.target.value; srvState.page = 1; window.RERENDER_PAGE(mount); }},
    });
    const envSel = h('select', { on:{change:(e)=>{ srvState.env = e.target.value; srvState.page = 1; window.RERENDER_PAGE(mount); }}},
      envOpts.map(([v,l]) => h('option'+(srvState.env===v?'.on':''), {value:v, selected: srvState.env===v}, l)));
    const buOpts = [['__all','All business units']].concat(BU_VALUES.map(b => [b, b]));
    const buSel = h('select', { on:{change:(e)=>{ srvState.bu = e.target.value; srvState.page = 1; window.RERENDER_PAGE(mount); }}},
      buOpts.map(([v,l]) => h('option', {value:v, selected: srvState.bu===v}, l)));
    const clearBtn = h('button.btn', { on:{click:()=>{ srvState.q=''; srvState.env='__all'; srvState.bu='__all'; srvState.page=1; window.RERENDER_PAGE(mount); }}}, 'Reset');
    const exportBtn = h('button.btn', { on:{click:()=>exportCsv('servers', rows, ['name','fqdn','env','bu','app','pg','active'])}}, 'Export CSV');
    const count = h('span.ct', null, 'Showing ' + (pag.start+1) + '–' + pag.end + ' of ' + rows.length.toLocaleString());
    page.appendChild(filterBar([search, envSel, buSel, clearBtn, h('span.spacer'), count, exportBtn]));

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
        ? h('td', null, h('span.badge.ok', null, h('span.dot'), 'Active'))
        : h('td', null, h('span.badge.crit', null, h('span.dot'), 'Inactive'));
      tbody.appendChild(h('tr'+(r.active?'':'.sev-crit'), null,
        h('td.host', null, mark(r.name, q)),
        h('td.muted', null, mark(r.fqdn, q)),
        h('td', null, h('span.env-tag', null, mark(r.env, q))),
        h('td.muted', null, mark(r.bu || 'Unknown', q)),
        h('td.muted', null, mark(r.app, q)),
        h('td', null, h('span.badge'+(r.pg==='NO PATCH GROUP FOUND'?'.warn':''), null, r.pg==='NO PATCH GROUP FOUND'?null:h('span.dot'), mark(r.pg, q))),
        activeCell,
      ));
    });
    if (paged.length === 0) {
      tbody.appendChild(h('tr', null, h('td', {colspan:7}, h('div.no-hits', null, 'No servers match ', h('b', null, srvState.q || srvState.env || srvState.bu)))));
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
        h('td', null, h('span.env-tag', null, r.env)),
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
  const certState = { q:'', level:'__all', bu:'__all', sort:'days', sortDir:1, page:1, per:20 };

  function applyCertFilters() {
    const q = certState.q.trim().toLowerCase();
    let rows = liveCerts().list;
    if (certState.level !== '__all') rows = rows.filter(r => r.level === certState.level);
    if (certState.bu !== '__all') rows = rows.filter(r => (r.bu || 'Unknown') === certState.bu);
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

  function renderCertsPage(mount) {
    const page = h('div.page');
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
    const buOpts = [['__all','All business units']].concat(BU_VALUES.map(b => [b, b]));
    const buSel = h('select', { on:{change:(e)=>{ certState.bu=e.target.value; certState.page=1; window.RERENDER_PAGE(mount); }}},
      buOpts.map(([v,l]) => h('option', {value:v, selected: certState.bu===v}, l)));
    const q = h('input', {'data-fk':'certs-search', type:'text', placeholder:'Filter by server or service…', value: certState.q,
      on:{input:(e)=>{ certState.q=e.target.value; certState.page=1; window.RERENDER_PAGE(mount); }}});
    const reset = h('button.btn', { on:{click:()=>{ certState.q=''; certState.level='__all'; certState.bu='__all'; certState.page=1; window.RERENDER_PAGE(mount); }}}, 'Reset');
    const exportBtn = h('button.btn', { on:{click:()=>exportCsv('certificates', rows, ['name','server','service','bu','expires','days','level'])}}, 'Export CSV');
    const count = h('span.ct', null, 'Showing ' + (pag.start+1) + '–' + pag.end + ' of ' + rows.length);
    page.appendChild(filterBar([levelSel, buSel, q, reset, h('span.spacer'), count, exportBtn]));

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
    let rows = liveEol().products.slice();
    if (eolState.status !== '__all') rows = rows.filter(r => r.status === eolState.status);
    if (q) {
      rows = rows.filter(r => {
        if (r.product.toLowerCase().includes(q)) return true;
        if (String(r.version).toLowerCase().includes(q)) return true;
        // Match against cached host list for this product. If not loaded
        // yet, skip host-level matching — product-name match still applies.
        const hosts = eolHostsFor(r.product, r.version);
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
    const { products: EOL_PRODUCTS, totals: EOL_TOTALS } = liveEol();

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
      const hostsOrState = eolHostsFor(r.product, r.version);
      const hosts = Array.isArray(hostsOrState) ? hostsOrState : [];
      const isLoading = hostsOrState === 'loading';
      const hostMatches = (qStr && hosts.length) ? hosts.filter(hh => hh.fqdn.includes(qStr) || hh.host.toLowerCase().includes(qStr)) : [];
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
  window.EXCLUSIONS = window.EXCLUSIONS || [
    {id:'EX-0412', server:'PR0604-26002-00', fqdn:'kandr_sanctions.hiscox.com', group:'2A', reason:'Vendor advisory \u2014 pending hotfix', until:'Apr 22, 2026', requester:'a.naidu',   requested:'Mar 28, 2026', state:'expiring-soon'},
    {id:'EX-0411', server:'PR0702-11102-01', fqdn:'alteryx.hiscox.com',         group:'7A', reason:'Application change-freeze',            until:'Apr 20, 2026', requester:'m.kowalski',requested:'Apr 02, 2026', state:'expiring-soon'},
    {id:'EX-0410', server:'PR0605-14001-00', fqdn:'signal.hiscox.de',           group:'5A', reason:'Regulatory window',                     until:'Apr 30, 2026', requester:'j.evans',   requested:'Apr 01, 2026', state:'active'},
    {id:'EX-0406', server:'PR0308-22034-00', fqdn:'app.hiscox.com',             group:'3A', reason:'Customer-facing release period',        until:'Apr 17, 2026', requester:'s.chen',    requested:'Mar 30, 2026', state:'overdue'},
    {id:'EX-0405', server:'PR0308-22035-00', fqdn:'app.hiscox.com',             group:'3A', reason:'Customer-facing release period',        until:'Apr 17, 2026', requester:'s.chen',    requested:'Mar 30, 2026', state:'overdue'},
    {id:'EX-0403', server:'DV0402-11201-02', fqdn:'dv-db.hiscox.com',           group:'4A', reason:'Database migration in-flight',          until:'May 15, 2026', requester:'p.ramirez', requested:'Apr 04, 2026', state:'active'},
    {id:'EX-0402', server:'PR0801-14404-00', fqdn:'thunderhead.hiscox.com',     group:'7B', reason:'Hardware refresh in progress',          until:'May 02, 2026', requester:'k.oduya',   requested:'Apr 01, 2026', state:'active'},
    {id:'EX-0399', server:'PR0604-26003-00', fqdn:'kandr_sanctions.hiscox.com', group:'2A', reason:'Vendor advisory \u2014 pending hotfix', until:'Apr 22, 2026', requester:'a.naidu',   requested:'Mar 28, 2026', state:'expiring-soon'},
    {id:'EX-0397', server:'PR0605-14002-00', fqdn:'signal.hiscox.de',           group:'5A', reason:'Other',                                  until:'Jun 01, 2026', requester:'t.bennett', requested:'Apr 03, 2026', state:'active'},
    {id:'EX-0394', server:'DV0402-11201-03', fqdn:'dv-db.hiscox.com',           group:'4A', reason:'Database migration in-flight',          until:'May 15, 2026', requester:'p.ramirez', requested:'Apr 04, 2026', state:'active'},
    {id:'EX-0388', server:'PR0308-22036-00', fqdn:'app.hiscox.com',             group:'3A', reason:'Customer-facing release period',        until:'Apr 17, 2026', requester:'s.chen',    requested:'Mar 30, 2026', state:'overdue'},
  ];
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
    const PATCH_ISSUES = getPatchIssues();

    // HERO — countdown + cycle meta + group bars
    const hero = h('div.patch-banner', null,
      h('div.countdown', null, h('span.n', null, '3'), h('span.unit', null, 'days')),
      h('div.meta', null,
        h('span.t', null, 'Next Cycle'),
        h('span.d', null, 'April 2026 · begins Apr 23, 2026'),
        h('span.sub', null, getPatchTotal().toLocaleString()+' servers across '
          + (new Set(getPatchGroups().map(g => g.id)).size)+' groups · '
          + (PATCH_ISSUES.filter(i => i.status==='blocking').length>0
              ? PATCH_ISSUES.filter(i => i.status==='blocking').length+' open blocker'
              : 'no open blockers'))),
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
        h('td', null, h('span.badge', null, h('span.dot'), s.pg)),
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
    bu: '__all',
    sort: 'until',
    sortDir: 1,
    page: 1,
    per: 20,
    // add-exclusion wizard
    add: { step: 1, serverQuery: '', selectedServers: [], reason: '', until: '', notes: '', calOffset: 0 },
    // bulk
    bulk: { scope: 'group', group: 'GROUP0', env: 'Production', reason: '', until: '', calOffset: 0 },
  };

  function renderPatchMgmtPage(mount) {
    const page = h('div.page');

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
    if (pmState.bu !== '__all') rows = rows.filter(r => (r.bu || 'Unknown') === pmState.bu);
    if (q) rows = rows.filter(r =>
      r.server.toLowerCase().includes(q) ||
      r.fqdn.toLowerCase().includes(q) ||
      r.reason.toLowerCase().includes(q) ||
      r.requester.toLowerCase().includes(q) ||
      r.group.toLowerCase().includes(q) ||
      (r.bu || '').toLowerCase().includes(q) ||
      r.id.toLowerCase().includes(q));
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

    const stateOpts = [
      ['__all','All states ('+window.EXCLUSIONS.length+')'],
      ['overdue','Overdue ('+(window.EXCL_COUNTS.overdue||0)+')'],
      ['expiring-soon','Expiring soon ('+(window.EXCL_COUNTS['expiring-soon']||0)+')'],
      ['active','Active ('+(window.EXCL_COUNTS.active||0)+')'],
    ];
    const q = h('input', {'data-fk':'patchmgmt-search', type:'text', placeholder:'Filter by server, FQDN, reason, requester…', value: pmState.q,
      on:{input:(e)=>{ pmState.q=e.target.value; pmState.page=1; window.RERENDER_PAGE(mount); }}});
    const stateSel = h('select', { on:{change:(e)=>{ pmState.stateFilter=e.target.value; pmState.page=1; window.RERENDER_PAGE(mount); }}},
      stateOpts.map(([v,l]) => h('option', {value:v, selected: pmState.stateFilter===v}, l)));
    const buOpts = [['__all','All business units']].concat(BU_VALUES.map(b => [b, b]));
    const buSel = h('select', { on:{change:(e)=>{ pmState.bu=e.target.value; pmState.page=1; window.RERENDER_PAGE(mount); }}},
      buOpts.map(([v,l]) => h('option', {value:v, selected: pmState.bu===v}, l)));
    const reset = h('button.btn', { on:{click:()=>{ pmState.q=''; pmState.stateFilter='__all'; pmState.bu='__all'; pmState.page=1; window.RERENDER_PAGE(mount); }}}, 'Reset');
    const addBtn = h('button.btn.primary', { on:{click:()=>{ pmState.tab='add'; window.RERENDER_PAGE(mount); }}}, '+ Add exclusion');
    const count = h('span.ct', null, 'Showing '+(pag.start+1)+'–'+pag.end+' of '+rows.length);
    wrap.appendChild(filterBar([stateSel, buSel, q, reset, h('span.spacer'), count, addBtn]));

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
      sortableTh('fqdn','FQDN'),
      sortableTh('group','Group'),
      sortableTh('bu','Business unit'),
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
        h('td.muted', null, mark(r.fqdn, qq)),
        h('td', null, h('span.badge', null, h('span.dot'), mark(r.group, qq))),
        h('td.muted', null, mark(r.bu || 'Unknown', qq)),
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
    if (paged.length === 0) tbody.appendChild(h('tr', null, h('td', {colspan:10}, h('div.no-hits', null, 'No exclusions match filter'))));
    table.appendChild(tbody);
    tbl.appendChild(table);
    tbl.appendChild(paginationBar(pag, p => { pmState.page=p; window.RERENDER_PAGE(mount); }));
    wrap.appendChild(tbl);
    return wrap;
  }

  // ---------- Calendar date picker ----------
  // Parses values like "Apr 26, 2026" back into a Date (also handles ISO-ish strings).
  function parseUntil(s) {
    if (!s) return null;
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  function fmtUntil(d) {
    return d.toLocaleDateString('en-GB', {day:'numeric', month:'short', year:'numeric'});
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
      stateObj.until = fmtUntil(d);
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

      footer.appendChild(h('button.btn', { on:{click:()=>{ pmState.add.step=1; window.RERENDER_PAGE(mount); }}}, '← Back'));
      const cont = h('button.btn.primary', {
        disabled: !pmState.add.reason,
        style: pmState.add.reason ? null : {opacity:'0.4',cursor:'not-allowed'},
        on:{click:()=>{ if (pmState.add.reason) { pmState.add.step=3; window.RERENDER_PAGE(mount); }}},
      }, 'Next · Hold-until →');
      footer.appendChild(cont);
    }

    if (pmState.add.step === 3) {
      panel.appendChild(h('div', {style:{fontFamily:'var(--display)',fontSize:'22px',letterSpacing:'-0.01em',color:'var(--ink)',fontWeight:'400'}}, 'How long should this hold last?'));
      panel.appendChild(h('div', {style:{fontSize:'13px',color:'var(--ink-2)',maxWidth:'60ch'}}, 'Pick a specific date or one of the common windows. After this date, the server returns to the next scheduled cycle automatically — you\u2019ll see it in Expiring renewals the week before.'));

      const today = new Date(2026, 3, 21); // April 21, 2026 — matches the rest of the prototype
      const fmt = (d) => d.toLocaleDateString('en-GB', {day:'numeric', month:'short', year:'numeric'});
      const presets = [
        {label:'Next week',      days:7},
        {label:'2 weeks',        days:14},
        {label:'This cycle only (until Apr 26)', fixed:'Apr 26, 2026'},
        {label:'1 month',        days:30},
        {label:'Next cycle (May 28)', fixed:'May 28, 2026'},
        {label:'1 quarter',      days:90},
      ];
      const presetGrid = h('div', {style:{display:'grid',gridTemplateColumns:'repeat(3, 1fr)',gap:'8px'}});
      presets.forEach(p => {
        const val = p.fixed || fmt(new Date(today.getTime() + p.days*86400000));
        const isSel = pmState.add.until === val;
        presetGrid.appendChild(h('div', {style:{
          padding:'14px 16px',border:'1px solid var(--rule)',
          background: isSel ? 'var(--signal-wash)' : 'var(--paper-2)',
          borderLeft: isSel ? '3px solid var(--signal)' : '3px solid var(--rule-2)',
          cursor:'pointer',display:'flex',flexDirection:'column',gap:'4px',
        }, on:{click:()=>{ pmState.add.until = val; window.RERENDER_PAGE(mount); }}},
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
      row('Reason',        pmState.add.reason || '—').forEach(x => kv.appendChild(x));
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
        const payload = {
          servers: servers.slice(),
          reason: pmState.add.reason,
          until: pmState.add.until,
          notes: pmState.add.notes,
        };
        const reset = () => {
          pmState.add = { step: 1, serverQuery: '', selectedServers: [], reason: '', until: '', notes: '', calOffset: 0 };
          pmState.tab = 'excluded';
          window.RERENDER_PAGE(mount);
        };
        const act = window.OC_ACTIONS && window.OC_ACTIONS.addExclusion;
        if (act) {
          act(payload, reset);
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

    // show current pick as a disabled-looking readout to fill the 2nd grid column
    const untilReadout = h('div', {style:{
      height:'44px',padding:'0 14px',border:'1px solid var(--rule-2)',background:'var(--paper)',
      display:'flex',alignItems:'center',fontFamily:'var(--mono)',fontSize:'14px',
      color: pmState.bulk.until ? 'var(--ink)' : 'var(--ink-4)',
    }}, pmState.bulk.until || 'Pick from the calendar below');
    field('Hold until', untilReadout);

    panel.appendChild(form);

    // Calendar picker for bulk "hold until"
    const today = new Date(2026, 3, 21);
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
      h('span.affected-chip.warn', null, 'REVERSIBLE'),
    ));

    // Action
    const btn = h('button.btn.primary', {
      disabled: !pmState.bulk.reason || !pmState.bulk.until,
      style: (!pmState.bulk.reason || !pmState.bulk.until) ? {opacity:'0.4',cursor:'not-allowed',alignSelf:'flex-start'} : {alignSelf:'flex-start'},
      on:{click:()=>{
        if (pmState.bulk.reason && pmState.bulk.until) {
          const payload = {
            kind: pmState.bulk.scope, // 'group' | 'env'
            target: pmState.bulk.scope === 'group' ? pmState.bulk.group : pmState.bulk.env,
            reason: pmState.bulk.reason,
            until: pmState.bulk.until,
            affectedCount: affectedCount,
          };
          const reset = () => {
            pmState.bulk = { scope: 'group', group: 'GROUP0', env: 'Production', reason: '', until: '', calOffset: 0 };
            pmState.tab = 'excluded';
            window.RERENDER_PAGE(mount);
          };
          const act = window.OC_ACTIONS && window.OC_ACTIONS.bulkExclude;
          if (act) {
            act(payload, reset);
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
        h('div', {style:{fontFamily:'var(--mono)',fontSize:'11.5px',color:'var(--ink-2)'}}, r.fqdn+' · '+r.group),
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
  // Expose
  // ================================================================
  window.RENDER_SERVERS  = renderServersPage;
  window.RENDER_CERTS    = renderCertsPage;
  window.RENDER_EOL      = renderEolPage;
  window.RENDER_PATCHING = renderPatchingPage;
  window.RENDER_PATCHMGMT= renderPatchMgmtPage;
})();
