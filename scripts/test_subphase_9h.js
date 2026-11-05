'use strict';

/**
 * test_subphase_9h.js — Test Sub-Phase 9H: N03 Scheduled Executive Digest
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const assert = require('assert');
const { getSystemClient } = require('../config/prismaManager');
const prisma = getSystemClient();

const digestService = require('../services/digestService');
const { processExecutiveDigestTick, getIsoWeekKey } = require('../workers/executiveDigestWorker');

async function runTests() {
  console.log('====================================================');
  console.log('   TESTING SUB-PHASE 9H: N03 EXECUTIVE DIGEST      ');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`FAIL: ${name}`);
      console.error(`      ${err.message}`);
      failed++;
    }
  }

  // 1. DigestConfig Validation & Recipient Cap (Max 10)
  await test('1. DigestConfig Validation & Recipient Cap (Max 10)', async () => {
    const col = await prisma.college.create({
      data: { name: 'Digest Col', email: `dg_${Date.now()}@test.com`, code: `DG_${Date.now()}`, planId: 'premium', subStatus: 'ACTIVE' }
    });

    // Valid save
    const validConfig = await digestService.saveDigestConfig({
      collegeId: col.id,
      isEnabled: true,
      recipients: ['principal@college.edu', 'trustee@college.edu'],
      weekday: 1, // Monday
      sendHour: 8
    });
    assert.strictEqual(validConfig.isEnabled, true);
    assert.strictEqual(validConfig.recipients.length, 2);

    // Invalid email rejected
    try {
      await digestService.saveDigestConfig({
        collegeId: col.id,
        recipients: ['not-an-email']
      });
      assert.fail('Should reject invalid email');
    } catch (err) {
      assert.strictEqual(err.code, 'INVALID_EMAIL');
    }

    // Exceeding 10 recipients rejected
    try {
      const elevenEmails = Array.from({ length: 11 }, (_, i) => `user${i}@test.com`);
      await digestService.saveDigestConfig({
        collegeId: col.id,
        recipients: elevenEmails
      });
      assert.fail('Should reject >10 recipients');
    } catch (err) {
      assert.strictEqual(err.code, 'RECIPIENTS_CAP_EXCEEDED');
    }
  });

  // 2. Aggregates-Only Content Assertion (No raw rows)
  await test('2. Aggregates-Only Content Assertion (No student/voucher PII rows)', async () => {
    const col = await prisma.college.create({
      data: { name: 'Agg Col', email: `agg_${Date.now()}@test.com`, code: `AGG_${Date.now()}`, planId: 'premium', subStatus: 'ACTIVE' }
    });

    const summary = await digestService.generateDigestSummary(col.id);
    assert.strictEqual(summary.reportType, 'WEEKLY_EXECUTIVE_DIGEST');
    assert(summary.metrics);

    // Must have rates and counts
    assert(typeof summary.metrics.activeStudents === 'number');
    assert(typeof summary.metrics.studentAttendanceRate === 'string');
    assert(typeof summary.metrics.staffAttendanceRate === 'string');
    assert(typeof summary.metrics.feeRecoveryRate === 'string');

    // Must NOT have individual record arrays
    assert.strictEqual(summary.students, undefined);
    assert.strictEqual(summary.vouchers, undefined);
    assert.strictEqual(summary.staff, undefined);
  });

  // 3. Catch-Up Scheduling & JobRunLog Idempotency
  await test('3. Catch-Up Scheduling & JobRunLog Idempotency (Tick once per ISO week)', async () => {
    const col = await prisma.college.create({
      data: { name: 'Catch Col', email: `cth_${Date.now()}@test.com`, code: `CTH_${Date.now()}`, planId: 'premium', subStatus: 'ACTIVE' }
    });

    // Configured for Monday 08:00 PKT
    await digestService.saveDigestConfig({
      collegeId: col.id,
      isEnabled: true,
      recipients: ['dean@college.edu'],
      weekday: 1, // Monday
      sendHour: 8
    });

    // Simulate running at Monday 10:00 PKT (2 hours missed/catch-up)
    // Construct a simulated UTC date corresponding to a Monday 10:00 PKT (05:00 UTC)
    // 2026-11-09 is a Monday. 05:00 UTC = 10:00 PKT.
    const simulatedMondayMissed = new Date('2026-11-09T05:00:00Z');

    const tickResults1 = await processExecutiveDigestTick(simulatedMondayMissed);
    const sentItem = tickResults1.find(r => r.collegeId === col.id);
    assert(sentItem, 'Missed scheduled digest must catch up and send');
    assert.strictEqual(sentItem.status, 'SENT');

    // Verify Outbox Event created
    const outbox = await prisma.outboxEvent.findFirst({
      where: { college_id: col.id, eventType: 'DIGEST_EMAIL' }
    });
    assert(outbox);
    assert.strictEqual(outbox.payload.recipients[0], 'dean@college.edu');

    // Run again immediately in the same week (simulating next hourly tick)
    const tickResults2 = await processExecutiveDigestTick(simulatedMondayMissed);
    const reSentItem = tickResults2.find(r => r.collegeId === col.id);
    assert.strictEqual(reSentItem, undefined, 'Second tick in same week must be skipped via JobRunLog');
  });

  // 4. Skips Disabled and Suspended Colleges
  await test('4. Skips Disabled and Suspended Institutions', async () => {
    // Suspended college
    const suspCol = await prisma.college.create({
      data: { name: 'Susp Col', email: `susp_${Date.now()}@test.com`, code: `SDG_${Date.now()}`, planId: 'premium', subStatus: 'SUSPENDED' }
    });
    await digestService.saveDigestConfig({
      collegeId: suspCol.id,
      isEnabled: true,
      recipients: ['admin@susp.edu'],
      weekday: 1,
      sendHour: 8
    });

    const simulatedMonday = new Date('2026-11-09T05:00:00Z');
    const tickResults = await processExecutiveDigestTick(simulatedMonday);

    const suspItem = tickResults.find(r => r.collegeId === suspCol.id);
    assert.strictEqual(suspItem, undefined, 'Suspended college must be skipped');
  });

  console.log(`\n====================================================`);
  console.log(`SUB-PHASE 9H TESTS SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log(`====================================================`);

  if (failed > 0) process.exit(1);
}

runTests()
  .catch(err => {
    console.error('Fatal error during test run:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

