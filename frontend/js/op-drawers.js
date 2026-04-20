/* Operations Console — drawer renderers (pure vanilla) */
(function () {
  'use strict';
  const OC = window.OC;
  const { h, t, Badge, InlineSearch, fmtDate, fmtShortDate, downloadCsv, isoDay } = OC;

  function Drawer({ counter, title, subtitle, body, footer, closeDrawer }) {
    const scrim = h('div.drawer-scrim', { onclick: closeDrawer });
    const aside = h('aside.drawer', {
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': title ? String(title) + (subtitle ? ' — ' + subtitle : '') : 'Detail panel'
    });
    const closeBtn = h('button.drawer-close', { onclick: closeDrawer }, 'Close · Esc');
    const head = h('div.drawer-head', null,
      h('div', null,
        h('div.counter', null, counter),
        h('h2', null, title),
        subtitle && h('div.subtitle', null, subtitle)
      ),
      closeBtn
    );
    aside.appendChild(head);
    const bodyEl = h('div.drawer-body');
    if (Array.isArray(body)) body.forEach(n => n && bodyEl.appendChild(n));
    else if (body) bodyEl.appendChild(body);
    if (footer) bodyEl.appendChild(footer);
    aside.appendChild(bodyEl);

    // Focus trap: wrap Tab between first/last focusable, and focus Close on mount.
    const FOCUSABLE = 'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    aside.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const focusable = aside.querySelectorAll(FOCUSABLE);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    });
    requestAnimationFrame(() => { try { closeBtn.focus(); } catch (_) {} });

    return [scrim, aside];
  }

  function kpis(cells) {
    const g = h('div.drawer-kpis');
    for (const c of cells) {
      if (!c) continue;
      g.appendChild(h('div.cell', null,
        h('div.lbl', null, c.lbl),
        h('div.val' + (c.tone ? '.' + c.tone : ''), null, c.val),
        h('div.sub', null, c.sub)
      ));
    }
    return g;
  }
  function section(lbl, count, ...body) {
    const sec = h('div.drawer-section');
    const l = h('div.lbl', null, lbl);
    if (count != null) l.appendChild(h('span.ct', null, String(count)));
    sec.appendChild(l);
    for (const b of body) if (b) sec.appendChild(b);
    return sec;
  }

  // ═══════════════════════════════════════════════════════════
  // CYCLE
  // ═══════════════════════════════════════════════════════════
  OC.drawers.cycle = function (cycle, d, ctx) {
    const { closeDrawer, ps } = ctx;
    const qs = ps('drawer-cycle:' + cycle.id, 'q', '');
    const expandedS = ps('drawer-cycle:' + cycle.id, 'expanded', new Set());
    const upcoming = cycle.status === 'Upcoming';
    const PAGE_SIZE = 10;

    const pool = d.servers.filter(s => s.patchGroup && s.isActive);
    const offset = (cycle.id * 7) % Math.max(1, pool.length - cycle.count);
    const inCycle = pool.slice(offset, offset + cycle.count);
    const byGroup = {};
    for (const s of inCycle) { (byGroup[s.patchGroup] = byGroup[s.patchGroup] || []).push(s); }
    const groupKeys = Object.keys(byGroup).sort();

    const baseDate = new Date(cycle.date);
    const fmtWin = (i) => {
      const start = new Date(baseDate.getTime() + i * 4 * 3600000);
      const end = new Date(start.getTime() + 4 * 3600000);
      const fmt = dt => dt.toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
      return fmt(start) + '–' + fmt(end) + ' UTC';
    };

    const windowsCt = inCycle.filter(s => s.applicationName !== 'SQL Server' && !s.serverName.startsWith('SQL')).length;
    const sqlCt = inCycle.length - windowsCt;
    const prodCt = inCycle.filter(s => s.environment === 'Prod').length;

    const title = h('span', null);
    if (upcoming) { title.appendChild(t('Upcoming cycle in ')); title.appendChild(h('em', null, 'T−' + d.nextPatch.days + ' days')); }
    else title.appendChild(t('Completed cycle'));

    const kpisEl = kpis([
      { lbl: 'Servers', val: String(cycle.count), sub: 'scoped' },
      { lbl: 'Windows / SQL', val: h('span', null, String(windowsCt), h('span', { style: { color: 'var(--ink-4)', fontSize: '18px', fontWeight: '400' } }, ' / ' + sqlCt)), sub: 'servers by stack' },
      { lbl: 'Production', val: String(prodCt), tone: 'warn', sub: 'requires change ticket' },
      { lbl: 'Known issues', val: String(Object.values(d.nextPatch.issues).reduce((a,b)=>a+b,0)), tone: 'crit', sub: 'flagged for this cycle' },
    ]);

    // known issues
    const kbBlock = h('div.kb-block');
    for (const iss of d.issues.slice(0, 4)) {
      const row = h('div', { style: { padding: '10px 0', borderBottom: '1px solid var(--rule)', display: 'grid', gridTemplateColumns: '1fr auto', gap: '12px', alignItems: 'center' } },
        h('div', null,
          h('div.kb-title', { style: { fontSize: '13px' } }, iss.title),
          h('div', { style: { fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--ink-3)', marginTop: '3px' } },
            [iss.win && 'Windows', iss.sql && 'SQL'].filter(Boolean).join(' · ') + ' — fix: ' + iss.fix)
        ),
        Badge(iss.severity === 'High' ? 'crit' : iss.severity === 'Medium' ? 'warn' : 'info', iss.severity)
      );
      kbBlock.appendChild(row);
    }

    // servers by group
    const listEl = h('div.detail-list', { style: { marginTop: '8px' } });
    let anyMatch = false;
    for (const g of groupKeys) {
      const matches = byGroup[g].filter(s => !qs.get() || (s.serverName + ' ' + s.applicationName + ' ' + g).toLowerCase().includes(qs.get().toLowerCase()));
      if (matches.length === 0) continue;
      anyMatch = true;
      const gi = groupKeys.indexOf(g);
      listEl.appendChild(h('div.group-heading', null,
        h('span', null, g + ' · window ' + (gi + 1) + ' · ' + fmtWin(gi)),
        h('span', null, matches.length + (qs.get() ? ' of ' + byGroup[g].length : '') + ' servers')
      ));
      const isExpanded = expandedS.get().has(g);
      const showCount = isExpanded ? matches.length : Math.min(PAGE_SIZE, matches.length);
      for (let i = 0; i < showCount; i++) {
        const s = matches[i];
        listEl.appendChild(h('div.row', null,
          h('div.idx', null, String(i + 1).padStart(2, '0')),
          h('div', null,
            h('div.name', null, s.serverName),
            h('div', { style: { fontFamily: 'var(--mono)', fontSize: '10.5px', color: 'var(--ink-4)', marginTop: '2px' } }, s.applicationName)
          ),
          h('span.tag', null, s.environment),
          h('span.right', null, s.dataCenter || 'DC-01')
        ));
      }
      if (matches.length > PAGE_SIZE) {
        const toggle = () => {
          const next = new Set(expandedS.get());
          if (next.has(g)) next.delete(g); else next.add(g);
          expandedS.set(next);
        };
        const hiddenCount = matches.length - PAGE_SIZE;
        listEl.appendChild(h('div.row', {
          role: 'button',
          tabIndex: 0,
          'aria-expanded': isExpanded ? 'true' : 'false',
          'aria-label': isExpanded
            ? 'Collapse ' + g + ' server list'
            : 'Show ' + hiddenCount + ' more servers in ' + g,
          style: {
            color: 'var(--signal)',
            gridTemplateColumns: '1fr',
            cursor: 'pointer',
            justifyContent: 'center',
            textAlign: 'center'
          },
          onclick: toggle,
          onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }
        },
          h('span', { style: { fontFamily: 'var(--mono)', fontSize: '11px', letterSpacing: '0.06em' } },
            isExpanded ? '− Show fewer' : '+ Show ' + hiddenCount + ' more servers in this group')
        ));
      }
    }
    if (!anyMatch && qs.get()) {
      listEl.appendChild(h('div.no-hits', null, 'No servers match ', h('b', null, qs.get()), '.'));
    }

    const groupsSec = h('div.drawer-section');
    groupsSec.appendChild(h('div.lbl', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
      h('span', null, 'Servers by group ', h('span.ct', null, groupKeys.length + ' rolling windows'))
    ));
    groupsSec.appendChild(InlineSearch(qs.get(), v => qs.set(v), 'Search server, application, group…'));
    groupsSec.appendChild(listEl);

    // CSV export: honours the drawer's current search filter.
    const exportCycle = () => {
      const q2 = qs.get().toLowerCase();
      const rows = [];
      for (const g of groupKeys) {
        const gi = groupKeys.indexOf(g);
        const windowLabel = 'window ' + (gi + 1) + ' · ' + fmtWin(gi);
        for (const s of byGroup[g]) {
          if (q2 && !((s.serverName + ' ' + s.applicationName + ' ' + g).toLowerCase().includes(q2))) continue;
          rows.push({
            serverName: s.serverName,
            applicationName: s.applicationName,
            patchGroup: g,
            window: windowLabel,
            environment: s.environment,
            dataCenter: s.dataCenter || 'DC-01'
          });
        }
      }
      downloadCsv('cycle-' + cycle.id + '-servers-' + isoDay() + '.csv', rows, [
        { key: 'serverName', label: 'Hostname' },
        { key: 'applicationName', label: 'Application' },
        { key: 'patchGroup', label: 'Patch group' },
        { key: 'window', label: 'Window' },
        { key: 'environment', label: 'Environment' },
        { key: 'dataCenter', label: 'Data centre' },
      ]);
    };
    const footer = h('div', { style: { display: 'flex', gap: '8px', justifyContent: 'flex-end' } },
      h('button.drawer-close', {
        onclick: exportCycle,
        title: qs.get() ? 'Export filtered server list' : 'Export all ' + inCycle.length + ' servers'
      }, 'Export CSV'),
      upcoming && h('button.drawer-close', { style: { background: 'var(--signal)', color: 'var(--paper)', borderColor: 'var(--signal)' } }, 'Approve cycle')
    );

    return Drawer({
      counter: 'CYCLE · #' + cycle.id,
      title,
      subtitle: fmtDate(cycle.date) + ' · ' + cycle.count + ' servers · ' + groupKeys.length + ' groups · ' + (upcoming ? 'scheduled' : 'executed') + ' in ' + groupKeys.length + ' rolling windows',
      body: [
        kpisEl,
        section('Known issues affecting this cycle', d.issues.length, kbBlock),
        groupsSec,
      ],
      footer,
      closeDrawer
    });
  };

  // ═══════════════════════════════════════════════════════════
  // ISSUE
  // ═══════════════════════════════════════════════════════════
  OC.drawers.issue = function (issue, d, ctx) {
    const { closeDrawer, ps } = ctx;
    const qs = ps('drawer-issue:' + issue.id, 'q', '');
    const expandedS = ps('drawer-issue:' + issue.id, 'expanded', false);
    const PAGE_SIZE = 10;

    const affected = d.servers.filter(s => {
      if (issue.win && !issue.sql) return !s.serverName.startsWith('SQL');
      if (issue.sql && !issue.win) return s.serverName.startsWith('SQL');
      return true;
    });

    const kbs = [
      { id: 'KB50344' + (40 + issue.id), title: 'Cumulative update including fix', date: '2026-04-15' },
      { id: 'KB50345' + (10 + issue.id), title: 'Out-of-band hotfix', date: '2026-03-02' },
    ];
    const history = [
      { date: '2026-03-12', cycle: 11, count: 3, status: 'resolved' },
      { date: '2026-02-12', cycle: 10, count: 7, status: 'resolved' },
      { date: '2026-01-15', cycle: 9, count: 12, status: 'resolved' },
      { date: '2025-12-18', cycle: 8, count: 18, status: 'new' },
    ];
    const sevTone = s => s === 'High' ? 'crit' : s === 'Medium' ? 'warn' : 'info';

    const title = h('span', null, 'Known issue: ', h('em', null, issue.severity === 'High' ? 'High severity' : issue.severity));

    const kpisEl = kpis([
      { lbl: 'Severity', val: issue.severity, tone: issue.severity === 'High' ? 'crit' : issue.severity === 'Medium' ? 'warn' : 'ok', sub: 'vendor rating' },
      { lbl: 'Affects', val: String(affected.length), sub: 'servers scoped' },
      { lbl: 'First seen', val: '#' + history[history.length - 1].cycle, sub: history[history.length - 1].date },
      { lbl: 'Patched', val: String(history.filter(h => h.status === 'resolved').length), tone: 'ok', sub: 'of ' + history.length + ' prior cycles' },
    ]);

    // description
    const descBlock = h('div.kb-block', null,
      h('div', { style: { fontSize: '13px', lineHeight: '1.55', color: 'var(--ink)' } }, issue.title),
      h('div', { style: { fontFamily: 'var(--mono)', fontSize: '11.5px', color: 'var(--ink-2)', marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--rule)' } },
        h('b', null, 'Platform:'), ' ' + [issue.win && 'Windows Server', issue.sql && 'SQL Server'].filter(Boolean).join(' · '),
        h('br'),
        h('b', null, 'Suggested fix:'), ' ' + issue.fix
      )
    );

    // kbs
    const kbsEl = h('div');
    for (const kb of kbs) {
      kbsEl.appendChild(h('div.kb-block', { style: { marginBottom: '8px' } },
        h('div.kb', null, kb.id + ' · ' + kb.date),
        h('div.kb-title', { style: { fontSize: '13px' } }, kb.title)
      ));
    }

    // history rail
    const rail = h('div.hist-rail');
    for (const hh of history.slice().reverse()) {
      rail.appendChild(h('div.h-cell', null,
        h('div.date', null, '#' + hh.cycle + ' · ' + hh.date.slice(5)),
        h('div.ct', null, String(hh.count)),
        h('div.st' + (hh.status === 'new' ? '.fail' : ''), null, hh.status)
      ));
    }

    // affected servers
    const q = qs.get().toLowerCase();
    const matches = affected.filter(s => !q || (s.serverName + ' ' + s.applicationName + ' ' + (s.patchGroup || '') + ' ' + s.environment).toLowerCase().includes(q));
    const isExpanded = expandedS.get();
    const showCount = isExpanded ? matches.length : Math.min(PAGE_SIZE, matches.length);
    const affList = h('div.detail-list', { style: { marginTop: '8px' } });
    for (let i = 0; i < showCount; i++) {
      const s = matches[i];
      affList.appendChild(h('div.row', null,
        h('div.idx', null, String(i + 1).padStart(2, '0')),
        h('div', null,
          h('div.name', null, s.serverName),
          h('div', { style: { fontFamily: 'var(--mono)', fontSize: '10.5px', color: 'var(--ink-4)', marginTop: '2px' } }, s.applicationName + ' · ' + (s.patchGroup || '—'))
        ),
        h('span.tag', null, s.environment),
        Badge(sevTone(issue.severity), 'not yet patched')
      ));
    }
    if (q && matches.length === 0) affList.appendChild(h('div.no-hits', null, 'No servers match ', h('b', null, qs.get()), '.'));
    if (matches.length > PAGE_SIZE) {
      const toggle = () => expandedS.set(!expandedS.get());
      const hiddenCount = matches.length - PAGE_SIZE;
      affList.appendChild(h('div.row', {
        role: 'button',
        tabIndex: 0,
        'aria-expanded': isExpanded ? 'true' : 'false',
        'aria-label': isExpanded ? 'Collapse affected servers list' : 'Show ' + hiddenCount + ' more affected servers',
        style: { color: 'var(--signal)', gridTemplateColumns: '1fr', cursor: 'pointer', justifyContent: 'center', textAlign: 'center' },
        onclick: toggle,
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }
      },
        h('span', { style: { fontFamily: 'var(--mono)', fontSize: '11px', letterSpacing: '0.06em' } },
          isExpanded ? '− Show fewer' : '+ Show ' + hiddenCount + ' more affected servers')
      ));
    }

    const affSec = h('div.drawer-section', null,
      h('div.lbl', null, 'Affected servers ', h('span.ct', null, matches.length + (qs.get() ? ' of ' + affected.length : ''))),
      InlineSearch(qs.get(), v => qs.set(v), 'Search server, application, group, env…'),
      affList
    );

    return Drawer({
      counter: 'ISSUE · #' + issue.id,
      title,
      subtitle: issue.title,
      body: [
        kpisEl,
        section('Description', null, descBlock),
        section('Related KB articles', kbs.length, kbsEl),
        section('Occurrence history', null, rail),
        affSec
      ],
      closeDrawer
    });
  };

  // ═══════════════════════════════════════════════════════════
  // EOL
  // ═══════════════════════════════════════════════════════════
  OC.drawers.eol = function (product, d, ctx) {
    const { closeDrawer, ps } = ctx;
    const qs = ps('drawer-eol:' + product.product + product.version, 'q', '');
    const expandedS = ps('drawer-eol:' + product.product + product.version, 'expanded', false);
    const PAGE_SIZE = 10;

    const tone = product.status === 'eol' ? 'crit' : product.status === 'extended' ? 'warn' : product.status === 'approaching' ? 'info' : 'ok';
    const label = product.status === 'eol' ? 'End of Life' : product.status === 'extended' ? 'Extended' : product.status === 'approaching' ? 'Approaching' : 'Supported';

    const pool = d.servers.filter(s => {
      if (product.product.includes('SQL')) return s.serverName.startsWith('SQL') || s.applicationName === 'SQL Server';
      if (product.product.includes('IIS')) return s.applicationName === 'Web API' || s.applicationName === 'Customer Portal';
      if (product.product.includes('Windows Server')) return !s.serverName.startsWith('SQL');
      if (product.product.includes('.NET')) return s.applicationName === 'Web API' || s.applicationName === 'Payment Service' || s.applicationName === 'Customer Portal';
      return true;
    });
    const affected = pool.slice(0, product.assets);
    const envSplit = {};
    affected.forEach(s => { envSplit[s.environment] = (envSplit[s.environment] || 0) + 1; });
    const daysUntil = Math.floor((new Date(product.eol) - Date.now()) / (1000 * 60 * 60 * 24));
    const daysUntilExt = product.ext ? Math.floor((new Date(product.ext) - Date.now()) / (1000 * 60 * 60 * 24)) : null;

    const title = h('span', null, product.product + ' ', h('em', null, product.version));

    const kpisCells = [
      { lbl: 'Status', val: label, tone, sub: 'vendor support' },
      { lbl: 'End of life', val: fmtShortDate(product.eol), sub: (daysUntil < 0 ? Math.abs(daysUntil) + 'd past' : daysUntil + 'd ahead') },
    ];
    if (product.ext && product.ext !== product.eol) {
      kpisCells.push({ lbl: 'Extended', val: fmtShortDate(product.ext), sub: daysUntilExt < 0 ? Math.abs(daysUntilExt) + 'd past' : daysUntilExt + 'd ahead' });
    }
    kpisCells.push({ lbl: 'Hosts', val: String(product.assets), sub: 'running this version' });

    // env distribution
    const envBlock = h('div.kb-block', { style: { padding: '0' } });
    const envEntries = Object.entries(envSplit).sort((a,b) => b[1] - a[1]);
    for (const [env, n] of envEntries) {
      const pct = n / affected.length;
      const fillCol = env === 'Prod' ? 'var(--crit)' : env === 'Staging' ? 'var(--warn)' : 'var(--signal)';
      envBlock.appendChild(h('div', { style: { display: 'grid', gridTemplateColumns: '90px 1fr 50px', gap: '14px', alignItems: 'center', padding: '10px 16px', borderBottom: '1px solid var(--rule)' } },
        h('span', { style: { fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--ink)' } }, env),
        h('div', { style: { height: '6px', background: 'var(--wash)', position: 'relative' } },
          h('div', { style: { position: 'absolute', inset: '0', width: (pct * 100) + '%', background: fillCol } })
        ),
        h('span', { style: { fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--ink-2)', textAlign: 'right' } }, String(n))
      ));
    }

    // plan
    let planText;
    if (product.status === 'eol') planText = [t('Vendor support ended '), h('b', null, Math.abs(daysUntil) + ' days ago'), t('. These hosts accumulate audit and security risk with every passing day. Plan remediation in the next 1–2 patch cycles.')];
    else if (product.status === 'extended') planText = [t('On extended / ESU support until ' + fmtShortDate(product.ext) + '. Begin migration planning now — extended support typically adds licensing cost.')];
    else if (product.status === 'approaching') planText = [t('Support ends in ' + daysUntil + ' days. Confirm upgrade path and schedule migration waves in cycles #' + (d.cycles[0].id + 1) + '–#' + (d.cycles[0].id + 3) + '.')];
    else planText = [t('Fully supported by vendor. No action required until the support window closes in ' + daysUntil + ' days.')];
    const planBlock = h('div.kb-block', null, h('div', { style: { fontSize: '13px', lineHeight: '1.55', color: 'var(--ink)' } }, ...planText));

    // affected
    const q = qs.get().toLowerCase();
    const matches = affected.filter(s => !q || (s.serverName + ' ' + s.applicationName + ' ' + (s.patchGroup || '') + ' ' + s.environment).toLowerCase().includes(q));
    const isExpanded = expandedS.get();
    const showCount = isExpanded ? matches.length : Math.min(PAGE_SIZE, matches.length);
    const affBadge = product.status === 'eol' ? 'at risk' : product.status === 'extended' ? 'ESU' : product.status === 'approaching' ? 'plan upgrade' : 'supported';
    const affList = h('div.detail-list', { style: { marginTop: '8px' } });
    for (let i = 0; i < showCount; i++) {
      const s = matches[i];
      affList.appendChild(h('div.row', null,
        h('div.idx', null, String(i + 1).padStart(2, '0')),
        h('div', null,
          h('div.name', null, s.serverName),
          h('div', { style: { fontFamily: 'var(--mono)', fontSize: '10.5px', color: 'var(--ink-4)', marginTop: '2px' } }, s.applicationName + ' · ' + (s.patchGroup || '—'))
        ),
        h('span.tag', null, s.environment),
        Badge(tone, affBadge)
      ));
    }
    if (q && matches.length === 0) affList.appendChild(h('div.no-hits', null, 'No hosts match ', h('b', null, qs.get()), '.'));
    if (matches.length > PAGE_SIZE) {
      const toggle = () => expandedS.set(!expandedS.get());
      const hiddenCount = matches.length - PAGE_SIZE;
      affList.appendChild(h('div.row', {
        role: 'button',
        tabIndex: 0,
        'aria-expanded': isExpanded ? 'true' : 'false',
        'aria-label': isExpanded ? 'Collapse affected hosts list' : 'Show ' + hiddenCount + ' more affected hosts',
        style: { color: 'var(--signal)', gridTemplateColumns: '1fr', cursor: 'pointer', justifyContent: 'center', textAlign: 'center' },
        onclick: toggle,
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }
      },
        h('span', { style: { fontFamily: 'var(--mono)', fontSize: '11px', letterSpacing: '0.06em' } },
          isExpanded ? '− Show fewer' : '+ Show ' + hiddenCount + ' more affected hosts')
      ));
    }

    const affSec = h('div.drawer-section', null,
      h('div.lbl', null, 'Affected hosts ', h('span.ct', null, matches.length + (qs.get() ? ' match' : ' of ' + product.assets))),
      InlineSearch(qs.get(), v => qs.set(v), 'Search host, application, group, env…'),
      affList
    );

    const exportEolHosts = () => {
      const slug = (product.product + '-' + product.version).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      downloadCsv(slug + '-hosts-' + isoDay() + '.csv', matches, [
        { key: 'serverName', label: 'Hostname' },
        { key: 'applicationName', label: 'Application' },
        { key: 'patchGroup', label: 'Patch group' },
        { key: 'environment', label: 'Environment' },
        { key: 'product', label: 'Product', value: () => product.product },
        { key: 'version', label: 'Version', value: () => product.version },
        { key: 'status', label: 'Status', value: () => product.status },
      ]);
    };
    const footer = h('div', { style: { display: 'flex', gap: '8px', justifyContent: 'flex-end' } },
      h('button.drawer-close', {
        onclick: exportEolHosts,
        title: qs.get() ? 'Export filtered host list' : 'Export all ' + matches.length + ' hosts'
      }, 'Export host list'),
      h('button.drawer-close', { style: { background: 'var(--signal)', color: 'var(--paper)', borderColor: 'var(--signal)' } }, 'Open upgrade ticket')
    );

    return Drawer({
      counter: 'LIFECYCLE · ' + product.status.toUpperCase(),
      title,
      subtitle: label + ' · ' + product.assets + ' hosts affected · EOL ' + fmtShortDate(product.eol),
      body: [
        kpis(kpisCells),
        section('Environment distribution', null, envBlock),
        section('Migration plan', null, planBlock),
        affSec
      ],
      footer,
      closeDrawer
    });
  };

})();
