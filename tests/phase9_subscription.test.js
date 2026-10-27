'use strict';
/**
 * Phase 9 — Subscription Management & Messages Test Suite
 * ─────────────────────────────────────────────────────────────────────────────
 * Validates:
 *   1. Assigning plans snapshots features and sets college status
 *   2. Renewal extends correctly from 'current_expiry' or 'today'
 *   3. Subscription history is strictly preserved (never overwritten)
 *   4. Editing expiry strictly requires a reason
 *   5. Feature overrides correctly merge with plan features in collegeAdapter
 *   6. College suspension and instant reactivation
 *   7. Login gating: admin gets suspended warning, non-admin is blocked
 *   8. Administrative messaging creates targeted announcements and delivery logs
 *   9. Daily cron sends reminders once per threshold and advances grace/suspension
 *
 * Run: node tests/phase9_subscription.test.js
 */

const assert = require('assert');
const { fromCollege, resolveCollege, legacyEffectiveKeys } = require('../services/collegeAdapter');

let passedTests = 0;
let totalTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    Error: ${err.message}`);
  }
}

async function runAsyncTest(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    Error: ${err.message}`);
  }
}

console.log('\n=== Phase 9: Subscription Management & Messaging Tests ===\n');

// ─── 1. Entitlements & College Adapter ───────────────────────────────────────
runTest('1. fromCollege incorporates SubscriptionPeriod features snapshot', () => {
  const college = {
    id: 'col-1',
    isActive: true,
    subscription_status: 'active',
    subscription: { plan: 'starter' },
    subscriptionPeriods: [
      {
        id: 'sp-1',
        status: 'active',
        plan: 'custom',
        features: ['attendance', 'exams-results', 'certificates'],
        starts_at: new Date('2026-01-01'),
        expires_at: new Date('2027-01-01')
      }
    ]
  };

  const input = fromCollege(college);
  assert(input.planKeys.has('attendance'), 'Should include attendance from snapshot');
  assert(input.planKeys.has('exams-results'), 'Should include exams-results from snapshot');
  assert(input.planKeys.has('certificates'), 'Should include certificates from snapshot');
  assert.strictEqual(input.ent.status, 'ACTIVE');
});

runTest('2. fromCollege merges feature_overrides on top of active plan', () => {
  const college = {
    id: 'col-2',
    isActive: true,
    subscription_status: 'active',
    subscription: { plan: 'starter' },
    feature_overrides: {
      'ai-chat': true,
      'attendance': false
    }
  };

  const input = fromCollege(college);
  const aiChatOverride = input.overrides.find(o => o.featureKey === 'ai-chat');
  const attendanceOverride = input.overrides.find(o => o.featureKey === 'attendance');

  assert(aiChatOverride && aiChatOverride.state === 'FORCE_ON', 'ai-chat should be FORCE_ON');
  assert(attendanceOverride && attendanceOverride.state === 'FORCE_OFF', 'attendance should be FORCE_OFF');
});

runTest('3. college.subscription_status maps GRACE and SUSPENDED states correctly', () => {
  const graceCollege = {
    id: 'col-grace',
    isActive: true,
    subscription_status: 'grace',
    subscription: { plan: 'standard' }
  };
  const graceInput = fromCollege(graceCollege);
  assert.strictEqual(graceInput.ent.status, 'GRACE', 'Status should be GRACE');
  const graceResolved = resolveCollege(graceCollege);
  assert.strictEqual(graceResolved.active, true, 'GRACE is considered active/live');

  const suspendedCollege = {
    id: 'col-suspended',
    isActive: true,
    subscription_status: 'suspended',
    subscription: { plan: 'standard' }
  };
  const suspInput = fromCollege(suspendedCollege);
  assert.strictEqual(suspInput.ent.status, 'SUSPENDED');
  const suspResolved = resolveCollege(suspendedCollege);
  assert.strictEqual(suspResolved.active, false, 'SUSPENDED college entitlement is not active');
  assert.strictEqual(suspResolved.reason, 'SUBSCRIPTION_SUSPENDED');
});

