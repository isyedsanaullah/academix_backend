'use strict';

/**
 * test_subphase_9j.js
 * Verification test suite for Sub-Phase 9J: N04 Accountant Journal CSV (Premium)
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { getSystemClient } = require('../config/prismaManager');
const { queueExportJob } = require('../services/exportService');
const { processExportJob } = require('../workers/exportWorker');
const {
  seedDefaultMappings,
  validateAccountHeadMappings,
  fetchAccountantJournalData
} = require('../services/accountantJournalService');

const prisma = getSystemClient();

async function runTests() {
  console.log('====================================================');
  console.log('   TESTING SUB-PHASE 9J: N04 ACCOUNTANT JOURNAL CSV ');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`PASS: ${message}`);
      passed++;
    } else {
      console.error(`FAIL: ${message}`);
      failed++;
    }
  }

  let starterCollegeId = null;
  let standardCollegeId = null;
  let premiumCollegeId = null;
  const testUserId = `test_user_${Date.now()}`;

  try {
    // ----------------------------------------------------
    // Setup Test Colleges
    // ----------------------------------------------------
    const starterCol = await prisma.college.create({
      data: {
        name: 'Starter College Test 9J',
        email: `starter9j_${Date.now()}@test.com`,
        code: `ST9J_${Date.now()}`,
        planId: 'starter',
        subStatus: 'ACTIVE'
      }
    });
    starterCollegeId = starterCol.id;

    const stdCol = await prisma.college.create({
      data: {
        name: 'Standard College Test 9J',
        email: `std9j_${Date.now()}@test.com`,
        code: `STD9J_${Date.now()}`,
        planId: 'standard',
        subStatus: 'ACTIVE'
      }
    });
    standardCollegeId = stdCol.id;

    const premCol = await prisma.college.create({
      data: {
        name: 'Premium College Test 9J',
        email: `prem9j_${Date.now()}@test.com`,
        code: `PRM9J_${Date.now()}`,
        planId: 'premium',
        subStatus: 'ACTIVE'
      }
    });
    premiumCollegeId = premCol.id;

    // ----------------------------------------------------
    // TEST 1: Feature Gating (Starter & Standard Rejected with 403 FEATURE_NOT_IN_PLAN)
    // ----------------------------------------------------
    let starterBlocked = false;
    try {
      await queueExportJob({
        collegeId: starterCollegeId,
        userId: testUserId,
        exportType: 'LEDGER',
        format: 'CSV'
      });
    } catch (err) {
      if (err.code === 'FEATURE_NOT_IN_PLAN' && err.status === 403) {
        starterBlocked = true;
      }
    }

    let standardBlocked = false;
    try {
      await queueExportJob({
        collegeId: standardCollegeId,
        userId: testUserId,
        exportType: 'LEDGER',
        format: 'CSV'
      });
    } catch (err) {
      if (err.code === 'FEATURE_NOT_IN_PLAN' && err.status === 403) {
        standardBlocked = true;
      }
    }

    assert(
      starterBlocked && standardBlocked,
      '1. Starter and Standard tiers strictly rejected with 403 FEATURE_NOT_IN_PLAN for N04'
    );

    // ----------------------------------------------------
    // TEST 2: Pre-Flight Check Blocks Unmapped Heads (422 UNMAPPED_HEADS)
    // ----------------------------------------------------
    // Create Student, Fee, Payment, and Refund without any mappings
    const student = await prisma.student.create({
      data: {
        college_id: premiumCollegeId,
        session_id: 'default_session',
        name: 'Ahmed Khan',
        rollNumber: 'FA-101',
        fatherName: 'Tariq Khan',
        gender: 'male',
        class: '11th',
        group: 'Pre-Engineering',
        status: 'active'
      }
    });

    const fee = await prisma.fee.create({
      data: {
        college_id: premiumCollegeId,
        session_id: 'default_session',
        student_id: student.id,
        month: '2026-11',
        tuitionFee: 5000,
        labFee: 1500,
        totalAmount: 6500,
        paidAmount: 6500,
        status: 'paid',
        challanNumber: `CHL-${Date.now()}`
      }
    });

    await prisma.payment.create({
      data: {
        college_id: premiumCollegeId,
        fee_id: fee.id,
        student_id: student.id,
        amount: 6500,
        paymentMethod: 'bank',
        receiptNumber: `RCP-${Date.now()}`
      }
    });

    await prisma.feeRefund.create({
      data: {
        college_id: premiumCollegeId,
        student_id: student.id,
        fee_id: fee.id,
        amount: 1000,
        reason: 'Duplicate payment adjustment',
        status: 'paid'
      }
    });

    let preflightBlocked = false;
    let unmappedList = [];
    try {
      await queueExportJob({
        collegeId: premiumCollegeId,
        userId: testUserId,
        exportType: 'LEDGER',
        format: 'CSV'
      });
    } catch (err) {
      if (err.code === 'UNMAPPED_HEADS' && err.status === 422) {
        preflightBlocked = true;
        unmappedList = err.details?.unmapped || [];
      } else {
        console.error('Test 2 caught unexpected error:', err);
      }
    }

    assert(
      preflightBlocked && unmappedList.length >= 1,
      '2. Pre-flight check rejects unmapped heads with 422 UNMAPPED_HEADS and lists missing heads'
    );

    // ----------------------------------------------------
    // TEST 3: AccountHeadMapping Seeding (Seeds future N40 Chart of Accounts)
    // ----------------------------------------------------
    const seedResult = await seedDefaultMappings(premiumCollegeId, null, prisma);
    const mappings = await prisma.accountHeadMapping.findMany({ where: { college_id: premiumCollegeId } });

    assert(
      seedResult.success && mappings.length >= 10,
      '3. AccountHeadMapping seeds baseline Chart of Accounts (PAYMENT_METHOD, FEE_TYPE, FINE, REFUND)'
    );

    // ----------------------------------------------------
    // TEST 4: Double-Entry Journal Balance Assertion (Debits == Credits)
    // ----------------------------------------------------
    const journalData = await fetchAccountantJournalData(prisma, premiumCollegeId, null, {});

    assert(
      journalData.isBalanced &&
      journalData.totalDebits > 0 &&
      journalData.totalDebits === journalData.totalCredits,
      `4. Double-entry journal strictly balances (Total Debits PKR ${journalData.totalDebits} == Total Credits PKR ${journalData.totalCredits})`
    );

    // ----------------------------------------------------
    // TEST 5: Successful Export Execution via Export Worker
    // ----------------------------------------------------
    const job = await queueExportJob({
      collegeId: premiumCollegeId,
      userId: testUserId,
      exportType: 'LEDGER',
      format: 'CSV'
    });

    const execResult = await processExportJob(job);
    const completedJob = await prisma.exportJob.findUnique({ where: { id: job.id } });

    assert(
      execResult.success && completedJob.status === 'READY' && completedJob.rowCount >= 4,
      '5. Export worker successfully generates READY journal CSV with row count'
    );

  } catch (err) {
    console.error('Unhandled error in 9J tests:', err);
    failed++;
  } finally {
    // Cleanup
    const colIds = [starterCollegeId, standardCollegeId, premiumCollegeId].filter(Boolean);
    if (colIds.length > 0) {
      await prisma.exportJob.deleteMany({ where: { college_id: { in: colIds } } });
      await prisma.payment.deleteMany({ where: { college_id: { in: colIds } } });
      await prisma.feeRefund.deleteMany({ where: { college_id: { in: colIds } } });
      await prisma.fee.deleteMany({ where: { college_id: { in: colIds } } });
      await prisma.student.deleteMany({ where: { college_id: { in: colIds } } });
      await prisma.accountHeadMapping.deleteMany({ where: { college_id: { in: colIds } } });
      await prisma.collegeUsage.deleteMany({ where: { college_id: { in: colIds } } });
      await prisma.college.deleteMany({ where: { id: { in: colIds } } });
    }
  }

  console.log('\n====================================================');
  console.log(`SUB-PHASE 9J TESTS SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================');

  if (failed > 0) process.exit(1);
}

runTests();
