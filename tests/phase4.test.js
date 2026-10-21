const assert = require('assert');
const { resolveCollege, fromCollege } = require('../services/collegeAdapter');
const { impact } = require('../services/entitlements.v2');
const { consume } = require('../services/quota');

console.log('--- Starting Phase 4 Test Suite ---');

// ==============================================================================
// 1. Preview Impact Test
// When 'entry-system' is disabled via overrides, impact() must report capabilities switching
// ==============================================================================
{
  const college = {
    id: 'test-college-1',
    isActive: true,
    subscription: { plan: 'standard', status: 'active', featureOverrides: {} },
    settings: { programs: [{ name: 'Computer Science' }] }
  };

  const baseArgs = fromCollege(college);
  const preview = impact(baseArgs, {
    overrides: { 'entry-system': false }
  });

  assert(preview.switched.length > 0, 'Preview impact should detect capability method switches');
  const attSwitch = preview.switched.find(s => s.capability === 'attendance.mark');
  assert(attSwitch, 'attendance.mark capability should switch method');
  assert.strictEqual(attSwitch.to, 'manual', 'attendance.mark should fallback to manual');
  console.log('✓ 1. Preview impact correctly detected fallback switch to manual attendance');
}

// ==============================================================================
// 2. Overrides With Expiry Test
// Past expiry must be ignored; future expiry must be respected
// ==============================================================================
{
  const past = new Date(Date.now() - 3600000).toISOString(); // 1 hour ago
  const future = new Date(Date.now() + 3600000).toISOString(); // 1 hour in future

  // Starter college does not have ai-chat in plan
  const collegePast = {
    id: 'test-college-2',
    isActive: true,
    subscription: {
      plan: 'basic',
      status: 'active',
      featureOverrides: {
        'ai-chat': { state: 'on', expiresAt: past, reason: 'Expired trial' }
      }
    }
  };

  const resolvedPast = resolveCollege(collegePast);
  assert.strictEqual(resolvedPast.features['ai-chat'].on, false, 'Expired override must NOT turn on feature');

  const collegeFuture = {
    id: 'test-college-2',
    isActive: true,
    subscription: {
      plan: 'basic',
      status: 'active',
      featureOverrides: {
        'ai-chat': { state: 'on', expiresAt: future, reason: 'Active trial' }
      }
    }
  };

  const resolvedFuture = resolveCollege(collegeFuture);
  assert.strictEqual(resolvedFuture.features['ai-chat'].on, true, 'Valid future override must turn on feature');
  console.log('✓ 2. Overrides with expiration date verified (past ignored, future accepted)');
}

// ==============================================================================
// 3. FeatureFlag Release Rules & KillSwitch Test
// ==============================================================================
{
  const standardCollege = {
    id: 'college-alpha',
    isActive: true,
    subscription: { plan: 'standard', status: 'active', featureOverrides: {} }
  };

  // 3a. Kill Switch: Turn off attendance-biometric for everyone
  const flagsWithKillSwitch = {
    'attendance-biometric': {
      featureKey: 'attendance-biometric',
      killSwitch: true,
      release: 'GA'
    }
  };

  const resolvedKill = resolveCollege(standardCollege, { flags: flagsWithKillSwitch });
  assert.strictEqual(resolvedKill.features['attendance-biometric'].on, false, 'KillSwitch must disable feature even in standard plan');

  // 3b. HIDDEN Feature Flag
  const flagsHidden = {
    'attendance-qr': {
      featureKey: 'attendance-qr',
      killSwitch: false,
      release: 'HIDDEN'
    }
  };

  const resolvedHidden = resolveCollege(standardCollege, { flags: flagsHidden });
  assert.strictEqual(resolvedHidden.features['attendance-qr'].on, false, 'HIDDEN feature must not be available');

  // 3c. BETA Feature Flag: college-alpha is not in betaColleges, college-beta is
  const flagsBeta = {
    'ai-pdf-chat': {
      featureKey: 'ai-pdf-chat',
      killSwitch: false,
      release: 'BETA',
      betaColleges: ['college-beta']
    }
  };

  const collegeBeta = {
    id: 'college-beta',
    isActive: true,
    subscription: { plan: 'enterprise', status: 'active', featureOverrides: {} }
  };

  const collegeAlphaEnterprise = {
    id: 'college-alpha',
    isActive: true,
    subscription: { plan: 'enterprise', status: 'active', featureOverrides: {} }
  };

  const resolvedBetaExcluded = resolveCollege(collegeAlphaEnterprise, { flags: flagsBeta });
  assert.strictEqual(resolvedBetaExcluded.features['ai-pdf-chat'].on, false, 'Non-beta college cannot access BETA feature');

  const resolvedBetaIncluded = resolveCollege(collegeBeta, { flags: flagsBeta });
  assert.strictEqual(resolvedBetaIncluded.features['ai-pdf-chat'].on, true, 'Beta college CAN access BETA feature');

  console.log('✓ 3. FeatureFlag controls verified (KillSwitch, HIDDEN, BETA scoping)');
}

