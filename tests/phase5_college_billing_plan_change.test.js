'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { getCollegeBillingList, getCollegeBillingDetail } = require('../modules/superAdminFinance/services/collegeBilling.service');
const { changeCollegePlan } = require('../modules/superAdminFinance/services/planChange.service');
const { getSystemClient, closeAllClients } = require('../config/prismaManager');

async function runTests() {
  console.log('='.repeat(70));
  console.log('RUNNING PHASE 5: PER-COLLEGE BILLING & PLAN CHANGE ENGINE TESTS');
  console.log('='.repeat(70));

  let passed = 0;
  let failed = 0;

  function assert(desc, condition) {
    if (condition) {
      console.log(`[PASS] ${desc}`);
      passed++;
    } else {
      console.error(`[FAIL] ${desc}`);
      failed++;
    }
  }

  try {
    const prisma = getSystemClient();

    // 1. College Billing List (without test data)
    console.log('\n--- 1. Testing getCollegeBillingList (includeTest=false) ---');
    const billingListWithoutTest = await getCollegeBillingList({ includeTest: false, page: 1, limit: 10 });
    assert('Returns 10 colleges per page', billingListWithoutTest.colleges.length === 10);
    assert('All returned colleges have isTest = false',
      billingListWithoutTest.colleges.every(c => c.isTest === false)
    );
    assert('All colleges have derived billingPrice in PKR (> 0)',
      billingListWithoutTest.colleges.every(c => typeof c.billingPrice === 'number' && c.billingPrice > 0)
    );

    // 2. College Billing List (with test data)
    console.log('\n--- 2. Testing getCollegeBillingList (includeTest=true) ---');
    const billingListWithTest = await getCollegeBillingList({ includeTest: true, limit: 10 });
    assert('Total count matches 641 colleges in DB',
      billingListWithTest.pagination.total === 641
    );

    // 3. College Billing Detail
    console.log('\n--- 3. Testing getCollegeBillingDetail ---');
    const sampleCollege = billingListWithoutTest.colleges[0];
    const detail = await getCollegeBillingDetail(sampleCollege.id);

    assert('Detail contains college metadata and derived billingPrice',
      detail && detail.college && detail.college.id === sampleCollege.id && detail.college.billingPrice > 0
    );
    assert('Detail contains limits and usage objects',
      detail.limits && typeof detail.limits.maxStudents === 'number' &&
      detail.usage && typeof detail.usage.students === 'number'
    );
    assert('Detail contains financialSummary and ledger array',
      detail.financialSummary && Array.isArray(detail.ledger)
    );
    assert('Detail accountants are safe (no passwords, secrets, or cnic)',
      Array.isArray(detail.accountants) &&
      detail.accountants.every(a => a.password === undefined && a.totpSecretEnc === undefined && a.cnic === undefined)
    );

    // 4. Plan Change: Blocking Payment 409 check (Amendment 8)
    console.log('\n--- 4. Testing Plan Change: Blocking Payment 409 Conflict ---');
    // Find a college with a pending payment
    const collegeWithPending = await prisma.collegeSubscriptionPayment.findFirst({
      where: { status: 'PENDING' },
      select: { college_id: true, id: true, status: true }
    });

    if (collegeWithPending) {
      let threw409 = false;
      let errorDetails = null;

      try {
        await changeCollegePlan(
          collegeWithPending.college_id,
          'premium',
          'Customer requested upgrade',
          { id: 'admin-tester', email: 'superadmin@test.com' }
        );
      } catch (err) {
        threw409 = err.statusCode === 409 && err.code === 'PAYMENT_IN_PROGRESS';
        errorDetails = err.details;
      }

      assert('changeCollegePlan throws 409 PAYMENT_IN_PROGRESS when proof is under review', threw409);
      assert('409 response includes blockingPayment id and status',
        errorDetails &&
        errorDetails.blockingPayment &&
        errorDetails.blockingPayment.id === collegeWithPending.id &&
        errorDetails.blockingPayment.status === collegeWithPending.status
      );
    } else {
      console.log('Skipping 409 test: No pending payments found in DB');
    }

    // 5. Plan Change: Successful upgrade on a test college without pending payments
    console.log('\n--- 5. Testing Plan Change: Successful Upgrade & Audit Log ---');
    // Pick a test college with no pending payment
    const testCollege = await prisma.college.findFirst({
      where: {
        isTest: true,
        subscriptionPayments: {
          none: { status: { in: ['PENDING', 'APPROVING'] } }
        }
      },
      select: { id: true, code: true, planId: true, billingCycle: true }
    });

    if (testCollege) {
      const targetPlan = testCollege.planId === 'premium' ? 'enterprise' : 'premium';
      const changeResult = await changeCollegePlan(
        testCollege.id,
        targetPlan,
        'Upgrading plan for contract test verification',
        { id: 'admin-tester', email: 'superadmin@test.com' }
      );

      assert('changeCollegePlan succeeds immediately for upgrade',
        changeResult.success && changeResult.effectivePlan === targetPlan
      );
      assert('Derived billing price is automatically computed from PLAN_PRICING',
        typeof changeResult.derivedBillingPrice === 'number' && changeResult.derivedBillingPrice > 0
      );

      // Verify DB row
      const verifiedCollege = await prisma.college.findUnique({
        where: { id: testCollege.id },
        select: { planId: true }
      });
      assert('College in database has updated planId',
        verifiedCollege.planId === targetPlan
      );

      // Verify Audit record
      const auditLog = await prisma.collegeEntitlementAudit.findFirst({
        where: { college_id: testCollege.id, action: 'PLAN_CHANGE' },
        orderBy: { createdAt: 'desc' }
      });
      assert('CollegeEntitlementAudit record is created',
        auditLog && auditLog.newVal === targetPlan
      );
    }

  } catch (err) {
    console.error('Test execution error:', err);
    failed++;
  } finally {
    await closeAllClients();
  }

  console.log('\n' + '='.repeat(70));
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('='.repeat(70));

  if (failed > 0) process.exit(1);
}

runTests();
