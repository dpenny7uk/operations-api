/* Operations Console — Health prototype (vanilla) */
(function () {
  'use strict';

  // ---------- tiny DOM helper ----------
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

  const fmtRel = (m) => m<1?'just now':m<60?m+'m ago':m<1440?Math.floor(m/60)+'h ago':Math.floor(m/1440)+'d ago';
  const fmtDur = (m) => m<60?m+'m':m<1440?Math.floor(m/60)+'h '+(m%60?m%60+'m':'').trim():Math.floor(m/1440)+'d '+(Math.floor(m/60)%24)+'h';
  const fmtDate = (d) => d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});

  // ================================================================
  // STATE
  // ================================================================
  const defaults = { alertStyle:'v2', scenario:'degraded', theme:'light', tweaksOpen:false };
  // bump this key when the stored shape changes so old sessions don't pin a stale layout
  const STORAGE_KEY = 'op-proto-v5';
  try { ['op-proto-v1','op-proto-v2','op-proto-v3','op-proto-v4'].forEach(k => localStorage.removeItem(k)); } catch(_) {}
  const state = Object.assign({}, defaults, JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'));
  function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  function setState(p) { Object.assign(state, p); save(); render(); }

  // ================================================================
  // REAL DASHBOARD DATA (modelled on the legacy screenshots)
  // ================================================================
  const SERVERS = {
    total: 2149,
    env: [
      {name:'Production',       count:1130},
      {name:'Development',       count: 657},
      {name:'UAT',               count: 134},
      {name:'Staging',           count:  98},
      {name:'Shared Services',   count:  57},
      {name:'System',            count:  35},
      {name:'Unmapped',          count:  18},
      {name:'Proof of Concept',  count:  12},
      {name:'Continuous Integration', count: 8},
    ],
  };

  // Demo defaults. op-boot.js overwrites window.PATCH_GROUPS / SYNCS /
  // RECENT_ALERTS_BASE with real API data and re-renders. All in-function
  // reads reference window.* so they pick up the latest value each render.
  window.PATCH_GROUPS = window.PATCH_GROUPS || [
    {name:'PROD-A',  servers:412, date:new Date(2026,3,23), window:'02:00–05:00 UTC', services:'core-api, payments'},
    {name:'PROD-B',  servers:388, date:new Date(2026,3,23), window:'05:00–08:00 UTC', services:'databases, cache'},
    {name:'PROD-C',  servers:271, date:new Date(2026,3,24), window:'02:00–05:00 UTC', services:'web, edge'},
    {name:'PROD-D',  servers: 59, date:new Date(2026,3,24), window:'05:00–06:30 UTC', services:'search, ingest'},
    {name:'DEV-A',   servers:234, date:new Date(2026,3,25), window:'anytime',         services:'dev environments'},
    {name:'DEV-B',   servers:198, date:new Date(2026,3,25), window:'anytime',         services:'ephemeral, ci'},
    {name:'UAT',     servers:134, date:new Date(2026,3,26), window:'01:00–04:00 UTC', services:'pre-prod'},
    {name:'STAGING', servers: 98, date:new Date(2026,3,26), window:'04:00–05:30 UTC', services:'staging'},
  ];
  // No local alias — all render-time reads go through window.PATCH_GROUPS so op-boot
  // replacements take effect on re-render.

  window.SYNCS = window.SYNCS || [
    {name:'confluence_issues',     status:'healthy', last:new Date(2026,3,20,5,0),  records:    4, failures:0, err:'—', schedule:'Daily 4:00 AM'},
    {name:'databricks_servers',    status:'healthy', last:new Date(2026,3,20,6,0),  records: 2149, failures:0, err:'—', schedule:'Daily 5:00 AM'},
    {name:'databricks_eol_dates',  status:'healthy', last:new Date(2026,3,20,6,30), records: 7913, failures:0, err:'—', schedule:'Daily 5:30 AM'},
    {name:'databricks_eol_software',status:'healthy',last:new Date(2026,3,20,6,35), records: 1353, failures:0, err:'—', schedule:'Daily 5:35 AM'},
    {name:'certificate_scan',      status:'healthy', last:new Date(2026,3,20,7,7),  records:  298, failures:0, err:'—', schedule:'Daily 6:00 AM'},
    {name:'patching_schedule_html',status:'healthy', last:new Date(2026,3,20,7,30), records: 1159, failures:0, err:'—', schedule:'Daily 6:30 AM'},
  ];

  window.RECENT_ALERTS_BASE = window.RECENT_ALERTS_BASE || [
    {id:'PRD004-26092-00', when:'Apr 12 2026', sub:'Certificate expiring soon', detail:'cert expires in -7 days', tone:'crit'},
    {id:'KNR-Prod',        when:'Apr 12 2026', sub:'Certificate expiring soon', detail:'cert expires in -7 days', tone:'crit'},
    {id:'PRD004-26083-00', when:'Apr 14 2026', sub:'Patch compliance below SLA', detail:'compliance at 91.6% (SLA 95%)', tone:'warn'},
    {id:'DVX032-14011-00', when:'Apr 14 2026', sub:'Server unreachable > 30m',    detail:'no check-in since 12:04Z',      tone:'warn'},
    {id:'INFRA-DBX',       when:'Apr 15 2026', sub:'Databricks sync lagging',     detail:'last success 18m ago (SLA 10m)', tone:'info'},
  ];

  const UNREACHABLE = [
    {name:'DVX032EUGSE-00', env:'Development',  lastSeen:'2h ago', duration:'2h 12m'},
    {name:'DVX032EUCDN-00', env:'Development',  lastSeen:'2h ago', duration:'2h 12m'},
    {name:'DVX032I42J2A-00',env:'Staging',      lastSeen:'2h ago', duration:'2h 12m'},
    {name:'DVX032GLWSD-00', env:'Development',  lastSeen:'2h ago', duration:'2h 12m'},
    {name:'DVX032FHQCKV-01',env:'Development',  lastSeen:'2h ago', duration:'2h 12m'},
  ];

  const UNMATCHED = [
    {raw:'ielcompa01', source:'PATCHING_HTML', firstSeen:'Mar 14, 2026'},
    {raw:'iclcsem1',   source:'PATCHING_HTML', firstSeen:'Mar 14, 2026'},
    {raw:'hxb20200',   source:'UNMATCHED_HTML',firstSeen:'Mar 24, 2026'},
    {raw:'hxa23200',   source:'UNMATCHED_HTML',firstSeen:'Mar 24, 2026'},
    {raw:'hxx22590',   source:'UNMATCHED_HTML',firstSeen:'Mar 24, 2026'},
  ];

  // EXCLUSIONS: exposed via window.EXCLUSIONS so op-boot.js can replace after fetch.
  window.EXCLUSIONS = window.EXCLUSIONS || [];

  // ================================================================
  // SCENARIOS — overlay alerts / row severity / banner on top of
  // the base dashboard data above.
  // ================================================================
  const SCENARIOS = {
    healthy: {
      label:'All healthy', banner:null, apiState:'ok',
      summary:{crit:0,warn:0,info:2,tagline:'All systems operational. <b>2 informational</b> advisories.'},
      alerts:[
        {sev:'info',title:'Quarterly patch rehearsal window <em>2026-05-04</em>',detail:'Dry-run patch cycle scheduled for 24 non-prod hosts. No impact expected.',meta:{when:60,owner:'platform-ops',runbook:'RB-204'}},
        {sev:'info',title:'TLS 1.3 enforcement rollout — phase 2',detail:'Policy will be applied to internal API gateways over the next 7 days.',meta:{when:180,owner:'sec-platform',runbook:'RB-117'}},
      ],
      rowIssues:[],
    },
    offline: {
      label:'API offline',
      banner:{tone:'crit',lead:'API unreachable',msg:'<b>Operator Console cannot reach the Operations API.</b> Data shown is the last cached snapshot from <b>4m ago</b>.',sub:'3 retries failed · ECONNREFUSED at ops-api.corp.local:8443'},
      apiState:'off',
      summary:{crit:7,warn:3,info:0,tagline:'<b>API unreachable</b> — all figures below are <b>stale</b>.'},
      alerts:[
        {sev:'crit',title:'API <em>unreachable</em> — all endpoints failing',detail:'All 7 monitored endpoints returned connection errors. Cached data being served. Retries 3/3 exhausted at 14:22:06Z.',meta:{when:4,owner:'platform-ops',runbook:'RB-001',dur:240,tries:3,blast:'all consoles'}},
        {sev:'crit',title:'Health telemetry <em>stale</em> — last update 4m ago',detail:'Cannot verify current operational posture. Indicators show the last known state, not live values.',meta:{when:4,owner:'platform-ops',runbook:'RB-002',dur:240,blast:'dashboard'}},
        {sev:'warn',title:'Patch scheduler <em>unknown state</em>',detail:'Unable to confirm next cycle readiness. PROD-A scheduled in 2 days — verify manually before kickoff.',meta:{when:4,owner:'patch-ops',runbook:'RB-077',blast:'PROD-A'}},
      ],
      rowIssues:[
        {host:'db-prod-07',env:'Production',age:42,err:'cached · last seen 42m',sev:'crit'},
        {host:'web-prod-15',env:'Production',age:38,err:'cached · last seen 38m',sev:'crit'},
        {host:'api-prod-02',env:'Production',age:12,err:'cached · last seen 12m',sev:'warn'},
      ],
    },
    degraded: {
      label:'API degraded',
      banner:{tone:'warn',lead:'API degraded',msg:'<b>3 of 7 endpoints returning errors.</b> Dashboard is partially stale; affected sections are flagged.',sub:'/health/validation (500) · /certs/expiring (timeout) · /patch/cycles (503)'},
      apiState:'warn',
      summary:{crit:2,warn:5,info:1,tagline:'<b>Degraded</b> — certs and patching affected.'},
      alerts:[
        {sev:'crit',title:'Certificate sync <em>timed out</em> — 3 attempts',detail:'/certs/expiring exceeded 30s timeout. Expiry data is 18m stale. 4 certs are inside the warning window and may have changed state.',meta:{when:18,owner:'sec-platform',runbook:'RB-061',dur:1080,tries:3,blast:'cert dashboard'}},
        {sev:'crit',title:'Server inventory sync <em>HTTP 500</em>',detail:'databricks_servers last run returned 500. Server total shown below is from the previous successful run.',meta:{when:14,owner:'platform-ops',runbook:'RB-045',dur:840,tries:6,blast:'server KPIs',host:'ops-api-02'}},
        {sev:'warn',title:'Patch schedule endpoint <em>503</em> — upstream saturated',detail:'/patch/cycles returned 503 twice in the last 10m. Upcoming cycle dates visible from cache.',meta:{when:6,owner:'patch-ops',runbook:'RB-077',tries:2,blast:'patch page'}},
        {sev:'warn',title:'EOL tracker stale — <em>sync behind 2h</em>',detail:'Software end-of-life feed last synced at 12:07Z. Manual refresh may resolve.',meta:{when:120,owner:'sec-platform',runbook:'RB-088',blast:'eol page'}},
      ],
      rowIssues:[
        {host:'ops-api-02',env:'Production',age:14,err:'HTTP 500 · /servers',sev:'crit'},
        {host:'cert-worker-01',env:'Production',age:18,err:'timeout 30s · /certs',sev:'crit'},
        {host:'patch-scheduler',env:'Production',age:6,err:'HTTP 503 · retry queued',sev:'warn'},
      ],
    },
    stale: {
      label:'Stale data',
      banner:{tone:'warn',lead:'Data is stale',msg:'<b>SCCM sync has not completed in 3h 18m.</b> Patch compliance figures are out of date.',sub:'Expected every 30m · last success 11:42Z · 2 consecutive failures'},
      apiState:'ok',
      summary:{crit:1,warn:4,info:0,tagline:'<b>Data freshness degraded</b> — 2 syncs stale.'},
      alerts:[
        {sev:'crit',title:'patching_schedule_html <em>failing</em> — 2 consecutive runs',detail:'Python sync job exited with code 1: pyodbc.OperationalError — connection to sccm-db timed out. Patch compliance is 3h 18m stale.',meta:{when:198,owner:'patch-ops',runbook:'RB-033',dur:11880,tries:2,blast:'compliance KPIs'}},
        {sev:'warn',title:'databricks_servers sync <em>behind schedule</em>',detail:'Last completed 72m ago (expected every 30m). New servers may not yet appear in the inventory.',meta:{when:72,owner:'platform-ops',runbook:'RB-019',dur:4320,blast:'inventory'}},
        {sev:'warn',title:'certificate_scan <em>queue backlog</em>',detail:'98 pending rotations in queue. Worker throughput dropped from 40/min to 4/min at 13:55Z.',meta:{when:60,owner:'sec-platform',runbook:'RB-062',dur:3600,blast:'98 rotations'}},
      ],
      rowIssues:[
        {host:'patching_schedule_html',env:'Prod',age:198,err:'pyodbc timeout',sev:'crit'},
        {host:'databricks_servers',env:'Prod',age:72,err:'overdue · expected 30m',sev:'warn'},
      ],
    },
    certs: {
      label:'Certs expiring',
      banner:{tone:'crit',lead:'Certificates expired',msg:'<b>2 production certificates have expired.</b> 5 more expire within 14 days. Auto-rotate is currently disabled.',sub:'ops-api.corp.local expired 4h ago · identity.corp.local expired 11h ago'},
      apiState:'ok',
      summary:{crit:2,warn:5,info:0,tagline:'<b>2 expired</b>, <b>5 critical</b> — auto-rotate off.'},
      alerts:[
        {sev:'crit',title:'Cert <em>ops-api.corp.local</em> expired 4h ago',detail:'TLS handshake failing on public endpoint. Browser warnings active for all operator sessions. Renewal blocked by DNS-01 challenge failure.',meta:{when:240,owner:'sec-platform',runbook:'RB-103',dur:14400,blast:'all API traffic'}},
        {sev:'crit',title:'Cert <em>identity.corp.local</em> expired 11h ago',detail:'SAML metadata signing broken — new operator logins failing at IdP. Existing sessions unaffected until token refresh.',meta:{when:660,owner:'iam',runbook:'RB-104',dur:39600,blast:'new logins'}},
        {sev:'warn',title:'<em>5 certs</em> expiring in ≤ 14 days',detail:'db-prod.corp.local (3d), internal-api.corp.local (7d), metrics.corp.local (9d), cache.corp.local (11d), ldap.corp.local (13d).',meta:{when:30,owner:'sec-platform',runbook:'RB-105',blast:'5 services'}},
        {sev:'warn',title:'Auto-rotate <em>disabled</em> — manual intervention required',detail:'cert-manager configured with autoRotate=false since 2026-03-12. Each expiring cert must be rotated by hand.',meta:{when:5760,owner:'sec-platform',runbook:'RB-106'}},
      ],
      rowIssues:[
        {host:'ops-api.corp.local',env:'Prod',age:240,err:'EXPIRED · 4h past',sev:'crit'},
        {host:'identity.corp.local',env:'Prod',age:660,err:'EXPIRED · 11h past',sev:'crit'},
        {host:'db-prod.corp.local',env:'Prod',age:0,err:'expires in 3d',sev:'warn'},
        {host:'internal-api.corp.local',env:'Prod',age:0,err:'expires in 7d',sev:'warn'},
      ],
    },
    patching: {
      label:'Patch failure',
      banner:{tone:'crit',lead:'Patch cycle degraded',msg:'<b>PROD-A — 7 hosts failed to apply patches.</b> 4 require manual remediation before the next maintenance window.',sub:'Started 13:00Z · 53/60 succeeded · rollback blocked on 3 hosts'},
      apiState:'ok',
      summary:{crit:3,warn:4,info:1,tagline:'<b>PROD-A</b> — 7 failures, 3 blocked on rollback.'},
      alerts:[
        {sev:'crit',title:'3 hosts <em>blocked on rollback</em> — manual intervention required',detail:'db-prod-12, db-prod-13, db-prod-14 failed during pg_upgrade validation. Rollback is failing because WAL is ahead of replica. On-call must choose recovery path.',meta:{when:42,owner:'db-ops',runbook:'RB-200',dur:2520,tries:2,blast:'prod-db cluster'}},
        {sev:'crit',title:'Host <em>web-prod-22</em> offline after patch',detail:'Host stopped responding to health checks 6m after reboot. SSH not responding. Out-of-band console shows kernel panic during boot.',meta:{when:28,owner:'platform-ops',runbook:'RB-201',dur:1680,blast:'web pool capacity −8%'}},
        {sev:'crit',title:'<em>KB5034122</em> rejected by 4 Windows hosts',detail:'Installation failed with 0x800f0922 — staged files corrupted. Retry queued for next cycle.',meta:{when:85,owner:'patch-ops',runbook:'RB-202',dur:5100,tries:1,blast:'4 hosts'}},
        {sev:'warn',title:'Compliance dropped to <em>91.6%</em> (SLA 95%)',detail:'7 hosts failed to apply this cycle + 6 exclusions = 13/156 hosts non-compliant.',meta:{when:12,owner:'patch-ops',runbook:'RB-203',blast:'SLA breach'}},
      ],
      rowIssues:[
        {host:'db-prod-12',env:'Production',age:42,err:'pg_upgrade failed · rollback blocked',sev:'crit'},
        {host:'db-prod-13',env:'Production',age:42,err:'pg_upgrade failed · rollback blocked',sev:'crit'},
        {host:'web-prod-22',env:'Production',age:28,err:'offline post-reboot · kernel panic',sev:'crit'},
        {host:'fs-prod-03',env:'Production',age:85,err:'KB5034122 · 0x800f0922',sev:'warn'},
      ],
    },
    security: {
      label:'Auth disabled',
      banner:{tone:'crit',lead:'Authentication disabled',msg:'<b>Authentication:Mode = "none"</b> in production. Every endpoint is exposed without credentials — intended for local dev only.',sub:'Detected on ops-api-01 · ops-api-02 · 3h 04m ago'},
      apiState:'ok',
      summary:{crit:2,warn:1,info:0,tagline:'<b>Critical security advisory</b> — auth disabled, CORS wildcard in use.'},
      alerts:[
        {sev:'crit',title:'Auth <em>disabled</em> on production API',detail:'appsettings.json has Authentication:Mode = "none". Any caller on the corp network can read/write every endpoint. Config was pushed at 11:04Z by deploy-bot.',meta:{when:184,owner:'platform-ops',runbook:'RB-401',dur:11040,blast:'entire API surface',host:'ops-api-01,02'}},
        {sev:'crit',title:'CORS policy accepts <em>*</em> with credentials',detail:'Cors:AllowedOrigins is empty → effective wildcard. Combined with disabled auth this permits arbitrary cross-origin reads.',meta:{when:184,owner:'sec-platform',runbook:'RB-402',dur:11040,blast:'browser clients'}},
        {sev:'warn',title:'Write access to <em>validation_rules</em> granted to readonly role',detail:'GRANT INSERT on system.validation_rules to app_readonly. Equivalent to arbitrary SQL execution via POST /health/validation/run.',meta:{when:720,owner:'dba',runbook:'RB-403',dur:43200,blast:'sql execution'}},
      ],
      rowIssues:[
        {host:'ops-api-01',env:'Production',age:184,err:'auth:none · cors:*',sev:'crit'},
        {host:'ops-api-02',env:'Production',age:184,err:'auth:none · cors:*',sev:'crit'},
      ],
    },
  };

  // ================================================================
  // RAIL + STATUSLINE
  // ================================================================
  function Rail() {
    const ROUTE_MAP = [
      ['01','Health','health'],
      ['02','Servers','servers'],
      ['03','Patching Schedules','patching'],
      ['04','Patch Management','patchmgmt'],
      ['05','Certificates','certs'],
      ['06','End of Life','eol'],
    ];
    const active = (window.ROUTER && window.ROUTER.currentRoute()) || 'health';
    const nav = h('ul.nav-list');
    for (const [idx,label,rid] of ROUTE_MAP) {
      const cls = (rid === active) ? '.active' : '';
      const li = h('li.nav-item'+cls, {
        on:{click:()=>{ if (window.ROUTER) window.ROUTER.goto(rid); }},
        role:'button', tabindex:'0',
      },
        h('span.idx', null, idx),
        h('span.label', null, label));
      nav.appendChild(li);
    }
    const api = SCENARIOS[state.scenario].apiState;
    return h('aside.rail', null,
      h('div.brand', null,
        h('div.mark', null, 'Service Ops'),
        h('div.sub', null, 'operations dashboard')),
      h('div', null,
        h('div.rail-section-label', null, 'Surfaces'),
        nav),
      h('div.rail-footer', null,
        h('span.rail-api'+(api==='off'?'.off':api==='warn'?'.warn':''), null,
          h('span.d'), 'API '+(api==='off'?'offline':api==='warn'?'degraded':'online')),
        h('div.clock', null, '14:22:06 UTC · 2026-04-21'),
        h('div', null, 'build 3d4948d · prototype')),
    );
  }

  function Statusline() {
    const sc = SCENARIOS[state.scenario];
    const s = sc.summary;
    const route = (window.ROUTER && window.ROUTER.currentRoute()) || 'health';
    // Per-surface hero: status word + telegram pieces tailored to the page
    const heroCopy = surfaceHero(route, sc);
    return h('header.statusline', null,
      h('div', null,
        h('div.tag', null, heroCopy.tag),
        h('h1', null, 'Status ', h('em', null, heroCopy.word)),
        h('div.telegram', null, ...heroCopy.pieces),
      ),
      h('div.right', null,
        h('div.timestamp', null, 'Last refresh · 14:22:06'),
        h('button.theme-toggle', {title:'Toggle theme', on:{click:()=>setState({theme: state.theme==='light'?'dark':'light'})}},
          state.theme === 'light' ? '☾' : '☀'),
        h('button.refresh', null, h('span.dot'), 'Refresh')),
    );
  }

  function surfaceHero(route, sc) {
    const s = sc.summary;
    const CERT = window.CERTS_DATA && window.CERTS_DATA.CERT_COUNTS || {};
    const EOL = window.EOL_DATA && window.EOL_DATA.EOL_TOTALS || {};
    const SRV_D = window.SERVERS_DATA || {};
    switch (route) {
      case 'servers': {
        const unreach = (SRV_D.unreachable || []).length;
        const unmatch = (SRV_D.unmatched || []).length;
        return {
          tag: '— SERVERS SURFACE · '+sc.label.toUpperCase(),
          word: 'Server inventory',
          pieces: [
            h('span.piece.ok', null, h('b', null, (SRV_D.SRV_TOTAL||0).toLocaleString()), ' hosts tracked'),
            h('span.piece'+(unreach?'.crit':''), null, h('b', null, String(unreach)), ' unreachable'),
            h('span.piece'+(unmatch?'.warn':''), null, h('b', null, String(unmatch)), ' unmatched'),
            h('span.piece', null, h('b', null, '10'), ' environments'),
          ],
        };
      }
      case 'certs': {
        const exp = CERT.expired||0, crit = CERT.crit||0, warn = CERT.warn||0, ok = CERT.ok||0;
        const total = exp+crit+warn+ok;
        const word = exp>0 ? 'certificates expired' : crit>0 ? 'rotation required' : warn>0 ? 'watch the window' : 'Operational';
        return {
          tag: '— CERTIFICATES SURFACE · '+sc.label.toUpperCase(),
          word: word,
          pieces: [
            h('span.piece'+(exp?'.crit':''), null, h('b', null, String(exp)), ' expired'),
            h('span.piece'+(crit?'.crit':''), null, h('b', null, String(crit)), ' critical'),
            h('span.piece'+(warn?'.warn':''), null, h('b', null, String(warn)), ' warning'),
            h('span.piece.ok', null, h('b', null, String(ok)), ' healthy'),
            h('span.piece', null, h('b', null, String(total)), ' total'),
          ],
        };
      }
      case 'eol': {
        const word = EOL.eol>0 ? 'end-of-life exposure' : EOL.extended>0 ? 'extended support only' : 'Operational';
        return {
          tag: '— END OF LIFE SURFACE · '+sc.label.toUpperCase(),
          word: word,
          pieces: [
            h('span.piece'+(EOL.eol?'.crit':''), null, h('b', null, String(EOL.eol||0)), ' EOL'),
            h('span.piece'+(EOL.extended?'.warn':''), null, h('b', null, String(EOL.extended||0)), ' extended support'),
            h('span.piece.ok', null, h('b', null, String(EOL.supported||0)), ' supported'),
            h('span.piece.crit', null, h('b', null, (EOL.affected||0).toLocaleString()), ' servers affected'),
          ],
        };
      }
      case 'patching': {
        // Data owned by pages-v3; count blockers via a conservative probe
        // (pages-v3 is loaded after app.js, so data may not be reachable from
        // here — keep a stable summary that matches the page hero)
        return {
          tag: '— PATCHING SCHEDULES · '+sc.label.toUpperCase(),
          word: 'Next Cycle · Apr 23',
          pieces: [
            h('span.piece', null, h('b', null, 'April 2026'), ' cycle in 3d'),
            h('span.piece.ok', null, h('b', null, '1,020'), ' servers queued'),
            h('span.piece.warn', null, h('b', null, '1'), ' open blocker'),
          ],
        };
      }
      case 'patchmgmt':
        return {
          tag: '— PATCH MANAGEMENT · '+sc.label.toUpperCase(),
          word: 'exclusions · 3 overdue',
          pieces: [
            h('span.piece.crit', null, h('b', null, '3'), ' past hold date'),
            h('span.piece.warn', null, h('b', null, '3'), ' expiring soon'),
            h('span.piece.ok', null, h('b', null, '5'), ' active'),
            h('span.piece', null, h('b', null, '1,020'), ' eligible'),
          ],
        };
      default: {
        // health — preserve original behaviour
        return {
          tag: '— OPERATOR BULLETIN · '+sc.label.toUpperCase(),
          word: s.crit>0 ? 'needs attention' : s.warn>0 ? 'with caveats' : 'Operational',
          pieces: [
            h('span.piece'+(s.crit?'.crit':''), null, h('b', null, String(s.crit)), ' critical'),
            h('span.piece'+(s.warn?'.warn':''), null, h('b', null, String(s.warn)), ' warning'),
            h('span.piece.ok', null, h('b', null, SERVERS.total.toLocaleString()), ' hosts tracked'),
            h('span.piece', null, h('b', null, 'PROD-A'), ' in 2d'),
          ],
        };
      }
    }
  }

  // ================================================================
  // LOUD BANNER + SEV SUMMARY + ALERTS (stamped)
  // ================================================================
  function LoudBanner(b) {
    if (!b) return null;
    const el = h('div.loud-banner.'+b.tone);
    el.appendChild(h('div.lead', null, h('span.pulse-dot'), b.lead));
    const msg = h('div.msg'); msg.innerHTML = b.msg + (b.sub?'<small>'+b.sub+'</small>':'');
    el.appendChild(msg);
    el.appendChild(h('div.bact', null,
      h('button.primary', null, 'Retry now'),
      h('button', null, 'Open status'),
      h('button', null, 'Dismiss'),
    ));
    return el;
  }

  function SevSummary(sc) {
    const s = sc.summary;
    const bar = h('div.sev-summary');
    const counts = h('div.counts');
    counts.appendChild(h('div.c.crit', null, h('div.n', null, String(s.crit)), h('div.l', null, 'Critical')));
    counts.appendChild(h('div.c.warn', null, h('div.n', null, String(s.warn)), h('div.l', null, 'Warning')));
    counts.appendChild(h('div.c.info', null, h('div.n', null, String(s.info)), h('div.l', null, 'Info')));
    bar.appendChild(counts);
    const tg = h('div.tagline'); tg.innerHTML = s.tagline; bar.appendChild(tg);
    bar.appendChild(h('div.actions', null,
      h('button', null, 'Mute 15m'),
      h('button', null, 'Export'),
      h('button', null, 'Ack all'),
    ));
    return bar;
  }

  function Alert(a) {
    const sevLabel = {crit:'Critical',warn:'Warning',info:'Info'}[a.sev];
    const meta = a.meta || {};
    const metaBlock = h('div.a-meta');
    if (meta.when != null) metaBlock.appendChild(h('span.m', null, h('span.lbl',null,'started'), h('b',null, fmtRel(meta.when))));
    if (meta.dur != null)  metaBlock.appendChild(h('span.m', null, h('span.lbl',null,'duration'), h('b',null, fmtDur(meta.dur))));
    if (meta.tries != null)metaBlock.appendChild(h('span.m', null, h('span.lbl',null,'retries'), h('b',null, meta.tries+'/3')));
    if (meta.blast)        metaBlock.appendChild(h('span.m', null, h('span.lbl',null,'impact'), h('b',null, meta.blast)));
    if (meta.host)         metaBlock.appendChild(h('span.m', null, h('span.lbl',null,'host'), h('b',null, meta.host)));
    if (meta.owner)        metaBlock.appendChild(h('span.m', null, h('span.lbl',null,'owner'), h('b',null, meta.owner)));
    if (meta.runbook)      metaBlock.appendChild(h('span.m', null, h('span.lbl',null,'runbook'), h('b',null, meta.runbook)));

    const actions = h('div.a-actions');
    if (a.sev === 'crit') {
      actions.appendChild(h('button.primary', null, 'Retry'));
      actions.appendChild(h('button', null, 'Runbook'));
      actions.appendChild(h('button', null, 'Copy'));
      actions.appendChild(h('button.ghost', null, 'Snooze'));
    } else if (a.sev === 'warn') {
      actions.appendChild(h('button.primary', null, 'Acknowledge'));
      actions.appendChild(h('button', null, 'Runbook'));
      actions.appendChild(h('button.ghost', null, 'Snooze'));
    } else {
      actions.appendChild(h('button', null, 'Dismiss'));
      actions.appendChild(h('button.ghost', null, 'Details'));
    }

    const title = h('div.a-title'); title.innerHTML = a.title;
    const el = h('div.alert.'+a.sev);
    el.appendChild(h('span.a-sev', null, h('span.a-dot'+(a.sev==='crit'||a.sev==='warn'?'.pulsing':'')), sevLabel));
    el.appendChild(h('div.a-body', null, title, h('div.a-detail', null, a.detail), metaBlock));
    el.appendChild(actions);
    return el;
  }

  // ================================================================
  // CRITICAL ISSUES STRIP (4 cells — no validation rules)
  // ================================================================
  function CritStrip(sc) {
    const stale = sc.apiState !== 'ok';
    const strip = h('div.crit-strip');
    const c1tone = sc.summary.crit ? 'crit' : sc.summary.warn ? 'warn' : 'ok';
    strip.appendChild(h('div.cs-cell.status-cell.'+c1tone, null,
      h('div.cs-label', null, 'System status'),
      h('div.cs-value', null, stale ? 'Unknown' : (sc.summary.crit?'Degraded':sc.summary.warn?'Attention':'Healthy')),
      h('div.cs-sub', null, (sc.summary.crit+sc.summary.warn)+' open signals'+(stale?' · cached':''))));
    strip.appendChild(h('div.cs-cell.'+(state.scenario==='patching'?'crit':'info'), null,
      h('div.cs-label', null, 'Next patch cycle'),
      h('div.cs-value', null, '2', h('span.cs-unit', null, 'days')),
      h('div.cs-sub', null, 'PROD-A · 412 servers · 23 Apr'),
      h('div.cs-link', null, 'View schedule')));
    strip.appendChild(h('div.cs-cell.info', null,
      h('div.cs-label', null, 'Unmatched servers'),
      h('div.cs-value', null, String(UNMATCHED.length * 2)),
      h('div.cs-sub', null, 'pending review'),
      h('div.cs-link', null, 'Review queue')));
    strip.appendChild(h('div.cs-cell.'+(state.scenario==='stale'?'crit':'ok'), null,
      h('div.cs-label', null, 'Sync failures'),
      h('div.cs-value', null, state.scenario==='stale'?'2':'0'),
      h('div.cs-sub', null, state.scenario==='stale'?'2 syncs failing':'all syncs healthy'),
      h('div.cs-link', null, 'View sync status')));
    strip.appendChild(h('div.cs-cell.info', null,
      h('div.cs-label', null, 'Patch exclusions'),
      h('div.cs-value', null, String(window.EXCLUSIONS.length)),
      h('div.cs-sub', null, window.EXCLUSIONS.length?'held / expired':'all holds active'),
      h('div.cs-link', null, 'Review exclusions')));
    return strip;
  }

  // ================================================================
  // KEY METRICS — Servers (env split) + Patching (group breakdown) + Certs
  // ================================================================
  function ServerEnvSplit(stale) {
    const max = Math.max(...SERVERS.env.map(e=>e.count));
    const card = h('div.metric-card');
    card.appendChild(h('div.mc-head', null,
      h('span.mc-title', null, 'Servers'),
      h('span.mc-total', null, SERVERS.total.toLocaleString(), h('small', null, 'total')),
      stale ? h('span.stale-chip', null, 'cached') : null,
    ));
    const list = h('div.env-bars');
    for (const e of SERVERS.env) {
      const pct = (e.count / max) * 100;
      list.appendChild(h('div.env-row', null,
        h('div.name', null, e.name),
        h('div.bar', null, h('div.fill', { style:{ width: pct+'%' } })),
        h('div.count', null, e.count.toLocaleString()),
      ));
    }
    card.appendChild(list);
    return card;
  }

  function PatchingCard(stale) {
    const card = h('div.metric-card');
    card.appendChild(h('div.mc-head', null,
      h('span.mc-title', null, 'Patching'),
      h('span.mc-total', null, (window.PATCH_GROUPS.reduce((s,g)=>s+(g.servers||0),0)).toLocaleString(), h('small', null, 'servers')),
      h('span.mc-sub', null, window.PATCH_GROUPS[0] ? ('next cycle · ' + fmtDate(window.PATCH_GROUPS[0].date)) : 'no upcoming cycle'),
      stale ? h('span.stale-chip', null, 'cached') : null,
    ));

    // Group them by date heading
    const byDate = new Map();
    for (const g of window.PATCH_GROUPS) {
      const k = (g.date && g.date.toDateString) ? g.date.toDateString() : String(g.date);
      if (!byDate.has(k)) byDate.set(k, {date:g.date, groups:[]});
      byDate.get(k).groups.push(g);
    }
    const max = Math.max(...PATCH_GROUPS.map(g=>g.servers));
    const list = h('div.patch-list');
    for (const [_, bucket] of byDate) {
      list.appendChild(h('div.patch-date', null,
        h('span.pd-day', null, bucket.date.toLocaleDateString('en-GB',{weekday:'short'}).toUpperCase()),
        h('span.pd-date', null, fmtDate(bucket.date)),
        h('span.pd-count', null, bucket.groups.reduce((s,g)=>s+g.servers,0).toLocaleString()+' servers')));
      for (const g of bucket.groups) {
        const pct = (g.servers / max) * 100;
        list.appendChild(h('div.patch-row', null,
          h('div.pg', null, g.name),
          h('div.pbar', null, h('span', { style:{ width: pct+'%' } })),
          h('div.pcount', null, g.servers.toLocaleString()),
          h('div.pwhen', null, g.window),
        ));
      }
    }
    card.appendChild(list);
    return card;
  }

  function CertCard() {
    const card = h('div.metric-card');
    const expiring = state.scenario==='certs' ? 7 : 4;
    const expired  = state.scenario==='certs' ? 2 : 0;
    card.appendChild(h('div.mc-head', null,
      h('span.mc-title', null, 'Certificates'),
      h('span.mc-total', null, '287', h('small', null, 'tracked')),
      h('span.mc-sub', null, expiring+' expiring ≤ 14d'),
    ));
    const grid = h('div.cert-stat');
    grid.appendChild(h('div.cs-row.crit', null, h('div.n', null, String(expired)), h('div.l', null, 'Expired')));
    grid.appendChild(h('div.cs-row.warn', null, h('div.n', null, String(expiring-expired)), h('div.l', null, 'Expiring ≤ 14d')));
    grid.appendChild(h('div.cs-row.ok',   null, h('div.n', null, String(287-expiring)), h('div.l', null, 'Valid > 14d')));
    card.appendChild(grid);
    // Mini timeline
    const tl = h('div.cert-mini-axis');
    const labels = ['now','+3d','+7d','+14d','+30d','+60d'];
    labels.forEach(l => tl.appendChild(h('span.tk', null, l)));
    card.appendChild(tl);
    const lanes = h('div.cert-mini-lanes');
    lanes.appendChild(h('div.cl.crit', { style:{ left:'0%',  width:'6%' } }, h('span.dot')));
    lanes.appendChild(h('div.cl.crit', { style:{ left:'0%',  width:'2%' } }, h('span.dot')));
    lanes.appendChild(h('div.cl.warn', { style:{ left:'4%',  width:'8%' } }));
    lanes.appendChild(h('div.cl.warn', { style:{ left:'14%', width:'6%' } }));
    lanes.appendChild(h('div.cl.warn', { style:{ left:'22%', width:'4%' } }));
    lanes.appendChild(h('div.cl.ok',   { style:{ left:'30%', width:'40%' } }));
    card.appendChild(lanes);
    return card;
  }

  // ================================================================
  // SYNC STATUSES (bottom of page)
  // ================================================================
  function SyncTable() {
    const wrap = h('div.table-wrap');
    const tbl = h('table.op');
    tbl.appendChild(h('thead', null, h('tr', null,
      h('th', null, 'Sync'),
      h('th', null, 'Status'),
      h('th', null, 'Last success'),
      h('th', { style:{textAlign:'right'} }, 'Records'),
      h('th', { style:{textAlign:'right'} }, 'Failures'),
      h('th', null, 'Last error'),
      h('th', null, 'Schedule'),
    )));
    const tb = h('tbody');
    // Override status for "stale" scenario
    const syncs = window.SYNCS.map(s => {
      if (state.scenario==='stale' && s.name==='patching_schedule_html') return {...s, status:'fail', err:'pyodbc timeout', failures:2};
      if (state.scenario==='stale' && s.name==='databricks_servers')     return {...s, status:'warn', err:'overdue 42m', failures:0};
      return s;
    });
    for (const s of syncs) {
      const badgeCls = s.status==='healthy'?'ok':s.status==='warn'?'warn':'crit';
      const sevRow   = s.status==='fail'?'sev-crit':s.status==='warn'?'sev-warn':'';
      tb.appendChild(h('tr'+(sevRow?'.'+sevRow:''), null,
        h('td.host', null, s.name),
        h('td', null, h('span.badge.'+badgeCls, null, h('span.dot'), s.status.toUpperCase())),
        h('td.mono.muted', null, s.last.toLocaleString('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})),
        h('td.num', null, s.records.toLocaleString()),
        h('td.num', { style:{color: s.failures? 'var(--crit)':'var(--ink-3)'} }, String(s.failures)),
        h('td.mono', { style:{color: s.status==='fail'?'var(--crit)':'var(--ink-3)'} }, s.err),
        h('td.mono.muted', null, s.schedule),
      ));
    }
    tbl.appendChild(tb);
    wrap.appendChild(tbl);
    return wrap;
  }

  // ================================================================
  // EXCLUSIONS + UNREACHABLE + UNMATCHED
  // ================================================================
  function ExclusionsTable() {
    const wrap = h('div.table-wrap');
    const tbl = h('table.op');
    tbl.appendChild(h('thead', null, h('tr', null,
      h('th', null, 'Server'),
      h('th', null, 'Patch group'),
      h('th', null, 'Service'),
      h('th', null, 'Function'),
      h('th', null, 'Environment'),
      h('th', null, 'Date excluded'),
      h('th', null, 'Held until'),
      h('th', null, 'Notes'),
    )));
    if (!window.EXCLUSIONS.length) {
      tbl.appendChild(h('tbody', null, h('tr', null, h('td', { colspan:8, style:{padding:'28px 20px',textAlign:'center',fontFamily:'var(--mono)',fontSize:'11.5px',color:'var(--ink-3)',letterSpacing:'.1em',textTransform:'uppercase'} }, 'No servers currently excluded from patching.'))));
    }
    wrap.appendChild(tbl);
    return wrap;
  }

  function UnreachableTable() {
    const rows = [...UNREACHABLE];
    // overlay scenario-specific
    const sc = SCENARIOS[state.scenario];
    for (const r of sc.rowIssues || []) {
      if (r.sev==='crit' || r.sev==='warn') {
        rows.unshift({name:r.host, env:r.env, lastSeen:fmtRel(r.age), duration:r.err, _sev:r.sev});
      }
    }
    const wrap = h('div.table-wrap');
    const tbl = h('table.op');
    tbl.appendChild(h('thead', null, h('tr', null,
      h('th', null, 'Name'),
      h('th', null, 'Environment'),
      h('th', null, 'Last seen'),
      h('th', null, 'Duration'),
    )));
    const tb = h('tbody');
    for (const r of rows.slice(0,6)) {
      const sevClass = r._sev ? 'sev-'+r._sev : '';
      tb.appendChild(h('tr'+(sevClass?'.'+sevClass:''), null,
        h('td.host', null, r.name),
        h('td', null, h('span.env-tag', null, r.env)),
        h('td.mono.muted', null, r.lastSeen),
        h('td.mono', { style:{color: r._sev==='crit'?'var(--crit)':r._sev==='warn'?'var(--warn)':'var(--ink-3)'} }, r.duration),
      ));
    }
    tbl.appendChild(tb); wrap.appendChild(tbl);
    return wrap;
  }

  function UnmatchedTable() {
    const wrap = h('div.table-wrap');
    const tbl = h('table.op');
    tbl.appendChild(h('thead', null, h('tr', null,
      h('th', null, 'Raw name'),
      h('th', null, 'Source'),
      h('th', null, 'First seen'),
    )));
    const tb = h('tbody');
    for (const r of UNMATCHED) {
      tb.appendChild(h('tr', null,
        h('td.host', null, r.raw),
        h('td', null, h('span.badge.neutral', null, r.source)),
        h('td.mono.muted', null, r.firstSeen),
      ));
    }
    tbl.appendChild(tb); wrap.appendChild(tbl);
    return wrap;
  }

  function RecentAlerts(sc) {
    const feed = h('div.feed');
    // Synthesize from scenario.alerts (top 3) + base
    const items = (sc.alerts || []).slice(0,3).map(a => ({
      id: (a.title.match(/<em>([^<]+)<\/em>/)||[,'OPS-'+Math.floor(Math.random()*1000)])[1],
      when: fmtRel((a.meta||{}).when || 0),
      sub:  a.title.replace(/<[^>]+>/g,''),
      detail: a.detail.split('.')[0],
      tone: a.sev,
    })).concat(window.RECENT_ALERTS_BASE.slice(0,2));

    for (const a of items.slice(0,5)) {
      feed.appendChild(h('div.feed-item.'+a.tone, null,
        h('div.when', null, a.when),
        h('div.what', null, h('b', { style:{color:'var(--ink)'} }, a.id), ' · ', a.sub, h('small', null, a.detail)),
        h('span.badge.'+(a.tone==='crit'?'crit':a.tone==='warn'?'warn':'info'), null, a.tone==='crit'?'Critical':a.tone==='warn'?'Warning':'Info'),
      ));
    }
    return feed;
  }

  // ================================================================
  // PAGE
  // ================================================================
  function HealthPage() {
    const sc = SCENARIOS[state.scenario];
    const stale = sc.apiState !== 'ok';
    const page = h('div.page');

    page.appendChild(h('div.page-head', null,
      h('span.counter', null, '01 / 06'),
      h('span.title', null, 'Health'),
      h('span.note', null, 'Live operational status across all managed servers, patching schedules, certificates and sync pipelines.'),
    ));

    if (sc.banner) page.appendChild(LoudBanner(sc.banner));
    page.appendChild(SevSummary(sc));

    // Critical Issues strip
    page.appendChild(h('div.section-label', null, h('span',null,'Critical issues'), h('span.count',null,'5')));
    page.appendChild(CritStrip(sc));

    // Active Alerts
    if (sc.alerts.length) {
      page.appendChild(h('div.section-label', null, h('span',null,'Active alerts'), h('span.count',null,String(sc.alerts.length)),
        h('span', { style:{marginLeft:'auto',fontSize:'10px',color:'var(--ink-4)',letterSpacing:'.1em',textTransform:'uppercase',fontFamily:'var(--mono)'} }, 'from cert expiry, sync + patch pipelines')));
      const stack = h('div.alerts-stack');
      sc.alerts.forEach(a => stack.appendChild(Alert(a)));
      page.appendChild(stack);
    }

    // Key metrics — Servers env split + Patching groups + Certs
    page.appendChild(h('div.section-label', null, h('span',null,'Key metrics')));
    const metricsGrid = h('div.metrics-grid');
    metricsGrid.appendChild(ServerEnvSplit(stale));
    metricsGrid.appendChild(PatchingCard(stale));
    metricsGrid.appendChild(CertCard());
    page.appendChild(metricsGrid);

    // Recent alerts (feed, compact)
    page.appendChild(h('div.section-label', null, h('span',null,'Recent alerts'), h('span.count',null,'5')));
    page.appendChild(RecentAlerts(sc));

    // Unreachable + Unmatched split
    const split = h('div.split.even');
    const ucol = h('div');
    ucol.appendChild(h('div.section-label', null, h('span',null,'Unreachable servers'), h('span.count',null,String(UNREACHABLE.length))));
    ucol.appendChild(UnreachableTable());
    split.appendChild(ucol);

    const mcol = h('div');
    mcol.appendChild(h('div.section-label', null, h('span',null,'Unmatched servers'), h('span.count',null,String(UNMATCHED.length))));
    mcol.appendChild(UnmatchedTable());
    split.appendChild(mcol);
    page.appendChild(split);

    // Currently excluded (from old screenshot)
    page.appendChild(h('div.section-label', null, h('span',null,'Currently excluded servers'), h('span.count',null,String(window.EXCLUSIONS.length))));
    page.appendChild(ExclusionsTable());

    // Sync statuses (from old screenshot, now at bottom)
    page.appendChild(h('div.section-label', null, h('span',null,'Sync statuses'), h('span.count',null,String(window.SYNCS.length))));
    page.appendChild(SyncTable());

    return page;
  }

  // ================================================================
  // Tweaks panel
  // ================================================================
  function Tweaks() {
    if (!state.tweaksOpen) return h('button.tp-fab', { on:{click:()=>setState({tweaksOpen:true})} }, h('span.d'), 'Tweaks');
    const scenarioOpts = Object.entries(SCENARIOS).map(([k,v]) => [k, v.label]);
    const themeOpts = [['light','Light'],['dark','Dark']];
    const opt = (groupLbl, wide, opts, cur, onPick) => {
      const og = h('div.tp-group'+(wide?'.wide':''));
      og.appendChild(h('div.label', null, groupLbl));
      const o = h('div.opts');
      opts.forEach(([k,l]) => o.appendChild(h('button'+(cur===k?'.on':''), { on:{click:()=>onPick(k)} }, l)));
      og.appendChild(o);
      return og;
    };
    const panel = h('div.tp');
    panel.appendChild(h('div.tp-head', null,
      h('span.t', null, 'Tweaks'),
      h('button.x', { on:{click:()=>setState({tweaksOpen:false})} }, 'close ×')));
    const body = h('div.tp-body');
    body.appendChild(opt('Failure scenario', true, scenarioOpts, state.scenario, v=>setState({scenario:v})));
    body.appendChild(opt('Theme', false, themeOpts, state.theme, v=>setState({theme:v})));
    body.appendChild(h('div.tp-group', null,
      h('div.label', null, 'About'),
      h('div.hint', null, 'Stamped alert style. Cycle through scenarios to see how alerts, banner, sync and patching surfaces react together.'),
    ));
    panel.appendChild(body);
    return panel;
  }

  // ================================================================
  // Render
  // ================================================================
  function render() {
    document.body.setAttribute('data-alert-style', 'v2');
    document.body.setAttribute('data-theme', state.theme);
    document.body.setAttribute('data-api', SCENARIOS[state.scenario].apiState === 'off' ? 'offline' : SCENARIOS[state.scenario].apiState === 'warn' ? 'degraded' : '');
    const root = document.getElementById('root');
    root.innerHTML = '';
    const shell = h('div.shell');
    shell.appendChild(Rail());
    const stage = h('main.stage');
    stage.appendChild(Statusline());
    // Page mount — router-driven
    const pageMount = h('div.page-mount');
    stage.appendChild(pageMount);
    renderCurrentPage(pageMount);
    shell.appendChild(stage);
    root.appendChild(shell);
    root.appendChild(Tweaks());

    if (window.__tweaksHostReady) return;
    window.addEventListener('message', (e) => {
      if (!e.data) return;
      if (e.data.type === '__activate_edit_mode') setState({tweaksOpen:true});
      else if (e.data.type === '__deactivate_edit_mode') setState({tweaksOpen:false});
    });
    window.addEventListener('hashchange', () => render());
    try { window.parent.postMessage({type:'__edit_mode_available'}, '*'); } catch {}
    window.__tweaksHostReady = true;
  }

  function renderCurrentPage(mount) {
    const active = document.activeElement;
    const hadFocus = active && active.matches && active.matches('input[data-fk], textarea[data-fk]');
    const fk = hadFocus ? active.getAttribute('data-fk') : null;
    const selStart = hadFocus ? active.selectionStart : null;
    const selEnd   = hadFocus ? active.selectionEnd   : null;

    const route = (window.ROUTER && window.ROUTER.currentRoute()) || 'health';
    switch (route) {
      case 'servers':   if (window.RENDER_SERVERS)   window.RENDER_SERVERS(mount);   else mountHealth(mount); break;
      case 'certs':     if (window.RENDER_CERTS)     window.RENDER_CERTS(mount);     else mountHealth(mount); break;
      case 'eol':       if (window.RENDER_EOL)       window.RENDER_EOL(mount);       else mountHealth(mount); break;
      case 'patching':  if (window.RENDER_PATCHING)  window.RENDER_PATCHING(mount);  else mountHealth(mount); break;
      case 'patchmgmt': if (window.RENDER_PATCHMGMT) window.RENDER_PATCHMGMT(mount); else mountHealth(mount); break;
      default:          mountHealth(mount);
    }

    if (fk) {
      const restored = document.querySelector('input[data-fk="'+fk+'"], textarea[data-fk="'+fk+'"]');
      if (restored) {
        restored.focus();
        try { restored.setSelectionRange(selStart ?? restored.value.length, selEnd ?? restored.value.length); } catch {}
      }
    }
  }
  // Expose for page modules so they can trigger a refocus-preserving re-render.
  window.RERENDER_PAGE = function (mount) {
    if (!mount) mount = document.querySelector('.page-mount');
    if (mount) renderCurrentPage(mount);
  };
  function mountHealth(mount) { mount.innerHTML = ''; mount.appendChild(HealthPage()); }

  document.addEventListener('DOMContentLoaded', render);
})();
