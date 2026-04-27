/* Service Ops Console — shell (rail, statusline, health page). All data is
   fetched by op-boot.js into window.* globals; this file only renders. */
(function () {
  'use strict';

  // Shared DOM builder — defined in op-h.js, loaded before this script.
  const h = window.H;

  const fmtRel = (m) => m<1?'just now':m<60?m+'m ago':m<1440?Math.floor(m/60)+'h ago':Math.floor(m/1440)+'d ago';
  const fmtDur = (m) => m<60?m+'m':m<1440?Math.floor(m/60)+'h '+(m%60?m%60+'m':'').trim():Math.floor(m/1440)+'d '+(Math.floor(m/60)%24)+'h';
  const fmtDate = (d) => d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});

  // ================================================================
  // STATE
  // ================================================================
  const defaults = { alertStyle:'v2', theme:'light' };
  const STORAGE_KEY = 'op-console-v1';
  try { ['op-proto-v1','op-proto-v2','op-proto-v3','op-proto-v4','op-proto-v5'].forEach(k => localStorage.removeItem(k)); } catch(_) {}
  const state = Object.assign({}, defaults, JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'));
  function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  function setState(p) { Object.assign(state, p); save(); render(); }

  // ================================================================
  // REAL DASHBOARD DATA — all sourced from window.* globals populated by
  // op-boot.js after parallel /api fetches. These locals are pre-boot
  // fallbacks only; once boot resolves, windows are replaced and renders
  // pick up real values via the getters below.
  // ================================================================

  // Server total + env breakdown (fallback only — real from window.SERVERS_DATA)
  function getServers() {
    const sd = window.SERVERS_DATA || {};
    return {
      total: sd.SRV_TOTAL || 0,
      env: sd.SRV_ENV || [],
    };
  }

  // Pre-boot fallbacks. Empty = honest: nothing shows until op-boot.js fetches
  // from the API and repopulates. If the API is unreachable these stay empty
  // and the "API unreachable" banner surfaces via consoleState().
  window.PATCH_GROUPS       = window.PATCH_GROUPS       || [];
  window.SYNCS              = window.SYNCS              || [];
  window.RECENT_ALERTS_BASE = window.RECENT_ALERTS_BASE || [];

  function getUnreachable() { return (window.SERVERS_DATA && window.SERVERS_DATA.unreachable) || []; }
  function getUnmatched()   { return (window.SERVERS_DATA && window.SERVERS_DATA.unmatched)   || []; }

  // EXCLUSIONS: exposed via window.EXCLUSIONS so op-boot.js can replace after fetch.
  window.EXCLUSIONS = window.EXCLUSIONS || [];

  // ================================================================
  // CONSOLE STATE — derived live from window globals + apiErrors.
  // Returns the same shape the page renderers previously consumed from
  // the SCENARIOS overlay: { label, banner, apiState, summary, alerts }.
  // Call once per render; pass the result down.
  // ================================================================
  function consoleState() {
    const errs = Array.isArray(window.API_ERRORS) ? window.API_ERRORS : [];
    const errCount = errs.length;
    // apiState: off if nothing reachable (network/auth blanket errors present
    // and no real data ever arrived), degraded if some endpoints failed, ok
    // otherwise. Blanket errors start with 'Authentication' / 'Network' /
    // 'Request' / 'Rate' / 'Server'; per-endpoint errors are path-shaped.
    const hasBlanket = errs.some(e => /^(Authentication|Network|Request)/.test(e));
    const apiState = errCount === 0 ? 'ok' : hasBlanket ? 'off' : 'warn';

    // Alerts come from /api/alerts/recent (populated into RECENT_ALERTS_BASE
    // by op-boot.js). Tones there are already crit/warn/info.
    const recent = Array.isArray(window.RECENT_ALERTS_BASE) ? window.RECENT_ALERTS_BASE : [];
    const alerts = recent.map(a => ({
      sev: a.tone || 'info',
      title: a.sub || a.id || 'Alert',
      detail: a.detail || '',
      meta: { blast: a.id || '' },
    }));
    const crit = recent.filter(a => a.tone === 'crit').length;
    const warn = recent.filter(a => a.tone === 'warn').length;
    const info = recent.filter(a => a.tone === 'info').length;

    // usingDemo: op-boot.js flips this after Promise.allSettled if any fetch
    // returned null, meaning at least one widget is still on its demo-data
    // fallback from op-pages.js. Correlated with apiState but named for intent.
    const usingDemo = window.USING_DEMO === true;

    // Banner: surface API degradation. When data is fully healthy this is null.
    let banner = null;
    if (apiState === 'off') {
      banner = {
        tone: 'crit',
        lead: 'API unreachable',
        msg: '<b>Operator Console cannot reach the Operations API.</b> ' + (usingDemo
          ? 'Figures below are <b>demo data</b>, not live.'
          : 'Figures below may be missing or stale.'),
        sub: errs.slice(0, 4).join(' · '),
      };
    } else if (apiState === 'warn') {
      const pathErrs = errs.filter(e => !/^(Authentication|Network|Request|Rate|Server)/.test(e));
      banner = {
        tone: 'warn',
        lead: 'API degraded',
        msg: '<b>' + errCount + ' endpoint' + (errCount === 1 ? '' : 's') + ' returning errors.</b> ' + (usingDemo
          ? 'Affected sections are showing <b>demo data</b>.'
          : 'Affected sections may be stale.'),
        sub: pathErrs.slice(0, 4).join(' · '),
      };
    }

    // Label + tagline
    let label, tagline;
    if (apiState === 'off')      { label = 'API unreachable'; tagline = '<b>API unreachable</b> — ' + (usingDemo ? 'showing demo data.' : 'figures below may be stale.'); }
    else if (apiState === 'warn'){ label = 'API degraded';    tagline = '<b>Degraded</b> — ' + (usingDemo ? 'some widgets showing demo data.' : 'some endpoints failing.'); }
    else if (crit > 0)           { label = 'Needs attention'; tagline = '<b>' + crit + ' critical</b> alert' + (crit === 1 ? '' : 's') + ' open.'; }
    else if (warn > 0)           { label = 'With caveats';    tagline = '<b>' + warn + ' warning</b>' + (warn === 1 ? '' : 's') + ' — review when possible.'; }
    else                         { label = 'All healthy';     tagline = 'All systems operational.' + (info ? ' <b>' + info + ' informational</b> advisor' + (info === 1 ? 'y' : 'ies') + '.' : ''); }

    return {
      label,
      banner,
      apiState,
      summary: { crit, warn, info, tagline },
      alerts,
    };
  }

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
    const api = consoleState().apiState;
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
        h('div.clock', null, (() => {
          const d = new Date();
          const p = n => String(n).padStart(2,'0');
          return p(d.getUTCHours())+':'+p(d.getUTCMinutes())+':'+p(d.getUTCSeconds())+' UTC · '+d.getUTCFullYear()+'-'+p(d.getUTCMonth()+1)+'-'+p(d.getUTCDate());
        })())),
    );
  }

  function Statusline() {
    const sc = consoleState();
    const s = sc.summary;
    const route = (window.ROUTER && window.ROUTER.currentRoute()) || 'health';
    // Per-surface hero: status word + telegram pieces tailored to the page
    const heroCopy = surfaceHero(route, sc);
    // When the API is degraded or unreachable, the per-surface word is derived
    // from numbers we can't trust — override it so the hero doesn't contradict
    // the banner below (e.g. "Status Operational" next to "API DEGRADED").
    if (sc.apiState === 'off')       heroCopy.word = 'API unreachable';
    else if (sc.apiState === 'warn') heroCopy.word = 'API degraded';
    return h('header.statusline', null,
      h('div', null,
        h('div.tag', null, heroCopy.tag),
        h('h1', null, 'Status ', h('em', null, heroCopy.word)),
        h('div.telegram', null, ...heroCopy.pieces),
      ),
      h('div.right', null,
        h('div.timestamp', null, 'Last refresh · ' + (() => { const d = new Date(); const p = n => String(n).padStart(2,'0'); return p(d.getHours())+':'+p(d.getMinutes())+':'+p(d.getSeconds()); })()),
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
        const pg = Array.isArray(window.PATCH_GROUPS) ? window.PATCH_GROUPS : [];
        const next = pg[0] || null;
        const totalQueued = pg.reduce((n, g) => n + (g.servers || 0), 0);
        let word = 'no cycle queued', cycleStr = '—';
        if (next && next.date instanceof Date) {
          const days = Math.max(0, Math.ceil((next.date.getTime() - Date.now()) / 86400000));
          word = 'Next cycle · ' + next.date.toLocaleDateString('en-GB',{day:'2-digit',month:'short'});
          cycleStr = 'in ' + days + (days === 1 ? ' day' : ' days');
        }
        return {
          tag: '— PATCHING SCHEDULES · '+sc.label.toUpperCase(),
          word,
          pieces: [
            h('span.piece', null, h('b', null, cycleStr)),
            h('span.piece.ok', null, h('b', null, totalQueued.toLocaleString()), ' servers queued'),
            h('span.piece', null, h('b', null, String(pg.length)), ' groups'),
          ],
        };
      }
      case 'patchmgmt': {
        const ex = Array.isArray(window.EXCLUSIONS) ? window.EXCLUSIONS : [];
        const overdue  = ex.filter(x => x.state === 'overdue').length;
        const expiring = ex.filter(x => x.state === 'expiring').length;
        const active   = ex.filter(x => x.state === 'active').length;
        const word = overdue>0 ? 'exclusions · '+overdue+' overdue' : expiring>0 ? 'exclusions · '+expiring+' expiring' : 'exclusions · all active';
        return {
          tag: '— PATCH MANAGEMENT · '+sc.label.toUpperCase(),
          word,
          pieces: [
            h('span.piece'+(overdue?'.crit':''), null, h('b', null, String(overdue)), ' past hold date'),
            h('span.piece'+(expiring?'.warn':''), null, h('b', null, String(expiring)), ' expiring soon'),
            h('span.piece.ok', null, h('b', null, String(active)), ' active'),
            h('span.piece', null, h('b', null, String(ex.length)), ' total'),
          ],
        };
      }
      default: {
        // Next patch cycle piece — from real window.PATCH_GROUPS[0] if available
        const next = (window.PATCH_GROUPS && window.PATCH_GROUPS[0]) || null;
        let nextPiece;
        if (next && next.date instanceof Date) {
          const days = Math.max(0, Math.ceil((next.date.getTime() - Date.now()) / 86400000));
          nextPiece = h('span.piece', null, h('b', null, next.name || '—'), ' in ' + days + 'd');
        } else {
          nextPiece = h('span.piece', null, h('b', null, '—'), ' no cycle queued');
        }
        return {
          tag: '— OPERATOR BULLETIN · '+sc.label.toUpperCase(),
          word: s.crit>0 ? 'needs attention' : s.warn>0 ? 'review warnings' : 'Operational',
          pieces: [
            h('span.piece'+(s.crit?'.crit':''), null, h('b', null, String(s.crit)), ' critical'),
            h('span.piece'+(s.warn?'.warn':''), null, h('b', null, String(s.warn)), ' warning'),
            h('span.piece.ok', null, h('b', null, getServers().total.toLocaleString()), ' hosts tracked'),
            nextPiece,
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

    // Alerts are derived server-side from /api/alerts/recent (unreachable
    // scans, cert expiries, sync lag, overdue exclusions). There is no
    // "retry" or "runbook" action — the underlying data changes when the
    // next sync runs. Keep Copy (useful) and Snooze (client-side dismiss).
    const actions = h('div.a-actions');
    const idForCopy = (a.meta && a.meta.blast) || a.title;
    const copyBtn = h('button', { on:{click:() => {
      try {
        navigator.clipboard.writeText(idForCopy);
        copyBtn.textContent = 'Copied';
        setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1200);
      } catch {
        copyBtn.textContent = 'Copy failed';
      }
    }}}, 'Copy');
    actions.appendChild(copyBtn);

    const title = h('div.a-title'); title.innerHTML = a.title;
    const el = h('div.alert.'+a.sev);
    el.appendChild(h('span.a-sev', null, h('span.a-dot'+(a.sev==='crit'||a.sev==='warn'?'.pulsing':'')), sevLabel));
    el.appendChild(h('div.a-body', null, title, h('div.a-detail', null, a.detail), metaBlock));

    // Snooze = client-side dismiss. Not persistent — fades the alert on this
    // session only. (There is no snooze/ack endpoint yet.)
    const snoozeBtn = h('button.ghost', { on:{click:() => {
      el.style.transition = 'opacity .2s ease';
      el.style.opacity = '0';
      setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 220);
    }}}, 'Snooze');
    actions.appendChild(snoozeBtn);

    el.appendChild(actions);
    return el;
  }

  // ================================================================
  // CRITICAL ISSUES STRIP (4 cells — no validation rules)
  // ================================================================
  function CritStrip(sc) {
    const stale = sc.apiState !== 'ok';
    const strip = h('div.crit-strip');

    // System status
    const c1tone = sc.summary.crit ? 'crit' : sc.summary.warn ? 'warn' : 'ok';
    strip.appendChild(h('div.cs-cell.status-cell.'+c1tone, null,
      h('div.cs-label', null, 'System status'),
      h('div.cs-value', null, stale ? 'Unknown' : (sc.summary.crit?'Degraded':sc.summary.warn?'Attention':'Healthy')),
      h('div.cs-sub', null, (sc.summary.crit+sc.summary.warn)+' open signals'+(stale?' · stale':''))));

    // Next patch cycle — from window.PATCH_GROUPS[0]
    const next = (window.PATCH_GROUPS && window.PATCH_GROUPS[0]) || null;
    let nextDays = null, nextSub = '—';
    if (next && next.date instanceof Date) {
      const ms = next.date.getTime() - Date.now();
      nextDays = Math.max(0, Math.ceil(ms / 86400000));
      const pieces = [next.name, (next.servers || 0).toLocaleString() + ' servers', fmtDate(next.date)].filter(Boolean);
      nextSub = pieces.join(' · ');
    }
    strip.appendChild(h('div.cs-cell.info', null,
      h('div.cs-label', null, 'Next patch cycle'),
      h('div.cs-value', null, nextDays == null ? '—' : String(nextDays), nextDays != null ? h('span.cs-unit', null, nextDays === 1 ? 'day' : 'days') : null),
      h('div.cs-sub', null, nextSub),
      h('div.cs-link', null, 'View schedule')));

    // Unmatched servers — real count from window.SERVERS_DATA.unmatched
    const unmatchedCount = getUnmatched().length;
    strip.appendChild(h('div.cs-cell.'+(unmatchedCount ? 'warn' : 'info'), null,
      h('div.cs-label', null, 'Unmatched servers'),
      h('div.cs-value', null, String(unmatchedCount)),
      h('div.cs-sub', null, unmatchedCount ? 'pending review' : 'none pending'),
      h('div.cs-link', null, 'Review queue')));

    // Sync failures — count non-healthy from window.SYNCS
    const syncs = Array.isArray(window.SYNCS) ? window.SYNCS : [];
    const failing = syncs.filter(s => s.status && s.status !== 'healthy').length;
    strip.appendChild(h('div.cs-cell.'+(failing ? 'crit' : 'ok'), null,
      h('div.cs-label', null, 'Sync failures'),
      h('div.cs-value', null, String(failing)),
      h('div.cs-sub', null, failing ? (failing === 1 ? '1 sync failing' : failing + ' syncs failing') : 'all syncs healthy'),
      h('div.cs-link', null, 'View sync status')));

    // Patch exclusions — already real via window.EXCLUSIONS
    const exCount = (window.EXCLUSIONS || []).length;
    strip.appendChild(h('div.cs-cell.info', null,
      h('div.cs-label', null, 'Patch exclusions'),
      h('div.cs-value', null, String(exCount)),
      h('div.cs-sub', null, exCount ? 'held / expired' : 'none active'),
      h('div.cs-link', null, 'Review exclusions')));
    return strip;
  }

  // ================================================================
  // KEY METRICS — Servers (env split) + Patching (group breakdown) + Certs
  // ================================================================
  function ServerEnvSplit(stale) {
    const srv = getServers();
    const max = srv.env.length ? Math.max(...srv.env.map(e => e.count)) : 1;
    const card = h('div.metric-card');
    card.appendChild(h('div.mc-head', null,
      h('span.mc-title', null, 'Servers'),
      h('span.mc-total', null, srv.total.toLocaleString(), h('small', null, 'total')),
      stale ? h('span.stale-chip', null, 'stale') : null,
    ));
    const list = h('div.env-bars');
    if (!srv.env.length) {
      list.appendChild(h('div.env-row.muted', null, h('div.name', null, '—'), h('div.bar'), h('div.count', null, '—')));
    } else {
      for (const e of srv.env) {
        const pct = (e.count / max) * 100;
        list.appendChild(h('div.env-row', null,
          h('div.name', null, e.name),
          h('div.bar', null, h('div.fill', { style:{ width: pct+'%' } })),
          h('div.count', null, e.count.toLocaleString()),
        ));
      }
    }
    card.appendChild(list);
    return card;
  }

  function PatchingCard(stale) {
    const card = h('div.metric-card');

    // Card scope: current Mon-Sun week (UTC). Backend returns ~45 days for the
    // Patching page; the dashboard card is an at-a-glance view.
    const now = new Date();
    const day = (now.getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
    const weekStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day));
    const weekEnd = new Date(weekStart); weekEnd.setUTCDate(weekStart.getUTCDate() + 7);
    const inWeek = window.PATCH_GROUPS.filter(g => g.date && g.date >= weekStart && g.date < weekEnd);

    const totalServers = inWeek.reduce((s,g)=>s+(g.servers||0),0);
    const weekEndDisplay = new Date(weekEnd.getTime() - 86400000);
    card.appendChild(h('div.mc-head', null,
      h('span.mc-title', null, 'Patching'),
      h('span.mc-total', null, totalServers.toLocaleString(), h('small', null, 'servers')),
      h('span.mc-sub', null, inWeek.length ? ('this week · ' + fmtDate(weekStart) + '–' + fmtDate(weekEndDisplay)) : 'no cycles this week'),
      stale ? h('span.stale-chip', null, 'cached') : null,
    ));

    const list = h('div.patch-list');
    if (!inWeek.length) {
      list.appendChild(h('div.patch-date.muted', null,
        h('span.pd-date', null, 'No patching scheduled this week')));
      card.appendChild(list);
      return card;
    }

    // Group them by date heading
    const byDate = new Map();
    for (const g of inWeek) {
      const k = (g.date && g.date.toDateString) ? g.date.toDateString() : String(g.date);
      if (!byDate.has(k)) byDate.set(k, {date:g.date, groups:[]});
      byDate.get(k).groups.push(g);
    }
    const max = Math.max(1, ...inWeek.map(g=>g.servers));
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
    // Real counts from /api/certificates/summary via op-boot.js
    const counts = (window.CERTS_DATA && window.CERTS_DATA.CERT_COUNTS) || { expired:0, within7d:0, within30d:0, healthy:0 };
    const expired = counts.expired || 0;
    // CERT_COUNTS maps backend: expired/crit(≤7d)/warn(≤30d)/ok. Treat "expiring"
    // as crit+warn (≤30d window) since we no longer distinguish 14d in backend.
    const expiringSoon = (counts.within7d || 0) + (counts.within30d || 0);
    const healthy = counts.healthy || 0;
    const tracked = expired + expiringSoon + healthy;
    card.appendChild(h('div.mc-head', null,
      h('span.mc-title', null, 'Certificates'),
      h('span.mc-total', null, tracked.toLocaleString(), h('small', null, 'tracked')),
      h('span.mc-sub', null, expiringSoon + ' expiring ≤ 30d'),
    ));
    const grid = h('div.cert-stat');
    grid.appendChild(h('div.cs-row.crit', null, h('div.n', null, String(expired)), h('div.l', null, 'Expired')));
    grid.appendChild(h('div.cs-row.warn', null, h('div.n', null, String(expiringSoon)), h('div.l', null, 'Expiring ≤ 30d')));
    grid.appendChild(h('div.cs-row.ok',   null, h('div.n', null, String(healthy)), h('div.l', null, 'Valid > 30d')));
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
    const syncs = Array.isArray(window.SYNCS) ? window.SYNCS : [];
    for (const s of syncs) {
      const badgeCls = s.status==='healthy'?'ok':s.status==='warn'?'warn':'crit';
      const sevRow   = s.status==='crit'?'sev-crit':s.status==='warn'?'sev-warn':'';
      const lastStr = s.last ? s.last.toLocaleString('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : '—';
      tb.appendChild(h('tr'+(sevRow?'.'+sevRow:''), null,
        h('td.host', null, s.name),
        h('td', null, h('span.badge.'+badgeCls, null, h('span.dot'), String(s.status||'').toUpperCase() || '—')),
        h('td.mono.muted', null, lastStr),
        h('td.num', null, (s.records||0).toLocaleString()),
        h('td.num', { style:{color: s.failures? 'var(--crit)':'var(--ink-3)'} }, String(s.failures||0)),
        h('td.mono', { style:{color: s.status==='crit'?'var(--crit)':'var(--ink-3)'} }, s.err || '—'),
        h('td.mono.muted', null, s.schedule || ''),
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
    const list = Array.isArray(window.EXCLUSIONS) ? window.EXCLUSIONS : [];
    const tb = h('tbody');
    if (!list.length) {
      tb.appendChild(h('tr', null, h('td', { colspan:8, style:{padding:'28px 20px',textAlign:'center',fontFamily:'var(--mono)',fontSize:'11.5px',color:'var(--ink-3)',letterSpacing:'.1em',textTransform:'uppercase'} }, 'No servers currently excluded from patching.')));
    } else {
      for (const r of list) {
        const stateCls = r.state === 'overdue' ? '.sev-crit' : r.state === 'expiring' || r.state === 'expiring-soon' ? '.sev-warn' : '';
        tb.appendChild(h('tr'+stateCls, null,
          h('td.host', null, r.server || r.fqdn || '—'),
          h('td', null, r.group ? h('span.badge', null, h('span.dot'), r.group) : '—'),
          h('td.muted', null, r.service || '—'),
          h('td.muted', null, r.func || '—'),
          h('td', null, r.env ? h('span.env-tag', null, r.env) : '—'),
          h('td.mono.muted', null, r.requested || '—'),
          h('td.mono', null, r.until || '—'),
          h('td.muted', null, r.notes || r.reason || '—'),
        ));
      }
    }
    tbl.appendChild(tb);
    wrap.appendChild(tbl);
    return wrap;
  }

  function UnreachableTable() {
    const rows = getUnreachable();
    const wrap = h('div.table-wrap');
    const tbl = h('table.op');
    tbl.appendChild(h('thead', null, h('tr', null,
      h('th', null, 'Name'),
      h('th', null, 'Environment'),
      h('th', null, 'Last seen'),
      h('th', null, 'Duration'),
    )));
    const tb = h('tbody');
    if (!rows.length) {
      tb.appendChild(h('tr', null, h('td', { colspan:4, style:{padding:'20px',textAlign:'center',color:'var(--ink-3)',fontFamily:'var(--mono)',fontSize:'11.5px',letterSpacing:'.1em',textTransform:'uppercase'} }, 'No unreachable servers.')));
    } else {
      for (const r of rows.slice(0, 6)) {
        tb.appendChild(h('tr', null,
          h('td.host', null, r.name),
          h('td', null, h('span.env-tag', null, r.env)),
          h('td.mono.muted', null, r.lastSeen),
          h('td.mono', null, r.duration || '—'),
        ));
      }
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
    const rows = getUnmatched();
    if (!rows.length) {
      tb.appendChild(h('tr', null, h('td', { colspan:3, style:{padding:'20px',textAlign:'center',color:'var(--ink-3)',fontFamily:'var(--mono)',fontSize:'11.5px',letterSpacing:'.1em',textTransform:'uppercase'} }, 'No unmatched servers.')));
    } else {
      for (const r of rows) {
        tb.appendChild(h('tr', null,
          h('td.host', null, r.raw),
          h('td', null, h('span.badge.neutral', null, r.source)),
          h('td.mono.muted', null, r.firstSeen),
        ));
      }
    }
    tbl.appendChild(tb); wrap.appendChild(tbl);
    return wrap;
  }

  function RecentAlerts() {
    const feed = h('div.feed');
    const base = Array.isArray(window.RECENT_ALERTS_BASE) ? window.RECENT_ALERTS_BASE : [];
    if (!base.length) {
      feed.appendChild(h('div.feed-item.info', null,
        h('div.when', null, '—'),
        h('div.what', null, h('b', { style:{color:'var(--ink)'} }, 'No recent alerts'), h('small', null, 'Nothing surfaced by /api/alerts/recent.')),
        h('span.badge.info', null, 'Info'),
      ));
      return feed;
    }
    for (const a of base.slice(0, 5)) {
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
    const sc = consoleState();
    const stale = sc.apiState !== 'ok';
    const page = h('div.page');

    page.appendChild(h('div.page-head', null,
      h('span.counter', null, '01 / 06'),
      h('span.title', null, 'Health'),
      h('span.note', null, 'Live operational status across all managed servers, patching schedules, certificates and sync pipelines.'),
    ));

    // Aggregate DEMO ribbon for the dashboard — any widget on demo data shows up
    // in the list so the user can see at a glance which cards are unreliable.
    const demoSet = (window.DEMO_WIDGETS instanceof Set) ? window.DEMO_WIDGETS : null;
    if (demoSet && demoSet.size) {
      const labels = Array.from(demoSet).map(k => ({
        servers: 'Servers', certs: 'Certificates', eol: 'End-of-life',
        patching: 'Patching', exclusions: 'Exclusions', health: 'Sync health',
      }[k] || k));
      page.appendChild(h('div.demo-ribbon-row', { role: 'status', 'aria-label': 'Some dashboard cards are showing demo data' },
        h('span.demo-ribbon', null, 'DEMO DATA'),
        h('span.demo-ribbon-note', null, 'live fetch failed for: ' + labels.join(', ') + '. Figures on these cards are placeholders.'),
      ));
    }

    if (sc.banner) page.appendChild(LoudBanner(sc.banner));
    page.appendChild(SevSummary(sc));

    // Critical Issues strip
    const openSignals = sc.summary.crit + sc.summary.warn + sc.summary.info;
    page.appendChild(h('div.section-label', null, h('span',null,'Critical issues'), h('span.count',null,String(openSignals))));
    page.appendChild(CritStrip(sc));

    // Key metrics — Servers env split + Patching groups + Certs
    page.appendChild(h('div.section-label', null, h('span',null,'Key metrics')));
    const metricsGrid = h('div.metrics-grid');
    metricsGrid.appendChild(ServerEnvSplit(stale));
    metricsGrid.appendChild(PatchingCard(stale));
    metricsGrid.appendChild(CertCard());
    page.appendChild(metricsGrid);

    // Active Alerts (from /api/alerts/recent — the real list)
    if (sc.alerts.length) {
      page.appendChild(h('div.section-label', null, h('span',null,'Active alerts'), h('span.count',null,String(sc.alerts.length)),
        h('span', { style:{marginLeft:'auto',fontSize:'10px',color:'var(--ink-4)',letterSpacing:'.1em',textTransform:'uppercase',fontFamily:'var(--mono)'} }, 'from cert expiry, sync + patch pipelines')));
      const stack = h('div.alerts-stack');
      sc.alerts.slice(0, 10).forEach(a => stack.appendChild(Alert(a)));
      page.appendChild(stack);
    }

    // Recent alerts (feed, compact)
    const recentCount = Math.min(5, (window.RECENT_ALERTS_BASE || []).length);
    page.appendChild(h('div.section-label', null, h('span',null,'Recent alerts'), h('span.count',null,String(recentCount))));
    page.appendChild(RecentAlerts());

    // Currently excluded — operationally significant, sits above reference
    // tables below.
    page.appendChild(h('div.section-label', null, h('span',null,'Currently excluded servers'), h('span.count',null,String(window.EXCLUSIONS.length))));
    page.appendChild(ExclusionsTable());

    // Unreachable + Unmatched split
    const unreachable = getUnreachable();
    const unmatched = getUnmatched();
    const split = h('div.split.even');
    const ucol = h('div');
    ucol.appendChild(h('div.section-label', null, h('span',null,'Unreachable servers'), h('span.count',null,String(unreachable.length))));
    ucol.appendChild(UnreachableTable());
    split.appendChild(ucol);

    const mcol = h('div');
    mcol.appendChild(h('div.section-label', null, h('span',null,'Unmatched servers'), h('span.count',null,String(unmatched.length))));
    mcol.appendChild(UnmatchedTable());
    split.appendChild(mcol);
    page.appendChild(split);

    // Sync statuses (from old screenshot, now at bottom)
    page.appendChild(h('div.section-label', null, h('span',null,'Sync statuses'), h('span.count',null,String(window.SYNCS.length))));
    page.appendChild(SyncTable());

    return page;
  }

  // ================================================================
  // Render
  // ================================================================
  function render() {
    document.body.setAttribute('data-alert-style', 'v2');
    document.body.setAttribute('data-theme', state.theme);
    const apiState = consoleState().apiState;
    document.body.setAttribute('data-api', apiState === 'off' ? 'offline' : apiState === 'warn' ? 'degraded' : '');
    const root = document.getElementById('root');
    // Build the new shell in a detached node first. Only swap it in once the
    // page renders successfully, so a crash in a page module doesn't leave
    // the user staring at a blank document.
    const shell = h('div.shell');
    shell.appendChild(Rail());
    const stage = h('main.stage');
    stage.appendChild(Statusline());
    const pageMount = h('div.page-mount');
    stage.appendChild(pageMount);
    try {
      renderCurrentPage(pageMount);
    } catch (err) {
      console.error('Page render failed:', err);
      pageMount.innerHTML = '';
      pageMount.appendChild(h('div.page', null,
        h('div.page-head', null, h('span.title', null, 'Something went wrong')),
        h('div.loud-banner.crit', null,
          h('div.lead', null, 'Render error'),
          h('div.msg', { html:'<b>This page failed to render.</b> The shell is still usable — switch to another surface in the rail.<small>' + String(err && err.message || err).replace(/[<>&]/g,'') + '</small>' }),
        ),
      ));
    }
    shell.appendChild(stage);
    root.innerHTML = '';
    root.appendChild(shell);

    if (window.__opAppReady) return;
    window.addEventListener('hashchange', () => render());
    window.__opAppReady = true;
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
  // Full re-render of the shell (rail + statusline + page) when API state or
  // derived-count globals change. Less surgical than RERENDER_PAGE but needed
  // when elements outside .page-mount need to reflect live data.
  window.RERENDER_SHELL = function () { render(); };
  function mountHealth(mount) { mount.innerHTML = ''; mount.appendChild(HealthPage()); }

  document.addEventListener('DOMContentLoaded', render);
})();