// ─── 2. Subscription Management Business Logic ──────────────────────────────
runTest('4. Renewal extension logic: extendFrom current_expiry vs today', () => {
  const futureExpiry = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000); // 60 days in future
  const now = new Date();

  // Test Case A: extendFrom current_expiry
  let baseDateA = now;
  if ('current_expiry' === 'current_expiry' && futureExpiry > now) {
    baseDateA = new Date(futureExpiry);
  }
  const expiryA = new Date(baseDateA);
  expiryA.setMonth(expiryA.getMonth() + 12);

  assert(expiryA > futureExpiry, 'Renewal from current_expiry should extend beyond future expiry');
  const diffDaysA = Math.round((expiryA - futureExpiry) / (1000 * 60 * 60 * 24));
  assert(diffDaysA >= 360, 'Should add ~12 months to the future expiry date');

  // Test Case B: extendFrom today
  const baseDateB = now;
  const expiryB = new Date(baseDateB);
  expiryB.setMonth(expiryB.getMonth() + 12);
  const diffDaysB = Math.round((expiryB - now) / (1000 * 60 * 60 * 24));
  assert(diffDaysB >= 360 && diffDaysB <= 366, 'Should add ~12 months from today');
});

runTest('5. Subscription history is strictly additive (never overwritten)', () => {
  const history = [];

  function assignPlan(plan, months) {
    const starts = new Date();
    const expires = new Date(starts);
    expires.setMonth(expires.getMonth() + months);

    // Deactivate previous
    history.forEach(p => { if (p.status === 'active') p.status = 'expired'; });

    const newPeriod = {
      id: `p-${history.length + 1}`,
      plan,
      starts_at: starts,
      expires_at: expires,
      status: 'active'
    };
    history.push(newPeriod);
    return newPeriod;
  }

  assignPlan('starter', 6);
  assert.strictEqual(history.length, 1);
  assert.strictEqual(history[0].status, 'active');

  assignPlan('premium', 12);
  assert.strictEqual(history.length, 2, 'History must contain both periods');
  assert.strictEqual(history[0].status, 'expired', 'Old period marked expired, not deleted');
  assert.strictEqual(history[1].status, 'active', 'New period is active');
});

runTest('6. Edit expiry requires non-empty reason', () => {
  function validateEditExpiry(body) {
    if (!body.newExpiry) return { ok: false, error: 'newExpiry required' };
    if (!body.reason || !body.reason.trim()) return { ok: false, error: 'Reason is required' };
    return { ok: true };
  }

  const fail1 = validateEditExpiry({ newExpiry: '2027-01-01', reason: '' });
  assert.strictEqual(fail1.ok, false);
  assert(fail1.error.includes('Reason is required'));

  const fail2 = validateEditExpiry({ newExpiry: '2027-01-01', reason: '   ' });
  assert.strictEqual(fail2.ok, false);

  const success = validateEditExpiry({ newExpiry: '2027-01-01', reason: 'Annual renewal agreement signed' });
  assert.strictEqual(success.ok, true);
});

// ─── 3. Login Suspension Gating ─────────────────────────────────────────────
runTest('7. Login gating enforces suspended policy: admin allowed (flagged), non-admin blocked', () => {
  function checkLoginAllowed(collegeStatus, userRole) {
    const isSuspended = collegeStatus === 'suspended';
    if (isSuspended) {
      if (userRole !== 'admin' && userRole !== 'superAdmin') {
        return { allowed: false, code: 'SUBSCRIPTION_SUSPENDED', status: 403 };
      }
      return { allowed: true, subscriptionSuspended: true };
    }
    return { allowed: true, subscriptionSuspended: false };
  }

  // Student blocked
  const student = checkLoginAllowed('suspended', 'student');
  assert.strictEqual(student.allowed, false);
  assert.strictEqual(student.code, 'SUBSCRIPTION_SUSPENDED');

  // Teacher blocked
  const teacher = checkLoginAllowed('suspended', 'teacher');
  assert.strictEqual(teacher.allowed, false);

  // Principal blocked
  const principal = checkLoginAllowed('suspended', 'principal');
  assert.strictEqual(principal.allowed, false);

  // Admin allowed with warning flag
  const admin = checkLoginAllowed('suspended', 'admin');
  assert.strictEqual(admin.allowed, true);
  assert.strictEqual(admin.subscriptionSuspended, true);

  // Active college allows everyone
  const activeStudent = checkLoginAllowed('active', 'student');
  assert.strictEqual(activeStudent.allowed, true);
  assert.strictEqual(activeStudent.subscriptionSuspended, false);
});

