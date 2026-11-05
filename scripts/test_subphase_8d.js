require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const assert = require('assert');
const { getSystemClient } = require('../config/prismaManager');
const {
  calculateCheckInStatus,
  recordStaffAttendance,
  getStaffAttendance,
  isStaffOnLeave,
  SOURCE_PRIORITY
} = require('../services/staffAttendanceService');
const { processDailyStaffAbsentees } = require('../workers/staffAbsenteeWorker');

async function runTests() {
  console.log('--- Testing Sub-Phase 8D: #80 Staff Attendance & Leave Integration ---');
  const prisma = getSystemClient();

  const college = await prisma.college.findFirst();
  assert(college, 'A test college must exist');
  const collegeId = college.id;

  // Find a test user (teacher/employee)
  let staffUser = await prisma.user.findFirst({
    where: { college_id: collegeId, role: { in: ['teacher', 'employee', 'staff'] } }
  });
  if (!staffUser) {
    staffUser = await prisma.user.create({
      data: {
        name: 'Test Staff Attendance User',
        email: `staff.test.${Date.now()}@example.com`,
        role: 'employee',
        college_id: collegeId
      }
    });
  }

  const testDate = new Date('2026-11-15T00:00:00.000Z');

  // Clean any old test records for this date
  await prisma.staffAttendance.deleteMany({
    where: { college_id: collegeId, date: testDate }
  });
  await prisma.staffLeave.deleteMany({
    where: { college_id: collegeId, user_id: staffUser.id }
  });

  // 1. Shift, Grace and Half-Day Threshold Calculations
  console.log('1. Testing shift, grace and half-day boundary calculations...');
  const settings = {
    'staff.shiftStartTime': '08:00',
    'staff.graceMinutes': 15,
    'staff.halfDayAfterMinutes': 120
  };

  // Exactly at grace boundary (08:15 PKT -> 03:15 UTC)
  const atGrace = new Date('2026-11-15T03:15:00.000Z');
  const resGrace = calculateCheckInStatus(atGrace, settings);
  assert.strictEqual(resGrace.status, 'PRESENT', 'At grace boundary must be PRESENT');
  assert.strictEqual(resGrace.minutesLate, 0, 'At grace boundary minutesLate must be 0');

  // 1 minute after grace (08:16 PKT -> 03:16 UTC)
  const afterGrace = new Date('2026-11-15T03:16:00.000Z');
  const resAfterGrace = calculateCheckInStatus(afterGrace, settings);
  assert.strictEqual(resAfterGrace.status, 'LATE', '1 min after grace must be LATE');
  assert.strictEqual(resAfterGrace.minutesLate, 16, 'minutesLate must be 16');

  // Exactly at half-day threshold (10:00 PKT -> 05:00 UTC)
  const atHalfDay = new Date('2026-11-15T05:00:00.000Z');
  const resAtHalfDay = calculateCheckInStatus(atHalfDay, settings);
  assert.strictEqual(resAtHalfDay.status, 'LATE', 'At half-day threshold must be LATE');
  assert.strictEqual(resAtHalfDay.minutesLate, 120, 'minutesLate must be 120');

  // 1 minute after half-day threshold (10:01 PKT -> 05:01 UTC)
  const afterHalfDay = new Date('2026-11-15T05:01:00.000Z');
  const resAfterHalfDay = calculateCheckInStatus(afterHalfDay, settings);
  assert.strictEqual(resAfterHalfDay.status, 'HALF_DAY', 'After half-day threshold must be HALF_DAY');
  assert.strictEqual(resAfterHalfDay.minutesLate, 121, 'minutesLate must be 121');
  console.log('   PASS: Exact shift, grace and half-day thresholds verified.');

  // 2. Source Priority Hierarchy
  console.log('2. Testing Source Priority Hierarchy (MANUAL > BIOMETRIC > GATE_QR > SYSTEM)...');
  
  // Step 2a: Write low-priority SYSTEM record
  const sysRecord = await recordStaffAttendance({
    collegeId,
    userId: staffUser.id,
    date: testDate,
    status: 'ABSENT',
    source: 'SYSTEM'
  });
  assert.strictEqual(sysRecord.source, 'SYSTEM');
  assert.strictEqual(sysRecord.status, 'ABSENT');

  // Step 2b: Higher-priority BIOMETRIC punch overwrites SYSTEM
  const bioRecord = await recordStaffAttendance({
    collegeId,
    userId: staffUser.id,
    date: testDate,
    checkInTime: atGrace,
    source: 'BIOMETRIC'
  });
  assert.strictEqual(bioRecord.source, 'BIOMETRIC', 'BIOMETRIC must overwrite SYSTEM');
  assert.strictEqual(bioRecord.status, 'PRESENT');

  // Step 2c: Higher-priority MANUAL mark overwrites BIOMETRIC
  const manRecord = await recordStaffAttendance({
    collegeId,
    userId: staffUser.id,
    date: testDate,
    status: 'LATE',
    minutesLate: 25,
    source: 'MANUAL',
    markedById: staffUser.id
  });
  assert.strictEqual(manRecord.source, 'MANUAL', 'MANUAL must overwrite BIOMETRIC');
  assert.strictEqual(manRecord.status, 'LATE');

  // Step 2d: Lower-priority BIOMETRIC attempt cannot overwrite MANUAL
  const bioAttempt = await recordStaffAttendance({
    collegeId,
    userId: staffUser.id,
    date: testDate,
    checkInTime: afterHalfDay,
    status: 'HALF_DAY',
    source: 'BIOMETRIC'
  });
  assert.strictEqual(bioAttempt.source, 'MANUAL', 'Lower-priority BIOMETRIC must NOT overwrite MANUAL');
  assert.strictEqual(bioAttempt.status, 'LATE', 'MANUAL status must remain intact');
  console.log('   PASS: Source priority hierarchy verified in both directions.');

  // 3. Live ON_LEAVE Derivation
  console.log('3. Testing Live ON_LEAVE derivation...');
  // Create approved StaffLeave
  await prisma.staffLeave.create({
    data: {
      college_id: collegeId,
      user_id: staffUser.id,
      leaveType: 'CASUAL',
      startDate: testDate,
      endDate: testDate,
      status: 'APPROVED'
    }
  });

  const onLeaveCheck = await isStaffOnLeave(prisma, collegeId, staffUser.id, testDate);
  assert.strictEqual(onLeaveCheck, true, 'Staff must be recognized on leave');

  const attendanceList = await getStaffAttendance({
    collegeId,
    date: testDate,
    userId: staffUser.id
  });
  assert.strictEqual(attendanceList.length, 1);
  assert.strictEqual(attendanceList[0].status, 'ON_LEAVE', 'Returned status must be derived live as ON_LEAVE');
  console.log('   PASS: ON_LEAVE derived live at read time.');

  // 4. Audit Log for Manual Edits
  console.log('4. Testing AuditLog emission for manual edits...');
  const auditLogs = await prisma.auditLog.findMany({
    where: {
      college_id: collegeId,
      action: 'STAFF_ATTENDANCE_EDIT'
    },
    take: 1,
    orderBy: { createdAt: 'desc' }
  });
  assert(auditLogs.length > 0, 'AuditLog entry must be recorded for manual attendance mark');
  console.log('   PASS: AuditLog verified.');

  // 5. Cleanup test data
  await prisma.staffAttendance.deleteMany({
    where: { college_id: collegeId, date: testDate }
  });
  await prisma.staffLeave.deleteMany({
    where: { college_id: collegeId, user_id: staffUser.id }
  });

  console.log('\n====================================================');
  console.log('ALL SUB-PHASE 8D TESTS PASSED SUCCESSFULLY!');
  console.log('====================================================\n');
  process.exit(0);
}

runTests().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});

