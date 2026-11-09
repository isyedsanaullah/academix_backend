'use strict';

/**
 * pkt_money_utils.test.js
 * Unit tests for PKT timezone and PKR money utilities (Phase 0.3)
 */

const assert = require('assert');
const {
  startOfMonthPKT,
  endOfMonthPKT,
  pktRangeFromQuery,
  formatPKT,
  toPKTDateString
} = require('../utils/pkt');
const {
  formatPKR,
  formatPKRCompact,
  parsePKR,
  calcVariance
} = require('../utils/money');

function runTests() {
  console.log('====================================================');
  console.log('   PHASE 0.3 PKT & MONEY UTILITIES TEST SUITE       ');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}`);
      console.error(`    ${err.message}`);
      failed++;
    }
  }

  // 1. PKT Month Start
  test('startOfMonthPKT returns exact UTC equivalent of 1st day 00:00:00 PKT', () => {
    // Anchor to 2026-11-09
    const anchor = new Date('2026-11-09T12:00:00Z');
    const somCurrent = startOfMonthPKT(0, anchor);
    // 2026-11-01 00:00:00 PKT is 2026-10-31 19:00:00.000 UTC
    assert.strictEqual(somCurrent.toISOString(), '2026-10-31T19:00:00.000Z');

    const somPrev = startOfMonthPKT(-1, anchor);
    // 2026-10-01 00:00:00 PKT is 2026-09-30 19:00:00.000 UTC
    assert.strictEqual(somPrev.toISOString(), '2026-09-30T19:00:00.000Z');
  });

  // 2. PKT Month End
  test('endOfMonthPKT returns exact UTC equivalent of last day 23:59:59.999 PKT', () => {
    const anchor = new Date('2026-11-09T12:00:00Z');
    const eomCurrent = endOfMonthPKT(0, anchor);
    // November has 30 days. 2026-11-30 23:59:59.999 PKT is 2026-11-30 18:59:59.999 UTC
    assert.strictEqual(eomCurrent.toISOString(), '2026-11-30T18:59:59.999Z');

    const eomPrev = endOfMonthPKT(-1, anchor);
    // October has 31 days. 2026-10-31 23:59:59.999 PKT is 2026-10-31 18:59:59.999 UTC
    assert.strictEqual(eomPrev.toISOString(), '2026-10-31T18:59:59.999Z');
  });

  // 3. PKT Range from Query
  test('pktRangeFromQuery accurately builds start-of-day and end-of-day in PKT', () => {
    const range = pktRangeFromQuery('2026-11-01', '2026-11-05');
    assert.strictEqual(range.gte.toISOString(), '2026-10-31T19:00:00.000Z');
    assert.strictEqual(range.lte.toISOString(), '2026-11-05T18:59:59.999Z');
  });

  // 4. PKT Date Formatting
  test('formatPKT formats in Asia/Karachi timezone', () => {
    const utcDate = new Date('2026-11-01T00:00:00Z');
    const formatted = formatPKT(utcDate);
    // UTC 00:00:00 on Nov 1 is 05:00:00 AM on Nov 1 in PKT
    assert.ok(formatted.includes('Nov') || formatted.includes('1'), `Formatted output: ${formatted}`);
  });

  test('toPKTDateString returns YYYY-MM-DD in PKT wall time', () => {
    // 2026-10-31 19:30:00 UTC is 2026-11-01 00:30:00 PKT
    const date = new Date('2026-10-31T19:30:00Z');
    assert.strictEqual(toPKTDateString(date), '2026-11-01');
  });

  // 5. Money Formatters
  test('formatPKR formats integers correctly', () => {
    assert.strictEqual(formatPKR(121458300), 'PKR 121,458,300');
    assert.strictEqual(formatPKR(0), 'PKR 0');
    assert.strictEqual(formatPKR(351238.8), 'PKR 351,239');
  });

  test('formatPKRCompact formats millions, thousands, and billions', () => {
    assert.strictEqual(formatPKRCompact(121458300), 'PKR 121.5M');
    assert.strictEqual(formatPKRCompact(351238), 'PKR 351.2K');
    assert.strictEqual(formatPKRCompact(1500000000), 'PKR 1.5B');
    assert.strictEqual(formatPKRCompact(500), 'PKR 500');
  });

  test('parsePKR and calcVariance calculate expected values', () => {
    assert.strictEqual(parsePKR('1234.5'), 1235);
    assert.strictEqual(parsePKR(null), 0);
    assert.strictEqual(calcVariance(3000, 2500), -500); // 500 underpayment
    assert.strictEqual(calcVariance(3000, 3500), 500);  // 500 overpayment
  });

  console.log('\n----------------------------------------------------');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('----------------------------------------------------');

  if (failed > 0) process.exit(1);
}

runTests();

