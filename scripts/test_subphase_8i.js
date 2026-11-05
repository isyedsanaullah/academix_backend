require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const assert = require('assert');
const { getSystemClient } = require('../config/prismaManager');
const {
  isTimeEligible,
  dispatchAbsenceAlertsForCollege
} = require('../workers/absenceAlertWorker');

async function runTests() {
  console.log('--- Testing Sub-Phase 8I: #86 Absence Alerts to Guardians ---');
  const prisma = getSystemClient();

  const college = await prisma.college.findFirst({
    where: { subStatus: 'ACTIVE' }
  });
  assert(college, 'A test college must exist');
  const originalPlan = college.planId;
  await prisma.college.update({
    where: { id: college.id },
    data: { planId: 'premium' }
  });
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

  // 1. Test Time Eligibility
  console.log('1. Testing time window eligibility calculation...');
  // 10:00 PKT (05:00 UTC) -> inside 09:00 to 14:00 window
  const tenAmPkt = new Date('2026-11-15T05:00:00.000Z');
  assert.strictEqual(isTimeEligible(tenAmPkt, '09:00', '14:00'), true);

  // 08:30 PKT (03:30 UTC) -> before 09:00 window
  const eightThirtyPkt = new Date('2026-11-15T03:30:00.000Z');
  assert.strictEqual(isTimeEligible(eightThirtyPkt, '09:00', '14:00'), false);

  // 14:30 PKT (09:30 UTC) -> after 14:00 cutoff
  const twoThirtyPkt = new Date('2026-11-15T09:30:00.000Z');
  assert.strictEqual(isTimeEligible(twoThirtyPkt, '09:00', '14:00'), false);
  console.log('   PASS: Time window and cutoff logic verified.');

  // 2. Setup Student & Guardian Session
  const testDate = new Date('2026-11-16T00:00:00.000Z'); // Monday (working day)

  let student1 = await prisma.student.findFirst({
    where: { college_id: collegeId, status: 'active' }
  });
  if (!student1) {
    student1 = await prisma.student.create({
      data: {
        college_id: collegeId,
        session_id: session.id,
        name: 'Absence Test Student',
        fatherName: 'Father',
        gender: 'male',
        rollNumber: `ABS-${Date.now()}`,
        class: '11th',
        group: 'Pre-Medical',
        section: 'A',
        status: 'active'
      }
    });
  }

  // Ensure student1 has active guardian session
  await prisma.guardianSession.upsert({
    where: { college_id_studentId: { college_id: collegeId, studentId: student1.id } },
    create: {
      college_id: collegeId,
      studentId: student1.id,
      pinHash: 'hashedpin',
      isActive: true
    },
    update: { isActive: true }
  });

  // Clean old logs
  await prisma.absenceAlertLog.deleteMany({
    where: { college_id: collegeId, studentId: student1.id, alertDate: testDate }
  });
  await prisma.attendance.deleteMany({
    where: { college_id: collegeId, student_id: student1.id, date: testDate }
  });
  await prisma.college.update({
    where: { id: collegeId },
    data: { planId: originalPlan }
  });

  // Mark student absent on testDate
  await prisma.attendance.create({
    data: {
      college_id: collegeId,
      session_id: session.id,
      student_id: student1.id,
      date: testDate,
      status: 'absent'
    }
  });

  // 3. Dispatch Absence Alerts
  console.log('2. Testing Absence Alert Dispatch (Atomic Log + Guardian Notification)...');
  const res1 = await dispatchAbsenceAlertsForCollege(collegeId, {
    date: testDate,
    forceTime: true
  });
  console.log('res1 result:', res1);
  assert.strictEqual(res1.success, true);
  assert(res1.dispatchedCount >= 1, 'At least 1 alert must be dispatched');

  // Verify AbsenceAlertLog row exists
  const alertLog = await prisma.absenceAlertLog.findUnique({
    where: {
      college_id_studentId_alertDate: {
        college_id: collegeId,
        studentId: student1.id,
        alertDate: testDate
      }
    }
  });
  assert(alertLog, 'AbsenceAlertLog must be created');

  // Verify GuardianNotification exists
  const gNotif = await prisma.guardianNotification.findFirst({
    where: {
      college_id: collegeId,
      student_id: student1.id,
      kind: 'ABSENCE'
    },
    orderBy: { createdAt: 'desc' }
  });
  assert(gNotif, 'GuardianNotification must be inserted');
  assert(!gNotif.title.includes('SMS') && !gNotif.title.includes('WhatsApp'), 'In-app notification must not have misleading tags');
  console.log('   PASS: Absence alert dispatched atomically.');

  // 4. Test Idempotency: Second Dispatch Tick on Same Day
  console.log('3. Testing Idempotency on Second Tick...');
  const res2 = await dispatchAbsenceAlertsForCollege(collegeId, {
    date: testDate,
    forceTime: true
  });
  assert.strictEqual(res2.dispatchedCount, 0, 'No duplicate alerts should be dispatched on next tick');
  console.log('   PASS: Duplicate alert skipped cleanly.');

  // Clean test records
  await prisma.absenceAlertLog.deleteMany({
    where: { college_id: collegeId, studentId: student1.id, alertDate: testDate }
  });
  await prisma.guardianNotification.deleteMany({
    where: { college_id: collegeId, student_id: student1.id, kind: 'ABSENCE' }
  });
  await prisma.attendance.deleteMany({
    where: { college_id: collegeId, student_id: student1.id, date: testDate }
  });
  await prisma.college.update({
    where: { id: collegeId },
    data: { planId: originalPlan }
  });

  console.log('\n====================================================');
  console.log('ALL SUB-PHASE 8I TESTS PASSED SUCCESSFULLY!');
  console.log('====================================================\n');
  process.exit(0);
}

runTests().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
