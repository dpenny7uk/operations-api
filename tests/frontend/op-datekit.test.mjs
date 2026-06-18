// Tests for frontend/js/op-datekit.js - the canonical date + reason-slug helpers.
// Run with:  node --test tests/frontend/
//
// These cover exactly the logic the panel review flagged: the en-GB display
// string <-> Date round-trip on the exclusion write path (incl. the CLDR-42
// "Sept" form that new Date() rejects), the DST-safe day arithmetic, the
// hold-state boundaries, and the selection-driven reason slug.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const dk = require('../../frontend/js/op-datekit.js');

test('isoLocal uses LOCAL components - no UTC drift', () => {
  assert.equal(dk.isoLocal(new Date(2026, 8, 1)), '2026-09-01'); // 1 Sept
  assert.equal(dk.isoLocal(new Date(2026, 0, 5)), '2026-01-05');
  assert.equal(dk.isoLocal(new Date(2026, 11, 31)), '2026-12-31');
});

test('toIsoDate round-trips the en-GB display string for every month', () => {
  for (let m = 0; m < 12; m++) {
    const d = new Date(2026, m, 15);
    const display = dk.fmtGB(d);                 // e.g. "15 Sept 2026"
    assert.equal(dk.toIsoDate(display), dk.isoLocal(d),
      `month ${m} display "${display}" must round-trip to ISO`);
  }
});

test('toIsoDate parses the literal CLDR-42 "Sept" form that new Date() rejects', () => {
  assert.equal(dk.toIsoDate('1 Sept 2026'), '2026-09-01');
  assert.equal(dk.toIsoDate('22 Apr 2026'), '2026-04-22');
  assert.equal(dk.toIsoDate('Apr 22, 2026'), '2026-04-22'); // legacy US display form
});

test('toIsoDate passes ISO through and rejects junk', () => {
  assert.equal(dk.toIsoDate('2026-04-22'), '2026-04-22');
  assert.equal(dk.toIsoDate(''), null);
  assert.equal(dk.toIsoDate(null), null);
  assert.equal(dk.toIsoDate('not a date'), null);
});

test('deriveState boundaries match the backend rule', () => {
  const today = new Date(2026, 5, 1);
  assert.equal(dk.deriveState(dk.addDays(today, -1), today), 'overdue');
  assert.equal(dk.deriveState(today, today), 'expiring-soon');             // day 0
  assert.equal(dk.deriveState(dk.addDays(today, 6), today), 'expiring-soon');
  assert.equal(dk.deriveState(dk.addDays(today, 7), today), 'active');
  assert.equal(dk.deriveState(dk.addDays(today, 30), today), 'active');
});

test('deriveState accepts the en-GB display string too (incl. September)', () => {
  const today = new Date(2026, 8, 1);                                       // September anchor
  assert.equal(dk.deriveState(dk.fmtGB(dk.addDays(today, -2)), today), 'overdue');
  assert.equal(dk.deriveState(dk.fmtGB(dk.addDays(today, 3)), today), 'expiring-soon');
  assert.equal(dk.deriveState(dk.fmtGB(dk.addDays(today, 20)), today), 'active');
});

test('addDays is DST-safe (calendar arithmetic, not ms)', () => {
  // 29 Mar 2026 is the UK spring-forward; +1 day must land on the 30th,
  // which the old `today.getTime() + days*86400000` approach could miss.
  assert.equal(dk.isoLocal(dk.addDays(new Date(2026, 2, 29), 1)), '2026-03-30');
  assert.equal(dk.isoLocal(dk.addDays(new Date(2026, 9, 25), 1)), '2026-10-26'); // autumn fall-back
});

test('slugifyReason is driven by selection, never a free-text scan', () => {
  assert.equal(dk.slugifyReason('Application change-freeze', false), 'business-freeze');
  // pull the vendor key from the module so this file stays ASCII (the key
  // contains a non-ASCII dash, defined once in op-datekit.js)
  const vendorKey = Object.keys(dk.REASON_SLUGS).find(k => k.startsWith('Vendor advisory'));
  assert.equal(dk.slugifyReason(vendorKey, false), 'pending-vendor-fix');
  assert.equal(dk.slugifyReason('Hardware refresh in progress', false), 'custom');
  // a free-text "Other" that happens to contain a keyword must NOT collide
  assert.equal(dk.slugifyReason('approved vendor change', true), 'custom');
  assert.equal(dk.slugifyReason('emergency freeze window', true), 'custom');
  assert.equal(dk.slugifyReason('', true), 'custom');
});
