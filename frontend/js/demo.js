// --- Demo data generator (used when the API is unreachable) ---
export const DEMO = (() => {
  // Seeded pseudo-random for deterministic demo data
  let _seed = 42;
  const rand = () => { _seed = (_seed * 16807 + 0) % 2147483647; return (_seed - 1) / 2147483646; };
  const pick = arr => arr[Math.floor(rand() * arr.length)];
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const DAY = 86400000;

  // --- Generate 520 servers ---
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
  let serverId = 1;
  for (const [env, envShort, count] of envSpec) {
    for (let i = 1; i <= count; i++) {
      const prefix = prefixes[(i - 1) % prefixes.length];
      const name = `${prefix}-${envShort}-${pad(i)}`;
      servers.push({
        serverId: serverId++,
        serverName: name,
        fqdn: `${name.toLowerCase()}.corp.local`,
        environment: env,
        applicationName: apps[(i - 1) % apps.length],
        patchGroup: env === 'Development' && rand() < 0.3 ? null : pick(groups),
        isActive: rand() > 0.05
      });
    }
  }

  // --- Generate 1000 certificates ---
  const cnPrefixes = ['*.corp.local','api.corp.com','mail.corp.com','admin.corp.local',
    'monitor.corp.local','db.corp.local','ldap.corp.local','intranet.corp.local',
    'vpn.corp.com','sso.corp.com','tableau.corp.com','grafana.corp.local',
    'jenkins.corp.local','nexus.corp.local','sonar.corp.local','jira.corp.com',
    'confluence.corp.com','bitbucket.corp.com','artifactory.corp.local','vault.corp.local',
    'consul.corp.local','redis.corp.local','kafka.corp.local','elastic.corp.local',
    'kibana.corp.local','prometheus.corp.local','alertmanager.corp.local','minio.corp.local',
    'harbor.corp.local','keycloak.corp.local'];

  const certs = [];
  // 30 critical, 120 warning, 850 ok, 15 expired
  const certDist = [
    [15, -90, -1, 'critical', true],
    [30, 1, 14, 'critical', false],
    [120, 15, 60, 'warning', false],
    [850, 61, 365, 'ok', false]
  ];
  let certId = 1;
  for (const [count, minDays, maxDays, level, expired] of certDist) {
    for (let i = 0; i < count; i++) {
      const days = minDays + Math.floor(rand() * (maxDays - minDays + 1));
      const cn = i < cnPrefixes.length ? cnPrefixes[i] : `svc-${pad(certId, 4)}.corp.local`;
      certs.push({
        certId: certId++,
        subjectCn: cn,
        serverName: pick(servers).serverName,
        validTo: new Date(Date.now() + days * DAY).toISOString(),
        daysUntilExpiry: days,
        alertLevel: level,
        isExpired: expired
      });
    }
  }
  const certSummary = { criticalCount: 30, warningCount: 120, okCount: 850, expiredCount: 15, totalCount: 1015 };

  // --- Unreachable servers (12) ---
  const unreachable = [];
  const usedIdx = new Set();
  while (unreachable.length < 12) {
    const idx = Math.floor(rand() * servers.length);
    if (usedIdx.has(idx)) continue;
    usedIdx.add(idx);
    const s = servers[idx];
    unreachable.push({
      serverName: s.serverName, environment: s.environment,
      lastSeen: new Date(Date.now() - Math.floor(rand() * 3600000)).toISOString()
    });
  }

  // --- Unmatched servers (15) ---
  const unmatchedRaw = ['WEBPROD01','SQLPRD1','APPPRD02','SVCPROD3','MONPROD1',
    'unknown-host-42','unknown-host-99','DEVBLD01','ETLSVR1','RPTPRD02',
    'CACHEPRD1','MSGPROD1','FILEPRD02','DNSPRD1','BKUPPROD1'];
  const sources = ['SCCM','Qualys','Splunk','CrowdStrike'];
  const unmatched = unmatchedRaw.map((raw, i) => ({
    serverNameRaw: raw,
    sourceSystem: sources[i % sources.length],
    occurrenceCount: 1 + Math.floor(rand() * 30),
    firstSeenAt: new Date(Date.now() - Math.floor(rand() * 90 * DAY)).toISOString(),
    lastSeenAt: new Date().toISOString(),
    closestMatch: raw.startsWith('unknown') ? null : servers[Math.floor(rand() * 50)].serverName
  }));

  // --- Cycle servers for patching (60 from prod/staging to test pagination) ---
  const patchServers = servers.filter(s => s.environment === 'Prod' || s.environment === 'Staging').slice(0, 60);
  const cycleItems = patchServers.map((s, i) => ({
    scheduleId: i + 1, serverName: s.serverName, patchGroup: s.patchGroup || 'Group-A',
    scheduledTime: `0${2 + Math.floor(i / 5)}:00`.slice(-5), application: s.applicationName,
    service: s.applicationName ? s.applicationName + ' Service' : 'Infrastructure',
    hasKnownIssue: rand() < 0.2, issueCount: rand() < 0.2 ? 1 + Math.floor(rand() * 2) : 0
  }));

  // --- EOL detail using generated server names ---
  const pickN = (n) => { const out = []; for (let i = 0; i < n; i++) out.push(pick(servers).serverName); return [...new Set(out)]; };

  return {
    health: {
      overallStatus: 'healthy',
      syncStatuses: [
        { syncName: 'databricks_servers', status: 'success', lastSuccessAt: new Date(Date.now() - 3600000).toISOString(), hoursSinceSuccess: 1.0, freshnessStatus: 'healthy', recordsProcessed: 520, consecutiveFailures: 0, expectedSchedule: 'Every 6 hours' },
        { syncName: 'patching_schedule_html', status: 'success', lastSuccessAt: new Date(Date.now() - 7200000).toISOString(), hoursSinceSuccess: 2.0, freshnessStatus: 'healthy', recordsProcessed: 260, consecutiveFailures: 0, expectedSchedule: 'Every 12 hours' },
        { syncName: 'confluence_issues', status: 'warning', lastSuccessAt: new Date(Date.now() - 86400000).toISOString(), hoursSinceSuccess: 24.0, freshnessStatus: 'stale', recordsProcessed: 28, consecutiveFailures: 2, lastErrorMessage: 'Sync error occurred \u2014 check server logs', expectedSchedule: 'Every 6 hours' },
        { syncName: 'certificate_scan', status: 'success', lastSuccessAt: new Date(Date.now() - 14400000).toISOString(), hoursSinceSuccess: 4.0, freshnessStatus: 'healthy', recordsProcessed: 1000, consecutiveFailures: 0, expectedSchedule: 'Daily' },
      ],
      unmatchedServersCount: 15,
      unreachableServersCount: 12,
      lastUpdated: new Date().toISOString()
    },
    unreachableServers: unreachable,
    servers,
    serverSummary: (() => {
      const envCounts = {};
      let total = 0, active = 0;
      servers.forEach(s => {
        const env = s.environment || 'Unknown';
        if (!envCounts[env]) envCounts[env] = { total: 0, active: 0 };
        envCounts[env].total++;
        if (s.isActive) envCounts[env].active++;
        total++;
        if (s.isActive) active++;
      });
      return { totalCount: total, activeCount: active, environmentCounts: envCounts };
    })(),
    unmatched,
    nextPatch: {
      cycle: { cycleId: 12, cycleDate: new Date(Date.now() + 5 * DAY).toISOString(), serverCount: cycleItems.length, status: 'Scheduled' },
      daysUntil: 5,
      cycleDates: [new Date(Date.now() + 5 * DAY).toISOString().slice(0, 10), new Date(Date.now() + 6 * DAY).toISOString().slice(0, 10)],
      serversByGroup: { 'Group-A': Math.ceil(cycleItems.length * 0.28), 'Group-B': Math.ceil(cycleItems.length * 0.26), 'Group-C': Math.ceil(cycleItems.length * 0.25), 'Group-D': Math.ceil(cycleItems.length * 0.21) },
      issuesBySeverity: { 'High': 2, 'Medium': 5, 'Low': 3 },
      totalIssuesAffectingServers: 48
    },
    cycles: [
      { cycleId: 12, cycleDate: new Date(Date.now() + 5 * DAY).toISOString(), serverCount: cycleItems.length, status: 'active', displayStatus: 'Upcoming' },
      { cycleId: 11, cycleDate: new Date(Date.now() - 3 * DAY).toISOString(), serverCount: 255, status: 'completed', displayStatus: 'Completed' },
      { cycleId: 10, cycleDate: new Date(Date.now() - 55 * DAY).toISOString(), serverCount: 248, status: 'completed', displayStatus: 'Completed' },
    ],
    issues: [
      { issueId: 1, title: 'KB5034441 fails on small recovery partition', severity: 'High', application: null, appliesToWindows: true, appliesToSql: false, fix: 'Resize recovery partition to 1GB' },
      { issueId: 2, title: 'SQL CU requires SSMS restart', severity: 'Medium', application: 'SQL Server', appliesToWindows: false, appliesToSql: true, fix: 'Restart SSMS after patching' },
      { issueId: 3, title: '.NET 8 runtime conflict with legacy app', severity: 'High', application: 'Legacy CRM', appliesToWindows: true, appliesToSql: false, fix: 'Pin .NET runtime version' },
      { issueId: 4, title: 'Cluster failover during patch window', severity: 'Medium', application: 'Database Cluster', appliesToWindows: true, appliesToSql: true, fix: 'Drain node before patching' },
      { issueId: 5, title: 'TLS 1.0 disabled after security update', severity: 'Low', application: null, appliesToWindows: true, appliesToSql: false, fix: 'Update legacy clients' },
    ],
    cycleServers: {
      12: { items: cycleItems, totalCount: cycleItems.length, limit: 20, offset: 0 },
      11: { items: cycleItems.slice(0, 5), totalCount: 5, limit: 20, offset: 0 },
      10: { items: [], totalCount: 0, limit: 20, offset: 0 },
    },
    eolSummary: { eolCount: 2, extendedCount: 2, approachingCount: 6, supportedCount: 35, unknownCount: 0, totalCount: 45, affectedServers: 180 },
    eolSoftware: [
      { product: 'Windows Server', version: '2012 R2', endOfLife: '2023-10-10T00:00:00Z', endOfExtendedSupport: '2026-10-13T00:00:00Z', endOfSupport: '2023-10-10T00:00:00Z', alertLevel: 'extended', affectedAssets: 25 },
      { product: 'SQL Server', version: '2014', endOfLife: '2024-07-09T00:00:00Z', endOfExtendedSupport: '2024-07-09T00:00:00Z', endOfSupport: '2019-07-09T00:00:00Z', alertLevel: 'eol', affectedAssets: 18 },
      { product: '.NET Framework', version: '4.6.1', endOfLife: '2022-04-26T00:00:00Z', endOfExtendedSupport: '2026-11-10T00:00:00Z', endOfSupport: '2022-04-26T00:00:00Z', alertLevel: 'extended', affectedAssets: 40 },
      { product: 'Windows Server', version: '2016', endOfLife: '2027-01-12T00:00:00Z', endOfExtendedSupport: '2027-01-12T00:00:00Z', endOfSupport: '2022-01-11T00:00:00Z', alertLevel: 'approaching', affectedAssets: 65 },
      { product: 'SQL Server', version: '2016', endOfLife: '2026-07-14T00:00:00Z', endOfExtendedSupport: '2026-07-14T00:00:00Z', endOfSupport: '2021-07-13T00:00:00Z', alertLevel: 'approaching', affectedAssets: 30 },
      { product: 'IIS', version: '10.0', endOfLife: '2026-10-13T00:00:00Z', endOfExtendedSupport: null, endOfSupport: '2026-10-13T00:00:00Z', alertLevel: 'approaching', affectedAssets: 22 },
      { product: 'Windows Server', version: '2019', endOfLife: '2029-01-09T00:00:00Z', endOfExtendedSupport: '2029-01-09T00:00:00Z', endOfSupport: '2024-01-09T00:00:00Z', alertLevel: 'supported', affectedAssets: 110 },
      { product: 'SQL Server', version: '2019', endOfLife: '2030-01-08T00:00:00Z', endOfExtendedSupport: '2030-01-08T00:00:00Z', endOfSupport: '2025-01-07T00:00:00Z', alertLevel: 'supported', affectedAssets: 75 },
      { product: 'Windows Server', version: '2022', endOfLife: '2031-10-14T00:00:00Z', endOfExtendedSupport: '2031-10-14T00:00:00Z', endOfSupport: '2026-10-13T00:00:00Z', alertLevel: 'supported', affectedAssets: 150 },
      { product: '.NET', version: '8.0', endOfLife: '2026-11-10T00:00:00Z', endOfExtendedSupport: null, endOfSupport: '2026-11-10T00:00:00Z', alertLevel: 'approaching', affectedAssets: 70 },
    ],
    eolDetail: {
      'Windows Server|2012 R2': { assets: pickN(25) },
      'SQL Server|2014': { assets: pickN(18) },
      '.NET Framework|4.6.1': { assets: pickN(40) },
      'Windows Server|2016': { assets: pickN(65) },
      'SQL Server|2016': { assets: pickN(30) },
      'IIS|10.0': { assets: pickN(22) },
      'Windows Server|2019': { assets: pickN(110) },
      'SQL Server|2019': { assets: pickN(75) },
      'Windows Server|2022': { assets: pickN(150) },
      '.NET|8.0': { assets: pickN(70) },
    },
    certSummary,
    certificates: certs
  };
})();
