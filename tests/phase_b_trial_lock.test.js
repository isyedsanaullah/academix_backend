'use strict';

const assert = require('assert');
const crypto = require('crypto');

process.env.NODE_ENV = 'test';

const {
  calculateDaysRemaining,
  canTransitionSubStatus,
  assertValidSubStatusTransition,
  computeSubscriptionSnapshot,
  transitionCollegeSubStatus
} = require('../services/subscriptionStateService');
const { TRIAL_DAYS, TRIAL_ENTITLEMENT_PLAN } = require('../config/trialConfig');

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
}

async function run() {
  console.log('🧪 Running Phase (b) Trial, State Machine & Access Lock Tests...\n');

  // 1. Server-calculated daysRemaining (no decrementing DB counter)
  const baseNow = new Date('2026-11-01T10:00:00.000Z');
  const trialStart = new Date('2026-11-01T00:00:00.000Z');
  const trialEnd = new Date(trialStart.getTime() + TRIAL_DAYS * 86400000);

  assert.strictEqual(calculateDaysRemaining(trialEnd, baseNow), 14);
  assert.strictEqual(calculateDaysRemaining(trialEnd, new Date('2026-11-08T00:00:01.000Z')), 7);
  assert.strictEqual(calculateDaysRemaining(trialEnd, new Date('2026-11-14T12:00:00.000Z')), 1);
  assert.strictEqual(calculateDaysRemaining(trialEnd, trialEnd), 0);
  assert.strictEqual(calculateDaysRemaining(trialEnd, new Date(trialEnd.getTime() + 60000)), 0);
  assert.strictEqual(TRIAL_ENTITLEMENT_PLAN, 'standard');
  console.log('  ✔ Server-side daysRemaining calculation decreases accurately and hits 0 on expiry');

  // 2. State machine transition rules
  assert.strictEqual(canTransitionSubStatus('TRIAL', 'PENDING_PAYMENT'), true);
  assert.strictEqual(canTransitionSubStatus('PENDING_PAYMENT', 'ACTIVE'), true);
  assert.strictEqual(canTransitionSubStatus('TRIAL', 'EXPIRED'), true);
  assert.strictEqual(canTransitionSubStatus('EXPIRED', 'PENDING_PAYMENT'), true);
  assert.strictEqual(canTransitionSubStatus('EXPIRED', 'ACTIVE'), true);
  assert.strictEqual(canTransitionSubStatus('ACTIVE', 'DEACTIVATED'), true);
  assert.strictEqual(canTransitionSubStatus('DEACTIVATED', 'ACTIVE'), true);

  assert.strictEqual(canTransitionSubStatus('EXPIRED', 'TRIAL'), false, 'EXPIRED cannot revert to TRIAL');
  assert.strictEqual(canTransitionSubStatus('DEACTIVATED', 'PENDING_PAYMENT'), false, 'DEACTIVATED cannot move directly to PENDING_PAYMENT');
  assert.throws(
    () => assertValidSubStatusTransition('EXPIRED', 'TRIAL'),
    (err) => err.code === 'INVALID_SUBSCRIPTION_TRANSITION' && err.status === 400
  );
  console.log('  ✔ Subscription state machine enforces allowed transitions and rejects illegal transitions');

  // 3. Real-time snapshot + transitionCollegeSubStatus
  const expiredTrialSnap = computeSubscriptionSnapshot({
    subStatus: 'TRIAL',
    trialStartedAt: trialStart,
    trialEndsAt: new Date(Date.now() - 1000),
    isActive: true
  });
  assert.strictEqual(expiredTrialSnap.isLocked, true);
  assert.strictEqual(expiredTrialSnap.effectiveSubStatus, 'EXPIRED');
  assert.strictEqual(expiredTrialSnap.lockReason, 'TRIAL_EXPIRED');

  const activeTrialSnap = computeSubscriptionSnapshot({
    subStatus: 'TRIAL',
    trialStartedAt: new Date(),
    trialEndsAt: new Date(Date.now() + 7 * 86400000),
    isActive: true
  });
  assert.strictEqual(activeTrialSnap.isLocked, false);
  assert.strictEqual(activeTrialSnap.daysRemaining, 7);

  // Test transitionCollegeSubStatus with mock DB
  let dbCollege = {
    id: 'col-sm-1',
    subStatus: 'TRIAL',
    forceReadOnly: false,
    readOnlyReason: null,
    isActive: true,
    planId: 'standard',
    trialEndsAt: new Date(Date.now() + 5 * 86400000),
    periodEnd: null,
    tokenEpoch: 0
  };
  const auditRows = [];
  const smMockDb = {
    college: {
      findUnique: async () => dbCollege,
      update: async ({ data }) => {
        dbCollege = { ...dbCollege, ...data, tokenEpoch: data.tokenEpoch?.increment ? dbCollege.tokenEpoch + 1 : dbCollege.tokenEpoch };
        return dbCollege;
      }
    },
    collegeEntitlementAudit: {
      create: async ({ data }) => { auditRows.push(data); return data; }
    }
  };
  await transitionCollegeSubStatus(smMockDb, { collegeId: 'col-sm-1', toStatus: 'PENDING_PAYMENT', actorUserId: 'adm-1' });
  assert.strictEqual(dbCollege.subStatus, 'PENDING_PAYMENT');
  assert.strictEqual(dbCollege.forceReadOnly, false, 'PENDING_PAYMENT during active trial stays unlocked');
  await transitionCollegeSubStatus(smMockDb, { collegeId: 'col-sm-1', toStatus: 'DEACTIVATED', actorUserId: 'sa-1', reason: 'Manual disable' });
  assert.strictEqual(dbCollege.subStatus, 'DEACTIVATED');
  assert.strictEqual(dbCollege.forceReadOnly, true);
  assert.strictEqual(dbCollege.tokenEpoch, 1);
  assert.strictEqual(auditRows.length, 2);
  console.log('  ✔ transitionCollegeSubStatus updates lock flags, tokenEpoch, and writes immutable audit entries');

  // 4. Access Lock Middleware tests (Super Admin vs Locked Admin vs Locked Non-Admin)
  const mockCollegeStore = new Map();
  mockCollegeStore.set('col-locked', {
    id: 'col-locked',
    isActive: true,
    subStatus: 'EXPIRED',
    trialStartedAt: new Date(Date.now() - 15 * 86400000),
    trialEndsAt: new Date(Date.now() - 86400000),
    periodStart: null,
    periodEnd: null,
    forceReadOnly: true,
    readOnlyReason: 'TRIAL_EXPIRED'
  });
  mockCollegeStore.set('col-trial', {
    id: 'col-trial',
    isActive: true,
    subStatus: 'TRIAL',
    trialStartedAt: new Date(),
    trialEndsAt: new Date(Date.now() + 10 * 86400000),
    periodStart: null,
    periodEnd: null,
    forceReadOnly: false,
    readOnlyReason: null
  });

  const prismaManager = require('../config/prismaManager');
  const origGetSystemClient = prismaManager.getSystemClient;
  prismaManager.getSystemClient = () => ({
    college: {
      findUnique: async ({ where }) => mockCollegeStore.get(where.id) || null
    }
  });

  try {
    const { evaluateSubscriptionAccess, INACTIVE_COLLEGE_MESSAGE } = require('../middleware/subscriptionAccessLock');

    // 4a. Super Admin never blocked
    let nextCalled = false;
    await evaluateSubscriptionAccess(
      { user: { id: 'sa-1', role: 'superAdmin', college_id: 'col-locked' }, originalUrl: '/api/students' },
      makeRes(),
      () => { nextCalled = true; }
    );
    assert.strictEqual(nextCalled, true, 'Super Admin must never be blocked');

    // 4b. Locked student/teacher/employee/registrar blocked everywhere with exact message
    for (const role of ['student', 'teacher', 'employee', 'registrar', 'accountant', 'principal']) {
      for (const path of ['/api/students', '/api/attendance', '/api/auth/me', '/api/subscription/current']) {
        const res = makeRes();
        let passed = false;
        await evaluateSubscriptionAccess(
          { user: { id: `u-${role}`, role, college_id: 'col-locked' }, originalUrl: path },
          res,
          () => { passed = true; }
        );
        assert.strictEqual(passed, false, `${role} must be blocked on ${path}`);
        assert.strictEqual(res.statusCode, 403);
        assert.strictEqual(res.body.code, 'SUBSCRIPTION_INACTIVE');
        assert.strictEqual(res.body.message, INACTIVE_COLLEGE_MESSAGE);
      }
    }

    // 4c. Locked college admin: blocked on operational routes, allowed on billing/renewal/me routes
    for (const blockedPath of ['/api/students', '/api/fees', '/api/exams', '/api/admin/onboarding/launch']) {
      const res = makeRes();
      let passed = false;
      await evaluateSubscriptionAccess(
        { user: { id: 'adm-1', role: 'admin', college_id: 'col-locked' }, originalUrl: blockedPath },
        res,
        () => { passed = true; }
      );
      assert.strictEqual(passed, false, `Locked admin must be blocked on ${blockedPath}`);
      assert.strictEqual(res.statusCode, 403);
      assert.strictEqual(res.body.code, 'SUBSCRIPTION_LOCKED_RENEWAL_REQUIRED');
    }

    for (const allowedPath of ['/api/subscription/current', '/api/subscription/checkout', '/api/subscription/invoices/1/voucher.pdf', '/api/auth/me', '/api/me/capabilities', '/api/college/info']) {
      const res = makeRes();
      let passed = false;
      await evaluateSubscriptionAccess(
        { user: { id: 'adm-1', role: 'admin', college_id: 'col-locked' }, originalUrl: allowedPath },
        res,
        () => { passed = true; }
      );
      assert.strictEqual(passed, true, `Locked admin must be allowed on ${allowedPath}`);
    }

    // 4d. Active trial: non-admin allowed
    {
      const res = makeRes();
      let passed = false;
      await evaluateSubscriptionAccess(
        { user: { id: 'stu-1', role: 'student', college_id: 'col-trial' }, originalUrl: '/api/students' },
        res,
        () => { passed = true; }
      );
      assert.strictEqual(passed, true, 'Active trial student must be allowed');
    }
    console.log('  ✔ subscriptionAccessLock enforces Super Admin bypass, non-admin hard lock, and admin-only renewal whitelist');

    // 5. Daily Lifecycle Worker: 7, 3, 1 day reminders + expiry flip
    const now = new Date();
    const reminderLogs = [];
    const outbox = [];
    const lifecycleColleges = [
      { id: 'c-7d', subStatus: 'TRIAL', trialEndsAt: new Date(now.getTime() + 6.5 * 86400000), forceReadOnly: false },
      { id: 'c-3d', subStatus: 'TRIAL', trialEndsAt: new Date(now.getTime() + 2.5 * 86400000), forceReadOnly: false },
      { id: 'c-1d', subStatus: 'TRIAL', trialEndsAt: new Date(now.getTime() + 0.5 * 86400000), forceReadOnly: false },
      { id: 'c-exp', subStatus: 'TRIAL', trialEndsAt: new Date(now.getTime() - 60000), forceReadOnly: false }
    ];
    const updatedColleges = new Map();
    const mockTx = {
      $queryRaw: async () => [{ locked: true }],
      college: {
        findMany: async () => lifecycleColleges,
        update: async ({ where, data }) => {
          updatedColleges.set(where.id, data);
          return data;
        }
      },
      subscriptionReminderLog: {
        findMany: async () => reminderLogs,
        createMany: async ({ data }) => { reminderLogs.push(...data); }
      },
      planVersion: { findMany: async () => [] },
      outboxEvent: {
        createMany: async ({ data }) => { outbox.push(...data); }
      },
      collegeEntitlementAudit: { create: async () => ({}) }
    };
    prismaManager.getSystemClient = () => ({ $transaction: async (fn) => fn(mockTx) });
    const workerPath = require.resolve('../workers/subscriptionLifecycleWorker');
    delete require.cache[workerPath];
    const { runLifecycleWorker } = require('../workers/subscriptionLifecycleWorker');

    const firstRun = await runLifecycleWorker();
    assert.strictEqual(firstRun.processedCount, 4);
    assert.ok(reminderLogs.some(l => l.college_id === 'c-7d' && l.eventType === 'TRIAL_7D'));
    assert.ok(reminderLogs.some(l => l.college_id === 'c-3d' && l.eventType === 'TRIAL_3D'));
    assert.ok(reminderLogs.some(l => l.college_id === 'c-1d' && l.eventType === 'TRIAL_1D'));
    assert.ok(reminderLogs.some(l => l.college_id === 'c-exp' && l.eventType === 'TRIAL_EXPIRED'));
    assert.strictEqual(updatedColleges.get('c-exp')?.subStatus, 'EXPIRED');
    assert.strictEqual(updatedColleges.get('c-exp')?.forceReadOnly, true);
    assert.ok(outbox.some(e => e.eventType === 'TRIAL_REMINDER_EMAIL' && e.college_id === 'c-7d'));
    assert.ok(outbox.some(e => e.eventType === 'TRIAL_EXPIRED_EMAIL' && e.college_id === 'c-exp'));

    // Second run same day must be idempotent (no duplicate reminders)
    const countBefore = reminderLogs.length;
    await runLifecycleWorker();
    assert.strictEqual(reminderLogs.length, countBefore, 'Lifecycle worker must not duplicate reminders on same day');
    console.log('  ✔ subscriptionLifecycleWorker triggers 7d/3d/1d reminders, flips expired trials to EXPIRED, and is idempotent');
  } finally {
    prismaManager.getSystemClient = origGetSystemClient;
  }
}

run().catch((err) => {
  console.error('❌ Phase (b) tests failed:', err);
  process.exit(1);
});

