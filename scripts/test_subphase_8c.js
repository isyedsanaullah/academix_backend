'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const assert = require('assert');
const { getSystemClient } = require('../config/prismaManager');
const prisma = getSystemClient();
const {
  validateImportCap,
  processNextJob,
  undoImportJob
} = require('../workers/bulkImportWorker');

async function testPhase8C() {
  console.log('--- Testing Sub-Phase 8C: #27 Bulk Data Import Engine ---');

  const college = await prisma.college.findFirst();
  assert.ok(college, 'College exists');

  let session = await prisma.session.findFirst({ where: { college_id: college.id } });
  if (!session) {
    session = await prisma.session.create({
      data: {
        college_id: college.id,
        name: 'Test Session Import ' + Date.now(),
        startDate: new Date('2026-09-01'),
        endDate: new Date('2027-06-30')
      }
    });
  }

  // 1. Test Row Cap Validation (OD-21)
  console.log('1. Testing OD-21 Import Row Cap validation...');
  let capFailed = false;
  try {
    // Attempt 30,000 rows (exceeds all plan tiers)
    await validateImportCap(college.id, 30000);
  } catch (err) {
    capFailed = true;
    assert.strictEqual(err.code, 'IMPORT_ROW_CAP_EXCEEDED');
  }
  assert.ok(capFailed, 'Over-cap import submission rejected');
  console.log('   PASS: Over-cap import rejected according to OD-21 caps.');

  // 2. Submit a test student import with 2 valid rows and 1 invalid row
  console.log('2. Creating a test import job with partial failure...');
  const roll1 = 'IMP_' + Date.now() + '_1';
  const roll2 = 'IMP_' + Date.now() + '_2';

  const job = await prisma.bulkImportJob.create({
    data: {
      college_id: college.id,
      importType: 'students',
      status: 'PENDING',
      totalRows: 3,
      createdById: 'tester'
    }
  });

  await prisma.bulkImportRow.createMany({
    data: [
      {
        job_id: job.id,
        rowNumber: 1,
        payloadJson: { name: 'Valid Student 1', rollNumber: roll1, sessionId: session.id, class: 'FSc Part 1', group: 'Pre-Medical' },
        status: 'PENDING'
      },
      {
        job_id: job.id,
        rowNumber: 2,
        payloadJson: { name: 'Invalid Missing Roll', rollNumber: '', sessionId: session.id, class: 'FSc Part 1' }, // Missing rollNumber
        status: 'PENDING'
      },
      {
        job_id: job.id,
        rowNumber: 3,
        payloadJson: { name: 'Valid Student 2', rollNumber: roll2, sessionId: session.id, class: 'FSc Part 1', group: 'Pre-Engineering' },
        status: 'PENDING'
      }
    ]
  });

  // 3. Process the job via worker
  console.log('3. Running bulkImportWorker.processNextJob()...');
  const finalized = await processNextJob('test_worker_1');
  assert.ok(finalized, 'Job claimed and processed');
  assert.strictEqual(finalized.id, job.id);
  assert.strictEqual(finalized.status, 'PARTIAL_SUCCESS');
  assert.strictEqual(finalized.rowsSuccess, 2);
  assert.strictEqual(finalized.rowsFailed, 1);
  assert.ok(finalized.errorCsvUrl, 'errorCsvUrl generated for failed rows');
  console.log('   PASS: Worker processed chunks, isolated row failure, and set PARTIAL_SUCCESS.');

  // Verify students in DB with importJobId
  const students = await prisma.student.findMany({
    where: { importJobId: job.id }
  });
  assert.strictEqual(students.length, 2, '2 valid students inserted');
  assert.ok(students.every(s => s.importJobId === job.id), 'Students have importJobId tag');
  console.log('   PASS: Students created with importJobId.');

  // 4. Test staff import without plaintext passwords
  console.log('4. Testing staff import invitation security invariant...');
  const staffEmail = `staff_${Date.now()}@testcollege.edu`;
  const staffJob = await prisma.bulkImportJob.create({
    data: {
      college_id: college.id,
      importType: 'staff',
      status: 'PENDING',
      totalRows: 1,
      createdById: 'tester'
    }
  });
  await prisma.bulkImportRow.create({
    data: {
      job_id: staffJob.id,
      rowNumber: 1,
      payloadJson: { name: 'Prof Test', email: staffEmail, role: 'teacher' },
      status: 'PENDING'
    }
  });

  const staffFinalized = await processNextJob('test_worker_1');
  assert.strictEqual(staffFinalized.status, 'COMPLETED');

  const staffUser = await prisma.user.findFirst({ where: { email: staffEmail } });
  assert.ok(staffUser, 'Staff user created');
  assert.strictEqual(staffUser.password, null, 'Plaintext password must NOT be set on import');
  assert.strictEqual(staffUser.emailVerified, false, 'emailVerified must be false for pending invite');
  console.log('   PASS: Staff imported securely with null password and pending invite state.');

  // 5. Test Undo Import Job
  console.log('5. Testing undoImportJob rollback...');
  const undoRes = await undoImportJob(job.id, college.id);
  assert.strictEqual(undoRes.deletedCount, 2);

  const remainingStudents = await prisma.student.count({ where: { importJobId: job.id } });
  assert.strictEqual(remainingStudents, 0, 'All students from job deleted on undo');

  const revertedJob = await prisma.bulkImportJob.findUnique({ where: { id: job.id } });
  assert.strictEqual(revertedJob.status, 'REVERTED');
  console.log('   PASS: undoImportJob cleanly rolled back all imported records.');

  // Clean up staff test user and jobs
  await prisma.user.delete({ where: { id: staffUser.id } });
  await prisma.bulkImportRow.deleteMany({ where: { job_id: { in: [job.id, staffJob.id] } } });
  await prisma.bulkImportJob.deleteMany({ where: { id: { in: [job.id, staffJob.id] } } });

  console.log('\n====================================================');
  console.log('ALL SUB-PHASE 8C TESTS PASSED SUCCESSFULLY!');
  console.log('====================================================');

  await prisma.$disconnect();
}

testPhase8C().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});

