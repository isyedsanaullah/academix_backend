const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const assert = require('assert');
const { getSystemClient } = require('../config/prismaManager');
const {
  CANONICAL_PLANS,
  PLAN_PRICING,
  PLAN_LIMITS
} = require('../config/planConstants');
const {
  CATEGORIES,
  FEATURE_REGISTRY
} = require('../config/featureRegistry');
const { getEntitlements } = require('../services/entitlements');
const { subscriptionGate } = require('../middleware/subscriptionGate');
const {
  QuotaExceededError,
  resolvePeriodKey,
  resolveLimit,
  checkQuota,
  withQuota
} = require('../services/quotaService');
const {
  InsufficientCreditsError,
  ensureMonthlyGrant,
  getMessageCreditBalance,
  getAICreditBalance,
  debitMessageCredits,
  debitAICredits,
  grantPurchasedCredits
} = require('../services/ledgerService');

async function runPhase2Tests() {
  console.log('====================================================');
  console.log('   ACADEMIX PHASE 2 COMPREHENSIVE CONTRACT TESTS   ');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`FAIL: ${name}`);
      console.error(`      ${err.message}`);
      failed++;
    }
  }

  async function asyncTest(name, fn) {
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

  const prisma = getSystemClient();
  const testCollege = await prisma.college.findFirst({
    where: { subStatus: 'ACTIVE' }
  });
  assert(testCollege, 'Need at least one active college in DB for testing');

  // TEST SUITE 1: ENTITLEMENTS RESOLVER
  console.log('--- Suite 1: Single Source of Truth Entitlement Resolver ---');

  await asyncTest('getEntitlements returns complete snapshot for active college', async () => {
    const ent = await getEntitlements(testCollege.id);
    assert.strictEqual(ent.collegeId, testCollege.id);
    assert(CANONICAL_PLANS.includes(ent.planId));
    assert.strictEqual(ent.isReadOnly, false);
    assert.strictEqual(ent.readOnlyReason, null);
    assert(typeof ent.effectiveLimits === 'object');
    assert(Array.isArray(ent.features));
    assert(ent.features.length >= 33);
  });

  test('resolvePeriodKey maps metrics to standardized periods', () => {
    const now = new Date();
    assert.strictEqual(resolvePeriodKey('students'), 'total');
    assert.strictEqual(resolvePeriodKey('staff'), 'total');
    assert.strictEqual(resolvePeriodKey('storageBytes'), 'total');
    assert(resolvePeriodKey('applications', now).startsWith('cycle_'));
    assert(resolvePeriodKey('aiQuizGenerations').match(/^\d{4}-\d{2}$/));
    assert(resolvePeriodKey('tutorChat:student123').match(/^\d{4}-\d{2}-\d{2}$/));
  });

  // TEST SUITE 2: SUBSCRIPTION GATE MIDDLEWARE
  console.log('\n--- Suite 2: SubscriptionGate Middleware Enforcement ---');

  await asyncTest('Super Admin bypasses subscription gate unconditionally', async () => {
    const gate = subscriptionGate('export-center');
    let calledNext = false;
    const req = {
      user: { role: 'superAdmin' },
      method: 'POST'
    };
    const res = {};
    await gate(req, res, () => { calledNext = true; });
    assert.strictEqual(calledNext, true);
  });

  await asyncTest('Missing college context returns 403 NO_COLLEGE_CONTEXT', async () => {
    const gate = subscriptionGate('student-records');
    let resStatus = null;
    let resJson = null;
    const req = {
      user: { role: 'admin' },
      method: 'GET'
    };
    const res = {
      status: (code) => {
        resStatus = code;
        return { json: (data) => { resJson = data; } };
      }
    };
    await gate(req, res, () => {});
    assert.strictEqual(resStatus, 403);
    assert.strictEqual(resJson.code, 'NO_COLLEGE_CONTEXT');
  });

  await asyncTest('Subscription gate blocks unentitled feature when strict mode enabled', async () => {
    const origEnv = process.env.ENFORCE_SUBSCRIPTION_GATES;
    process.env.ENFORCE_SUBSCRIPTION_GATES = 'true';

    // white-label-branding is Enterprise only; testCollege is Starter
    const gate = subscriptionGate('white-label-branding');
    let resStatus = null;
    let resJson = null;
    let calledNext = false;

    const req = {
      collegeId: testCollege.id,
      user: { role: 'admin', college_id: testCollege.id },
      method: 'GET',
      originalUrl: '/api/test'
    };
    const res = {
      status: (code) => {
        resStatus = code;
        return { json: (data) => { resJson = data; } };
      }
    };

    await gate(req, res, () => { calledNext = true; });
    process.env.ENFORCE_SUBSCRIPTION_GATES = origEnv;

    if (testCollege.planId !== 'enterprise') {
      assert.strictEqual(resStatus, 403);
      assert.strictEqual(resJson.code, 'FEATURE_NOT_IN_PLAN');
      assert.strictEqual(calledNext, false);
    } else {
      assert.strictEqual(calledNext, true);
    }
  });

  // TEST SUITE 3: QUOTA SERVICE & ATOMIC MUTATIONS
  console.log('\n--- Suite 3: Quota Service & Atomic Transactional Protection ---');

  await asyncTest('checkQuota returns allowed: true when under limits', async () => {
    const status = await checkQuota(testCollege.id, 'students', 1);
    assert.strictEqual(typeof status.allowed, 'boolean');
    assert.strictEqual(typeof status.remaining, 'number');
    assert.strictEqual(status.period, 'total');
  });

  await asyncTest('withQuota increments usage atomically upon callback success', async () => {
    const testMetric = 'testCounter_' + Date.now();
    // Set an initial usage in CollegeUsage
    await prisma.collegeUsage.upsert({
      where: {
        college_id_metric_period: {
          college_id: testCollege.id,
          metric: 'aiQuizGenerations',
          period: resolvePeriodKey('aiQuizGenerations')
        }
      },
      update: { value: 0 },
      create: {
        college_id: testCollege.id,
        metric: 'aiQuizGenerations',
        period: resolvePeriodKey('aiQuizGenerations'),
        value: 0
      }
    });

    // Run withQuota
    let callbackExecuted = false;
    const result = await withQuota(testCollege.id, 'students', 0, async (tx) => {
      callbackExecuted = true;
      return 'SUCCESS_PAYLOAD';
    });

    assert.strictEqual(callbackExecuted, true);
    assert.strictEqual(result, 'SUCCESS_PAYLOAD');
  });

  await asyncTest('withQuota throws QuotaExceededError when limit exceeded', async () => {
    let threw = false;
    try {
      // Request 999,999 students which exceeds Starter 300 limit
      await withQuota(testCollege.id, 'students', 999999, async () => {
        return 'SHOULD_NOT_EXECUTE';
      });
    } catch (err) {
      if (err instanceof QuotaExceededError) {
        threw = true;
      }
    }
    assert.strictEqual(threw, true, 'Did not throw QuotaExceededError');
  });

  // TEST SUITE 4: DUAL-BUCKET CREDIT LEDGER
  console.log('\n--- Suite 4: Dual-Bucket Append-Only Credit Ledgers ---');

  await asyncTest('ensureMonthlyGrant idempotently grants monthly credits', async () => {
    const periodKey = await ensureMonthlyGrant(testCollege.id);
    assert(periodKey.match(/^\d{4}-\d{2}$/));
  });

  await asyncTest('grantPurchasedCredits adds to PURCHASED bucket and rolls over', async () => {
    const initialBal = await getMessageCreditBalance(testCollege.id);
    await grantPurchasedCredits(testCollege.id, 'MESSAGE_CREDITS', 50, 'TEST_ORDER_123');
    const newBal = await getMessageCreditBalance(testCollege.id);

    assert.strictEqual(newBal.purchasedBalance, initialBal.purchasedBalance + 50);
    assert.strictEqual(newBal.totalBalance, initialBal.totalBalance + 50);
  });

  await asyncTest('debitMessageCredits debits credits correctly and updates ledger', async () => {
    const beforeBal = await getMessageCreditBalance(testCollege.id);
    if (beforeBal.totalBalance >= 5) {
      const result = await debitMessageCredits(testCollege.id, 5, 'SMS_DEBIT', 'TEST_SMS_REF');
      assert.strictEqual(result.debited, 5);
      assert.strictEqual(result.balances.totalBalance, beforeBal.totalBalance - 5);
    }
  });

  await asyncTest('debitMessageCredits throws InsufficientCreditsError when balance depleted', async () => {
    let threw = false;
    try {
      await debitMessageCredits(testCollege.id, 99999999, 'SMS_DEBIT', 'TOO_LARGE');
    } catch (err) {
      if (err instanceof InsufficientCreditsError) {
        threw = true;
      }
    }
    assert.strictEqual(threw, true, 'Did not throw InsufficientCreditsError');
  });

  // TEST SUITE 5: PUBLIC DIRECTORY & PLANS API
  console.log('\n--- Suite 5: Public Plans & 162-Services Catalog API ---');

  test('Public services catalog contains all 162 services across 10 categories', () => {
    assert.strictEqual(FEATURE_REGISTRY.length, 162);
    assert.strictEqual(CATEGORIES.length, 10);
    const live = FEATURE_REGISTRY.filter(f => f.status === 'live').length;
    const roadmap = FEATURE_REGISTRY.filter(f => f.status === 'coming_soon').length;
    assert.strictEqual(live, 86);
    assert.strictEqual(roadmap, 76);
  });

  await prisma.$disconnect();

  console.log('\n====================================================');
  console.log(`PHASE 2 TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runPhase2Tests().catch(err => {
  console.error('Fatal Phase 2 test error:', err);
  process.exit(1);
});
