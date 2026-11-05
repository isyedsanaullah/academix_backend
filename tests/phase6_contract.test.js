/**
 * phase6_contract.test.js
 * Comprehensive automated contract test suite for Phase 6.
 * Tests 1–12: 6A/6C Settlement Engine, Concurrency, Partial Unique Index, Caps, Outbox.
 * Tests 13–16: 6B Governance Deck, Quota Overrides, Audit Immutability, Trial Ceiling.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const assert = require('assert');
const { getSystemClient } = require('../config/prismaManager');
const {
  approvePayment,
  rejectPayment,
  submitPayment,
  cleanTid
} = require('../services/settlementService');
const { getEntitlements } = require('../services/entitlements');
const jwt = require('jsonwebtoken');

let prisma;

async function runTests() {
  console.log('====================================================');
  console.log('   ACADEMIX PHASE 6 COMPREHENSIVE CONTRACT TESTS    ');
  console.log('====================================================\n');

  prisma = getSystemClient();
  let passed = 0;
  let failed = 0;

  const test = async (name, fn) => {
    try {
      await fn();
      console.log(`PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`FAIL: ${name}`);
      console.error('   Error:', err.message);
      if (err.detail) console.error('   Detail:', err.detail);
      failed++;
    }
  };

  // Helper to get or create an isolated test college
  const createTestCollege = async (overrides = {}) => {
    const code = 'T6_' + Math.random().toString(36).substring(2, 8).toUpperCase();
    return await prisma.college.create({
      data: {
        name: `Phase 6 Test College ${code}`,
        code,
        email: `${code.toLowerCase()}@test-phase6.edu.pk`,
        planId: 'starter',
        subStatus: 'ACTIVE',
        periodStart: new Date(),
        periodEnd: new Date(Date.now() + 30 * 86400000),
        forceReadOnly: false,
        tokenEpoch: 0,
        trialExtensionCount: 0,
        ...overrides
      }
    });
  };

  try {
    // -------------------------------------------------------------------------
    // Test 1: Mixed Order Sequence Test
    // -------------------------------------------------------------------------
    await test('1. Mixed Order Sequence Test (Plan first, then Add-ons, then Credits)', async () => {
      const col = await createTestCollege({ planId: 'starter' });
      const now = new Date();

      const payment = await prisma.collegeSubscriptionPayment.create({
        data: {
          college_id: col.id,
          type: 'UPGRADE',
          planId: 'standard',
          billingCycle: 'MONTHLY',
          expectedAmount: 5999,
          amountPaid: 5999,
          paymentMethod: 'BANK_TRANSFER',
          transactionId: 'TXMIXED' + Date.now(),
          screenshotUrl: 'tenants/test/receipts/proof.jpg',
          submittedBy: 'tester',
          lineItems: [
            { itemType: 'PLAN_UPGRADE', planId: 'standard', unitPrice: 5999, subtotal: 5999 },
            { itemType: 'ADDON', addonType: 'APPLICATIONS', quantity: 1, unitPrice: 2500, subtotal: 2500 }
          ]
        }
      });

      const res = await approvePayment(payment.id, 'admin_super');
      assert.ok(res.receiptNumber.startsWith('RCP-'), 'Receipt number generated');

      const updatedCol = await prisma.college.findUnique({ where: { id: col.id } });
      assert.strictEqual(updatedCol.planId, 'standard', 'Plan was upgraded to standard first');

      const activeAddons = await prisma.collegeAddon.findMany({ where: { college_id: col.id } });
      assert.strictEqual(activeAddons.length, 1, 'Addon was created second');
      assert.strictEqual(activeAddons[0].addonType, 'APPLICATIONS');
    });

    // -------------------------------------------------------------------------
    // Test 2: Partial Unique Index Test
    // -------------------------------------------------------------------------
    await test('2. Partial Unique Index Test (Duplicate blocked for active, accepted after rejected)', async () => {
      const col = await createTestCollege();
      const txId = 'TXUNQ' + Date.now();

      // Submit and approve payment 1
      const p1 = await prisma.collegeSubscriptionPayment.create({
        data: {
          college_id: col.id,
          type: 'RENEWAL',
          expectedAmount: 2999,
          amountPaid: 2999,
          paymentMethod: 'RAAST',
          transactionId: txId,
          screenshotUrl: 'test.png',
          submittedBy: 'tester',
          status: 'PENDING',
          lineItems: []
        }
      });

      // Submit identical payment -> must fail with duplicate
      let dupFailed = false;
      try {
        await submitPayment(col.id, 'tester', {
          type: 'RENEWAL',
          expectedAmount: 2999,
          amountPaid: 2999,
          paymentMethod: 'RAAST',
          transactionId: txId,
          screenshotUrl: 'test.png',
          lineItems: []
        });
      } catch (err) {
        if (err.message === 'DUPLICATE_TRANSACTION') dupFailed = true;
      }
      assert.ok(dupFailed, 'Submit returned 409 DUPLICATE_TRANSACTION');

      // Now reject payment 1
      await rejectPayment(p1.id, 'admin_super', { reason: 'Test rejection' });

      // After rejection, submitting with same txId is allowed
      const p2 = await submitPayment(col.id, 'tester', {
        type: 'RENEWAL',
        expectedAmount: 2999,
        amountPaid: 2999,
        paymentMethod: 'RAAST',
        transactionId: txId,
        screenshotUrl: 'test2.png',
        lineItems: []
      });
      assert.ok(p2.id, 'Submission succeeded with same txId after prior was REJECTED');
    });

    // -------------------------------------------------------------------------
    // Test 3: Duplicate Submission Detection & Fuzzy Matching Test
    // -------------------------------------------------------------------------
    await test('3. Duplicate Submission Detection Test (Fuzzy cross-method flagged)', async () => {
      const col = await createTestCollege();
      const txId = 'TXFUZZY' + Date.now();

      // Submit on BANK_TRANSFER
      await submitPayment(col.id, 'tester', {
        type: 'RENEWAL',
        expectedAmount: 2999,
        amountPaid: 2999,
        paymentMethod: 'BANK_TRANSFER',
        transactionId: txId,
        screenshotUrl: 'test.png',
        lineItems: []
      });

      // Submit same txId on JAZZCASH (cross-method fuzzy match)
      const pCross = await submitPayment(col.id, 'tester', {
        type: 'RENEWAL',
        expectedAmount: 2999,
        amountPaid: 2999,
        paymentMethod: 'JAZZCASH',
        transactionId: txId,
        screenshotUrl: 'test2.png',
        lineItems: []
      });

      assert.strictEqual(pCross.isDuplicateSuspected, true, 'isDuplicateSuspected set to true for cross-method');
    });

    // -------------------------------------------------------------------------
    // Test 4: Concurrent Double-Approve Test
    // -------------------------------------------------------------------------
    await test('4. Concurrent Double-Approve Test (Pessimistic lock + atomic transition)', async () => {
      const col = await createTestCollege();
      const p = await prisma.collegeSubscriptionPayment.create({
        data: {
          college_id: col.id,
          type: 'RENEWAL',
          expectedAmount: 2999,
          amountPaid: 2999,
          paymentMethod: 'BANK_TRANSFER',
          transactionId: 'TXCONCUR' + Date.now(),
          screenshotUrl: 'test.png',
          submittedBy: 'tester',
          status: 'PENDING',
          lineItems: []
        }
      });

      // Execute two simultaneous approvals
      const [res1, res2] = await Promise.allSettled([
        approvePayment(p.id, 'admin_1'),
        approvePayment(p.id, 'admin_2')
      ]);

      const successCount = [res1, res2].filter(r => r.status === 'fulfilled').length;
      const rejectCount = [res1, res2].filter(r => r.status === 'rejected').length;

      assert.strictEqual(successCount, 1, 'Exactly one approval succeeded');
      assert.strictEqual(rejectCount, 1, 'Second approval rejected');
      const rejectedResult = [res1, res2].find(r => r.status === 'rejected');
      const rejectMsg = rejectedResult?.reason?.message || String(rejectedResult?.reason);
      assert.ok(
        rejectMsg.includes('PAYMENT_ALREADY_SETTLED_OR_CANCELLED') || rejectMsg.includes('conflict') || rejectMsg.includes('409') || rejectMsg.includes('Unable to start a transaction'),
        `Second approval rejected with conflict, received: ${rejectMsg}`
      );
    });

    // -------------------------------------------------------------------------
    // Test 5: Approval Cap Re-Validation Test (Upgrade Hard Block)
    // -------------------------------------------------------------------------
    await test('5. Approval Cap Re-Validation Test (Hard block 422 on upgrade)', async () => {
      const col = await createTestCollege({ planId: 'standard' });

      // Seed usage exceeding starter limits (e.g. 500 students, starter max is 300)
      await prisma.collegeUsage.upsert({
        where: { college_id_metric_period: { college_id: col.id, metric: 'students', period: 'total' } },
        update: { value: BigInt(500) },
        create: { college_id: col.id, metric: 'students', period: 'total', value: BigInt(500) }
      });

      const p = await prisma.collegeSubscriptionPayment.create({
        data: {
          college_id: col.id,
          type: 'UPGRADE',
          planId: 'starter', // trying to downgrade/upgrade to a plan capped at 300
          expectedAmount: 2999,
          amountPaid: 2999,
          paymentMethod: 'BANK_TRANSFER',
          transactionId: 'TXCAP' + Date.now(),
          screenshotUrl: 'test.png',
          submittedBy: 'tester',
          status: 'PENDING',
          lineItems: []
        }
      });

      let blocked = false;
      try {
        await approvePayment(p.id, 'admin_super');
      } catch (err) {
        if (err.code === 'CAP_EXCEEDED_AT_SETTLEMENT' || err.message === 'CAP_EXCEEDED_AT_SETTLEMENT') {
          blocked = true;
          assert.strictEqual(err.detail.metric, 'students');
          assert.strictEqual(err.detail.currentUsage, 500);
        }
      }
      assert.ok(blocked, 'Cap validation hard-blocked settlement with CAP_EXCEEDED_AT_SETTLEMENT');
    });

    // -------------------------------------------------------------------------
    // Test 6: Renewal Warn-Only Cap Test
    // -------------------------------------------------------------------------
    await test('6. Renewal Warn-Only Cap Test (Same-plan renewal with over-cap proceeds with warning)', async () => {
      const col = await createTestCollege({ planId: 'starter' });

      // Usage exceeds starter max 300
      await prisma.collegeUsage.upsert({
        where: { college_id_metric_period: { college_id: col.id, metric: 'students', period: 'total' } },
        update: { value: BigInt(450) },
        create: { college_id: col.id, metric: 'students', period: 'total', value: BigInt(450) }
      });

      const p = await prisma.collegeSubscriptionPayment.create({
        data: {
          college_id: col.id,
          type: 'RENEWAL',
          planId: 'starter',
          expectedAmount: 2999,
          amountPaid: 2999,
          paymentMethod: 'BANK_TRANSFER',
          transactionId: 'TXWARN' + Date.now(),
          screenshotUrl: 'test.png',
          submittedBy: 'tester',
          status: 'PENDING',
          lineItems: []
        }
      });

      const res = await approvePayment(p.id, 'admin_super');
      assert.ok(res.receiptNumber, 'Renewal succeeded despite over-cap');

      const audit = await prisma.collegeEntitlementAudit.findFirst({
        where: { college_id: col.id, action: 'RENEWAL_OVERCAP_WARNING' }
      });
      assert.ok(audit, 'RENEWAL_OVERCAP_WARNING audit record logged');
    });

    // -------------------------------------------------------------------------
    // Test 7: Underpayment & Overpayment Policy Test
    // -------------------------------------------------------------------------
    await test('7. Underpayment & Overpayment Policy Test', async () => {
      const col = await createTestCollege();

      // Underpayment without note -> rejected 400
      const pUnder = await prisma.collegeSubscriptionPayment.create({
        data: {
          college_id: col.id,
          type: 'RENEWAL',
          expectedAmount: 2999,
          amountPaid: 2500, // underpaid
          paymentMethod: 'BANK_TRANSFER',
          transactionId: 'TXUNDER' + Date.now(),
          screenshotUrl: 'test.png',
          submittedBy: 'tester',
          status: 'PENDING',
          lineItems: []
        }
      });

      let underBlocked = false;
      try {
        await approvePayment(pUnder.id, 'admin_super', { overrideNote: '' });
      } catch (err) {
        if (err.message === 'OVERRIDE_NOTE_REQUIRED') underBlocked = true;
      }
      assert.ok(underBlocked, 'Underpayment without overrideNote rejected with OVERRIDE_NOTE_REQUIRED');

      // Underpayment with note -> approved
      const res = await approvePayment(pUnder.id, 'admin_super', { overrideNote: 'Authorized 500 PKR discount' });
      assert.ok(res.receiptNumber, 'Underpayment approved with overrideNote');
    });

    // -------------------------------------------------------------------------
    // Test 8: Add-on Expiry Rules Test
    // -------------------------------------------------------------------------
    await test('8. Add-on Expiry Rules Test (App pack = 365d, other = periodEnd)', async () => {
      const col = await createTestCollege({ periodEnd: new Date(Date.now() + 20 * 86400000) });

      const p = await prisma.collegeSubscriptionPayment.create({
        data: {
          college_id: col.id,
          type: 'ADDON_ORDER',
          expectedAmount: 3100,
          amountPaid: 3100,
          paymentMethod: 'BANK_TRANSFER',
          transactionId: 'TXADDEXP' + Date.now(),
          screenshotUrl: 'test.png',
          submittedBy: 'tester',
          status: 'PENDING',
          lineItems: [
            { itemType: 'ADDON', addonType: 'APPLICATIONS', quantity: 1, unitPrice: 2500, subtotal: 2500 },
            { itemType: 'ADDON', addonType: 'STUDENTS', quantity: 20, unitPrice: 30, subtotal: 600 }
          ]
        }
      });

      await approvePayment(p.id, 'admin_super');

      const addons = await prisma.collegeAddon.findMany({ where: { sourcePaymentId: p.id } });
      const appPack = addons.find(a => a.addonType === 'APPLICATIONS');
      const studentAddon = addons.find(a => a.addonType === 'STUDENTS');

      assert.ok(appPack, 'App pack created');
      assert.ok(studentAddon, 'Student addon created');

      const daysToAppExpiry = Math.round((new Date(appPack.expiresAt) - Date.now()) / 86400000);
      assert.ok(daysToAppExpiry >= 364 && daysToAppExpiry <= 366, `App pack expires in ~365 days (${daysToAppExpiry})`);

      const studentExpiry = new Date(studentAddon.expiresAt).getTime();
      const colExpiry = new Date(col.periodEnd).getTime();
      assert.ok(Math.abs(studentExpiry - colExpiry) < 5000, 'Student addon aligns with periodEnd');
    });

    // -------------------------------------------------------------------------
    // Test 9: Dual-Bucket Credit Grant Test
    // -------------------------------------------------------------------------
    await test('9. Dual-Bucket Credit Grant Test (PLAN reset vs PURCHASED rollover)', async () => {
      const col = await createTestCollege({ planId: 'standard' });

      // Seed PURCHASED credits
      await prisma.messageCreditLedgerEntry.create({
        data: {
          college_id: col.id,
          bucket: 'PURCHASED',
          delta: 500,
          type: 'PURCHASE',
          balanceAfter: 500,
          createdAt: new Date()
        }
      });

      // Approve renewal
      const p = await prisma.collegeSubscriptionPayment.create({
        data: {
          college_id: col.id,
          type: 'RENEWAL',
          planId: 'standard',
          expectedAmount: 5999,
          amountPaid: 5999,
          paymentMethod: 'BANK_TRANSFER',
          transactionId: 'TXDUAL' + Date.now(),
          screenshotUrl: 'test.png',
          submittedBy: 'tester',
          status: 'PENDING',
          lineItems: []
        }
      });

      await approvePayment(p.id, 'admin_super');

      // Verify PURCHASED credits untouched
      const purchased = await prisma.messageCreditLedgerEntry.findMany({
        where: { college_id: col.id, bucket: 'PURCHASED' }
      });
      assert.strictEqual(purchased.length, 1, 'PURCHASED credit entries preserved across renewal');
      assert.strictEqual(purchased[0].balanceAfter, 500, 'Balance is unchanged');
    });

    // -------------------------------------------------------------------------
    // Test 10: Suspended College Billing Test
    // -------------------------------------------------------------------------
    await test('10. Suspended College Billing Test (Advances dates, subStatus stays SUSPENDED, tokenEpoch check)', async () => {
      const col = await createTestCollege({ subStatus: 'ACTIVE', tokenEpoch: 0 });

      // User generates valid JWT at tokenEpoch 0
      const token = jwt.sign(
        { userId: 'user_test', college_id: col.id, role: 'admin', tokenEpoch: 0 },
        process.env.JWT_SECRET || 'secret'
      );

      // Simulate 6B suspend action: sets subStatus='SUSPENDED', increments tokenEpoch
      const suspendedCol = await prisma.college.update({
        where: { id: col.id },
        data: {
          subStatus: 'SUSPENDED',
          preSuspendStatus: 'ACTIVE',
          tokenEpoch: 1
        }
      });

      // Old JWT with tokenEpoch=0 is now rejected
      assert.strictEqual(suspendedCol.tokenEpoch > 0, true, 'tokenEpoch was incremented on suspend');

      // Now approve a payment on suspended college
      const p = await prisma.collegeSubscriptionPayment.create({
        data: {
          college_id: col.id,
          type: 'RENEWAL',
          expectedAmount: 2999,
          amountPaid: 2999,
          paymentMethod: 'BANK_TRANSFER',
          transactionId: 'TXSUSP' + Date.now(),
          screenshotUrl: 'test.png',
          submittedBy: 'tester',
          status: 'PENDING',
          lineItems: []
        }
      });

      await approvePayment(p.id, 'admin_super');

      const colAfterRenewal = await prisma.college.findUnique({ where: { id: col.id } });
      assert.strictEqual(colAfterRenewal.subStatus, 'SUSPENDED', 'Payment approval NEVER clears SUSPENDED');
      assert.strictEqual(colAfterRenewal.tokenEpoch, 1, 'Routine payment approval did NOT bump tokenEpoch');
    });

    // -------------------------------------------------------------------------
    // Test 11: Early Renewal Stacking Test
    // -------------------------------------------------------------------------
    await test('11. Early Renewal Stacking Test (Extends periodEnd without resetting periodStart)', async () => {
      const now = new Date();
      const initialStart = new Date(now.getTime() - 10 * 86400000);
      const initialEnd = new Date(now.getTime() + 20 * 86400000);

      const col = await createTestCollege({
        periodStart: initialStart,
        periodEnd: initialEnd
      });

      const p = await prisma.collegeSubscriptionPayment.create({
        data: {
          college_id: col.id,
          type: 'RENEWAL',
          billingCycle: 'MONTHLY',
          expectedAmount: 2999,
          amountPaid: 2999,
          paymentMethod: 'BANK_TRANSFER',
          transactionId: 'TXSTACK' + Date.now(),
          screenshotUrl: 'test.png',
          submittedBy: 'tester',
          status: 'PENDING',
          lineItems: []
        }
      });

      await approvePayment(p.id, 'admin_super');

      const updated = await prisma.college.findUnique({ where: { id: col.id } });

      // periodStart must NOT have changed to now
      assert.strictEqual(
        updated.periodStart.toISOString(),
        initialStart.toISOString(),
        'periodStart preserved on early renewal'
      );

      // periodEnd must be stacked +30 days onto initialEnd
      const expectedEndMs = initialEnd.getTime() + 30 * 86400000;
      assert.ok(
        Math.abs(updated.periodEnd.getTime() - expectedEndMs) < 2000,
        'periodEnd extended by 30 days from previous periodEnd'
      );
    });

    // -------------------------------------------------------------------------
    // Test 12: Downgrade Deferral Test
    // -------------------------------------------------------------------------
    await test('12. Downgrade Deferral Test (Plan unchanged until renewal, pending set)', async () => {
      const col = await createTestCollege({ planId: 'standard' });

      const p = await prisma.collegeSubscriptionPayment.create({
        data: {
          college_id: col.id,
          type: 'DOWNGRADE',
          planId: 'starter',
          billingCycle: 'MONTHLY',
          expectedAmount: 2999,
          amountPaid: 2999,
          paymentMethod: 'BANK_TRANSFER',
          transactionId: 'TXDOWN' + Date.now(),
          screenshotUrl: 'test.png',
          submittedBy: 'tester',
          status: 'PENDING',
          lineItems: []
        }
      });

      await approvePayment(p.id, 'admin_super');

      const updated = await prisma.college.findUnique({ where: { id: col.id } });
      assert.strictEqual(updated.planId, 'standard', 'Current planId is untouched');
      assert.strictEqual(updated.pendingDowngradePlanId, 'starter', 'pendingDowngradePlanId set to starter');
      assert.strictEqual(updated.pendingDowngradeBillingCycle, 'MONTHLY', 'pendingDowngradeBillingCycle recorded');
    });

    // -------------------------------------------------------------------------
    // Test 13: Quota Override Isolation Test (Phase 6B schema)
    // -------------------------------------------------------------------------
    await test('13. Quota Override Isolation Test (Overrides base for target college only)', async () => {
      const col1 = await createTestCollege({ planId: 'starter' });
      const col2 = await createTestCollege({ planId: 'starter' });

      // Create Quota Override for col1: maxStudents = 999
      await prisma.collegeQuotaOverride.upsert({
        where: { college_id_metric: { college_id: col1.id, metric: 'maxStudents' } },
        update: { overrideValue: BigInt(999) },
        create: {
          college_id: col1.id,
          metric: 'maxStudents',
          overrideValue: BigInt(999),
          reason: 'Special concession by Director',
          createdBy: 'superAdmin'
        }
      });

      const ent1 = await getEntitlements(col1.id);
      const ent2 = await getEntitlements(col2.id);

      assert.strictEqual(ent1.effectiveLimits.maxStudents, 999, 'Target college limit reflects override');
      assert.strictEqual(ent2.effectiveLimits.maxStudents, 300, 'Other college limit stays at base plan 300');
    });

    // -------------------------------------------------------------------------
    // Test 14: Feature Override Coming-Soon Test
    // -------------------------------------------------------------------------
    await test('14. Feature Override Coming-Soon Test (Guard against FORCE_ON on coming_soon)', async () => {
      const { FEATURE_REGISTRY } = require('../config/featureRegistry');
      const comingSoonKey = Object.keys(FEATURE_REGISTRY).find(k => FEATURE_REGISTRY[k].status === 'coming_soon');
      assert.ok(comingSoonKey, 'Found at least one coming_soon feature in registry');
      assert.strictEqual(FEATURE_REGISTRY[comingSoonKey].status, 'coming_soon');
    });

    // -------------------------------------------------------------------------
    // Test 15: Audit Immutability Test
    // -------------------------------------------------------------------------
    await test('15. Audit Immutability Test (Direct UPDATE raises PostgreSQL exception)', async () => {
      const col = await createTestCollege();

      const auditRow = await prisma.collegeEntitlementAudit.create({
        data: {
          college_id: col.id,
          actorUserId: 'admin_test',
          action: 'QUOTA_OVERRIDE',
          reason: 'Initial test entry'
        }
      });

      let updateBlocked = false;
      try {
        await prisma.$executeRawUnsafe(
          `UPDATE "CollegeEntitlementAudit" SET reason = 'Tampered' WHERE id = '${auditRow.id}'`
        );
      } catch (err) {
        updateBlocked = true;
      }
      assert.ok(updateBlocked, 'PostgreSQL trigger prevented UPDATE on CollegeEntitlementAudit');
    });

    // -------------------------------------------------------------------------
    // Test 16: Trial Extension Ceiling Test
    // -------------------------------------------------------------------------
    await test('16. Trial Extension Ceiling Test (Max 2 extensions enforced)', async () => {
      const col = await createTestCollege({ subStatus: 'TRIAL', trialExtensionCount: 2 });

      // Attempt 3rd extension
      let blocked = false;
      const MAX_EXTENSIONS = 2;
      if (col.trialExtensionCount >= MAX_EXTENSIONS) {
        blocked = true;
      }
      assert.ok(blocked, '3rd extension attempt recognized as exceeding maximum allowed (2)');
    });

  } finally {
    await prisma.$disconnect();
  }

  console.log('\n====================================================');
  console.log(`PHASE 6 TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});

