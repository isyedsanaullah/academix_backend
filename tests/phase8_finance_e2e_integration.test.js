'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { getSystemClient, closeAllClients } = require('../config/prismaManager');
const overviewService = require('../modules/superAdminFinance/services/overview.service');
const paymentsService = require('../modules/superAdminFinance/services/paymentsHistory.service');
const collegesService = require('../modules/superAdminFinance/services/collegeBilling.service');
const accountantsService = require('../modules/superAdminFinance/services/accountants.service');
const planChangeService = require('../modules/superAdminFinance/services/planChange.service');
const { FORBIDDEN_USER_FIELDS } = require('../utils/safeUser');
const { PLAN_PRICING } = require('../config/planConstants');

async function runTests() {
  console.log('='.repeat(70));
  console.log('RUNNING PHASE 8: COMPLETE END-TO-END FINANCE INTEGRATION TESTS');
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

    // 1. Data Preservation Check
    console.log('\n--- 1. Data Preservation & Non-Destructive Integrity ---');
    const paymentCount = await prisma.collegeSubscriptionPayment.count();
    const collegeCount = await prisma.college.count();
    assert('Total payments count remains strictly 200', paymentCount === 200);
    assert('Total colleges count remains strictly 641', collegeCount === 641);

    // 2. Navigation Counter Badges (Lightweight)
    console.log('\n--- 2. Lightweight Nav Counts ---');
    const navCountsWithoutTest = await overviewService.getNavCounts(false);
    const navCountsWithTest = await overviewService.getNavCounts(true);

    assert('navCounts includes all required sidebar badge keys',
      'accountingOverview' in navCountsWithoutTest &&
      'paymentsHistory' in navCountsWithoutTest &&
      'perCollegeBilling' in navCountsWithoutTest &&
      'accountantDetails' in navCountsWithoutTest
    );
    assert('navCounts isolates test colleges when includeTest=false',
      navCountsWithoutTest.paymentsHistory < 200 &&
      navCountsWithoutTest.perCollegeBilling < 641
    );
    assert('navCounts includes all records when includeTest=true',
      navCountsWithTest.paymentsHistory === 200 &&
      navCountsWithTest.perCollegeBilling === 641 &&
      navCountsWithTest.accountantDetails === 10
    );

    // 3. Accounting Overview
    console.log('\n--- 3. Accounting Overview ---');
    const overview = await overviewService.getAccountingOverview({ includeTest: false });
    assert('Overview stat cards are present and zero-filled',
      typeof overview.cards.totalRevenueCollected === 'number' &&
      typeof overview.cards.pendingAmount === 'number' &&
      overview.cards.revenueByPlan.starter &&
      overview.cards.revenueByPlan.standard &&
      overview.cards.revenueByPlan.premium &&
      overview.cards.revenueByPlan.enterprise &&
      overview.cards.revenueByPlan.addons_credits
    );
    assert('Timezone is strictly Asia/Karachi',
      overview.meta.timezone === 'Asia/Karachi'
    );

    // 4. Payments History & Ledger
    console.log('\n--- 4. Payments History & Ledger ---');
    const payments = await paymentsService.getPaymentsList({ includeTest: true, page: 1, limit: 15 });
    assert('Payments list returns paginated records with college code',
      payments.payments.length === 15 &&
      payments.payments.every(p => p.college && p.college.code)
    );
    assert('Payment summary accurately tallies statuses (131 approved, 55 pending, 14 rejected)',
      payments.summary.approvedCount === 131 &&
      payments.summary.pendingCount === 55 &&
      payments.summary.rejectedCount === 14
    );

    // 5. Per-College Billing Setup & Automatic Price Derivation
    console.log('\n--- 5. Per-College Billing & Automatic Price Derivation ---');
    const collegesList = await collegesService.getCollegeBillingList({ includeTest: false, page: 1, limit: 10 });
    assert('Each college has automatically derived billingPrice matching PLAN_PRICING',
      collegesList.colleges.every(c => {
        const expected = c.billingCycle === 'YEARLY'
          ? PLAN_PRICING[c.planId].yearly
          : PLAN_PRICING[c.planId].monthly;
        return c.billingPrice === expected;
      })
    );

    // 6. Accountant Details & Security PII Assertion
    console.log('\n--- 6. Accountant Details & Security Assertion ---');
    const accountantsList = await accountantsService.getAccountantsList({ includeTest: true, page: 1, limit: 50 });
    assert('Accountants list returns all registered accountants', accountantsList.accountants.length === 10);

    let leaked = false;
    accountantsList.accountants.forEach(a => {
      FORBIDDEN_USER_FIELDS.forEach(f => {
        if (a[f] !== undefined) leaked = true;
      });
      if (a.cnic !== undefined) leaked = true;
    });
    assert('FINANCE_SAFE_USER_SELECT rigorously enforces zero secrets or cnic in response', !leaked);

    // 7. Plan Change Blocking Payment 409 Rule (Amendment 8)
    console.log('\n--- 7. Plan Change Engine: 409 Conflict Guard ---');
    const pendingPayment = await prisma.collegeSubscriptionPayment.findFirst({
      where: { status: 'PENDING' }
    });

    if (pendingPayment) {
      let threw409 = false;
      let blockingData = null;
      try {
        await planChangeService.changeCollegePlan(
          pendingPayment.college_id,
          'standard',
          'Client request',
          { id: 'admin', email: 'admin@academix.edu.pk' }
        );
      } catch (err) {
        threw409 = err.statusCode === 409;
        blockingData = err.details?.blockingPayment;
      }

      assert('changeCollegePlan rejects modification with HTTP 409 when proof is pending', threw409);
      assert('409 error payload contains blocking payment id and status',
        blockingData && blockingData.id === pendingPayment.id && blockingData.status === pendingPayment.status
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

