/* auditing-demo-data.js — Phase 0 fixture for 08 Auditing.

   Loaded before op-pages.js, exposes window.AUDITING_DATA with the shape the
   future /api/auditing/* endpoints will return. Swap to real fetch in Phase 1
   by deleting this file and pointing op-pages.js's reads at apiAuditing.*.

   Deliberate test cases baked in:
   - Owner shared across two groups (dedup demo)
   - One bound group with NO owner (campaign-launch guard demo)
   - One closed campaign + one active campaign mid-flight
   - One packet pre-submitted (read-only banner demo on attest.html) */
(function () {
  'use strict';

  // Names use Contoso per project sanitisation rules.
  const USERS = [
    { sam: 'alice.chen',     display: 'Alice Chen',     email: 'alice.chen@contoso.com',     enabled: true  },
    { sam: 'bob.harris',     display: 'Bob Harris',     email: 'bob.harris@contoso.com',     enabled: true  },
    { sam: 'carol.nguyen',   display: 'Carol Nguyen',   email: 'carol.nguyen@contoso.com',   enabled: true  },
    { sam: 'david.okafor',   display: 'David Okafor',   email: 'david.okafor@contoso.com',   enabled: true  },
    { sam: 'eva.lindqvist',  display: 'Eva Lindqvist',  email: 'eva.lindqvist@contoso.com',  enabled: true  },
    { sam: 'frank.dubois',   display: 'Frank Dubois',   email: 'frank.dubois@contoso.com',   enabled: true  },
    { sam: 'grace.patel',    display: 'Grace Patel',    email: 'grace.patel@contoso.com',    enabled: true  },
    { sam: 'henry.silva',    display: 'Henry Silva',    email: 'henry.silva@contoso.com',    enabled: false },
    { sam: 'iris.tanaka',    display: 'Iris Tanaka',    email: 'iris.tanaka@contoso.com',    enabled: true  },
    { sam: 'jane.smith',     display: 'Jane Smith',     email: 'jane.smith@contoso.com',     enabled: true  },
    { sam: 'kareem.osei',    display: 'Kareem Osei',    email: 'kareem.osei@contoso.com',    enabled: true  },
    { sam: 'lena.kowalski',  display: 'Lena Kowalski',  email: 'lena.kowalski@contoso.com',  enabled: true  },
    { sam: 'mike.fernandez', display: 'Mike Fernandez', email: 'mike.fernandez@contoso.com', enabled: true  },
    { sam: 'nora.abboud',    display: 'Nora Abboud',    email: 'nora.abboud@contoso.com',    enabled: true  },
    { sam: 'oscar.melin',    display: 'Oscar Melin',    email: 'oscar.melin@contoso.com',    enabled: true  },
    { sam: 'priya.iyer',     display: 'Priya Iyer',     email: 'priya.iyer@contoso.com',     enabled: true  },
    { sam: 'quinn.rivera',   display: 'Quinn Rivera',   email: 'quinn.rivera@contoso.com',   enabled: true  },
    { sam: 'rachel.kim',     display: 'Rachel Kim',     email: 'rachel.kim@contoso.com',     enabled: true  },
    { sam: 'sam.becker',     display: 'Sam Becker',     email: 'sam.becker@contoso.com',     enabled: true  },
    { sam: 'tessa.morris',   display: 'Tessa Morris',   email: 'tessa.morris@contoso.com',   enabled: false },
    { sam: 'umar.haq',       display: 'Umar Haq',       email: 'umar.haq@contoso.com',       enabled: true  },
    { sam: 'vera.novak',     display: 'Vera Novak',     email: 'vera.novak@contoso.com',     enabled: true  },
    { sam: 'will.bryant',    display: 'Will Bryant',    email: 'will.bryant@contoso.com',    enabled: true  },
    { sam: 'xenia.popa',     display: 'Xenia Popa',     email: 'xenia.popa@contoso.com',     enabled: true  },
    { sam: 'yusuf.aydin',    display: 'Yusuf Aydin',    email: 'yusuf.aydin@contoso.com',    enabled: true  },
    { sam: 'zara.holt',      display: 'Zara Holt',      email: 'zara.holt@contoso.com',      enabled: true  },
    // The owners themselves (also team leads who own the groups below)
    { sam: 'paul.griffin',   display: 'Paul Griffin',   email: 'paul.griffin@contoso.com',   enabled: true  },
    { sam: 'sara.bennett',   display: 'Sara Bennett',   email: 'sara.bennett@contoso.com',   enabled: true  },
    { sam: 'tom.walsh',      display: 'Tom Walsh',      email: 'tom.walsh@contoso.com',      enabled: true  },
  ];

  // Groups: one DN per group. dn is the AD distinguished name format.
  const GROUPS = [
    { dn: 'CN=APP-Tableau-Editors,OU=AppGroups,DC=contoso,DC=com',  sam: 'APP-Tableau-Editors',  type: 'Security' },
    { dn: 'CN=APP-Tableau-Viewers,OU=AppGroups,DC=contoso,DC=com',  sam: 'APP-Tableau-Viewers',  type: 'Security' },
    { dn: 'CN=APP-Jira-Users,OU=AppGroups,DC=contoso,DC=com',       sam: 'APP-Jira-Users',       type: 'Security' },
    { dn: 'CN=APP-Jira-Admins,OU=AppGroups,DC=contoso,DC=com',      sam: 'APP-Jira-Admins',      type: 'Security' },
    { dn: 'CN=APP-ServiceNow-ITIL,OU=AppGroups,DC=contoso,DC=com',  sam: 'APP-ServiceNow-ITIL',  type: 'Security' },
    { dn: 'CN=APP-ServiceNow-Approvers,OU=AppGroups,DC=contoso,DC=com', sam: 'APP-ServiceNow-Approvers', type: 'Security' },
    { dn: 'CN=APP-Legacy-Reports,OU=AppGroups,DC=contoso,DC=com',   sam: 'APP-Legacy-Reports',   type: 'Security' }, // no owner — guard demo
  ];

  // Owners: composite (group_dn, owner_sam). Paul Griffin owns BOTH Tableau groups
  // to demonstrate the per-owner dedup (one email despite two packets).
  const GROUP_OWNERS = [
    { group_dn: GROUPS[0].dn, owner_sam: 'paul.griffin', source: 'managedBy' },
    { group_dn: GROUPS[1].dn, owner_sam: 'paul.griffin', source: 'managedBy' },
    { group_dn: GROUPS[2].dn, owner_sam: 'sara.bennett', source: 'managedBy' },
    { group_dn: GROUPS[3].dn, owner_sam: 'sara.bennett', source: 'managedBy' },
    // Jira-Admins also has Tom Walsh as co-owner (msExchCoManagedByLink) — multi-owner case.
    { group_dn: GROUPS[3].dn, owner_sam: 'tom.walsh',    source: 'm365_owner' },
    { group_dn: GROUPS[4].dn, owner_sam: 'tom.walsh',    source: 'managedBy' },
    { group_dn: GROUPS[5].dn, owner_sam: 'tom.walsh',    source: 'managedBy' },
    // GROUPS[6] APP-Legacy-Reports: deliberately no owner.
  ];

  // Memberships: assign a varied set of users to each group.
  const memberSlices = [
    [0,1,2,3,4,5,6,7,8,9,10,11],         // Tableau Editors (12 incl. one disabled = henry)
    [0,1,2,3,4,5,6,8,9,12,13,14,15,16,17,18,19], // Tableau Viewers (17 incl. one disabled = tessa)
    [10,11,12,13,14,15,16,17,18,19,20,21,22],     // Jira Users (13)
    [10,11,20,21],                                 // Jira Admins (4)
    [2,3,4,5,11,12,13,14,15,22,23,24,25],          // ServiceNow ITIL (13)
    [2,3,4],                                       // ServiceNow Approvers (3)
    [0,1,2,3,4,5,6,7],                             // Legacy Reports (8)
  ];
  const GROUP_MEMBERSHIPS = [];
  GROUPS.forEach((g, idx) => {
    memberSlices[idx].forEach(uIdx => {
      GROUP_MEMBERSHIPS.push({ group_dn: g.dn, sam_account: USERS[uIdx].sam });
    });
  });

  // Applications. audit_frequency_months drives the next-due calculation
  // (12 = annual, 6 = bi-annual). auto_launch toggles whether the (Phase 1)
  // BackgroundService should kick off the next campaign automatically when the
  // due date is reached, or just alert someone to do it.
  const APPLICATIONS = [
    {
      application_id: 1,
      name: 'Tableau Server',
      business_owner: 'paul.griffin',
      technical_owner: 'paul.griffin',
      support_email: 'tableau-support@contoso.com',
      bindings: [GROUPS[0].dn, GROUPS[1].dn],
      audit_frequency_months: 6,
      auto_launch: true,
    },
    {
      application_id: 2,
      name: 'Atlassian Jira',
      business_owner: 'sara.bennett',
      technical_owner: 'tom.walsh',
      support_email: 'jira-support@contoso.com',
      bindings: [GROUPS[2].dn, GROUPS[3].dn],
      audit_frequency_months: 12,
      auto_launch: false,
    },
    {
      application_id: 3,
      name: 'ServiceNow',
      business_owner: 'tom.walsh',
      technical_owner: 'tom.walsh',
      support_email: 'snow-support@contoso.com',
      bindings: [GROUPS[4].dn, GROUPS[5].dn],
      audit_frequency_months: 12,
      auto_launch: false,
    },
    {
      application_id: 4,
      name: 'Legacy Reporting Portal',
      business_owner: 'paul.griffin',
      technical_owner: '',
      support_email: 'reports@contoso.com',
      bindings: [GROUPS[6].dn], // ownerless — campaign launch will refuse
      audit_frequency_months: 12,
      auto_launch: false,
    },
  ];

  // Campaigns. Dates are absolute (per project memory: convert relative dates).
  // Today is 2026-05-28. Historical mix:
  //   - Tableau: 6-month cadence with 3 closed cycles + due in ~5 months
  //   - Jira: 12-month cadence, 1 closed last year + 1 active now (in-window)
  //   - ServiceNow: 12-month cadence, last closed >14 months ago → OVERDUE
  //   - Legacy Reports: never audited
  const CAMPAIGNS = [
    // Active
    {
      campaign_id: 101,
      application_id: 2,
      application_name: 'Atlassian Jira',
      name: '2026 Jira access review',
      status: 'active',
      due_at: '2026-06-15',
      created_by: 'damian.penny',
      created_at: '2026-05-25T09:14:00',
      closed_at: null,
      launch_kind: 'manual',
    },
    // Closed history — Tableau (6-monthly, auto-launched)
    {
      campaign_id: 100,
      application_id: 1,
      application_name: 'Tableau Server',
      name: '2026-Q1 Tableau access review',
      status: 'closed',
      due_at: '2026-04-15',
      created_by: 'system',
      created_at: '2026-03-20T10:00:00',
      closed_at: '2026-04-22T16:30:00',
      launch_kind: 'auto',
    },
    {
      campaign_id: 92,
      application_id: 1,
      application_name: 'Tableau Server',
      name: '2025-Q3 Tableau access review',
      status: 'closed',
      due_at: '2025-10-15',
      created_by: 'system',
      created_at: '2025-09-20T10:00:00',
      closed_at: '2025-10-18T13:10:00',
      launch_kind: 'auto',
    },
    {
      campaign_id: 84,
      application_id: 1,
      application_name: 'Tableau Server',
      name: '2025-Q1 Tableau access review',
      status: 'closed',
      due_at: '2025-04-15',
      created_by: 'damian.penny',
      created_at: '2025-03-20T10:00:00',
      closed_at: '2025-04-12T11:45:00',
      launch_kind: 'manual',
    },
    // Closed history — Jira (annual)
    {
      campaign_id: 78,
      application_id: 2,
      application_name: 'Atlassian Jira',
      name: '2025 Jira access review',
      status: 'closed',
      due_at: '2025-06-15',
      created_by: 'damian.penny',
      created_at: '2025-05-20T09:00:00',
      closed_at: '2025-06-11T14:00:00',
      launch_kind: 'manual',
    },
    // Closed history — ServiceNow (annual, no auto, OVERDUE now)
    {
      campaign_id: 70,
      application_id: 3,
      application_name: 'ServiceNow',
      name: '2025-Q1 ServiceNow access review',
      status: 'closed',
      due_at: '2025-03-15',
      created_by: 'damian.penny',
      created_at: '2025-02-20T09:00:00',
      closed_at: '2025-03-10T15:30:00',
      launch_kind: 'manual',
    },
  ];

  // Packets — one per (campaign, group). Token is fake for demo; real impl
  // signs HMAC + stores SHA-256 hash. Here it's just a stable string we can
  // match against the URL on attest.html.
  const PACKETS = [
    // Active Jira campaign packets
    {
      packet_id: 'pkt-jira-users',
      campaign_id: 101,
      group_dn: GROUPS[2].dn,
      group_sam: GROUPS[2].sam,
      token: 'demo-pending',
      token_expires_at: '2026-06-15T23:59:59',
      submitted_at: null,
      submitted_by_sam: null,
      submitted_by_display: null,
      reminder_sent_at: null,
    },
    {
      packet_id: 'pkt-jira-admins',
      campaign_id: 101,
      group_dn: GROUPS[3].dn,
      group_sam: GROUPS[3].sam,
      token: 'demo-completed',
      token_expires_at: '2026-06-15T23:59:59',
      submitted_at: '2026-05-27T14:32:00',
      submitted_by_sam: 'sara.bennett',
      submitted_by_display: 'Sara Bennett',
      reminder_sent_at: null,
    },
    // Closed Tableau campaign packets (both submitted)
    {
      packet_id: 'pkt-tab-editors',
      campaign_id: 100,
      group_dn: GROUPS[0].dn,
      group_sam: GROUPS[0].sam,
      token: 'demo-tab-editors',
      token_expires_at: '2026-04-15T23:59:59',
      submitted_at: '2026-04-12T11:20:00',
      submitted_by_sam: 'paul.griffin',
      submitted_by_display: 'Paul Griffin',
      reminder_sent_at: null,
    },
    {
      packet_id: 'pkt-tab-viewers',
      campaign_id: 100,
      group_dn: GROUPS[1].dn,
      group_sam: GROUPS[1].sam,
      token: 'demo-tab-viewers',
      token_expires_at: '2026-04-15T23:59:59',
      submitted_at: '2026-04-14T09:05:00',
      submitted_by_sam: 'paul.griffin',
      submitted_by_display: 'Paul Griffin',
      reminder_sent_at: null,
    },
  ];

  // Decisions for the submitted packets.
  const DECISIONS = [
    // pkt-jira-admins (submitted by Sara) — 3 keep, 1 revoke
    { packet_id: 'pkt-jira-admins', subject_sam: 'kareem.osei',   decision: 'keep',   comment: '' },
    { packet_id: 'pkt-jira-admins', subject_sam: 'lena.kowalski', decision: 'keep',   comment: '' },
    { packet_id: 'pkt-jira-admins', subject_sam: 'umar.haq',      decision: 'keep',   comment: '' },
    { packet_id: 'pkt-jira-admins', subject_sam: 'vera.novak',    decision: 'revoke', comment: 'Left admin team last month' },
    // pkt-tab-editors (Paul) — 10 keep, 2 revoke (Henry disabled, Bob moved teams)
    { packet_id: 'pkt-tab-editors', subject_sam: 'alice.chen',     decision: 'keep',   comment: '' },
    { packet_id: 'pkt-tab-editors', subject_sam: 'bob.harris',     decision: 'revoke', comment: 'Moved to Marketing' },
    { packet_id: 'pkt-tab-editors', subject_sam: 'carol.nguyen',   decision: 'keep',   comment: '' },
    { packet_id: 'pkt-tab-editors', subject_sam: 'david.okafor',   decision: 'keep',   comment: '' },
    { packet_id: 'pkt-tab-editors', subject_sam: 'eva.lindqvist',  decision: 'keep',   comment: '' },
    { packet_id: 'pkt-tab-editors', subject_sam: 'frank.dubois',   decision: 'keep',   comment: '' },
    { packet_id: 'pkt-tab-editors', subject_sam: 'grace.patel',    decision: 'keep',   comment: '' },
    { packet_id: 'pkt-tab-editors', subject_sam: 'henry.silva',    decision: 'revoke', comment: 'AD account disabled' },
    { packet_id: 'pkt-tab-editors', subject_sam: 'iris.tanaka',    decision: 'keep',   comment: '' },
    { packet_id: 'pkt-tab-editors', subject_sam: 'jane.smith',     decision: 'keep',   comment: '' },
    { packet_id: 'pkt-tab-editors', subject_sam: 'kareem.osei',    decision: 'keep',   comment: '' },
    { packet_id: 'pkt-tab-editors', subject_sam: 'lena.kowalski',  decision: 'keep',   comment: '' },
    // pkt-tab-viewers (Paul) — keep most, revoke a couple
    ...[0,1,2,3,4,5,6,8,9,12,13,14,15,16,17,18,19].map(i => ({
      packet_id: 'pkt-tab-viewers',
      subject_sam: USERS[i].sam,
      decision: (USERS[i].sam === 'tessa.morris' || USERS[i].sam === 'henry.silva') ? 'revoke' : 'keep',
      comment: USERS[i].sam === 'tessa.morris' ? 'Disabled account' : USERS[i].sam === 'henry.silva' ? 'AD disabled' : '',
    })),
  ];

  // ---------- Lookup helpers ----------
  function getUser(sam)        { return USERS.find(u => u.sam === sam) || null; }
  function getGroup(dn)        { return GROUPS.find(g => g.dn === dn) || null; }
  function getApp(id)          { return APPLICATIONS.find(a => a.application_id === id) || null; }
  function getCampaign(id)     { return CAMPAIGNS.find(c => c.campaign_id === id) || null; }
  function getOwnersOfGroup(dn){ return GROUP_OWNERS.filter(o => o.group_dn === dn).map(o => ({ ...o, ...getUser(o.owner_sam) })); }
  function getMembersOfGroup(dn){ return GROUP_MEMBERSHIPS.filter(m => m.group_dn === dn).map(m => getUser(m.sam_account)).filter(Boolean); }
  function getPacketsOfCampaign(cid){ return PACKETS.filter(p => p.campaign_id === cid); }
  function getPacketByToken(token){ return PACKETS.find(p => p.token === token) || null; }
  function getDecisionsByPacket(pid){ return DECISIONS.filter(d => d.packet_id === pid).map(d => ({ ...d, subject: getUser(d.subject_sam) })); }

  // Campaign progress: { submitted, total }
  function getCampaignProgress(cid) {
    const ps = getPacketsOfCampaign(cid);
    return { submitted: ps.filter(p => p.submitted_at).length, total: ps.length };
  }

  // Decision summary for a packet (used in dashboard rows)
  function summarizeDecisions(pid) {
    const ds = getDecisionsByPacket(pid);
    return { keep: ds.filter(d => d.decision === 'keep').length, revoke: ds.filter(d => d.decision === 'revoke').length };
  }

  // Aggregate decisions across all packets of a campaign.
  function summarizeCampaignDecisions(cid) {
    const packets = getPacketsOfCampaign(cid);
    let keep = 0, revoke = 0;
    for (const p of packets) {
      const s = summarizeDecisions(p.packet_id);
      keep += s.keep; revoke += s.revoke;
    }
    return { keep, revoke, total: keep + revoke };
  }

  // Audit history: all campaigns for an application, newest first.
  function getAuditHistory(appId) {
    return CAMPAIGNS.filter(c => c.application_id === appId)
      .slice()
      .sort((a, b) => {
        const ka = a.closed_at || a.created_at || '';
        const kb = b.closed_at || b.created_at || '';
        return kb.localeCompare(ka);
      });
  }

  // Last audit = most recent closed campaign's closed_at. Null if never.
  function getLastAuditDate(appId) {
    const closed = CAMPAIGNS
      .filter(c => c.application_id === appId && c.status === 'closed' && c.closed_at)
      .sort((a, b) => b.closed_at.localeCompare(a.closed_at));
    return closed.length ? closed[0].closed_at : null;
  }

  // Next due = last audit + frequency_months. Null if no last audit AND no frequency.
  function getNextAuditDue(appId) {
    const app = getApp(appId);
    if (!app || !app.audit_frequency_months) return null;
    const last = getLastAuditDate(appId);
    if (!last) return null; // never audited — caller handles "first audit pending"
    const d = new Date(last);
    if (isNaN(d.getTime())) return null;
    d.setMonth(d.getMonth() + app.audit_frequency_months);
    return d.toISOString();
  }

  // Status enum derived from app state:
  //   active   — campaign currently in flight (any active campaign for this app)
  //   never    — never audited (no closed campaigns ever)
  //   overdue  — last_audit + frequency < today
  //   due_soon — within 30 days of next due
  //   ok       — otherwise
  // Also returns days until/since due (negative = overdue).
  function getAuditStatus(appId) {
    const hasActive = CAMPAIGNS.some(c => c.application_id === appId && c.status === 'active');
    if (hasActive) return { status: 'active', daysUntilDue: null };
    const last = getLastAuditDate(appId);
    if (!last) return { status: 'never', daysUntilDue: null };
    const next = getNextAuditDue(appId);
    if (!next) return { status: 'ok', daysUntilDue: null };
    const daysUntilDue = Math.ceil((new Date(next).getTime() - Date.now()) / 86400000);
    if (daysUntilDue < 0) return { status: 'overdue', daysUntilDue };
    if (daysUntilDue <= 30) return { status: 'due_soon', daysUntilDue };
    return { status: 'ok', daysUntilDue };
  }

  window.AUDITING_DATA = {
    USERS, GROUPS, GROUP_OWNERS, GROUP_MEMBERSHIPS, APPLICATIONS, CAMPAIGNS, PACKETS, DECISIONS,
    getUser, getGroup, getApp, getCampaign,
    getOwnersOfGroup, getMembersOfGroup,
    getPacketsOfCampaign, getPacketByToken, getDecisionsByPacket,
    getCampaignProgress, summarizeDecisions, summarizeCampaignDecisions,
    getAuditHistory, getLastAuditDate, getNextAuditDue, getAuditStatus,
  };
})();
