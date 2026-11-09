'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { getSystemClient, closeAllClients } = require('../config/prismaManager');

async function runTests() {
  console.log('='.repeat(70));
  console.log('RUNNING PHASE 1: DATABASE LAYER & INDEXES CONTRACT TESTS');
  console.log('='.repeat(70));

  const prisma = getSystemClient();
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
    // 1. Verify Postgres pg_indexes has all newly created indexes
    const indexes = await prisma.$queryRawUnsafe(`
      SELECT tablename, indexname, indexdef
      FROM pg_indexes
      WHERE tablename IN ('College', 'CollegeSubscriptionPayment')
      ORDER BY tablename, indexname;
    `);

    const indexNames = indexes.map(i => i.indexname);
    console.log(`Discovered ${indexes.length} indexes across College and CollegeSubscriptionPayment:`);
    indexNames.forEach(name => console.log(`  - ${name}`));

    assert(
      'College has index on isTest',
      indexNames.includes('College_isTest_idx')
    );

    assert(
      'College has composite index on planId and subStatus',
      indexNames.includes('College_planId_subStatus_idx')
    );

    assert(
      'CollegeSubscriptionPayment has index on createdAt DESC',
      indexNames.includes('CollegeSubscriptionPayment_createdAt_idx')
    );

    assert(
      'CollegeSubscriptionPayment has composite index on status and reviewedAt DESC',
      indexNames.includes('CollegeSubscriptionPayment_status_reviewedAt_idx')
    );

    assert(
      'CollegeSubscriptionPayment has composite index on college_id and createdAt DESC',
      indexNames.includes('CollegeSubscriptionPayment_college_id_createdAt_idx')
    );

    assert(
      'CollegeSubscriptionPayment has index on paymentMethod',
      indexNames.includes('CollegeSubscriptionPayment_paymentMethod_idx')
    );

    assert(
      'CollegeSubscriptionPayment has index on planId',
      indexNames.includes('CollegeSubscriptionPayment_planId_idx')
    );

    // 2. Verify all 200 payments have non-null planId and billingCycle
    const nullPlanCount = await prisma.collegeSubscriptionPayment.count({
      where: { planId: null }
    });
    assert(`No payment rows have planId = null (found: ${nullPlanCount})`, nullPlanCount === 0);

    const nullCycleCount = await prisma.collegeSubscriptionPayment.count({
      where: { billingCycle: null }
    });
    assert(`No payment rows have billingCycle = null (found: ${nullCycleCount})`, nullCycleCount === 0);

    // 3. Verify total payment count remained strictly 200 (no deletion or unwanted creation)
    const totalPayments = await prisma.collegeSubscriptionPayment.count();
    assert(`Total payment rows count is preserved at 200 (found: ${totalPayments})`, totalPayments === 200);

    // 4. Verify canonical plan distribution after backfill
    const planCounts = await prisma.collegeSubscriptionPayment.groupBy({
      by: ['planId'],
      _count: { id: true }
    });
    console.log('Post-backfill plan breakdown in CollegeSubscriptionPayment:', planCounts);
    const validPlans = ['starter', 'standard', 'premium', 'enterprise'];
    const allValid = planCounts.every(p => validPlans.includes(p.planId));
    assert('All planId values match canonical tiers', allValid);

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