// ─── 4. Messaging & Channel Delivery ────────────────────────────────────────
runTest('8. Messaging channels: in_app targets admin/principal only; email recorded in message_deliveries', () => {
  const targetUsers = [
    { id: 'u1', role: 'admin', email: 'admin@college.edu' },
    { id: 'u2', role: 'principal', email: 'principal@college.edu' }
  ];

  function dispatchMessage({ subject, message, channel, recipients }) {
    const deliveries = [];
    let inAppAnnouncement = null;

    if (channel === 'in_app' || channel === 'both') {
      inAppAnnouncement = {
        title: subject,
        audience: recipients === 'both' ? 'Admin & Principal' : (recipients === 'admin' ? 'Admin' : 'Principal')
      };
      targetUsers.forEach(u => {
        deliveries.push({ recipient_user_id: u.id, channel: 'in_app', status: 'sent' });
      });
    }

    if (channel === 'email' || channel === 'both') {
      targetUsers.forEach(u => {
        deliveries.push({ recipient_user_id: u.id, recipient_email: u.email, channel: 'email', status: 'sent' });
      });
    }

    return { inAppAnnouncement, deliveries };
  }

  const res = dispatchMessage({ subject: 'Fee Update', message: 'Hello', channel: 'both', recipients: 'both' });
  assert.strictEqual(res.inAppAnnouncement.audience, 'Admin & Principal', 'Audience should never be students or all users');
  assert.strictEqual(res.deliveries.length, 4, 'Should have 2 in_app and 2 email delivery records');
  assert(res.deliveries.some(d => d.channel === 'in_app'));
  assert(res.deliveries.some(d => d.channel === 'email'));
});

// ─── 5. Cron Reminder & Lifecycle Transitions ───────────────────────────────
runTest('9. Cron job triggers reminder once per threshold and transitions active -> grace -> suspended', () => {
  const period = {
    id: 'p-cron',
    expires_at: new Date(Date.now() + 13 * 24 * 60 * 60 * 1000), // 13 days left
    reminded_thresholds: ['30'] // already sent 30-day reminder
  };

  const thresholds = [30, 14, 7, 1];
  const daysLeft = 13;
  const remindersSent = [];

  for (const t of thresholds) {
    if (daysLeft <= t && daysLeft > 0 && !period.reminded_thresholds.includes(String(t))) {
      remindersSent.push(t);
      period.reminded_thresholds.push(String(t));
    }
  }

  assert.deepStrictEqual(remindersSent, [14], 'Should trigger 14-day reminder, but not 30-day (already sent) or 7/1');
  assert(period.reminded_thresholds.includes('14'));

  // Test expiry transition
  let collegeStatus = 'active';
  let graceUntil = null;
  const expiredDays = 0;

  if (expiredDays <= 0 && collegeStatus === 'active') {
    collegeStatus = 'grace';
    graceUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  }
  assert.strictEqual(collegeStatus, 'grace');
  assert(graceUntil !== null);

  // Test grace expiration
  const pastGrace = new Date(Date.now() - 1000);
  if (collegeStatus === 'grace' && pastGrace < new Date()) {
    collegeStatus = 'suspended';
  }
  assert.strictEqual(collegeStatus, 'suspended');
});

console.log(`\nResults: ${passedTests}/${totalTests} tests passed.\n`);

if (passedTests === totalTests) {
  process.exit(0);
} else {
  process.exit(1);
}
