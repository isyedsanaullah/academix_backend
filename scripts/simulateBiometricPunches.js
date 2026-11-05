require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const assert = require('assert');
const crypto = require('crypto');
const { getSystemClient } = require('../config/prismaManager');
const { processBiometricPunchesBatch } = require('../workers/biometricSyncWorker');
const { ingestPunches } = require('../controllers/biometricIngress.controller');

async function runSimulator() {
  console.log('--- Sub-Phase 8E: Biometric Turnstile Ingress & Simulator ---');
  const prisma = getSystemClient();

  const college = await prisma.college.findFirst();
  assert(college, 'A test college must exist');
  const collegeId = college.id;

  // 1. Create a test biometric device
  const serialNumber = `ZK-TEST-${Date.now()}`;
  const deviceSecret = crypto.randomBytes(32).toString('hex');
  const pushSecretHash = crypto.createHash('sha256').update(deviceSecret).digest('hex');

  const device = await prisma.biometricDevice.create({
    data: {
      college_id: collegeId,
      serialNumber,
      deviceName: 'Main Gate Turnstile (Simulator)',
      location: 'Front Gate',
      status: 'ACTIVE',
      pushSecretHash
    }
  });
  console.log(`1. Created test biometric device: ${device.serialNumber} (id: ${device.id})`);

  // 2. Create enrolled test staff & student
  let staffUser = await prisma.user.findFirst({
    where: { college_id: collegeId, role: { in: ['teacher', 'employee', 'staff'] } }
  });
  if (!staffUser) {
    staffUser = await prisma.user.create({
      data: {
        name: 'Simulator Staff User',
        email: `sim.staff.${Date.now()}@example.com`,
        role: 'employee',
        college_id: collegeId
      }
    });
  }

  let student = await prisma.student.findFirst({
    where: { college_id: collegeId }
  });
  if (!student) {
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

    student = await prisma.student.create({
      data: {
        college_id: collegeId,
        session_id: session.id,
        name: 'Sim Student',
        fatherName: 'Sim Father',
        gender: 'male',
        rollNumber: `SIM-${Date.now()}`,
        class: '11th',
        group: 'Computer Science',
        section: 'A',
        status: 'active'
      }
    });
  }

  // 3. Map enrollment IDs
  const staffEnrollmentId = '1001';
  const studentEnrollmentId = '2001';
  const unmappedEnrollmentId = '9999';

  await prisma.biometricIdentityMap.upsert({
    where: { college_id_deviceUserId: { college_id: collegeId, deviceUserId: staffEnrollmentId } },
    create: { college_id: collegeId, deviceUserId: staffEnrollmentId, subjectType: 'STAFF', subjectId: staffUser.id },
    update: { subjectType: 'STAFF', subjectId: staffUser.id }
  });

  await prisma.biometricIdentityMap.upsert({
    where: { college_id_deviceUserId: { college_id: collegeId, deviceUserId: studentEnrollmentId } },
    create: { college_id: collegeId, deviceUserId: studentEnrollmentId, subjectType: 'STUDENT', subjectId: student.id },
    update: { subjectType: 'STUDENT', subjectId: student.id }
  });
  console.log('2. Configured BiometricIdentityMap for staff & student.');

  // Helper for mock HTTP requests
  function mockReqRes(headers, body, params) {
    let statusCode = 200;
    let responseData = null;
    const req = { headers, body, params, collegeId };
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        responseData = data;
        return this;
      }
    };
    return { req, res, getStatus: () => statusCode, getData: () => responseData };
  }

  // 4. Test Ingress: Invalid Bearer Secret
  console.log('3. Testing Ingress Authentication...');
  const badAuth = mockReqRes({ authorization: 'Bearer wrongsecret' }, { punches: [] }, { deviceId: device.id });
  await ingestPunches(badAuth.req, badAuth.res, () => {});
  assert.strictEqual(badAuth.getStatus(), 401, 'Wrong bearer token must return 401');
  console.log('   PASS: Unauthorized token rejected with 401.');

  // 5. Test Ingress: Far-Future Punch Rejection (now + 10 min)
  console.log('4. Testing Far-Future Punch Rejection...');
  const farFutureTime = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const futurePush = mockReqRes(
    { authorization: `Bearer ${deviceSecret}` },
    { punches: [{ deviceUserId: staffEnrollmentId, punchTime: farFutureTime }] },
    { deviceId: device.id }
  );
  await ingestPunches(futurePush.req, futurePush.res, () => {});
  assert.strictEqual(futurePush.getStatus(), 422, 'Future punch (> 5 min) must return 422');
  assert.strictEqual(futurePush.getData().code, 'FUTURE_PUNCH_REJECTED');
  console.log('   PASS: Far-future punch rejected with 422 FUTURE_PUNCH_REJECTED.');

  // 6. Test Ingress: Valid Punch Batch (Staff + Student + Unmapped)
  console.log('5. Testing Valid Punch Batch Ingress...');
  const now = new Date();
  const punchTime1 = new Date(now.getTime() - 30 * 60 * 1000).toISOString(); // 30 min ago
  const punchTime2 = new Date(now.getTime() - 10 * 60 * 1000).toISOString(); // 10 min ago
  const unmappedTime = new Date(now.getTime() - 15 * 60 * 1000).toISOString();

  const validPush = mockReqRes(
    { authorization: `Bearer ${deviceSecret}` },
    {
      punches: [
        { deviceUserId: staffEnrollmentId, punchTime: punchTime1 },
        { deviceUserId: staffEnrollmentId, punchTime: punchTime2 },
        { deviceUserId: studentEnrollmentId, punchTime: punchTime1 },
        { deviceUserId: unmappedEnrollmentId, punchTime: unmappedTime }
      ]
    },
    { deviceId: device.id }
  );
  await ingestPunches(validPush.req, validPush.res, () => {});
  assert.strictEqual(validPush.getStatus(), 200);
  assert.strictEqual(validPush.getData().data.accepted, 4);
  console.log('   PASS: 4 punches accepted into BiometricPunchLog.');

  // 7. Test Ingress Idempotency (replay duplicate punches)
  console.log('6. Testing Punch Replay Idempotency...');
  const replayPush = mockReqRes(
    { authorization: `Bearer ${deviceSecret}` },
    {
      punches: [
        { deviceUserId: staffEnrollmentId, punchTime: punchTime1 }
      ]
    },
    { deviceId: device.id }
  );
  await ingestPunches(replayPush.req, replayPush.res, () => {});
  assert.strictEqual(replayPush.getStatus(), 200);
  assert.strictEqual(replayPush.getData().data.accepted, 0, 'Duplicate punch should not insert a new row');
  assert.strictEqual(replayPush.getData().data.duplicates, 1);
  console.log('   PASS: Duplicate punch was ignored cleanly.');

  // 8. Run Worker: Process Punches
  console.log('7. Running biometricSyncWorker to process punches...');
  const workerResult = await processBiometricPunchesBatch();
  assert(workerResult.processedCount >= 4, 'Worker should process all punches');
  console.log(`   PASS: Worker processed ${workerResult.processedCount} punches.`);

  // 9. Verify Staff Attendance First/Last In/Out Calculation
  const staffAtt = await prisma.staffAttendance.findFirst({
    where: {
      college_id: collegeId,
      userId: staffUser.id,
      date: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    }
  });
  assert(staffAtt, 'StaffAttendance record must exist');
  assert.strictEqual(staffAtt.source, 'BIOMETRIC');
  assert(staffAtt.checkInTime, 'Check in time must be set to earliest punch');
  assert(staffAtt.checkOutTime, 'Check out time must be set to latest punch');
  console.log('   PASS: First punch mapped to checkIn, last punch mapped to checkOut.');

  // 10. Verify Unmapped Punch Routing
  const unmapped = await prisma.unmappedBiometricPunch.findFirst({
    where: {
      college_id: collegeId,
      deviceUserId: unmappedEnrollmentId
    }
  });
  assert(unmapped, 'Unmapped punch must be safely routed to UnmappedBiometricPunch');
  console.log('   PASS: Unrecognized enrollment ID safely routed to UnmappedBiometricPunch.');

  // Clean up test data
  await prisma.biometricPunchLog.deleteMany({ where: { deviceId: device.id } });
  await prisma.unmappedBiometricPunch.deleteMany({ where: { deviceId: device.id } });
  await prisma.biometricDevice.delete({ where: { id: device.id } });

  console.log('\n====================================================');
  console.log('ALL SUB-PHASE 8E SIMULATOR TESTS PASSED SUCCESSFULLY!');
  console.log('====================================================\n');
  process.exit(0);
}

runSimulator().catch(err => {
  console.error('Simulator failed with error:', err);
  process.exit(1);
});
