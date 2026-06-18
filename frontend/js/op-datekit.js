/* op-datekit.js - canonical date + reason-slug helpers.

   Single source of truth, shared by:
     - op-pages.js   (classic script, via window.OP_DATEKIT)
     - op-boot.js    (ES module, via window.OP_DATEKIT)
     - the Node tests (tests/frontend/op-datekit.test.mjs, via require())

   Why this exists: the hold-until date used to make a Date -> en-GB display
   string -> Date round-trip on the live exclusion write path, relying on the
   implementation-defined `new Date(string)` parser. On CLDR-42+ engines
   `toLocaleDateString('en-GB',{month:'short'})` emits "Sept" for September,
   which that parser does not reliably accept. This module parses ISO and the
   en-GB display form explicitly so the round-trip can never silently fail, and
   keeps the hold-state + reason-slug rules in one tested place.

   Loaded as a classic script BEFORE op-pages.js so window.OP_DATEKIT exists by
   the time the page renders. */
(function (root, factory) {
  var api = factory();
  if (root) root.OP_DATEKIT = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api; // Node tests
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  // first-three-letters -> month index. Covers full names and the CLDR-42
  // "Sept" abbreviation that the engine's own Date() parser does not handle.
  var MIDX = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

  function todayLocal() {
    var n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  }
  // Calendar arithmetic (not ms) so it stays correct across DST transitions.
  function addDays(base, n) {
    return new Date(base.getFullYear(), base.getMonth(), base.getDate() + n);
  }
  function isoLocal(d) {
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function mk(y, m, d) {
    var dt = new Date(y, m, d);
    return isNaN(dt.getTime()) ? null : dt;
  }

  // Robust parse: accepts a Date, ISO yyyy-mm-dd (as LOCAL midnight), or the
  // en-GB display string "22 Apr 2026" / "1 Sept 2026" / legacy "Apr 22, 2026".
  // Never depends on the engine's locale-specific string parsing for those.
  function parseLoose(s) {
    if (s == null) return null;
    if (s instanceof Date) return isNaN(s.getTime()) ? null : s;
    var str = String(s).trim();
    if (!str) return null;
    var iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
    if (iso) return mk(+iso[1], +iso[2] - 1, +iso[3]);
    var parts = str.replace(/[.,]/g, '').split(/\s+/);
    if (parts.length === 3) {
      var day, mon, year;
      if (/^\d+$/.test(parts[0])) { day = +parts[0]; mon = parts[1]; year = +parts[2]; } // 22 Apr 2026
      else { mon = parts[0]; day = +parts[1]; year = +parts[2]; }                          // Apr 22, 2026
      var mi = MIDX[(mon || '').toLowerCase().slice(0, 3)];
      if (mi != null && day >= 1 && day <= 31 && year > 0) return mk(year, mi, day);
    }
    var d = new Date(str); // last resort, e.g. full ISO timestamps
    return isNaN(d.getTime()) ? null : d;
  }

  // -> "yyyy-mm-dd" (the wire format the API binds to DateOnly), or null.
  function toIsoDate(s) {
    if (s == null || s === '') return null;
    var str = String(s).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
    var d = parseLoose(str);
    return d ? isoLocal(d) : null;
  }

  // en-GB display string - matches the existing fmtUntil() output exactly.
  function fmtGB(d) {
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  // Hold-state rule - mirrors backend PatchExclusionService.StateClauseFor:
  // overdue = until < today; expiring-soon = today <= until < today+7d; else active.
  // `until` may be a Date or any string parseLoose understands; `today` a Date or string.
  function deriveState(until, today) {
    var u = parseLoose(until);
    var t = (today instanceof Date) ? today : parseLoose(today);
    if (!u || !t) return 'active';
    var days = Math.round((u - t) / 86400000);
    if (days < 0) return 'overdue';
    if (days < 7) return 'expiring-soon';
    return 'active';
  }

  // Reason -> backend slug, driven by the SELECTED category, never a free-text
  // scan, so a free-text "Other" can never collide with a keyword. Keys mirror
  // EXCLUSION_REASONS in op-pages.js. Unknown / Other => 'custom'.
  var REASON_SLUGS = {
    'Vendor advisory \u2014 pending hotfix': 'pending-vendor-fix',
    'Application change-freeze': 'business-freeze',
    'Hardware refresh in progress': 'custom',
    'Regulatory window': 'custom',
    'Database migration in-flight': 'custom',
    'Customer-facing release period': 'custom',
    'Other': 'custom'
  };
  function slugifyReason(reason, isOther) {
    if (isOther) return 'custom';
    if (reason && Object.prototype.hasOwnProperty.call(REASON_SLUGS, reason)) return REASON_SLUGS[reason];
    return 'custom';
  }

  return {
    todayLocal: todayLocal, addDays: addDays, isoLocal: isoLocal,
    parseLoose: parseLoose, toIsoDate: toIsoDate, fmtGB: fmtGB,
    deriveState: deriveState, REASON_SLUGS: REASON_SLUGS, slugifyReason: slugifyReason
  };
});
