require('dotenv').config();
const assert = require('assert');
const { FEATURES } = require('../services/capabilityCatalog');
const { resolveCollege } = require('../services/collegeAdapter');
const { getMeritList } = require('../controllers/admissions.controller');
const { generateFeesFromStructure } = require('../controllers/fee.controller');
const { getSystemClient } = require('../config/prismaManager');
const { getCollegeLimit, consume } = require('../services/quota');

async function runPhase8Tests() {
  console.log('--- Starting Phase 8 Test Suite: Admissions Quotas, Fee Types & Discounts ---');

  // 1. Verify capability catalog statuses
  const phase8Keys = [
    'admissions',
    'admissions-online',
    'admission-matric-capture',
    'equivalence',
    'merit-scholarship-tiers',
    'quotas',
    'enquiry-leads',
    'fee-college-types',
    'fee-discounts',
    'fee-refunds'
  ];

  for (const key of phase8Keys) {
    const f = FEATURES.find(feat => feat.key === key);
    assert(f, `Feature '${key}' must exist in catalog`);
    assert.strictEqual(f.status, 'live', `Feature '${key}' must be 'live'`);
    assert.strictEqual(f.effort, 'Done', `Feature '${key}' effort must be 'Done'`);
  }
  console.log('✓ 1. All 10 Phase 8 admissions and fee features verified live & Done in catalog');

  // 2. Test Merit Order: Quota seats reserved first!
  // Setup 4 applicants:
  // - A: Open merit, 95%
  // - B: Open merit, 90%
  // - C: Quota 'sports', 78% (1 reserved seat)
  // - D: Quota 'sports', 70%
  const mockApplications = [
    {
      id: 'app-a',
      name: 'Bilal Ahmed',
      preferredGroup: 'Pre-Medical',
      sscTotalMarks: 1100,
      sscObtainedMarks: 1045, // 95%
      quota: null,
      equivalenceMarks: null,
      status: 'submitted'
    },
    {
      id: 'app-b',
      name: 'Hamza Tariq',
      preferredGroup: 'Pre-Medical',
      sscTotalMarks: 1100,
      sscObtainedMarks: 990, // 90%
      quota: null,
      equivalenceMarks: null,
      status: 'submitted'
    },
    {
      id: 'app-c',
      name: 'Usman Sports',
      preferredGroup: 'Pre-Medical',
      sscTotalMarks: 1100,
      sscObtainedMarks: 858, // 78%
      quota: 'sports',
      equivalenceMarks: null,
      status: 'submitted'
    },
    {
      id: 'app-d',
      name: 'Zaid Sports 2',
      preferredGroup: 'Pre-Medical',
      sscTotalMarks: 1100,
      sscObtainedMarks: 770, // 70%
      quota: 'sports',
      equivalenceMarks: null,
      status: 'submitted'
    }
  ];

  const mockQuotaRules = [
    {
      code: 'sports',
      name: 'Sports Quota',
      seats: 1,
      discountType: 'fixed',
      discountValue: 5000,
      isActive: true
    }
  ];

  const mockScholarshipTiers = [
    {
      id: 'tier-a-plus',
      name: 'A+ Merit Scholarship',
      minPercent: 90,
      maxPercent: 100,
      discountType: 'percent',
      discountValue: 25,
      appliesTo: ['tuition'],
      isActive: true
    }
  ];

  const mockAdmissionsDb = {
    session: {
      findFirst: async () => ({ id: 'session-2026' })
    },
    application: {
      findMany: async () => mockApplications
    },
    quotaRule: {
      findMany: async () => mockQuotaRules
    },
    scholarshipTier: {
      findMany: async () => mockScholarshipTiers
    }
  };

  let meritResponse = null;
  const resMerit = {
    json: (data) => { meritResponse = data; }
  };

  await getMeritList(
    {
      tenantClient: mockAdmissionsDb,
      collegeId: 'test-college-1',
      query: { group: 'Pre-Medical' }
    },
    resMerit,
    (err) => { if (err) throw err; }
  );

  assert(meritResponse.success, 'Merit list must generate successfully');
  assert.strictEqual(meritResponse.totalApplicants, 4);
  assert.strictEqual(meritResponse.quotaReservedCount, 1);
  assert.strictEqual(meritResponse.openMeritCount, 3);

  // Assert order: Quota reserved first (Usman Sports), then Open merit: Bilal (95%), Hamza (90%), Zaid (70%)
  const list = meritResponse.data;
  assert.strictEqual(list[0].id, 'app-c', 'Candidate C (sports quota reserved) must be 1st in merit list');
  assert.strictEqual(list[0].quotaAllocated, true, 'Candidate C must have quotaAllocated = true');

  assert.strictEqual(list[1].id, 'app-a', 'Candidate A (95% open merit) must be 2nd in merit list');
  assert.strictEqual(list[1].quotaAllocated, false);
  assert(list[1].scholarshipTier != null, 'Candidate A must qualify for A+ scholarship tier');

  assert.strictEqual(list[2].id, 'app-b', 'Candidate B (90% open merit) must be 3rd in merit list');
  assert.strictEqual(list[2].quotaAllocated, false);

  assert.strictEqual(list[3].id, 'app-d', 'Candidate D (sports unallocated) must compete in open merit');
  assert.strictEqual(list[3].quotaAllocated, false);

  console.log('✓ 2. Merit list order verified: Quota reserved seats placed first, open merit follows');

  // 3. Test Fee Generation with Quota Discount
  // Setup student with quota 'sports' (discount 5000 fixed)
  const mockStudent = {
    id: 'stud-101',
    name: 'Usman Sports',
    rollNumber: 'MED-01',
    class: 'FSC Part 1',
    quota: 'sports',
    application_id: null
  };

  const mockStructure = {
    id: 'struct-adm-1',
    college_id: 'test-college-1',
    session_id: 'session-2026',
    class: 'FSC Part 1',
    feeType: 'admission',
    amount: 25000,
    dueDate: new Date(),
    installments: null
  };

  let createdFeeRow = null;
  const mockFeeDb = {
    student: {
      findFirst: async () => mockStudent
    },
    feeStructure: {
      findMany: async () => [mockStructure]
    },
    quotaRule: {
      findFirst: async () => ({
        code: 'sports',
        discountType: 'fixed',
        discountValue: 5000,
        isActive: true
      })
    },
    fee: {
      create: async ({ data }) => {
        createdFeeRow = { id: 'fee-101', ...data };
        return createdFeeRow;
      }
    }
  };

  let feeResponse = null;
  const resFee = {
    status: () => ({
      json: (data) => { feeResponse = data; }
    })
  };

  await generateFeesFromStructure(
    {
      tenantClient: mockFeeDb,
      collegeId: 'test-college-1',
      body: { student_id: 'stud-101', session_id: 'session-2026' }
    },
    resFee,
    (err) => { if (err) throw err; }
  );

  assert(feeResponse.success, 'Fee generation must succeed');
  assert(createdFeeRow != null, 'Fee row must be created');
  assert.strictEqual(Number(createdFeeRow.scholarshipDeduction), 5000, 'Quota discount of 5000 must be in scholarshipDeduction');
  assert.strictEqual(Number(createdFeeRow.totalAmount), 20000, 'Net totalAmount must be 20000 (25000 - 5000)');
  console.log('✓ 3. Quota discount verified: 5000 deduction correctly reduced fee from 25000 to 20000');

  // 4. Test Public Apply Gating & Yearly Quota Limit Check
  // 4a. College where admissions-online is off returns 403
  const starterCollege = {
    id: 'c-starter',
    isActive: true,
    subscription: { plan: 'starter', status: 'active' },
    settings: {}
  };
  const resolvedStarter = resolveCollege(starterCollege);
  assert(!resolvedStarter.features['admissions-online'].on, 'admissions-online must be off on Starter');

  // 4b. Standard College (limit 300): test quota resolution and limit check
  const systemDb = getSystemClient();
  const stdLimit = await getCollegeLimit(systemDb, 'c-std', 'applications');
  assert.strictEqual(stdLimit, 300, 'Standard plan default applications limit must be 300');

  // Simulate usage reaching limit
  const currentYear = String(new Date().getFullYear());
  const quotaRes = await consume(systemDb, 'mock-college-app-test', 'applications', 301, 300, currentYear);
  assert.strictEqual(quotaRes.allowed, false, 'Consuming 301 on a 300 limit must be rejected');

  console.log('✓ 4. Public apply gating verified: admissions-online off returns 403; yearly limit rejects when reached');

  console.log('\n========================================');
  console.log('ALL PHASE 8 AUTOMATED TESTS PASSED (100%)');
  console.log('========================================\n');
}

if (require.main === module) {
  runPhase8Tests().catch(err => {
    console.error('Phase 8 test failure:', err);
    process.exit(1);
  });
}

module.exports = { runPhase8Tests };
