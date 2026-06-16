/* auditing-demo-data.js — Phase 0 fixture for 09 Auditing.

   Loaded before op-pages.js, exposes window.AUDITING_DATA with the shape the
   future /api/auditing/* endpoints will return. Swap to real fetch in Phase 1
   by deleting this file and pointing op-pages.js's reads at apiAuditing.*.

   Routing model (2026-05-29):
   - Each application chooses 'line_manager' OR 'nominees' routing.
   - line_manager: subjects grouped by manager_sam, one packet per manager.
   - nominees: 1-5 picked recipients per app, each gets a packet with the FULL
     roster, first-to-submit closes the whole campaign (others see read-only).
   - Group owners (managedBy) are NOT used for routing — kept as informational
     diagnostic only.

   Deliberate test cases baked in:
   - Tableau Server: line_manager routing, healthy history
   - Atlassian Jira: nominees routing with 3 nominees (Sara/Tom/Paul) — active
     campaign demos the "ANY one nominee closes" semantics
   - ServiceNow: line_manager, 14-day due period (smaller app), OVERDUE
   - Legacy Reporting Portal: line_manager with subjects who have NO manager
     resolvable → demos the business_owner fallback */
(function () {
  'use strict';

  // Org chart (3 levels):
  //   Heads (no manager):    paul.griffin, sara.bennett, tom.walsh
  //   Team leads → heads:    alice/bob/carol → paul, oscar/priya → sara, will/xenia → tom
  //   Individual contribs:   most others report to a team lead
  // Names use Contoso per project sanitisation rules.
  const USERS = [
    { sam: 'alice.chen',     display: 'Alice Chen',     email: 'alice.chen@contoso.com',     enabled: true,  manager_sam: 'paul.griffin' },
    { sam: 'bob.harris',     display: 'Bob Harris',     email: 'bob.harris@contoso.com',     enabled: true,  manager_sam: 'paul.griffin' },
    { sam: 'carol.nguyen',   display: 'Carol Nguyen',   email: 'carol.nguyen@contoso.com',   enabled: true,  manager_sam: 'paul.griffin' },
    { sam: 'david.okafor',   display: 'David Okafor',   email: 'david.okafor@contoso.com',   enabled: true,  manager_sam: 'alice.chen' },
    { sam: 'eva.lindqvist',  display: 'Eva Lindqvist',  email: 'eva.lindqvist@contoso.com',  enabled: true,  manager_sam: 'alice.chen' },
    { sam: 'frank.dubois',   display: 'Frank Dubois',   email: 'frank.dubois@contoso.com',   enabled: true,  manager_sam: 'alice.chen' },
    { sam: 'grace.patel',    display: 'Grace Patel',    email: 'grace.patel@contoso.com',    enabled: true,  manager_sam: 'alice.chen' },
    { sam: 'henry.silva',    display: 'Henry Silva',    email: 'henry.silva@contoso.com',    enabled: false, manager_sam: 'bob.harris' },
    { sam: 'iris.tanaka',    display: 'Iris Tanaka',    email: 'iris.tanaka@contoso.com',    enabled: true,  manager_sam: 'bob.harris' },
    { sam: 'jane.smith',     display: 'Jane Smith',     email: 'jane.smith@contoso.com',     enabled: true,  manager_sam: 'bob.harris' },
    { sam: 'kareem.osei',    display: 'Kareem Osei',    email: 'kareem.osei@contoso.com',    enabled: true,  manager_sam: 'bob.harris' },
    { sam: 'lena.kowalski',  display: 'Lena Kowalski',  email: 'lena.kowalski@contoso.com',  enabled: true,  manager_sam: 'carol.nguyen' },
    { sam: 'mike.fernandez', display: 'Mike Fernandez', email: 'mike.fernandez@contoso.com', enabled: true,  manager_sam: 'carol.nguyen' },
    { sam: 'nora.abboud',    display: 'Nora Abboud',    email: 'nora.abboud@contoso.com',    enabled: true,  manager_sam: 'carol.nguyen' },
    { sam: 'oscar.melin',    display: 'Oscar Melin',    email: 'oscar.melin@contoso.com',    enabled: true,  manager_sam: 'sara.bennett' },
    { sam: 'priya.iyer',     display: 'Priya Iyer',     email: 'priya.iyer@contoso.com',     enabled: true,  manager_sam: 'sara.bennett' },
    { sam: 'quinn.rivera',   display: 'Quinn Rivera',   email: 'quinn.rivera@contoso.com',   enabled: true,  manager_sam: 'oscar.melin' },
    { sam: 'rachel.kim',     display: 'Rachel Kim',     email: 'rachel.kim@contoso.com',     enabled: true,  manager_sam: 'oscar.melin' },
    { sam: 'sam.becker',     display: 'Sam Becker',     email: 'sam.becker@contoso.com',     enabled: true,  manager_sam: 'oscar.melin' },
    { sam: 'tessa.morris',   display: 'Tessa Morris',   email: 'tessa.morris@contoso.com',   enabled: false, manager_sam: 'oscar.melin' },
    { sam: 'umar.haq',       display: 'Umar Haq',       email: 'umar.haq@contoso.com',       enabled: true,  manager_sam: 'priya.iyer' },
    { sam: 'vera.novak',     display: 'Vera Novak',     email: 'vera.novak@contoso.com',     enabled: true,  manager_sam: 'priya.iyer' },
    { sam: 'will.bryant',    display: 'Will Bryant',    email: 'will.bryant@contoso.com',    enabled: true,  manager_sam: 'tom.walsh' },
    { sam: 'xenia.popa',     display: 'Xenia Popa',     email: 'xenia.popa@contoso.com',     enabled: true,  manager_sam: 'tom.walsh' },
    { sam: 'yusuf.aydin',    display: 'Yusuf Aydin',    email: 'yusuf.aydin@contoso.com',    enabled: true,  manager_sam: 'will.bryant' },
    { sam: 'zara.holt',      display: 'Zara Holt',      email: 'zara.holt@contoso.com',      enabled: true,  manager_sam: null }, // No manager — demos business_owner fallback
    // Heads — no manager themselves.
    { sam: 'paul.griffin',   display: 'Paul Griffin',   email: 'paul.griffin@contoso.com',   enabled: true,  manager_sam: null },
    { sam: 'sara.bennett',   display: 'Sara Bennett',   email: 'sara.bennett@contoso.com',   enabled: true,  manager_sam: null },
    { sam: 'tom.walsh',      display: 'Tom Walsh',      email: 'tom.walsh@contoso.com',      enabled: true,  manager_sam: null },
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

  // Applications.
  //   audit_frequency_months: cadence (6 = bi-annual, 12 = annual)
  //   auto_launch: BackgroundService kicks off the next campaign when due
  //   audit_routing_mode: 'line_manager' OR 'nominees'
  //   audit_due_period_days: campaign due_at = launched_at + this many days
  //   nominees: array of {nominee_sam, role_note} — used only in nominees mode
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
      audit_routing_mode: 'line_manager',
      audit_due_period_days: 21,
      nominees: [],
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
      audit_routing_mode: 'nominees',
      audit_due_period_days: 21,
      nominees: [
        { nominee_sam: 'sara.bennett', role_note: 'Tech owner' },
        { nominee_sam: 'tom.walsh',    role_note: 'Business owner' },
        { nominee_sam: 'paul.griffin', role_note: 'Architecture review' },
      ],
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
      audit_routing_mode: 'line_manager',
      audit_due_period_days: 14, // smaller app, shorter window
      nominees: [],
    },
    {
      application_id: 4,
      name: 'Legacy Reporting Portal',
      business_owner: 'paul.griffin',
      technical_owner: '',
      support_email: 'reports@contoso.com',
      bindings: [GROUPS[6].dn], // ownerless group — informational now
      audit_frequency_months: 12,
      auto_launch: false,
      audit_routing_mode: 'line_manager',
      audit_due_period_days: 21,
      nominees: [],
    },
  ];

  // CC mailbox config — every attestation invite/reminder CCs this address.
  // Declared here (before CAMPAIGNS) so the campaign rows can snapshot it.
  const CC_AUDIT_MAILBOX = 'group.userrecertification@contoso.com';

  // Campaigns. Dates are absolute (per project memory: convert relative dates).
  // Today is 2026-05-28. Historical mix:
  //   - Tableau: 6-month cadence with 3 closed cycles + due in ~5 months
  //   - Jira: 12-month cadence, 1 closed last year + 1 active now (in-window)
  //   - ServiceNow: 12-month cadence, last closed >14 months ago → OVERDUE
  //   - Legacy Reports: never audited
  const CAMPAIGNS = [
    // Active — Jira nominees mode (ANY nominee closes)
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
      closed_by_packet_id: null,
      launch_kind: 'manual',
      routing_mode: 'nominees',
      closure_mode: 'any_packet',
      cc_audit_mailbox: CC_AUDIT_MAILBOX,
    },
    // Active — ServiceNow line_manager mode (ALL packets must submit). 2 of 6
    // submitted; campaign is blocked waiting on the remaining managers. This
    // is the demo of "campaign closes only when every line manager responds".
    // Due 2026-06-03 (6 days out as of 2026-05-28) — inside the 7-day reminder
    // window, so the 4 pending packets will trigger reminders on the next tick.
    {
      campaign_id: 102,
      application_id: 3,
      application_name: 'ServiceNow',
      name: '2026 ServiceNow access review',
      status: 'active',
      due_at: '2026-06-03',
      created_by: 'damian.penny',
      created_at: '2026-05-20T08:30:00',
      closed_at: null,
      closed_by_packet_id: null,
      launch_kind: 'manual',
      routing_mode: 'line_manager',
      closure_mode: 'all_packets',
      cc_audit_mailbox: CC_AUDIT_MAILBOX,
    },
    // Closed history — Tableau (line_manager, all packets submitted)
    {
      campaign_id: 100,
      application_id: 1,
      application_name: 'Tableau Server',
      name: '2026-Q1 Tableau access review',
      status: 'closed',
      due_at: '2026-04-15',
      created_by: 'system',
      created_at: '2026-03-20T10:00:00',
      closed_at: '2026-04-14T13:30:00',
      closed_by_packet_id: null,
      launch_kind: 'auto',
      routing_mode: 'line_manager',
      closure_mode: 'all_packets',
      cc_audit_mailbox: CC_AUDIT_MAILBOX,
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
      closed_by_packet_id: null,
      launch_kind: 'auto',
      routing_mode: 'line_manager',
      closure_mode: 'all_packets',
      cc_audit_mailbox: CC_AUDIT_MAILBOX,
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
      closed_by_packet_id: null,
      launch_kind: 'manual',
      routing_mode: 'line_manager',
      closure_mode: 'all_packets',
      cc_audit_mailbox: CC_AUDIT_MAILBOX,
    },
    // Closed history — Jira nominees (closed by first nominee)
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
      closed_by_packet_id: null,
      launch_kind: 'manual',
      routing_mode: 'nominees',
      closure_mode: 'any_packet',
      cc_audit_mailbox: CC_AUDIT_MAILBOX,
    },
    // Closed history — ServiceNow (line_manager, OVERDUE next cycle)
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
      closed_by_packet_id: null,
      launch_kind: 'manual',
      routing_mode: 'line_manager',
      closure_mode: 'all_packets',
      cc_audit_mailbox: CC_AUDIT_MAILBOX,
    },
  ];

  // Packets — one per (campaign, recipient). Token is fake for demo; real impl
  // signs HMAC + stores SHA-256 hash. Here it's just a stable string matched
  // against the URL on attest.html. Each packet has its own subjects list
  // (the people the recipient is being asked to attest for).
  //
  // recipient_kind: 'manager' (line_manager routing) or 'nominee' (nominees routing)
  const PACKETS = [
    // -----------------------------------------------------------------------
    // Active Jira campaign 101 — nominees routing, all 3 packets pending.
    // demo-pending = Sara's packet (any nominee submission would close it).
    // -----------------------------------------------------------------------
    {
      packet_id: 'pkt-jira-sara',
      campaign_id: 101,
      recipient_sam: 'sara.bennett',
      recipient_display: 'Sara Bennett',
      recipient_email: 'sara.bennett@contoso.com',
      recipient_kind: 'nominee',
      role_note: 'Tech owner',
      subjects: ['lena.kowalski','mike.fernandez','nora.abboud','quinn.rivera','rachel.kim','sam.becker','tessa.morris','umar.haq','vera.novak','will.bryant','kareem.osei','jane.smith','iris.tanaka'],
      token: 'demo-pending',
      token_expires_at: '2026-06-15T23:59:59',
      submitted_at: null,
      submitted_by_sam: null,
      submitted_by_display: null,
      reminder_sent_at: null,
    },
    {
      packet_id: 'pkt-jira-tom',
      campaign_id: 101,
      recipient_sam: 'tom.walsh',
      recipient_display: 'Tom Walsh',
      recipient_email: 'tom.walsh@contoso.com',
      recipient_kind: 'nominee',
      role_note: 'Business owner',
      subjects: ['lena.kowalski','mike.fernandez','nora.abboud','quinn.rivera','rachel.kim','sam.becker','tessa.morris','umar.haq','vera.novak','will.bryant','kareem.osei','jane.smith','iris.tanaka'],
      token: 'demo-jira-tom',
      token_expires_at: '2026-06-15T23:59:59',
      submitted_at: null,
      submitted_by_sam: null,
      submitted_by_display: null,
      reminder_sent_at: null,
    },
    {
      packet_id: 'pkt-jira-paul',
      campaign_id: 101,
      recipient_sam: 'paul.griffin',
      recipient_display: 'Paul Griffin',
      recipient_email: 'paul.griffin@contoso.com',
      recipient_kind: 'nominee',
      role_note: 'Architecture review',
      subjects: ['lena.kowalski','mike.fernandez','nora.abboud','quinn.rivera','rachel.kim','sam.becker','tessa.morris','umar.haq','vera.novak','will.bryant','kareem.osei','jane.smith','iris.tanaka'],
      token: 'demo-jira-paul',
      token_expires_at: '2026-06-15T23:59:59',
      submitted_at: null,
      submitted_by_sam: null,
      submitted_by_display: null,
      reminder_sent_at: null,
    },
    // -----------------------------------------------------------------------
    // Closed Tableau campaign 100 — line_manager routing, all packets submitted.
    // demo-completed = Paul's packet (one of the manager packets), showing the
    // read-only banner state.
    // -----------------------------------------------------------------------
    {
      packet_id: 'pkt-tab-paul',
      campaign_id: 100,
      recipient_sam: 'paul.griffin',
      recipient_display: 'Paul Griffin',
      recipient_email: 'paul.griffin@contoso.com',
      recipient_kind: 'manager',
      // Paul's direct reports who are members of the Tableau bound groups
      subjects: ['alice.chen','bob.harris','carol.nguyen'],
      token: 'demo-completed',
      token_expires_at: '2026-04-15T23:59:59',
      submitted_at: '2026-04-12T11:20:00',
      submitted_by_sam: 'paul.griffin',
      submitted_by_display: 'Paul Griffin',
      reminder_sent_at: null,
    },
    {
      packet_id: 'pkt-tab-alice',
      campaign_id: 100,
      recipient_sam: 'alice.chen',
      recipient_display: 'Alice Chen',
      recipient_email: 'alice.chen@contoso.com',
      recipient_kind: 'manager',
      subjects: ['david.okafor','eva.lindqvist','frank.dubois','grace.patel'],
      token: 'demo-tab-alice',
      token_expires_at: '2026-04-15T23:59:59',
      submitted_at: '2026-04-13T15:00:00',
      submitted_by_sam: 'alice.chen',
      submitted_by_display: 'Alice Chen',
      reminder_sent_at: null,
    },
    {
      packet_id: 'pkt-tab-bob',
      campaign_id: 100,
      recipient_sam: 'bob.harris',
      recipient_display: 'Bob Harris',
      recipient_email: 'bob.harris@contoso.com',
      recipient_kind: 'manager',
      subjects: ['henry.silva','iris.tanaka','jane.smith','kareem.osei'],
      token: 'demo-tab-bob',
      token_expires_at: '2026-04-15T23:59:59',
      submitted_at: '2026-04-14T10:45:00',
      submitted_by_sam: 'bob.harris',
      submitted_by_display: 'Bob Harris',
      reminder_sent_at: null,
    },
    {
      packet_id: 'pkt-tab-carol',
      campaign_id: 100,
      recipient_sam: 'carol.nguyen',
      recipient_display: 'Carol Nguyen',
      recipient_email: 'carol.nguyen@contoso.com',
      recipient_kind: 'manager',
      subjects: ['lena.kowalski','mike.fernandez','nora.abboud'],
      token: 'demo-tab-carol',
      token_expires_at: '2026-04-15T23:59:59',
      submitted_at: '2026-04-14T13:30:00',
      submitted_by_sam: 'carol.nguyen',
      submitted_by_display: 'Carol Nguyen',
      reminder_sent_at: null,
    },
    // -----------------------------------------------------------------------
    // Active ServiceNow campaign 102 — line_manager routing.
    // 2 of 6 packets submitted; the campaign is still active because the
    // remaining 4 managers haven't responded. Demonstrates "campaign closes
    // only when ALL line managers have responded".
    // -----------------------------------------------------------------------
    {
      packet_id: 'pkt-snow-paul',
      campaign_id: 102,
      recipient_sam: 'paul.griffin',
      recipient_display: 'Paul Griffin',
      recipient_email: 'paul.griffin@contoso.com',
      recipient_kind: 'manager',
      subjects: ['carol.nguyen'],
      token: 'demo-snow-paul',
      token_expires_at: '2026-06-03T23:59:59',
      submitted_at: '2026-05-28T11:15:00',
      submitted_by_sam: 'paul.griffin',
      submitted_by_display: 'Paul Griffin',
      reminder_sent_at: null,
    },
    {
      packet_id: 'pkt-snow-alice',
      campaign_id: 102,
      recipient_sam: 'alice.chen',
      recipient_display: 'Alice Chen',
      recipient_email: 'alice.chen@contoso.com',
      recipient_kind: 'manager',
      subjects: ['david.okafor','eva.lindqvist','frank.dubois'],
      token: 'demo-snow-alice',
      token_expires_at: '2026-06-03T23:59:59',
      submitted_at: '2026-05-28T14:42:00',
      submitted_by_sam: 'alice.chen',
      submitted_by_display: 'Alice Chen',
      reminder_sent_at: null,
    },
    {
      packet_id: 'pkt-snow-carol',
      campaign_id: 102,
      recipient_sam: 'carol.nguyen',
      recipient_display: 'Carol Nguyen',
      recipient_email: 'carol.nguyen@contoso.com',
      recipient_kind: 'manager',
      subjects: ['lena.kowalski','mike.fernandez','nora.abboud'],
      token: 'demo-snow-carol',
      token_expires_at: '2026-06-03T23:59:59',
      submitted_at: null,
      submitted_by_sam: null,
      submitted_by_display: null,
      reminder_sent_at: null,
    },
    {
      packet_id: 'pkt-snow-sara',
      campaign_id: 102,
      recipient_sam: 'sara.bennett',
      recipient_display: 'Sara Bennett',
      recipient_email: 'sara.bennett@contoso.com',
      recipient_kind: 'manager',
      subjects: ['oscar.melin','priya.iyer'],
      token: 'demo-snow-sara',
      token_expires_at: '2026-06-03T23:59:59',
      submitted_at: null,
      submitted_by_sam: null,
      submitted_by_display: null,
      reminder_sent_at: null,
    },
    {
      packet_id: 'pkt-snow-tom',
      campaign_id: 102,
      recipient_sam: 'tom.walsh',
      recipient_display: 'Tom Walsh',
      recipient_email: 'tom.walsh@contoso.com',
      recipient_kind: 'manager',
      // Tom is both line manager of Will/Xenia AND the application's
      // business_owner — zara.holt (no manager_sam) is routed here via the
      // fallback rule, so all three appear on Tom's single packet.
      subjects: ['will.bryant','xenia.popa','zara.holt'],
      token: 'demo-snow-tom',
      token_expires_at: '2026-06-03T23:59:59',
      submitted_at: null,
      submitted_by_sam: null,
      submitted_by_display: null,
      reminder_sent_at: null,
    },
    {
      packet_id: 'pkt-snow-will',
      campaign_id: 102,
      recipient_sam: 'will.bryant',
      recipient_display: 'Will Bryant',
      recipient_email: 'will.bryant@contoso.com',
      recipient_kind: 'manager',
      subjects: ['yusuf.aydin'],
      token: 'demo-snow-will',
      token_expires_at: '2026-06-03T23:59:59',
      submitted_at: null,
      submitted_by_sam: null,
      submitted_by_display: null,
      reminder_sent_at: null,
    },
  ];

  // Decisions for the submitted packets.
  const DECISIONS = [
    // pkt-tab-paul (Paul attesting his direct reports) — all keep
    { packet_id: 'pkt-tab-paul', subject_sam: 'alice.chen',   decision: 'keep', comment: '' },
    { packet_id: 'pkt-tab-paul', subject_sam: 'bob.harris',   decision: 'keep', comment: '' },
    { packet_id: 'pkt-tab-paul', subject_sam: 'carol.nguyen', decision: 'keep', comment: '' },
    // pkt-tab-alice — all keep, four reports
    { packet_id: 'pkt-tab-alice', subject_sam: 'david.okafor',  decision: 'keep', comment: '' },
    { packet_id: 'pkt-tab-alice', subject_sam: 'eva.lindqvist', decision: 'keep', comment: '' },
    { packet_id: 'pkt-tab-alice', subject_sam: 'frank.dubois',  decision: 'keep', comment: '' },
    { packet_id: 'pkt-tab-alice', subject_sam: 'grace.patel',   decision: 'keep', comment: '' },
    // pkt-tab-bob — Henry revoked (disabled), rest keep
    { packet_id: 'pkt-tab-bob', subject_sam: 'henry.silva', decision: 'revoke', comment: 'AD account disabled' },
    { packet_id: 'pkt-tab-bob', subject_sam: 'iris.tanaka', decision: 'keep',   comment: '' },
    { packet_id: 'pkt-tab-bob', subject_sam: 'jane.smith',  decision: 'keep',   comment: '' },
    { packet_id: 'pkt-tab-bob', subject_sam: 'kareem.osei', decision: 'keep',   comment: '' },
    // pkt-tab-carol — all keep
    { packet_id: 'pkt-tab-carol', subject_sam: 'lena.kowalski',  decision: 'keep', comment: '' },
    { packet_id: 'pkt-tab-carol', subject_sam: 'mike.fernandez', decision: 'keep', comment: '' },
    { packet_id: 'pkt-tab-carol', subject_sam: 'nora.abboud',    decision: 'keep', comment: '' },
    // ServiceNow 2026 (campaign 102) — 2 packets submitted
    // pkt-snow-paul — keep carol
    { packet_id: 'pkt-snow-paul',  subject_sam: 'carol.nguyen',  decision: 'keep',   comment: '' },
    // pkt-snow-alice — revoke david (moved teams), keep eva/frank
    { packet_id: 'pkt-snow-alice', subject_sam: 'david.okafor',  decision: 'revoke', comment: 'Moved to Underwriting last month' },
    { packet_id: 'pkt-snow-alice', subject_sam: 'eva.lindqvist', decision: 'keep',   comment: '' },
    { packet_id: 'pkt-snow-alice', subject_sam: 'frank.dubois',  decision: 'keep',   comment: '' },
  ];

  // Email log — every send (invite, reminder, closure) recorded for audit.
  // Phase 1 will write to auditing.email_log; here we keep a fixture to drive
  // the email-log preview panel on the campaign detail.
  const EMAIL_LOG = [
    // Active Jira campaign 101 — three invites to the three nominees
    { log_id: 1, packet_id: 'pkt-jira-sara', campaign_id: 101, to_addr: 'sara.bennett@contoso.com', cc_addr: CC_AUDIT_MAILBOX, subject: '2026 Jira access review — your attestation', kind: 'invite', sent_at: '2026-05-25T09:14:12', success: true },
    { log_id: 2, packet_id: 'pkt-jira-tom',  campaign_id: 101, to_addr: 'tom.walsh@contoso.com',    cc_addr: CC_AUDIT_MAILBOX, subject: '2026 Jira access review — your attestation', kind: 'invite', sent_at: '2026-05-25T09:14:13', success: true },
    { log_id: 3, packet_id: 'pkt-jira-paul', campaign_id: 101, to_addr: 'paul.griffin@contoso.com', cc_addr: CC_AUDIT_MAILBOX, subject: '2026 Jira access review — your attestation', kind: 'invite', sent_at: '2026-05-25T09:14:15', success: true },
    // Closed Tableau 100 — four invites + four closures (last one closed the campaign)
    { log_id: 10, packet_id: 'pkt-tab-paul',  campaign_id: 100, to_addr: 'paul.griffin@contoso.com', cc_addr: CC_AUDIT_MAILBOX, subject: '2026-Q1 Tableau access review — your attestation', kind: 'invite', sent_at: '2026-03-20T10:01:02', success: true },
    { log_id: 11, packet_id: 'pkt-tab-alice', campaign_id: 100, to_addr: 'alice.chen@contoso.com',   cc_addr: CC_AUDIT_MAILBOX, subject: '2026-Q1 Tableau access review — your attestation', kind: 'invite', sent_at: '2026-03-20T10:01:04', success: true },
    { log_id: 12, packet_id: 'pkt-tab-bob',   campaign_id: 100, to_addr: 'bob.harris@contoso.com',   cc_addr: CC_AUDIT_MAILBOX, subject: '2026-Q1 Tableau access review — your attestation', kind: 'invite', sent_at: '2026-03-20T10:01:05', success: true },
    { log_id: 13, packet_id: 'pkt-tab-carol', campaign_id: 100, to_addr: 'carol.nguyen@contoso.com', cc_addr: CC_AUDIT_MAILBOX, subject: '2026-Q1 Tableau access review — your attestation', kind: 'invite', sent_at: '2026-03-20T10:01:07', success: true },
    // One reminder fired (Alice was slow)
    { log_id: 14, packet_id: 'pkt-tab-alice', campaign_id: 100, to_addr: 'alice.chen@contoso.com',   cc_addr: CC_AUDIT_MAILBOX, subject: 'Reminder: 2026-Q1 Tableau access review — your attestation', kind: 'reminder', sent_at: '2026-04-08T08:00:01', success: true },
    // Active ServiceNow 102 — six invites sent at launch
    { log_id: 20, packet_id: 'pkt-snow-paul',  campaign_id: 102, to_addr: 'paul.griffin@contoso.com', cc_addr: CC_AUDIT_MAILBOX, subject: '2026 ServiceNow access review — your attestation', kind: 'invite', sent_at: '2026-05-20T08:30:11', success: true },
    { log_id: 21, packet_id: 'pkt-snow-alice', campaign_id: 102, to_addr: 'alice.chen@contoso.com',   cc_addr: CC_AUDIT_MAILBOX, subject: '2026 ServiceNow access review — your attestation', kind: 'invite', sent_at: '2026-05-20T08:30:12', success: true },
    { log_id: 22, packet_id: 'pkt-snow-carol', campaign_id: 102, to_addr: 'carol.nguyen@contoso.com', cc_addr: CC_AUDIT_MAILBOX, subject: '2026 ServiceNow access review — your attestation', kind: 'invite', sent_at: '2026-05-20T08:30:13', success: true },
    { log_id: 23, packet_id: 'pkt-snow-sara',  campaign_id: 102, to_addr: 'sara.bennett@contoso.com', cc_addr: CC_AUDIT_MAILBOX, subject: '2026 ServiceNow access review — your attestation', kind: 'invite', sent_at: '2026-05-20T08:30:15', success: true },
    { log_id: 24, packet_id: 'pkt-snow-tom',   campaign_id: 102, to_addr: 'tom.walsh@contoso.com',    cc_addr: CC_AUDIT_MAILBOX, subject: '2026 ServiceNow access review — your attestation', kind: 'invite', sent_at: '2026-05-20T08:30:16', success: true },
    { log_id: 25, packet_id: 'pkt-snow-will',  campaign_id: 102, to_addr: 'will.bryant@contoso.com',  cc_addr: CC_AUDIT_MAILBOX, subject: '2026 ServiceNow access review — your attestation', kind: 'invite', sent_at: '2026-05-20T08:30:18', success: true },
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
  function getEmailLogForCampaign(cid){ return EMAIL_LOG.filter(e => e.campaign_id === cid).slice().sort((a,b) => (a.sent_at || '').localeCompare(b.sent_at || '')); }

  // Manager lookup — returns the user object for sam's manager, or null.
  function getManagerOfUser(sam) {
    const u = getUser(sam);
    if (!u || !u.manager_sam) return null;
    return getUser(u.manager_sam);
  }

  // Routing helpers used by the campaign launch preview + actual launch.
  function getRoutingMode(appId) {
    const app = getApp(appId);
    return app ? app.audit_routing_mode : 'line_manager';
  }

  // Deduped union of members across all bound groups for an app.
  function getAppRoster(appId) {
    const app = getApp(appId);
    if (!app) return [];
    const seen = new Set();
    const roster = [];
    app.bindings.forEach(dn => {
      getMembersOfGroup(dn).forEach(u => {
        if (!seen.has(u.sam)) { seen.add(u.sam); roster.push(u); }
      });
    });
    return roster;
  }

  // Line-manager grouping: { managerSam: { manager:user, subjects:[users] } }
  // Subjects with no manager_sam are bucketed under the app's business_owner
  // (matches the Phase 1 fallback).
  function getSubjectsByManager(appId) {
    const app = getApp(appId);
    if (!app) return {};
    const roster = getAppRoster(appId);
    const groups = {};
    let unrouted = [];
    roster.forEach(subject => {
      const mgr = getManagerOfUser(subject.sam);
      if (mgr) {
        if (!groups[mgr.sam]) groups[mgr.sam] = { manager: mgr, subjects: [] };
        groups[mgr.sam].subjects.push(subject);
      } else {
        unrouted.push(subject);
      }
    });
    if (unrouted.length) {
      const fallback = getUser(app.business_owner);
      const key = '__fallback__' + (fallback ? fallback.sam : 'none');
      groups[key] = {
        manager: fallback,
        subjects: unrouted,
        is_fallback: true,
      };
    }
    return groups;
  }

  // Nominees expanded with full user details + role notes.
  function getNomineesOfApp(appId) {
    const app = getApp(appId);
    if (!app || !Array.isArray(app.nominees)) return [];
    return app.nominees.map(n => ({
      ...n,
      ...(getUser(n.nominee_sam) || { sam: n.nominee_sam, display: n.nominee_sam, email: null, enabled: false }),
    }));
  }

  // Whether a campaign should be treated as closed for a given packet view.
  // Used by attest.html to show the read-only banner on non-submitted packets
  // in nominees-mode campaigns that another nominee already closed.
  function getClosingPacket(campaignId) {
    const c = getCampaign(campaignId);
    if (!c || c.status !== 'closed') return null;
    if (c.closure_mode !== 'any_packet') return null;
    const packets = getPacketsOfCampaign(campaignId);
    return packets.find(p => p.submitted_at) || null;
  }

  // Campaign progress: { submitted, total } for line_manager mode.
  // For nominees mode, "submitted" is 0 or 1 (first wins), "total" still N
  // packets but only one ever submits — UI should label this differently.
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

  // ---------- Page-level dashboard counts (drives the crit strip) ----------
  // Action required = the human-facing "you need to look at something" tally.
  //   Counts: overdue apps + apps in nominees mode with zero enabled nominees.
  // Overdue audits = apps past their next_due with no active campaign.
  // Reminders due this week = pending packets in active campaigns where
  //   campaign.due_at - NOW() <= 7 days, mirroring the reminder daily-tick SQL.
  // Active campaigns = anything still in flight.
  // Pending packets = unsubmitted packets across all active campaigns.
  // Healthy = apps on schedule, launch-ready, no active campaign needed.
  function getAuditingCritCounts() {
    const SEVEN_DAYS_MS = 7 * 86400000;
    const now = Date.now();

    const overdueApps = APPLICATIONS.filter(a => getAuditStatus(a.application_id).status === 'overdue');
    const notReadyApps = APPLICATIONS.filter(a => {
      if (a.audit_routing_mode !== 'nominees') return false;
      return getNomineesOfApp(a.application_id).filter(n => n.enabled).length === 0;
    });

    const activeCampaigns = CAMPAIGNS.filter(c => c.status === 'active');

    let remindersDue = 0;
    let pendingPackets = 0;
    activeCampaigns.forEach(c => {
      const packets = PACKETS.filter(p => p.campaign_id === c.campaign_id && !p.submitted_at);
      pendingPackets += packets.length;
      const dueAt = new Date((c.due_at || '') + 'T23:59:59').getTime();
      const msToDue = dueAt - now;
      if (msToDue > 0 && msToDue <= SEVEN_DAYS_MS) {
        remindersDue += packets.filter(p => !p.reminder_sent_at).length;
      }
    });

    const healthy = APPLICATIONS.filter(a => {
      const s = getAuditStatus(a.application_id);
      if (s.status !== 'ok') return false;
      if (a.audit_routing_mode === 'nominees' && getNomineesOfApp(a.application_id).filter(n => n.enabled).length === 0) return false;
      return true;
    });

    return {
      actionRequired: overdueApps.length + notReadyApps.length,
      overdue: overdueApps.length,
      remindersDue,
      activeCampaigns: activeCampaigns.length,
      pendingPackets,
      healthy: healthy.length,
      total: APPLICATIONS.length,
    };
  }

  window.AUDITING_DATA = {
    USERS, GROUPS, GROUP_OWNERS, GROUP_MEMBERSHIPS, APPLICATIONS, CAMPAIGNS, PACKETS, DECISIONS, EMAIL_LOG,
    CC_AUDIT_MAILBOX,
    getUser, getGroup, getApp, getCampaign,
    getOwnersOfGroup, getMembersOfGroup,
    getPacketsOfCampaign, getPacketByToken, getDecisionsByPacket, getEmailLogForCampaign,
    getCampaignProgress, summarizeDecisions, summarizeCampaignDecisions,
    getAuditHistory, getLastAuditDate, getNextAuditDue, getAuditStatus,
    getManagerOfUser, getRoutingMode, getAppRoster, getSubjectsByManager, getNomineesOfApp,
    getClosingPacket, getAuditingCritCounts,
  };
})();
