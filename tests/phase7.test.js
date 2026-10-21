const assert = require('assert');
const { FEATURES } = require('../services/capabilityCatalog');
const { resolveCollege } = require('../services/collegeAdapter');
const { computeEligibility, overrideEligibility } = require('../controllers/eligibility.controller');
const { recordStockMovement } = require('../controllers/practical.controller');
const { featureGate } = require('../middleware/loadEntitlements');

async function runPhase7Tests() {
  console.log('--- Starting Phase 7 Test Suite: Send-up Eligibility & Practicals ---');

  // 1. Verify capability catalog statuses
  const phase7Keys = [
    'internal-tests',
    'send-up-exams',
    'eligibility-lists',
    'weak-student-lists',
    'result-comparison',
    'practicals',
    'lab-journals',
    'lab-stock',
    'board-practicals'
  ];

  for (const key of phase7Keys) {
    const f = FEATURES.find(feat => feat.key === key);
    assert(f, `Feature '${key}' must exist in catalog`);
    assert.strictEqual(f.status, 'live', `Feature '${key}' must be 'live'`);
    assert.strictEqual(f.effort, 'Done', `Feature '${key}' effort must be 'Done'`);
  }
  console.log('✓ 1. All 9 Send-up and Practical features verified live & Done in catalog');

  // 2. Test Attendance Gating & Reason Formatting:
  // Student with 60% attendance against 75% minimum must be ineligible with reason "attendance 60% < 75%"
  // Also verify Leave exclusion: 6 present, 4 absent, 2 leave => 6/10 = 60%
  const mockStudent = {
    id: 'student-test-1',
    name: 'Ahmad Khan',
    rollNumber: 'FSC-101',
    class: 'FSC Part 2',
    section: 'A',
    group: 'Pre-Engineering'
  };

  const mockAttendance = [
    { student_id: 'student-test-1', status: 'present' },
    { student_id: 'student-test-1', status: 'present' },
    { student_id: 'student-test-1', status: 'present' },
    { student_id: 'student-test-1', status: 'present' },
    { student_id: 'student-test-1', status: 'present' },
    { student_id: 'student-test-1', status: 'late' }, // Late counts as present: 6 attended
    { student_id: 'student-test-1', status: 'absent' },
    { student_id: 'student-test-1', status: 'absent' },
    { student_id: 'student-test-1', status: 'absent' },
    { student_id: 'student-test-1', status: 'absent' }, // 4 absent => 10 total held
    { student_id: 'student-test-1', status: 'leave' },
    { student_id: 'student-test-1', status: 'leave' } // 2 leave excluded from held days
  ];

  let storedRecord = null;
  const mockTenantDb = {
    session: {
      findFirst: async () => ({ id: 'session-2026' })
    },
    eligibilityRule: {
      findFirst: async () => ({ minAttendancePercent: 75, minOverallPercent: null, maxFailedSubjects: null })
    },
    student: {
      findMany: async () => [mockStudent]
    },
    attendance: {
      findMany: async () => mockAttendance
    },
    result: {
      findMany: async () => []
    },
    eligibilityRecord: {
      findUnique: async () => storedRecord,
      findFirst: async () => storedRecord,
      create: async ({ data }) => {
        storedRecord = { id: 'rec-1', ...data };
        return storedRecord;
      },
      update: async ({ where, data }) => {
        storedRecord = { ...storedRecord, ...data };
        return storedRecord;
      }
    },
    auditLog: {
      create: async ({ data }) => {
        mockAuditLogs.push(data);
        return { id: 'audit-1', ...data };
      }
    }
  };

  const mockAuditLogs = [];

  const reqCompute = {
    tenantClient: mockTenantDb,
    collegeId: 'test-college-1',
    body: { forKind: 'send_up', session_id: 'session-2026' }
  };

  let responseData = null;
  const resCompute = {
    json: (data) => { responseData = data; }
  };

  await computeEligibility(reqCompute, resCompute, (err) => { if (err) throw err; });

  assert(responseData.success, 'Eligibility computation must succeed');
  assert.strictEqual(responseData.totalStudents, 1);
  assert.strictEqual(responseData.defaulterCount, 1);
  assert.strictEqual(responseData.eligibleCount, 0);

  const rec = responseData.data[0];
  assert.strictEqual(rec.attendancePercent, 60.0);
  assert.strictEqual(rec.eligible, false, 'Student at 60% must be ineligible');
  assert(rec.reasons.includes('attendance 60% < 75%'), `Reason must be 'attendance 60% < 75%', received: ${JSON.stringify(rec.reasons)}`);
  console.log('✓ 2. Ineligibility verified: attendance 60% < 75% correctly detected (leave excluded)');

  // 3. Principal Override & Audit Logging
  const reqOverride = {
    tenantClient: mockTenantDb,
    collegeId: 'test-college-1',
    params: { id: 'rec-1' },
    body: { overrideReason: 'Approved by Principal on medical certificate' },
    user: { id: 'principal-1', name: 'Prof. Tariq' }
  };

  let overrideResult = null;
  const resOverride = {
    json: (data) => { overrideResult = data; }
  };

  await overrideEligibility(reqOverride, resOverride, (err) => { if (err) throw err; });

  assert(overrideResult.success, 'Override must succeed');
  assert.strictEqual(storedRecord.eligible, true, 'Record must now be eligible');
  assert.strictEqual(storedRecord.overridden, true, 'Record must be marked overridden');
  assert.strictEqual(storedRecord.overrideReason, 'Approved by Principal on medical certificate');
  assert.strictEqual(mockAuditLogs.length, 1, 'Audit log must be written');
  assert.strictEqual(mockAuditLogs[0].action, 'ELIGIBILITY_OVERRIDE');
  console.log('✓ 3. Principal override verified and recorded in AuditLog');

  // 4. Lab Stock Constraint: Movement below zero must be rejected
  let stockItem = {
    id: 'item-hcl-01',
    college_id: 'test-college-1',
    name: 'Hydrochloric Acid (HCl 0.1M)',
    category: 'chemical',
    quantity: 5.0,
    minQuantity: 2.0
  };

  const mockStockDb = {
    labStockItem: {
      findFirst: async () => stockItem,
      update: async ({ data }) => {
        stockItem = { ...stockItem, ...data };
        return stockItem;
      }
    },
    labStockMovement: {
      create: async ({ data }) => ({ id: 'mov-1', ...data })
    },
    $transaction: async (ops) => Promise.all(ops)
  };

  // 4a. Attempt change of -6.0 when quantity is 5.0
  let errStatus = null;
  let errBody = null;
  const resFail = {
    status: (code) => {
      errStatus = code;
      return {
        json: (data) => { errBody = data; }
      };
    }
  };

  await recordStockMovement(
    {
      tenantClient: mockStockDb,
      collegeId: 'test-college-1',
      params: { id: 'item-hcl-01' },
      body: { change: -6.0, reason: 'practical' },
      user: { id: 'lab-assistant-1' }
    },
    resFail,
    (err) => { if (err) throw err; }
  );

  assert.strictEqual(errStatus, 400, 'Movement causing negative quantity must return 400');
  assert.strictEqual(errBody.code, 'INSUFFICIENT_STOCK', 'Error code must be INSUFFICIENT_STOCK');
  assert.strictEqual(stockItem.quantity, 5.0, 'Stock quantity must remain unchanged after rejected movement');

  // 4b. Valid movement of -3.0
  let successBody = null;
  const resSuccess = {
    json: (data) => { successBody = data; }
  };

  await recordStockMovement(
    {
      tenantClient: mockStockDb,
      collegeId: 'test-college-1',
      params: { id: 'item-hcl-01' },
      body: { change: -3.0, reason: 'practical' },
      user: { id: 'lab-assistant-1' }
    },
    resSuccess,
    (err) => { if (err) throw err; }
  );

  assert(successBody.success, 'Valid stock deduction must succeed');
  assert.strictEqual(stockItem.quantity, 2.0, 'Stock quantity must be reduced to 2.0');
  console.log('✓ 4. Lab stock invariant verified: negative movement rejected (INSUFFICIENT_STOCK)');

  // 5. Group-based Entitlement Gating:
  // An I.Com-only college gets 403 FEATURE_UNAVAILABLE reason GROUP_NOT_OFFERED on practical routes
  const icomCollege = {
    id: 'college-icom-only',
    isActive: true,
    subscription: { plan: 'standard', status: 'active' },
    settings: {
      programs: [{ name: 'I.Com' }]
    }
  };

  const resolvedIcom = resolveCollege(icomCollege);
  assert.strictEqual(resolvedIcom.features['practicals'].on, false, 'Practicals must be off for I.Com-only college');
  assert.strictEqual(resolvedIcom.features['practicals'].reason, 'GROUP_NOT_OFFERED', 'Reason must be GROUP_NOT_OFFERED');

  // Test the actual Express featureGate middleware for 'practicals'
  let gateStatus = null;
  let gateBody = null;
  const reqGate = {
    collegeId: 'college-icom-only',
    entitlements: resolvedIcom
  };
  const resGate = {
    status: (code) => {
      gateStatus = code;
      return {
        json: (data) => { gateBody = data; }
      };
    }
  };

  const gateMiddleware = featureGate('practicals');
  gateMiddleware(reqGate, resGate, () => {
    assert.fail('Should not call next() when feature is blocked by GROUP_NOT_OFFERED');
  });

  assert.strictEqual(gateStatus, 403, 'Must return 403 HTTP status');
  assert.strictEqual(gateBody.code, 'FEATURE_UNAVAILABLE');
  assert.strictEqual(gateBody.reason, 'GROUP_NOT_OFFERED');
  console.log('✓ 5. I.Com-only college blocked with 403 GROUP_NOT_OFFERED on practical routes');

  console.log('\n========================================');
  console.log('ALL PHASE 7 AUTOMATED TESTS PASSED (100%)');
  console.log('========================================\n');
}

if (require.main === module) {
  runPhase7Tests().catch(err => {
    console.error('Phase 7 test failure:', err);
    process.exit(1);
  });
}

module.exports = { runPhase7Tests };
