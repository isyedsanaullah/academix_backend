require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const assert = require('assert');
const { getSystemClient } = require('../config/prismaManager');
const { calculateStudentAttendance } = require('../services/attendanceCalculationService');
const { runShortageScannerForCollege } = require('../workers/attendanceShortageScannerWorker');

async function runTests() {
  console.log('--- Testing Sub-Phase 8H: #81 Attendance Shortage Scanner ---');
  const prisma = getSystemClient();

  const college = await prisma.college.findFirst({
    where: {
      planId: { in: ['standard', 'premium', 'enterprise'] },
      subStatus: 'ACTIVE'
    }
  });
  assert(college, 'A test college with standard+ plan must exist');
  const collegeId = college.id;

  let session = await prisma.session.findFirst({ where: { college_id: collegeId } });
  if (!session) {
    session = await prisma.session.create({
      data: {
        college_id: collegeId,
        name: '2026-2027',
        startDate: new Date('2026-08-01'),
        endDate: new Date('2027-06-30')
      }
    });
  }

  // Find or create test student
  let student = await prisma.student.findFirst({
    where: { college_id: collegeId, status: 'active' }
  });
  if (!student) {
    student = await prisma.student.create({
      data: {
        college_id: collegeId,
        session_id: session.id,
        name: 'Shortage Test Student',
        fatherName: 'Father',
        gender: 'male',
        rollNumber: `SHORT-${Date.now()}`,
        class: '11th',
        group: 'Pre-Medical',
        section: 'A',
        status: 'active'
      }
    });
  }

  // Clean any old test records for this student
  await prisma.attendanceShortageNotice.deleteMany({
    where: { college_id: collegeId, studentId: student.id }
  });
  await prisma.attendance.deleteMany({
    where: { college_id: collegeId, student_id: student.id }
  });

  // 1. Test calculation service
  console.log('1. Testing attendance calculation service (#41 / #81 shared logic)...');
  // Add 10 attendance records: 6 present, 1 late (0.5), 2 absent, 1 leave (excluded)
  const d0 = new Date('2026-10-01');
  const records = [
    { status: 'present' },
    { status: 'present' },
    { status: 'present' },
    { status: 'present' },
    { status: 'present' },
    { status: 'present' },
    { status: 'late' },
    { status: 'absent' },
    { status: 'absent' },
    { status: 'leave' } // Excluded from marked instructional days
  ];

  for (let i = 0; i < records.length; i++) {
    const d = new Date(d0.getTime() + i * 24 * 60 * 60 * 1000);
    await prisma.attendance.create({
      data: {
        college_id: collegeId,
        session_id: session.id,
        student_id: student.id,
        date: d,
        status: records[i].status
      }
    });
  }

  const calc = await calculateStudentAttendance(collegeId, student.id, { sessionId: session.id });
  // markedDays = 9 (present: 6, late: 1, absent: 2)
  // attendedDays = 6 + 0.5 = 6.5
  // percent = (6.5 / 9) * 100 = 72.22%
  assert.strictEqual(calc.markedDays, 9, 'markedDays should exclude status leave');
  assert.strictEqual(calc.attendancePercent, 72.22, 'attendancePercent should be 72.22%');
  console.log(`   PASS: Attendance calculated: ${calc.attendancePercent}% over ${calc.markedDays} marked days.`);

  // 2. Test Scanner Worker Run 1: Notice Issuance
  console.log('2. Testing Shortage Scanner Worker Run 1 (Notice Issuance)...');
  const run1Key = `TEST_RUN_1_${Date.now()}`;
  const scan1 = await runShortageScannerForCollege(collegeId, {
    runKey: run1Key,
    thresholdOverride: 75.0
  });
  assert.strictEqual(scan1.success, true);
  assert(scan1.noticesIssued >= 1, 'Should issue at least 1 notice for student at 72.22%');

  const notice1 = await prisma.attendanceShortageNotice.findUnique({
    where: {
      college_id_studentId_termKey: {
        college_id: collegeId,
        studentId: student.id,
        termKey: session.id
      }
    }
  });
  assert(notice1, 'Notice row must be created');
  assert.strictEqual(notice1.status, 'ISSUED');
  assert.strictEqual(Number(notice1.attendancePercent), 72.22);
  assert.strictEqual(notice1.notifyCount, 1);
  console.log('   PASS: Shortage notice issued and guardian notified.');

  // 3. Test Scanner Run 2: Double-run with same runKey skips cleanly (JobRunLog claim)
  console.log('3. Testing Double Run Idempotency with same runKey...');
  const scan2 = await runShortageScannerForCollege(collegeId, {
    runKey: run1Key,
    thresholdOverride: 75.0
  });
  assert.strictEqual(scan2.skipped, true);
  assert.strictEqual(scan2.reason, 'ALREADY_RAN');
  console.log('   PASS: Double run skipped with ALREADY_RAN.');

  // 4. Test Preserving ACKNOWLEDGED Status and Silent Update
  console.log('4. Testing Acknowledged state preservation and silent update on minor change...');
  await prisma.attendanceShortageNotice.update({
    where: { id: notice1.id },
    data: { status: 'ACKNOWLEDGED' }
  });

  // Run next period without worsening drop (72.22% is unchanged)
  const run2Key = `TEST_RUN_2_${Date.now()}`;
  const scan3 = await runShortageScannerForCollege(collegeId, {
    runKey: run2Key,
    thresholdOverride: 75.0
  });
  const notice2 = await prisma.attendanceShortageNotice.findUnique({
    where: { id: notice1.id }
  });
  assert.strictEqual(notice2.status, 'ACKNOWLEDGED', 'ACKNOWLEDGED status must be preserved');
  assert.strictEqual(notice2.notifyCount, 1, 'Notify count must NOT increment without worsening drop');
  console.log('   PASS: ACKNOWLEDGED state preserved; silent update did not spam guardian.');

  // 5. Test Re-notification on Significant Drop (>= 5.0 points)
  console.log('5. Testing Re-notification on Significant Drop (>= 5.0 points)...');
  // Add 3 more absent days to drop attendance below 67%
  for (let i = 10; i < 13; i++) {
    const d = new Date(d0.getTime() + i * 24 * 60 * 60 * 1000);
    await prisma.attendance.create({
      data: {
        college_id: collegeId,
        session_id: session.id,
        student_id: student.id,
        date: d,
        status: 'absent'
      }
    });
  }

  const run3Key = `TEST_RUN_3_${Date.now()}`;
  await runShortageScannerForCollege(collegeId, {
    runKey: run3Key,
    thresholdOverride: 75.0
  });

  const notice3 = await prisma.attendanceShortageNotice.findUnique({
    where: { id: notice1.id }
  });
  assert(Number(notice3.attendancePercent) <= 67.0, 'Attendance should have dropped');
  assert.strictEqual(notice3.notifyCount, 2, 'Notify count must increment to 2 on >= 5% drop');
  console.log(`   PASS: Notice re-notified: drop recognized, notifyCount incremented to ${notice3.notifyCount}.`);

  // 6. Test Auto-Resolution when Attendance Recovers
  console.log('6. Testing Auto-Resolution when Attendance Recovers Above Threshold...');
  // Add 15 present days to bring attendance well above 75%
  for (let i = 13; i < 28; i++) {
    const d = new Date(d0.getTime() + i * 24 * 60 * 60 * 1000);
    await prisma.attendance.create({
      data: {
        college_id: collegeId,
        session_id: session.id,
        student_id: student.id,
        date: d,
        status: 'present'
      }
    });
  }

  const run4Key = `TEST_RUN_4_${Date.now()}`;
  await runShortageScannerForCollege(collegeId, {
    runKey: run4Key,
    thresholdOverride: 75.0
  });

  const notice4 = await prisma.attendanceShortageNotice.findUnique({
    where: { id: notice1.id }
  });
  assert.strictEqual(notice4.status, 'RESOLVED', 'Notice must auto-resolve to RESOLVED when attendance >= 75%');
  console.log('   PASS: Notice auto-resolved to RESOLVED when attendance recovered.');

  // Clean up test records
  await prisma.attendanceShortageNotice.deleteMany({
    where: { college_id: collegeId, studentId: student.id }
  });
  await prisma.attendance.deleteMany({
    where: { college_id: collegeId, student_id: student.id }
  });
  await prisma.jobRunLog.deleteMany({
    where: { college_id: collegeId, runKey: { in: [run1Key, run2Key, run3Key, run4Key] } }
  });

  console.log('\n====================================================');
  console.log('ALL SUB-PHASE 8H TESTS PASSED SUCCESSFULLY!');
  console.log('====================================================\n');
  process.exit(0);
}

runTests().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