// ==============================================================================
// 4. Quota Enforcement Logic Test (Unit Test with Mock DB)
// ==============================================================================
(async () => {
  // Mock DB tracking usage state in memory
  const usageStore = new Map();

  const mockDb = {
    collegeUsage: {
      findUnique: async ({ where }) => {
        const key = `${where.college_id_metric_period.college_id}_${where.college_id_metric_period.metric}_${where.college_id_metric_period.period}`;
        return usageStore.get(key) || null;
      }
    },
    $queryRaw: async (strings, ...values) => {
      // Extract parameters from template tag
      const collegeId = values[0];
      const metric = values[1];
      const period = values[2];
      const amount = Number(values[3]);
      const key = `${collegeId}_${metric}_${period}`;

      const existing = usageStore.get(key);
      const currentVal = existing ? Number(existing.value) : 0;
      const nextVal = currentVal + amount;

      // Check if limited (WHERE clause in real SQL query, limit is last parameter)
      if (values.length >= 7) {
        const limitVal = Number(values[values.length - 1]);
        if (nextVal > limitVal) {
          // Limit exceeded, WHERE clause prevents update, returns 0 rows
          return [];
        }
      }

      const updated = { id: 'u1', college_id: collegeId, metric, period, value: BigInt(nextVal) };
      usageStore.set(key, updated);
      return [{ value: BigInt(nextVal) }];
    }
  };

  const testCollegeId = 'test-c-quota';
  const limit = 300;

  // Consume 100 students (under limit)
  let q1 = await consume(mockDb, testCollegeId, 'students', 100, limit);
  assert.strictEqual(q1.allowed, true);
  assert.strictEqual(q1.value, 100);
  assert.strictEqual(q1.warning, false);

  // Consume 150 students -> total 250 (warning threshold >= 80% of 300 = 240)
  let q2 = await consume(mockDb, testCollegeId, 'students', 150, limit);
  assert.strictEqual(q2.allowed, true);
  assert.strictEqual(q2.value, 250);
  assert.strictEqual(q2.warning, true, 'At 250/300 (>80%), warning should be triggered');

  // Attempt to consume 51 students -> total 301 > 300 limit -> must block
  let q3 = await consume(mockDb, testCollegeId, 'students', 51, limit);
  assert.strictEqual(q3.allowed, false, '301st student must be blocked');
  assert.strictEqual(q3.value, 250, 'Value should remain at previous level');

  // Consume remaining 50 students -> total 300 == limit -> allowed
  let q4 = await consume(mockDb, testCollegeId, 'students', 50, limit);
  assert.strictEqual(q4.allowed, true);
  assert.strictEqual(q4.value, 300);

  // 1 more student -> 301 -> blocked
  let q5 = await consume(mockDb, testCollegeId, 'students', 1, limit);
  assert.strictEqual(q5.allowed, false);

  console.log('✓ 4. Quota atomic enforcement verified (threshold warning, hard blocking at limit)');

  console.log('\n--- ALL PHASE 4 TESTS PASSED SUCCESSFULLY ---');
})().catch(err => {
  console.error('Phase 4 Test Failure:', err);
  process.exit(1);
});
