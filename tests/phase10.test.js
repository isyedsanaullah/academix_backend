require('dotenv').config();
const assert = require('assert');
const { FEATURES } = require('../services/capabilityCatalog');
const { resolveCollege } = require('../services/collegeAdapter');
const { featureGate } = require('../middleware/loadEntitlements');
const { getMockRankings, recordOmrScan, calculateAggregate } = require('../controllers/entryTest.controller');
const { submitFeedback, getFeedbackList } = require('../controllers/guidance.controller');

async function runPhase10Tests() {
  console.log('--- Starting Phase 10 Test Suite: Entry-Test Preparation, Parents & Guidance ---');

  // 1. Verify capability catalog statuses and addon flags
  const phase10Keys = [
    'mcq-bank',
    'mock-tests',
    'aggregate-calc',
    'entry-reg-tracking',
    'ptm',
    'career-counselling',
    'scholarship-tracking',
    'feedback-box'
  ];

  for (const key of phase10Keys) {
    const f = FEATURES.find(feat => feat.key === key);
    assert(f, `Feature '${key}' must exist in catalog`);
    assert.strictEqual(f.status, 'live', `Feature '${key}' must be 'live'`);
    assert.strictEqual(f.effort, 'Done', `Feature '${key}' effort must be 'Done'`);
  }

  // Ensure add-on flag is retained for entry-test items
  const addonKeys = ['mcq-bank', 'mock-tests', 'aggregate-calc', 'entry-reg-tracking'];
  for (const key of addonKeys) {
    const f = FEATURES.find(feat => feat.key === key);
    assert.strictEqual(f.addon, true, `Entry-test feature '${key}' must retain addon: true`);
  }
  console.log('✓ 1. All 8 Phase 10 features verified live & Done in catalog; add-on flags preserved');

  // 2. Test Academic Group Gating (I.Com-only college blocked with GROUP_NOT_OFFERED)
  const icomCollege = {
    id: 'c-icom-only',
    isActive: true,
    subscription: {
      plan: 'premium',
      status: 'active',
      addons: ['mcq-bank'] // Add-on is enabled, but college offers only Commerce
    },
    settings: {
      groupsOffered: ['commerce'] // Only Commerce / I.Com offered
    }
  };

  const resolvedIcom = resolveCollege(icomCollege);
  assert.strictEqual(
    resolvedIcom.features['mcq-bank'].reason,
    'GROUP_NOT_OFFERED',
    'mcq-bank must be blocked with GROUP_NOT_OFFERED when only commerce is offered'
  );

  // Test the actual Express featureGate middleware returning 403 GROUP_NOT_OFFERED
  const mockReqIcom = {
    collegeId: 'c-icom-only',
    college: icomCollege,
    entitlements: resolvedIcom
  };
  let gateStatusCode = null;
  let gateBody = null;
  const mockRes = {
    status: (code) => {
      gateStatusCode = code;
      return {
        json: (data) => { gateBody = data; }
      };
    }
  };

  const gateMw = featureGate('mcq-bank');
  gateMw(mockReqIcom, mockRes, () => {
    assert.fail('Should not call next() when feature is blocked by GROUP_NOT_OFFERED');
  });

  assert.strictEqual(gateStatusCode, 403, 'Must return HTTP 403 on GROUP_NOT_OFFERED');
  assert.strictEqual(gateBody.reason, 'GROUP_NOT_OFFERED', 'Response reason must be GROUP_NOT_OFFERED');

  // Verify that a Pre-Medical offering college has the feature enabled on Premium with add-on
  const medCollege = {
    id: 'c-pre-med',
    isActive: true,
    subscription: {
      plan: 'premium',
      status: 'active',
      addons: ['mcq-bank']
    },
    settings: {
      groupsOffered: ['pre-medical']
    }
  };
  const resolvedMed = resolveCollege(medCollege);
  assert.strictEqual(resolvedMed.features['mcq-bank'].on, true, 'mcq-bank must be enabled for Pre-Medical on Premium');
  console.log('✓ 2. Group gating verified: I.Com-only college blocked with 403 GROUP_NOT_OFFERED; Pre-Medical allowed');

  // 3. Test Mock Test Ranking handles ties correctly
  // Setup 4 mock attempts:
  // - A: 190 (Section S1)
  // - B: 180 (Section S1)
  // - C: 180 (Section S2) -> Tied with B!
  // - D: 160 (Section S1) -> Follows tied pair
  const mockAttempts = [
    { id: 'att-1', college_id: 'c-1', mock_id: 'mock-101', student_id: 's-1', score: 190 },
    { id: 'att-2', college_id: 'c-1', mock_id: 'mock-101', student_id: 's-2', score: 180 },
    { id: 'att-3', college_id: 'c-1', mock_id: 'mock-101', student_id: 's-3', score: 180 },
    { id: 'att-4', college_id: 'c-1', mock_id: 'mock-101', student_id: 's-4', score: 160 }
  ];

  const mockStudents = [
    { id: 's-1', name: 'Ayesha Khan', rollNumber: 'MED-01', section_id: 'sec-1' },
    { id: 's-2', name: 'Bilal Ahmed', rollNumber: 'MED-02', section_id: 'sec-1' },
    { id: 's-3', name: 'Zainab Noor', rollNumber: 'MED-03', section_id: 'sec-2' },
    { id: 's-4', name: 'Usman Ali', rollNumber: 'MED-04', section_id: 'sec-1' }
  ];

  const updatedAttempts = {};
  const mockTenantDb = {
    mockTest: {
      findUnique: async () => ({ id: 'mock-101', title: 'MDCAT Grand Mock #1' })
    },
    mockAttempt: {
      findMany: async () => [...mockAttempts].sort((a, b) => b.score - a.score),
      update: async ({ where, data }) => {
        updatedAttempts[where.id] = data;
        return { id: where.id, ...data };
      }
    },
    student: {
      findMany: async () => mockStudents
    }
  };

  let rankingResult = null;
  const resRanking = {
    json: (data) => { rankingResult = data; }
  };

  await getMockRankings(
    {
      tenantClient: mockTenantDb,
      collegeId: 'c-1',
      params: { id: 'mock-101' }
    },
    resRanking,
    (err) => { if (err) throw err; }
  );

  assert(rankingResult.success, 'Ranking query must succeed');
  const ranks = rankingResult.rankings;

  assert.strictEqual(ranks[0].rankCollege, 1, 'Top score (190) must be Rank 1');
  assert.strictEqual(ranks[1].rankCollege, 2, 'Second score (180) must be Rank 2');
  assert.strictEqual(ranks[2].rankCollege, 2, 'Tied score (180) must also be Rank 2');
  assert.strictEqual(ranks[3].rankCollege, 4, 'Following score (160) must be Rank 4 in competition ranking');

  // Verify section rankings
  // In sec-1: s-1 (190 -> 1), s-2 (180 -> 2), s-4 (160 -> 3)
  assert.strictEqual(ranks[0].rankSection, 1, 's-1 must be Rank 1 in sec-1');
  assert.strictEqual(ranks[1].rankSection, 2, 's-2 must be Rank 2 in sec-1');
  assert.strictEqual(ranks[3].rankSection, 3, 's-4 must be Rank 3 in sec-1');

  // In sec-2: s-3 is the only student in sec-2 -> Rank 1 in sec-2
  assert.strictEqual(ranks[2].rankSection, 1, 's-3 must be Rank 1 in sec-2');
  console.log('✓ 3. Ranking engine verified: ties share identical rank (Rank 2 & 2) followed by next rank (Rank 4)');

  // 4. Test Anonymous Student Feedback Privacy Invariant
  // When a student submits feedback with anonymous: true, student_id MUST NOT be exposed
  const createdFeedback = [];
  const mockFeedbackDb = {
    studentFeedback: {
      create: async ({ data }) => {
        createdFeedback.push({ id: 'fb-' + (createdFeedback.length + 1), ...data });
        return createdFeedback[createdFeedback.length - 1];
      },
      findMany: async () => createdFeedback
    }
  };

  let anonResponse = null;
  await submitFeedback(
    {
      tenantClient: mockFeedbackDb,
      collegeId: 'c-1',
      body: {
        category: 'facilities',
        message: 'Library AC is not working on 2nd floor.',
        anonymous: true,
        student_id: 'student-secret-uuid-123'
      }
    },
    {
      status: () => ({ json: (data) => { anonResponse = data; } })
    },
    (err) => { if (err) throw err; }
  );

  assert.strictEqual(anonResponse.data.student_id, null, 'Returned anonymous feedback must have student_id: null');
  assert.strictEqual(createdFeedback[0].student_id, null, 'Stored anonymous feedback must have student_id: null');

  // Submit non-anonymous feedback
  await submitFeedback(
    {
      tenantClient: mockFeedbackDb,
      collegeId: 'c-1',
      body: {
        category: 'academic',
        message: 'Great physics lecture today.',
        anonymous: false,
        student_id: 'student-public-456'
      }
    },
    {
      status: () => ({ json: () => {} })
    },
    (err) => { if (err) throw err; }
  );

  let listResponse = null;
  await getFeedbackList(
    {
      tenantClient: mockFeedbackDb,
      collegeId: 'c-1',
      query: {}
    },
    {
      json: (data) => { listResponse = data; }
    },
    (err) => { if (err) throw err; }
  );

  const anonItem = listResponse.data.find(f => f.anonymous);
  const namedItem = listResponse.data.find(f => !f.anonymous);

  assert.strictEqual(anonItem.student_id, null, 'Anonymous list item MUST have student_id: null');
  assert.strictEqual(namedItem.student_id, 'student-public-456', 'Named item preserves student_id');
  console.log('✓ 4. Student feedback privacy verified: anonymous feedback never exposes student_id');

  // 5. Test OMR scanning route returns 501 NOT_BUILT
  let omrStatus = null;
  let omrBody = null;
  recordOmrScan({}, {
    status: (code) => {
      omrStatus = code;
      return { json: (data) => { omrBody = data; } };
    }
  });

  assert.strictEqual(omrStatus, 501, 'OMR route must return HTTP 501');
  assert.strictEqual(omrBody.code, 'NOT_BUILT', 'OMR route code must be NOT_BUILT');
  console.log('✓ 5. OMR scanning route returns 501 NOT_BUILT as specified');

  // 6. Test Aggregate Calculator Formula & Accuracy
  // MBBS: 10% Matric, 40% F.Sc, 50% Entry-Test
  // Matric: 1000/1100 = 90.9091%
  // F.Sc: 950/1100 = 86.3636%
  // Entry: 180/200 = 90.0000%
  // Aggregate = (90.90909 * 10 + 86.36363 * 40 + 90.0000 * 50) / 100 = 88.6364%
  let aggResponse = null;
  calculateAggregate(
    {
      body: {
        weights: { matric: 10, fsc: 40, entryTest: 50 },
        matricObtained: 1000,
        matricTotal: 1100,
        fscObtained: 950,
        fscTotal: 1100,
        entryTestObtained: 180,
        entryTestTotal: 200
      }
    },
    {
      json: (data) => { aggResponse = data; }
    }
  );

  assert(aggResponse.success, 'Aggregate calculation must succeed');
  assert(Math.abs(aggResponse.aggregate - 88.6364) < 0.01, `Calculated aggregate ${aggResponse.aggregate} must match 88.6364%`);
  console.log(`✓ 6. Aggregate calculator verified: UHS MBBS formula computed exactly ${aggResponse.aggregate}%`);

  console.log('\n========================================');
  console.log('ALL PHASE 10 AUTOMATED TESTS PASSED (100%)');
  console.log('========================================\n');
}

if (require.main === module) {
  runPhase10Tests().catch(err => {
    console.error('Phase 10 test failure:', err);
    process.exit(1);
  });
}

module.exports = { runPhase10Tests };
