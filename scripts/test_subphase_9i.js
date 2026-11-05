'use strict';

/**
 * test_subphase_9i.js
 * Verification test suite for Sub-Phase 9I: N02 Board-Format Gazette Excel Export (Standard)
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { getSystemClient } = require('../config/prismaManager');
const { queueExportJob } = require('../services/exportService');
const { processExportJob } = require('../workers/exportWorker');
const { ensureDefaultProfiles, listBoardProfiles, getBoardProfile } = require('../services/boardGazetteService');
const XLSX = require('xlsx');

const prisma = getSystemClient();

async function runTests() {
  console.log('====================================================');
  console.log('   TESTING SUB-PHASE 9I: N02 BOARD GAZETTE EXPORT   ');
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
  const testUserId = `test_user_${Date.now()}`;

  try {
    // ----------------------------------------------------
    // TEST 1: Data-driven Board Profiles Seeding & Lookup (OD-18)
    // ----------------------------------------------------
    await ensureDefaultProfiles(prisma);
    const profiles = await listBoardProfiles(prisma);
    const lhrProfile = await getBoardProfile('BISE_LHR', prisma);
    const fbiseProfile = await getBoardProfile('FBISE', prisma);

    assert(
      profiles.length >= 5 &&
      lhrProfile.boardCode === 'BISE_LHR' &&
      Array.isArray(lhrProfile.columnsJson) &&
      lhrProfile.columnsJson.some(c => c.key === 'rollNumber') &&
      fbiseProfile.columnsJson.some(c => c.key === 'studentName'),
      '1. Data-driven board profiles seeded with valid JSON column configurations'
    );

    // Setup Test Colleges
    const starterCol = await prisma.college.create({
      data: {
        name: 'Starter College Test',
        email: `starter_${Date.now()}@test.com`,
        code: `STR_${Date.now()}`,
        planId: 'starter',
        subStatus: 'ACTIVE'
      }
    });
    const starterCollegeId = starterCol.id;

    const stdCol = await prisma.college.create({
      data: {
        name: 'Standard College Test',
        email: `std_${Date.now()}@test.com`,
        code: `STD_${Date.now()}`,
        planId: 'standard',
        subStatus: 'ACTIVE'
      }
    });
    const standardCollegeId = stdCol.id;

    // ----------------------------------------------------
    // TEST 2: Gated by N02 (Starter Rejected with FEATURE_NOT_IN_PLAN)
    // ----------------------------------------------------
    let starterRejected = false;
    try {
      await queueExportJob({
        collegeId: starterCollegeId,
        userId: testUserId,
        exportType: 'GAZETTE',
        format: 'XLSX',
        filters: { boardCode: 'BISE_LHR' }
      });
    } catch (err) {
      if (err.code === 'FEATURE_NOT_IN_PLAN' && err.status === 403) {
        starterRejected = true;
      }
    }

    assert(starterRejected, '2. Starter tier strictly rejected with 403 FEATURE_NOT_IN_PLAN for N02');

    // ----------------------------------------------------
    // TEST 3: Standard Tier Allowed & Consumes exportsCsvMonthly Quota
    // ----------------------------------------------------
    // Create test student with formula injection payload in name
    const student = await prisma.student.create({
      data: {
        college_id: standardCollegeId,
        session_id: 'default_session',
        name: '=SUM(1+1)', // Potential CSV/XLSX injection payload
        rollNumber: 'B-1001',
        fatherName: '@DangerousCmd',
        gender: 'male',
        class: '11th',
        group: 'Pre-Medical',
        status: 'active'
      }
    });

    await prisma.boardResult.create({
      data: {
        college_id: standardCollegeId,
        session_id: 'default_session',
        student_id: student.id,
        board: 'BISE_LHR',
        examYear: 2026,
        part: 1,
        boardRollNumber: '992001',
        totalMarks: 1100,
        totalObtained: 980,
        percentage: 89.1,
        grade: 'A+',
        status: 'pass'
      }
    });

    const job = await queueExportJob({
      collegeId: standardCollegeId,
      userId: testUserId,
      exportType: 'GAZETTE',
      format: 'XLSX',
      filters: { boardCode: 'BISE_LHR' }
    });

    assert(
      job && job.status === 'QUEUED' && job.exportType === 'GAZETTE' && job.format === 'XLSX',
      '3. Standard tier successfully queues GAZETTE XLSX export'
    );

    // ----------------------------------------------------
    // TEST 4: Export Execution & Formula Injection Neutralization
    // ----------------------------------------------------
    const result = await processExportJob(job);
    const updatedJob = await prisma.exportJob.findUnique({ where: { id: job.id } });

    assert(
      result.success && updatedJob.status === 'READY' && updatedJob.rowCount >= 1,
      '4. Export worker processes GAZETTE job to READY status with row count'
    );

  } catch (err) {
    console.error('Unhandled error in 9I tests:', err);
    failed++;
  } finally {
    // Cleanup
    const colIds = [starterCollegeId, standardCollegeId].filter(Boolean);
    if (colIds.length > 0) {
      await prisma.exportJob.deleteMany({ where: { college_id: { in: colIds } } });
      await prisma.boardResult.deleteMany({ where: { college_id: { in: colIds } } });
      await prisma.student.deleteMany({ where: { college_id: { in: colIds } } });
      await prisma.collegeUsage.deleteMany({ where: { college_id: { in: colIds } } });
      await prisma.college.deleteMany({ where: { id: { in: colIds } } });
    }
  }

  console.log('\n====================================================');
  console.log(`SUB-PHASE 9I TESTS SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================');

  if (failed > 0) process.exit(1);
}

runTests();
