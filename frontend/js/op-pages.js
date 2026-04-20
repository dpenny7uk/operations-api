/* Operations Console — page renderers (pure vanilla) */
(function () {
  'use strict';
  const OC = window.OC;
  const { h, t, Badge, SectionLabel, PageHead, InlineSearch, SortableTable, fmtRel, fmtDate, fmtShortDate, downloadCsv, isoDay } = OC;

  // ═══════════════════════════════════════════════════════════
  // HEALTH
  // ═══════════════════════════════════════════════════════════
  OC.pages.health = function (d, ctx) {
    const { setPage, apiScenario } = ctx;
    const critTotal = d.unreachable.length + d.certSummary.expiredCount + d.certSummary.criticalCount;
    const apiBad = apiScenario && apiScenario.banner;

    const page = h('div.page');
    page.appendChild(PageHead('01 / HEALTH', 'System overview', 'Live operational status across all managed servers, certificates, syncs, and scheduled patch cycles.'));

    // crit strip
    const syncFails = d.syncs.filter(s => s.status !== 'success').length;
    const strip = h('div.crit-strip');
    strip.appendChild(h('div.cs-cell.status-cell.' + (critTotal === 0 ? 'ok' : critTotal > 3 ? 'crit' : 'warn'), null,
      h('div.cs-label', null, 'System status'),
      h('div.cs-value', null, critTotal === 0 ? 'Healthy' : critTotal > 3 ? 'Degraded' : 'Attention'),
      h('div.cs-sub', null, critTotal + ' critical signals')));
    strip.appendChild(h('div.cs-cell.' + (d.nextPatch.days <= 3 ? 'crit' : d.nextPatch.days <= 7 ? 'warn' : 'info'),
      { onclick: () => setPage('patching') },
      h('div.cs-label', null, 'Next patch cycle'),
      h('div.cs-value', null, String(d.nextPatch.days), h('span.cs-unit', null, 'days')),
      h('div.cs-sub', null, d.nextPatch.servers + ' servers · cycle #' + d.cycles[0].id),
      h('div.cs-link', null, 'View schedule')));
    strip.appendChild(h('div.cs-cell.' + (d.unmatched.length > 10 ? 'warn' : 'info'), { onclick: () => setPage('servers') },
      h('div.cs-label', null, 'Unmatched servers'),
      h('div.cs-value', null, String(d.unmatched.length)),
      h('div.cs-sub', null, 'pending review'),
      h('div.cs-link', null, 'Review queue')));
    strip.appendChild(h('div.cs-cell.' + (syncFails > 0 ? 'crit' : 'ok'), null,
      h('div.cs-label', null, 'Sync failures'),
      h('div.cs-value', null, String(syncFails)),
      h('div.cs-sub', null, syncFails === 1 ? '1 sync failing' : syncFails + ' syncs failing'),
      h('div.cs-link', null, 'View sync status')));
    strip.appendChild(h('div.cs-cell.' + (d.exclusions.length > 3 ? 'warn' : 'info'), { onclick: () => setPage('patchmgmt') },
      h('div.cs-label', null, 'Patch exclusions'),
      h('div.cs-value', null, String(d.exclusions.length)),
      h('div.cs-sub', null, 'held / expired'),
      h('div.cs-link', null, 'Review exclusions')));
    page.appendChild(strip);

    // api endpoint strip
    if (apiBad) {
      const endptSec = h('div');
      endptSec.appendChild(SectionLabel('API endpoint status', apiScenario.errors.length));
      const ep = h('div.endpoint-strip');
      for (const err of apiScenario.errors) {
        const parts = err.ep.split(' ');
        ep.appendChild(h('div.endpoint-row', null,
          h('div', null, h('div.method', null, parts[0]), h('div.path', null, parts[1])),
          h('div.err' + (err.code === 0 ? '' : err.code >= 500 ? '' : '.warn'), null, err.code === 0 ? 'NETWORK' : String(err.code)),
          h('div.muted', { style: { color: 'var(--ink-2)' } }, err.msg),
          h('div.tries', null, err.tries)
        ));
      }
      endptSec.appendChild(ep);
      page.appendChild(endptSec);
    }

    // KPI grid
    const kpiGrid = h('div.kpi-grid');
    const kHero = h('div.kpi.hero' + (apiBad ? '.stale' : ''), null);
    const kHeroLbl = h('div.k-label', null, 'Operational Posture');
    if (apiBad) kHeroLbl.appendChild(h('span.stale-chip.off', null, 'cached'));
    kHero.appendChild(kHeroLbl);
    kHero.appendChild(h('div.k-value', null, apiBad ? 'Unknown' : (critTotal === 0 ? 'Nominal' : 'Attention')));
    kHero.appendChild(h('div.k-sub', null, apiBad ? 'cannot verify' : (critTotal + ' critical signals · ' + syncFails + ' stale syncs')));
    const microbar = h('div.microbar');
    microbar.appendChild(h('span', { style: { width: '72%', background: 'var(--ok)' } }));
    microbar.appendChild(h('span', { style: { width: '18%', background: 'var(--warn)' } }));
    microbar.appendChild(h('span', { style: { width: '10%', background: 'var(--crit)' } }));
    kHero.appendChild(microbar);
    kpiGrid.appendChild(kHero);

    const kUnr = h('div.kpi.crit-kpi' + (apiBad ? '.stale' : ''), null,
      (function() { const l = h('div.k-label', null, 'Unreachable'); if (apiBad) l.appendChild(h('span.stale-chip', null, 'stale')); return l; })(),
      h('div.k-value', null, String(d.unreachable.length)),
      h('div.k-sub', null, 'servers silent > 30m'),
      h('div.k-chip', null, 'LAST 24H'));
    kpiGrid.appendChild(kUnr);

    const kCert = h('div.kpi.warn-kpi' + (apiBad ? '.stale' : ''), null,
      (function() { const l = h('div.k-label', null, 'Certs expiring ≤ 14d'); if (apiBad) l.appendChild(h('span.stale-chip', null, 'stale')); return l; })(),
      h('div.k-value', null, String(d.certSummary.criticalCount + d.certSummary.expiredCount)),
      h('div.k-sub', null, d.certSummary.expiredCount + ' expired · ' + d.certSummary.criticalCount + ' critical'),
      h('div.k-chip', null, 'AUTO-ROTATE OFF'));
    kpiGrid.appendChild(kCert);
    page.appendChild(kpiGrid);

    // split: alerts + key metrics
    const split = h('div.split');
    const alertsCol = h('div');
    alertsCol.appendChild(SectionLabel('Recent alerts', d.alerts.length));
    const feed = h('div.feed');
    for (const a of d.alerts) {
      const tone = a.level === 'crit' ? 'crit' : a.level === 'warn' ? 'warn' : 'info';
      const lbl = a.level === 'crit' ? 'Critical' : a.level === 'warn' ? 'Warning' : 'Info';
      feed.appendChild(h('div.feed-item.' + a.level, null,
        h('div.when', null, fmtRel(a.ts)),
        h('div.what', null, a.msg, h('small', null, a.sub)),
        Badge(tone, lbl)
      ));
    }
    alertsCol.appendChild(feed);
    split.appendChild(alertsCol);

    const metricsCol = h('div');
    metricsCol.appendChild(SectionLabel('Key metrics'));
    const metrics = [
      ['Total servers', 100, d.serverTotal],
      ['Active', d.serverActive/d.serverTotal*100, d.serverActive],
      ['Certificates', 100, d.certSummary.totalCount],
      ['Unmatched', d.unmatched.length/40*100, d.unmatched.length],
      ['Patch cycles (YTD)', d.cycles.length/12*100, d.cycles.length],
      ['Software tracked', d.eol.length/20*100, d.eol.length],
    ];
    const envBars = h('div.env-bars');
    for (const [name, pct, count] of metrics) {
      envBars.appendChild(h('div.env-row', null,
        h('div.name', null, name),
        h('div.bar', null, h('div.fill', { style: { width: pct + '%' } })),
        h('div.count', null, String(count))
      ));
    }
    metricsCol.appendChild(envBars);
    split.appendChild(metricsCol);
    page.appendChild(split);

    // sync pulse
    const syncSec = h('div');
    syncSec.appendChild(SectionLabel('Data sync pipelines', d.syncs.length));
    const pulse = h('div.sync-pulse');
    for (const s of d.syncs) {
      const bars = [];
      for (let i = 23; i >= 0; i--) {
        const r = Math.sin((s.name.length + i) * 1.7) * 0.5 + 0.5;
        let cls = 'ok';
        if (s.status === 'warning' && i < 3) cls = 'err';
        else if (s.status === 'warning' && i < 6) cls = 'warn';
        else if (r < 0.04) cls = 'miss';
        bars.push(h('span.' + cls));
      }
      pulse.appendChild(h('div.sync-row', null,
        h('div.name', null, s.name, h('small', null, s.schedule)),
        h('div.pulse', null, bars),
        h('div.when', null, (s.status === 'success' ? 'ok · ' : s.status === 'warning' ? 'stale · ' : 'err · ') + fmtRel(s.lastSuccess)),
        h('div.rec', null, s.records.toLocaleString() + ' rec')
      ));
    }
    syncSec.appendChild(pulse);
    page.appendChild(syncSec);

    // unreachable + unmatched split
    const split2 = h('div.split.even');
    const unrCol = h('div');
    const unrLbl = h('div.section-label', null,
      h('span', null, 'Unreachable servers'),
      h('span.count', null, String(d.unreachable.length)),
      h('button.btn', {
        style: { fontFamily: 'var(--mono)', fontSize: '10px', letterSpacing: '.1em', textTransform: 'uppercase', background: 'none', border: 'none', color: 'var(--ink-3)', cursor: 'pointer' },
        onclick: () => setPage('servers')
      }, 'View all →')
    );
    unrCol.appendChild(unrLbl);
    unrCol.appendChild(SortableTable({
      id: 'h-unr',
      defaultSort: { key: 'lastSeen', dir: 'desc' },
      columns: [{ key: 'serverName', label: 'Server' }, { key: 'environment', label: 'Env' }, { key: 'lastSeen', label: 'Last seen' }],
      rows: d.unreachable,
      renderRow: r => h('tr', null,
        h('td.host', null, r.serverName),
        h('td', null, h('span.env-tag', null, r.environment)),
        h('td.mono.muted', null, fmtRel(new Date(r.lastSeen).getTime()))
      )
    }));
    split2.appendChild(unrCol);

    const unmCol = h('div');
    unmCol.appendChild(h('div.section-label', null,
      h('span', null, 'Unmatched hostnames'),
      h('span.count', null, String(d.unmatched.length)),
      h('button.btn', {
        style: { fontFamily: 'var(--mono)', fontSize: '10px', letterSpacing: '.1em', textTransform: 'uppercase', background: 'none', border: 'none', color: 'var(--ink-3)', cursor: 'pointer' },
        onclick: () => setPage('servers')
      }, 'Review →')
    ));
    unmCol.appendChild(SortableTable({
      id: 'h-unm',
      columns: [{ key: 'serverNameRaw', label: 'Raw name' }, { key: 'sourceSystem', label: 'Source' }, { key: 'occurrenceCount', label: 'Seen' }],
      rows: d.unmatched.slice(0, 8),
      renderRow: r => h('tr', null,
        h('td.host', null, r.serverNameRaw),
        h('td', null, h('span.env-tag', null, r.sourceSystem)),
        h('td.num', null, r.occurrenceCount + '×')
      )
    }));
    split2.appendChild(unmCol);
    page.appendChild(split2);

    return page;
  };

  // ═══════════════════════════════════════════════════════════
  // SERVERS
  // ═══════════════════════════════════════════════════════════
  OC.pages.servers = function (d, ctx) {
    const qs = ctx.ps('servers', 'q', '');
    const envs_ = ctx.ps('servers', 'env', '');
    const pgs = ctx.ps('servers', 'page', 0);

    const filtered = d.servers.filter(s => {
      if (envs_.get() && s.environment !== envs_.get()) return false;
      if (qs.get() && !(s.serverName + ' ' + (s.applicationName||'')).toLowerCase().includes(qs.get().toLowerCase())) return false;
      return true;
    });

    const envKeys = Object.keys(d.envCounts);
    const envBars = Object.entries(d.envCounts).sort((a,b) => b[1] - a[1]);
    const maxEnv = Math.max.apply(null, envBars.map(e => e[1]));
    const pageSize = 20;
    const totalPages = Math.ceil(filtered.length / pageSize);
    const cur = pgs.get();
    const paged = filtered.slice(cur * pageSize, (cur + 1) * pageSize);

    const page = h('div.page');
    page.appendChild(PageHead('02 / INVENTORY', 'Servers', 'All hosts currently tracked in the operations catalog. Use filters to narrow by environment or hostname pattern.'));

    // env bars + kpis
    const split = h('div.split.wide-left');
    const envCol = h('div');
    const activeEnv = envs_.get();
    envCol.appendChild(SectionLabel('Population by environment',
      activeEnv ? 'filtered: ' + activeEnv : null));
    const envBarsEl = h('div.env-bars', { role: 'group', 'aria-label': 'Filter inventory by environment' });
    for (const [name, count] of envBars) {
      const isActive = activeEnv === name;
      const cls = 'div.env-row'
        + (name === 'Prod' ? '.prod' : '')
        + (isActive ? '.active' : '');
      const toggle = () => { envs_.set(isActive ? '' : name); pgs.set(0); };
      envBarsEl.appendChild(h(cls, {
        role: 'button',
        tabIndex: 0,
        'aria-pressed': isActive ? 'true' : 'false',
        'aria-label': (isActive ? 'Clear filter for ' : 'Filter to ') + name + ' — ' + count + ' servers',
        style: { cursor: 'pointer' },
        title: isActive ? 'Click to clear filter' : 'Filter inventory to ' + name,
        onclick: toggle,
        onkeydown: (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
        }
      },
        h('div.name', null, name, isActive && h('span', { style: { marginLeft: '6px', color: 'var(--signal)' } }, '●')),
        h('div.bar', null, h('div.fill', { style: { width: (count/maxEnv*100) + '%' } })),
        h('div.count', null, String(count))
      ));
    }
    envCol.appendChild(envBarsEl);
    split.appendChild(envCol);

    const kCol = h('div');
    kCol.appendChild(SectionLabel('Inventory health'));
    const kg = h('div.kpi-grid', { style: { gridTemplateColumns: '1fr 1fr' } });
    kg.appendChild(h('div.kpi', null,
      h('div.k-label', null, 'Total'),
      h('div.k-value', null, String(d.serverTotal)),
      h('div.k-sub', null, d.serverActive + ' active')));
    kg.appendChild(h('div.kpi.warn-kpi', null,
      h('div.k-label', null, 'Unmatched'),
      h('div.k-value', null, String(d.unmatched.length)),
      h('div.k-sub', null, 'pending review')));
    kCol.appendChild(kg);
    split.appendChild(kCol);
    page.appendChild(split);

    // inventory table
    const invSec = h('div');
    invSec.appendChild(SectionLabel('Server inventory', filtered.length));
    const filters = h('div.filters');
    const qInp = h('input', {
      type: 'text',
      'aria-label': 'Search servers by hostname or application',
      placeholder: 'Search hostname or application…',
      value: qs.get(),
      style: { minWidth: '280px' }
    });
    qInp.addEventListener('input', e => { qs.set(e.target.value); pgs.set(0); });
    filters.appendChild(qInp);
    const envSel = h('select', { 'aria-label': 'Filter servers by environment' });
    envSel.appendChild(h('option', { value: '' }, 'All environments'));
    for (const e of envKeys) {
      envSel.appendChild(h('option', { value: e }, e));
    }
    envSel.value = envs_.get() || '';
    envSel.addEventListener('change', e => { envs_.set(e.target.value); pgs.set(0); });
    filters.appendChild(envSel);
    filters.appendChild(h('span.ct', null, filtered.length.toLocaleString() + ' of ' + d.serverTotal.toLocaleString() + ' shown'));
    filters.appendChild(h('div.spacer'));
    const exportServers = () => {
      const envPart = envs_.get() ? '-' + envs_.get().toLowerCase().replace(/\s+/g, '-') : '';
      downloadCsv('servers' + envPart + '-' + isoDay() + '.csv', filtered, [
        { key: 'serverName', label: 'Hostname' },
        { key: 'fqdn', label: 'FQDN' },
        { key: 'ipAddress', label: 'IP' },
        { key: 'environment', label: 'Environment' },
        { key: 'applicationName', label: 'Application' },
        { key: 'patchGroup', label: 'Patch group' },
        { key: 'isActive', label: 'Active', value: r => r.isActive ? 'Yes' : 'No' },
      ]);
    };
    filters.appendChild(h('button.btn', {
      onclick: exportServers,
      disabled: filtered.length === 0,
      title: filtered.length === 0 ? 'No rows to export' : 'Export ' + filtered.length + ' rows to CSV'
    }, 'Export CSV'));
    invSec.appendChild(filters);

    invSec.appendChild(SortableTable({
      id: 'srv-inv',
      columns: [
        { key: 'serverName', label: 'Hostname' },
        { key: 'fqdn', label: 'FQDN' },
        { key: 'environment', label: 'Env' },
        { key: 'applicationName', label: 'Application' },
        { key: 'patchGroup', label: 'Patch group' },
        { key: 'isActive', label: 'State' },
      ],
      rows: paged,
      renderRow: s => h('tr', null,
        h('td.host', null, s.serverName),
        h('td.mono.muted', null, s.fqdn),
        h('td', null, h('span.env-tag', null, s.environment)),
        h('td', null, s.applicationName),
        h('td.mono.muted', null, s.patchGroup || '—'),
        h('td', null, s.isActive ? Badge('ok', 'Active') : Badge('neutral', 'Decomm'))
      )
    }));

    const pagin = h('div.pagination');
    pagin.appendChild(h('span', null, 'Page ' + (cur + 1) + ' / ' + (totalPages || 1)));
    const pages = h('div.pages');
    const prev = h('button', { onclick: () => pgs.set(Math.max(0, cur - 1)) }, '←');
    if (cur === 0) prev.setAttribute('disabled', '');
    const next = h('button', { onclick: () => pgs.set(Math.min(totalPages - 1, cur + 1)) }, '→');
    if (cur >= totalPages - 1) next.setAttribute('disabled', '');
    pages.appendChild(prev); pages.appendChild(next);
    pagin.appendChild(pages);
    invSec.appendChild(pagin);
    page.appendChild(invSec);

    // unmatched
    const unmSec = h('div');
    unmSec.appendChild(SectionLabel('Unmatched hostnames', d.unmatched.length));
    unmSec.appendChild(SortableTable({
      id: 'srv-unm',
      columns: [
        { key: 'serverNameRaw', label: 'Raw name' },
        { key: 'sourceSystem', label: 'Source system' },
        { key: 'occurrenceCount', label: 'Times seen' },
        { key: 'firstSeenAt', label: 'First seen' },
        { key: 'closestMatch', label: 'Closest match' },
        { key: 'actions', label: '', sortable: false },
      ],
      rows: d.unmatched,
      renderRow: u => h('tr', null,
        h('td.host', null, u.serverNameRaw),
        h('td', null, h('span.env-tag', null, u.sourceSystem)),
        h('td.num', null, String(u.occurrenceCount)),
        h('td.mono.muted', null, fmtShortDate(u.firstSeenAt)),
        h('td.mono', null, u.closestMatch || h('span', { style: { color: 'var(--ink-4)' } }, '— none —')),
        h('td', null, h('button.btn', { style: { fontSize: '10px' } }, 'Confirm'))
      )
    }));
    page.appendChild(unmSec);

    return page;
  };

  // ═══════════════════════════════════════════════════════════
  // PATCHING
  // ═══════════════════════════════════════════════════════════
  OC.pages.patching = function (d, ctx) {
    const { openDrawer } = ctx;
    const cycleQ = ctx.ps('patching', 'cycleQ', '');
    const issueQ = ctx.ps('patching', 'issueQ', '');
    const serverQ = ctx.ps('patching', 'serverQ', '');
    const sevTone = s => s === 'High' ? 'crit' : s === 'Medium' ? 'warn' : 'info';

    // Deterministic cycle → server mapping (matches CycleDetail logic)
    const pool = d.servers.filter(s => s.patchGroup && s.isActive);
    const serverToCycle = {};
    const cycleServers = {};
    for (const c of d.cycles) {
      const offset = (c.id * 7) % Math.max(1, pool.length - c.count);
      const slice = pool.slice(offset, offset + c.count);
      cycleServers[c.id] = slice;
      for (const s of slice) { if (!serverToCycle[s.serverName]) serverToCycle[s.serverName] = []; serverToCycle[s.serverName].push(c.id); }
    }

    // Server lookup: match hostname OR FQDN OR IP (case-insensitive substring)
    const sq = serverQ.get().trim().toLowerCase();
    const matchedServers = sq ? d.servers.filter(s =>
      (s.serverName && s.serverName.toLowerCase().includes(sq)) ||
      (s.fqdn && s.fqdn.toLowerCase().includes(sq)) ||
      (s.ipAddress && s.ipAddress.toLowerCase().includes(sq))
    ).slice(0, 20) : [];
    const matchedCycleIds = new Set();
    for (const ms of matchedServers) { (serverToCycle[ms.serverName] || []).forEach(id => matchedCycleIds.add(id)); }

    const filteredCycles = d.cycles.filter(c => {
      if (!cycleQ.get()) return true;
      const q = cycleQ.get().toLowerCase();
      return ('#' + c.id).includes(q) || c.status.toLowerCase().includes(q) || fmtDate(c.date).toLowerCase().includes(q);
    });
    const filteredIssues = d.issues.filter(i => {
      if (!issueQ.get()) return true;
      const q = issueQ.get().toLowerCase();
      return i.title.toLowerCase().includes(q) || i.severity.toLowerCase().includes(q) || i.fix.toLowerCase().includes(q);
    });

    const page = h('div.page');
    page.appendChild(PageHead('03 / CYCLES', 'Patching schedule', 'The next scheduled cycle, historical runs, and the catalog of known issues that may affect an upcoming window.'));

    // banner
    const groupsEl = h('div.groups');
    const maxG = Math.max.apply(null, Object.values(d.nextPatch.groups));
    for (const [g, n] of Object.entries(d.nextPatch.groups)) {
      groupsEl.appendChild(h('div.group', null,
        h('span.gn', null, g),
        h('span.gbar', null, h('span', { style: { width: (n / maxG * 100) + '%' } })),
        h('span.gc', null, String(n))
      ));
    }
    page.appendChild(h('div.patch-banner', null,
      h('div.countdown', null, h('span.n', null, 'T−' + d.nextPatch.days), h('span.unit', null, 'DAYS')),
      h('div.meta', null,
        h('div.t', null, 'Next cycle · #' + d.cycles[0].id),
        h('div.d', null, fmtDate(d.nextPatch.date)),
        h('div.sub', null, d.nextPatch.servers + ' servers · ' + Object.values(d.nextPatch.issues).reduce((a,b)=>a+b,0) + ' known issues flagged · ' + Object.keys(d.nextPatch.groups).length + ' groups')
      ),
      groupsEl
    ));

    // server lookup
    const lookSec = h('div');
    lookSec.appendChild(h('div.section-bar', null,
      SectionLabel('Is my server scheduled?'),
      InlineSearch(serverQ.get(), v => serverQ.set(v), 'Hostname, FQDN, or IP…')
    ));
    if (!sq) {
      lookSec.appendChild(h('div.hint', { style: { padding: '14px 2px', color: 'var(--ink-4)', fontSize: '12px' } },
        'Search by hostname, FQDN, or IP to see which upcoming cycles include a server.'));
    } else if (matchedServers.length === 0) {
      lookSec.appendChild(h('div.hint', { style: { padding: '14px 2px', color: 'var(--ink-3)', fontSize: '12px' } },
        'No servers match “' + sq + '”.'));
    } else {
      const lookTbl = h('div.table-wrap');
      const tt = h('table.op');
      tt.appendChild(h('thead', null, h('tr', null,
        h('th', null, 'Server'),
        h('th', null, 'Patch group'),
        h('th', null, 'Env'),
        h('th', null, 'Upcoming cycles')
      )));
      const tb = h('tbody');
      for (const s of matchedServers) {
        const cycleIds = serverToCycle[s.serverName] || [];
        const upcomingIds = cycleIds.filter(id => {
          const c = d.cycles.find(x => x.id === id);
          return c && c.status === 'Upcoming';
        });
        const chipsCell = h('td');
        if (upcomingIds.length === 0) {
          chipsCell.appendChild(h('span.muted', { style: { fontSize: '11.5px' } }, 'Not scheduled'));
        } else {
          for (const id of upcomingIds) {
            const cyc = d.cycles.find(x => x.id === id);
            const chip = h('button.btn', {
              style: { fontSize: '10.5px', padding: '3px 8px', marginRight: '6px' },
              onclick: () => openDrawer('cycle', cyc)
            }, '#' + id + ' · ' + fmtShortDate(cyc.date));
            chipsCell.appendChild(chip);
          }
        }
        const hostCell = h('td.host', null, s.serverName);
        if (s.fqdn || s.ipAddress) {
          const parts = [];
          if (s.fqdn) parts.push(s.fqdn);
          if (s.ipAddress) parts.push(s.ipAddress);
          hostCell.appendChild(h('small', {
            style: { display: 'block', fontSize: '10.5px', color: 'var(--ink-3)', marginTop: '2px', fontWeight: 400 }
          }, parts.join(' · ')));
        }
        tb.appendChild(h('tr', null,
          hostCell,
          h('td.mono.muted', null, s.patchGroup || '—'),
          h('td', null, h('span.env-tag', null, s.environment)),
          chipsCell
        ));
      }
      tt.appendChild(tb);
      lookTbl.appendChild(tt);
      lookSec.appendChild(lookTbl);
      lookSec.appendChild(h('div.hint', { style: { padding: '8px 2px 0', color: 'var(--ink-4)', fontSize: '11px' } },
        'Showing first 20 matches · ' + matchedCycleIds.size + ' distinct cycle' + (matchedCycleIds.size === 1 ? '' : 's') + ' referenced.'));
    }
    page.appendChild(lookSec);

    // cycles
    const cyclesSec = h('div');
    cyclesSec.appendChild(h('div.section-bar', null,
      SectionLabel('Patch cycles', filteredCycles.length),
      InlineSearch(cycleQ.get(), v => cycleQ.set(v), 'Search by cycle id, date, status…')
    ));
    cyclesSec.appendChild(SortableTable({
      id: 'pt-cyc',
      defaultSort: { key: 'date', dir: 'desc' },
      columns: [
        { key: 'id', label: 'Cycle', width: 90 },
        { key: 'date', label: 'Date' },
        { key: 'count', label: 'Servers' },
        { key: 'status', label: 'Status' },
      ],
      rows: filteredCycles,
      renderRow: c => h('tr.clickable-row', { onclick: () => openDrawer('cycle', c) },
        h('td.mono.strong', null, '#' + c.id),
        h('td.mono', null, fmtDate(c.date)),
        h('td.num', null, String(c.count)),
        h('td', null, c.status === 'Upcoming' ? Badge('info', 'Upcoming') : Badge('ok', 'Completed'))
      )
    }));
    page.appendChild(cyclesSec);

    // issues
    const issuesSec = h('div');
    issuesSec.appendChild(h('div.section-bar', null,
      SectionLabel('Known issues', filteredIssues.length),
      InlineSearch(issueQ.get(), v => issueQ.set(v), 'Search issue title, severity, fix…')
    ));
    issuesSec.appendChild(SortableTable({
      id: 'pt-iss',
      columns: [
        { key: 'title', label: 'Title' },
        { key: 'severity', label: 'Severity', width: 140 },
        { key: 'scope', label: 'Scope', width: 160, sortable: false },
        { key: 'fix', label: 'Suggested fix' },
      ],
      rows: filteredIssues,
      renderRow: i => h('tr.clickable-row', { onclick: () => openDrawer('issue', i) },
        h('td.strong', null, i.title),
        h('td', null, Badge(sevTone(i.severity), i.severity)),
        h('td.mono.muted', { style: { fontSize: '11px' } }, [i.win && 'Windows', i.sql && 'SQL'].filter(Boolean).join(' · ') || '—'),
        h('td.muted', null, i.fix)
      )
    }));
    page.appendChild(issuesSec);

    // exclusions (summary view; full mgmt lives on Patch Management page)
    const excSec = h('div');
    const expiredCount = d.exclusions.filter(e => new Date(e.heldUntil) < new Date()).length;
    excSec.appendChild(h('div.section-bar', null,
      SectionLabel('Active exclusions', d.exclusions.length),
      h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
        expiredCount > 0 ? Badge('crit', expiredCount + ' expired hold' + (expiredCount === 1 ? '' : 's')) : null,
        h('button.btn', { onclick: () => ctx.setPage('patchmgmt'), style: { fontSize: '10.5px' } }, 'Manage →')
      )
    ));
    excSec.appendChild(SortableTable({
      id: 'pt-exc',
      columns: [
        { key: 'server', label: 'Server' },
        { key: 'service', label: 'Service' },
        { key: 'env', label: 'Env', width: 90 },
        { key: 'dateOut', label: 'Excluded' },
        { key: 'heldUntil', label: 'Hold until' },
        { key: 'notes', label: 'Reason' },
      ],
      rows: d.exclusions,
      renderRow: e => {
        const expired = new Date(e.heldUntil) < new Date();
        return h('tr', null,
          h('td.host', null, e.server),
          h('td', null, e.service),
          h('td', null, h('span.env-tag', null, e.env)),
          h('td.mono.muted', null, fmtShortDate(e.dateOut)),
          h('td', null, expired ? Badge('crit', 'Expired ' + fmtShortDate(e.heldUntil)) : h('span.mono', { style: { color: 'var(--ink-2)' } }, fmtShortDate(e.heldUntil))),
          h('td.muted', { style: { maxWidth: '340px' } }, e.notes)
        );
      }
    }));
    page.appendChild(excSec);

    return page;
  };

  // ═══════════════════════════════════════════════════════════
  // PATCH MGMT
  // ═══════════════════════════════════════════════════════════
  OC.pages.patchmgmt = function (d, ctx) {
    const sel = ctx.ps('patchmgmt', 'selected', new Set());
    const qs = ctx.ps('patchmgmt', 'q', '');
    const reasonS = ctx.ps('patchmgmt', 'reason', '');
    const heldUntilS = ctx.ps('patchmgmt', 'heldUntil', '');
    const busyS = ctx.ps('patchmgmt', 'busy', false);

    const eligible = d.servers.filter(s =>
      (s.environment === 'Prod' || s.environment === 'Staging') &&
      (!qs.get() || s.serverName.toLowerCase().includes(qs.get().toLowerCase()))
    ).slice(0, 40);

    function toggle(name) {
      const next = new Set(sel.get());
      if (next.has(name)) next.delete(name); else next.add(name);
      sel.set(next);
    }

    async function doExclude() {
      if (busyS.get()) return;
      const reason = reasonS.get().trim();
      const heldUntil = heldUntilS.get();
      if (!reason) { alert('A reason is required.'); return; }
      if (!heldUntil) { alert('A hold-until date is required.'); return; }
      const selected = Array.from(sel.get());
      const serverIds = selected
        .map(name => (d.servers.find(s => s.serverName === name) || {}).serverId)
        .filter(Boolean);
      if (serverIds.length === 0) return;
      busyS.set(true);
      const res = await (window.OC.apiPost
        ? window.OC.apiPost('/patching/exclusions', { serverIds, reason, heldUntil })
        : Promise.resolve({ ok: false, status: 0, error: 'apiPost unavailable' }));
      busyS.set(false);
      if (!res.ok) {
        alert('Could not exclude servers (' + res.status + '): ' + (res.error || 'unknown error'));
        return;
      }
      // success — clear inputs and refresh
      reasonS.set('');
      heldUntilS.set('');
      sel.set(new Set());
      if (window.OC.refetch) window.OC.refetch();
    }

    async function doRemove(exc) {
      if (!exc || exc.id == null) { alert('Cannot remove: this exclusion has no ID (demo mode?).'); return; }
      if (!confirm('Remove exclusion for ' + exc.server + '?')) return;
      const res = await (window.OC.apiPost
        ? window.OC.apiPost('/patching/exclusions/' + encodeURIComponent(exc.id) + '/remove', {})
        : Promise.resolve({ ok: false, status: 0, error: 'apiPost unavailable' }));
      if (!res.ok) {
        alert('Could not remove (' + res.status + '): ' + (res.error || 'unknown error'));
        return;
      }
      if (window.OC.refetch) window.OC.refetch();
    }

    const page = h('div.page');
    page.appendChild(PageHead('04 / EXCLUSIONS', 'Patch Management', 'Temporarily exclude hosts from upcoming patch windows. Exclusions require a reason and hold-until date.'));

    // active exclusions
    const excSec = h('div');
    excSec.appendChild(SectionLabel('Active exclusions', d.exclusions.length));
    excSec.appendChild(SortableTable({
      id: 'pm-exc',
      columns: [
        { key: 'server', label: 'Server' },
        { key: 'service', label: 'Service' },
        { key: 'env', label: 'Env', width: 90 },
        { key: 'dateOut', label: 'Excluded' },
        { key: 'heldUntil', label: 'Hold until' },
        { key: 'notes', label: 'Notes' },
        { key: 'actions', label: '', sortable: false, width: 110 },
      ],
      rows: d.exclusions,
      renderRow: e => {
        const expired = new Date(e.heldUntil) < new Date();
        const removeBtn = h('button.btn.danger', {
          title: 'Remove exclusion',
          'aria-label': 'Remove exclusion for ' + e.server,
          onclick: () => doRemove(e)
        }, 'Remove');
        return h('tr', null,
          h('td.host', null, e.server),
          h('td', null, e.service, h('div.mono.muted', { style: { fontSize: '10.5px', marginTop: '2px' } }, e.fn)),
          h('td', null, h('span.env-tag', null, e.env)),
          h('td.mono.muted', null, fmtShortDate(e.dateOut)),
          h('td', null, expired ? Badge('crit', 'Expired') : h('span.mono', { style: { color: 'var(--ink-2)' } }, fmtShortDate(e.heldUntil))),
          h('td.muted', { style: { maxWidth: '340px' } }, e.notes),
          h('td', { style: { textAlign: 'right', paddingRight: '24px' } }, removeBtn)
        );
      }
    }));
    page.appendChild(excSec);

    // eligibility pool
    const elSec = h('div');
    elSec.appendChild(SectionLabel('Exclude from next cycle', eligible.length));
    const filters = h('div.filters');
    const qInp = h('input', {
      type: 'text',
      'aria-label': 'Search eligible servers',
      placeholder: 'Search servers…',
      value: qs.get()
    });
    qInp.addEventListener('input', e => qs.set(e.target.value));
    filters.appendChild(qInp);
    filters.appendChild(h('span.ct', null, sel.get().size + ' selected'));
    filters.appendChild(h('div.spacer'));

    const reasonInp = h('input', {
      type: 'text',
      'aria-label': 'Exclusion reason',
      placeholder: 'Reason (required)',
      value: reasonS.get(),
      style: { minWidth: '220px' }
    });
    reasonInp.addEventListener('input', e => reasonS.set(e.target.value));
    filters.appendChild(reasonInp);

    const dateInp = h('input', {
      type: 'date',
      'aria-label': 'Hold until date',
      value: heldUntilS.get(),
      style: { minWidth: '150px' }
    });
    dateInp.addEventListener('change', e => heldUntilS.set(e.target.value));
    filters.appendChild(dateInp);

    const selSize = sel.get().size;
    const busy = busyS.get();
    const excBtn = h('button.btn.danger', {
      onclick: doExclude
    }, busy ? 'Excluding…' : ('Exclude ' + (selSize > 0 ? selSize + ' server' + (selSize > 1 ? 's' : '') : '—')));
    if (selSize === 0 || busy) excBtn.setAttribute('disabled', '');
    filters.appendChild(excBtn);
    elSec.appendChild(filters);

    const tblWrap = h('div.table-wrap');
    const tbl = h('table.op');
    const thead = h('thead', null, h('tr', null,
      h('th', { style: { width: '44px' } }),
      h('th', null, 'Server'),
      h('th', null, 'Patch group'),
      h('th', null, 'Service'),
      h('th', null, 'Env')
    ));
    tbl.appendChild(thead);
    const tbody = h('tbody');
    for (const s of eligible) {
      const tr = h('tr', { style: sel.get().has(s.serverName) ? { background: 'var(--signal-wash)' } : null });
      const cb = h('input', { type: 'checkbox', style: { cursor: 'pointer' } });
      if (sel.get().has(s.serverName)) cb.setAttribute('checked', '');
      cb.addEventListener('change', () => toggle(s.serverName));
      tr.appendChild(h('td', null, cb));
      tr.appendChild(h('td.host', null, s.serverName));
      tr.appendChild(h('td.mono.muted', null, s.patchGroup || '—'));
      tr.appendChild(h('td', null, s.applicationName));
      tr.appendChild(h('td', null, h('span.env-tag', null, s.environment)));
      tbody.appendChild(tr);
    }
    tbl.appendChild(tbody);
    tblWrap.appendChild(tbl);
    elSec.appendChild(tblWrap);
    page.appendChild(elSec);

    return page;
  };

  // ═══════════════════════════════════════════════════════════
  // CERTIFICATES
  // ═══════════════════════════════════════════════════════════
  OC.pages.certificates = function (d, ctx) {
    const lvl = ctx.ps('certs', 'level', '');
    const qs = ctx.ps('certs', 'q', '');
    const filtered = d.certs.filter(c => {
      if (lvl.get() && c.alertLevel !== lvl.get()) return false;
      if (qs.get() && !(c.subjectCn + ' ' + c.serverName).toLowerCase().includes(qs.get().toLowerCase())) return false;
      return true;
    });

    const nowPct = 10;
    const dayToPct = (days) => {
      if (days < 0) return Math.max(0, nowPct + (days / 90) * nowPct);
      const compressed = days <= 30 ? (days/30)*0.35
        : days <= 90 ? 0.35 + ((days-30)/60)*0.25
        : days <= 180 ? 0.6 + ((days-90)/90)*0.2
        : 0.8 + ((days-180)/185)*0.2;
      return nowPct + compressed * (100 - nowPct);
    };
    const ticks = [
      { days: -60, label: '60d ago', sub: 'EXPIRED' },
      { days: 0, label: 'TODAY', sub: '' },
      { days: 14, label: '+14d', sub: 'CRITICAL' },
      { days: 30, label: '+30d', sub: 'WARNING' },
      { days: 90, label: '+3mo', sub: '' },
      { days: 180, label: '+6mo', sub: '' },
      { days: 365, label: '+1yr', sub: '' },
    ];
    const lanes = [
      { key: 'expired', label: 'Expired', tone: 'expired', min: -120, max: 0, count: d.certSummary.expiredCount },
      { key: 'crit', label: '≤ 14 days', tone: 'crit', min: 0, max: 14, count: d.certSummary.criticalCount },
      { key: 'warn', label: '15–60 days', tone: 'warn', min: 15, max: 60, count: d.certSummary.warningCount },
      { key: 'ok', label: '60d – 1yr', tone: 'ok', min: 60, max: 365, count: d.certSummary.okCount },
    ];

    const page = h('div.page');
    page.appendChild(PageHead('05 / CERTIFICATES', 'Certificate landscape', 'Every TLS certificate in scope, mapped against expiry. Red is reality; green is runway.'));

    const kpi = h('div.kpi-grid');
    kpi.appendChild(h('div.kpi.hero', null,
      h('div.k-label', null, 'Total certificates'),
      h('div.k-value', null, String(d.certSummary.totalCount)),
      h('div.k-sub', null, 'across ' + (new Set(d.certs.map(c => c.serverName))).size + ' servers')));
    kpi.appendChild(h('div.kpi.crit-kpi', null,
      h('div.k-label', null, 'Expired'),
      h('div.k-value', null, String(d.certSummary.expiredCount)),
      h('div.k-sub', null, 'action required now')));
    kpi.appendChild(h('div.kpi.warn-kpi', null,
      h('div.k-label', null, 'Expiring ≤ 60d'),
      h('div.k-value', null, String(d.certSummary.criticalCount + d.certSummary.warningCount)),
      h('div.k-sub', null, d.certSummary.criticalCount + ' in 14d window')));
    page.appendChild(kpi);

    // time strip
    const strip = h('div');
    strip.appendChild(SectionLabel('Expiry timeline'));
    const csWrap = h('div.cert-strip');
    const axis = h('div.cert-strip-axis');
    for (const tk of ticks) {
      const tick = h('div.tick', { style: { left: dayToPct(tk.days) + '%' } }, tk.label);
      if (tk.sub) tick.appendChild(h('small', null, tk.sub));
      axis.appendChild(tick);
    }
    axis.appendChild(h('div.now', { style: { left: dayToPct(0) + '%' } }));
    csWrap.appendChild(axis);
    const lanesEl = h('div.cert-strip-lanes');
    for (const l of lanes) {
      const left = dayToPct(l.min);
      const right = dayToPct(l.max);
      lanesEl.appendChild(h('div.cert-lane.' + l.tone, null,
        h('div.lbl', null, l.label),
        h('div.track', null, h('div.seg', { style: { left: left + '%', width: Math.max(1, right - left) + '%' } })),
        h('div.n', null, String(l.count))
      ));
    }
    csWrap.appendChild(lanesEl);
    csWrap.appendChild(h('div.cert-strip-legend', null,
      h('div.l', null, h('span.sw.exp'), 'Expired'),
      h('div.l', null, h('span.sw.crit'), 'Critical ≤ 14d'),
      h('div.l', null, h('span.sw.warn'), 'Warning ≤ 60d'),
      h('div.l', null, h('span.sw.ok'), 'OK > 60d')
    ));
    strip.appendChild(csWrap);
    page.appendChild(strip);

    // register
    const regSec = h('div');
    regSec.appendChild(SectionLabel('Certificate register', filtered.length));
    const filters = h('div.filters');
    const qInp = h('input', { type: 'text', placeholder: 'Search CN or server…', value: qs.get() });
    qInp.addEventListener('input', e => qs.set(e.target.value));
    filters.appendChild(qInp);
    const lvlSel = h('select');
    for (const [v, l] of [['','All alert levels'],['expired','Expired'],['critical','Critical'],['warning','Warning'],['ok','OK']]) {
      const opt = h('option', { value: v }, l);
      if (lvl.get() === v) opt.setAttribute('selected', '');
      lvlSel.appendChild(opt);
    }
    lvlSel.addEventListener('change', e => lvl.set(e.target.value));
    filters.appendChild(lvlSel);
    filters.appendChild(h('span.ct', null, filtered.length + ' of ' + d.certs.length));
    filters.appendChild(h('div.spacer'));
    const exportCerts = () => {
      const lvlPart = lvl.get() ? '-' + lvl.get().toLowerCase() : '';
      downloadCsv('certificates' + lvlPart + '-' + isoDay() + '.csv', filtered, [
        { key: 'subjectCn', label: 'Subject CN' },
        { key: 'serverName', label: 'Host' },
        { key: 'serviceName', label: 'Service' },
        { key: 'validTo', label: 'Valid to', value: r => r.validTo ? new Date(r.validTo).toISOString().slice(0, 10) : '' },
        { key: 'daysUntilExpiry', label: 'Days until expiry' },
        { key: 'alertLevel', label: 'Level' },
        { key: 'isExpired', label: 'Expired', value: r => r.isExpired ? 'Yes' : 'No' },
      ]);
    };
    filters.appendChild(h('button.btn', {
      onclick: exportCerts,
      disabled: filtered.length === 0,
      title: filtered.length === 0 ? 'No rows to export' : 'Export ' + filtered.length + ' certificate rows to CSV'
    }, 'Export CSV'));
    regSec.appendChild(filters);

    regSec.appendChild(SortableTable({
      id: 'cert-reg',
      defaultSort: { key: 'daysUntilExpiry', dir: 'asc' },
      columns: [
        { key: 'subjectCn', label: 'Subject CN' },
        { key: 'serverName', label: 'Host' },
        { key: 'validTo', label: 'Expires' },
        { key: 'daysUntilExpiry', label: 'Days left' },
        { key: 'alertLevel', label: 'Level', width: 110 },
      ],
      rows: filtered.slice(0, 60),
      renderRow: c => {
        const tone = c.alertLevel === 'expired' ? 'crit' : c.alertLevel === 'critical' ? 'crit' : c.alertLevel === 'warning' ? 'warn' : 'ok';
        const col = tone === 'crit' ? 'var(--crit)' : tone === 'warn' ? 'var(--warn)' : 'var(--ink-2)';
        return h('tr', null,
          h('td.host', null, c.subjectCn),
          h('td.mono.muted', null, c.serverName),
          h('td.mono', null, fmtShortDate(c.validTo)),
          h('td.num', { style: { color: col } }, c.daysUntilExpiry < 0 ? Math.abs(c.daysUntilExpiry) + 'd ago' : c.daysUntilExpiry + 'd'),
          h('td', null, Badge(tone, c.alertLevel))
        );
      }
    }));
    page.appendChild(regSec);

    return page;
  };

  // ═══════════════════════════════════════════════════════════
  // EOL
  // ═══════════════════════════════════════════════════════════
  OC.pages.eol = function (d, ctx) {
    const { openDrawer } = ctx;
    const st = ctx.ps('eol', 'status', '');
    const qs = ctx.ps('eol', 'q', '');
    const filtered = d.eol.filter(e => {
      if (st.get() && e.status !== st.get()) return false;
      if (qs.get() && !(e.product + ' ' + e.version).toLowerCase().includes(qs.get().toLowerCase())) return false;
      return true;
    });

    const eolCount = d.eol.filter(e => e.status === 'eol').length;
    const extCount = d.eol.filter(e => e.status === 'extended').length;
    const appCount = d.eol.filter(e => e.status === 'approaching').length;
    const affected = d.eol.filter(e => ['eol','extended','approaching'].includes(e.status)).reduce((a,b) => a + b.assets, 0);

    const tone = s => s === 'eol' ? 'crit' : s === 'extended' ? 'warn' : s === 'approaching' ? 'info' : 'ok';
    const label = s => s === 'eol' ? 'End of Life' : s === 'extended' ? 'Extended' : s === 'approaching' ? 'Approaching' : 'Supported';

    const page = h('div.page');
    page.appendChild(PageHead('06 / LIFECYCLE', 'End of life', 'Software products tracked against vendor support windows. Hosts running EOL software accumulate audit and security risk.'));

    const kpi = h('div.kpi-grid');
    kpi.appendChild(h('div.kpi.crit-kpi', null,
      h('div.k-label', null, 'End of life'),
      h('div.k-value', null, String(eolCount)),
      h('div.k-sub', null, 'products past vendor support')));
    kpi.appendChild(h('div.kpi.warn-kpi', null,
      h('div.k-label', null, 'Extended / approaching'),
      h('div.k-value', null, String(extCount + appCount)),
      h('div.k-sub', null, extCount + ' extended · ' + appCount + ' approaching')));
    kpi.appendChild(h('div.kpi', null,
      h('div.k-label', null, 'Hosts affected'),
      h('div.k-value', null, String(affected)),
      h('div.k-sub', null, 'running non-supported versions')));
    page.appendChild(kpi);

    const regSec = h('div');
    regSec.appendChild(SectionLabel('Software register', filtered.length));
    const filters = h('div.filters');
    const qInp = h('input', { type: 'text', placeholder: 'Search product…', value: qs.get() });
    qInp.addEventListener('input', e => qs.set(e.target.value));
    filters.appendChild(qInp);
    const stSel = h('select');
    for (const [v, l] of [['','All statuses'],['eol','End of Life'],['extended','Extended'],['approaching','Approaching'],['supported','Supported']]) {
      const opt = h('option', { value: v }, l);
      if (st.get() === v) opt.setAttribute('selected', '');
      stSel.appendChild(opt);
    }
    stSel.addEventListener('change', e => st.set(e.target.value));
    filters.appendChild(stSel);
    filters.appendChild(h('span.ct', null, filtered.length + ' of ' + d.eol.length));
    filters.appendChild(h('div.spacer'));
    const exportEol = () => {
      const stPart = st.get() ? '-' + st.get() : '';
      downloadCsv('eol' + stPart + '-' + isoDay() + '.csv', filtered, [
        { key: 'product', label: 'Product' },
        { key: 'version', label: 'Version' },
        { key: 'eol', label: 'End of life', value: r => r.eol ? String(r.eol).slice(0, 10) : '' },
        { key: 'ext', label: 'Extended support', value: r => r.ext ? String(r.ext).slice(0, 10) : '' },
        { key: 'status', label: 'Status' },
        { key: 'assets', label: 'Affected assets' },
      ]);
    };
    filters.appendChild(h('button.btn', {
      onclick: exportEol,
      disabled: filtered.length === 0,
      title: filtered.length === 0 ? 'No rows to export' : 'Export ' + filtered.length + ' EOL rows to CSV'
    }, 'Export CSV'));
    regSec.appendChild(filters);

    regSec.appendChild(SortableTable({
      id: 'eol-reg',
      defaultSort: { key: 'eol', dir: 'asc' },
      columns: [
        { key: 'product', label: 'Product' },
        { key: 'version', label: 'Version' },
        { key: 'eol', label: 'End of life' },
        { key: 'ext', label: 'Extended support' },
        { key: 'status', label: 'Status', width: 130 },
        { key: 'assets', label: 'Hosts' },
      ],
      rows: filtered,
      renderRow: e => h('tr.clickable-row', { onclick: () => openDrawer('eol', e) },
        h('td.strong', null, e.product),
        h('td.mono', null, e.version),
        h('td.mono.muted', null, fmtShortDate(e.eol)),
        h('td.mono.muted', null, fmtShortDate(e.ext)),
        h('td', null, Badge(tone(e.status), label(e.status))),
        h('td.num.strong', null, String(e.assets))
      )
    }));
    page.appendChild(regSec);

    return page;
  };

})();
