require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const assert = require('assert');
const { getSystemClient } = require('../config/prismaManager');
const {
  generateGuardianPin,
  hashGuardianPin,
  compareGuardianPin
} = require('../utils/guardianPinGenerator');
const { login, issueSinglePin } = require('../controllers/parentPortal.controller');
const { guardianProtect } = require('../middleware/guardianAuth.middleware');

async function runTests() {
  console.log('--- Testing Sub-Phase 8G: #83 Parent Portal Mobile App Engine ---');
  const prisma = getSystemClient();

  const college = await prisma.college.findFirst();
  assert(college, 'A test college must exist');
  const collegeId = college.id;

  const student = await prisma.student.findFirst({
    where: { college_id: collegeId, status: 'active' }
  });
  assert(student, 'A test active student must exist');

  // Helper for mock HTTP requests
  function mockReqRes(body, headers = {}, params = {}) {
    let statusCode = 200;
    let responseData = null;
    let headerMap = {};
    const req = {
      body,
      headers,
      params,
      collegeId,
      user: { id: 'test-admin', college_id: collegeId }
    };
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        responseData = data;
        return this;
      },
      set(key, val) {
        headerMap[key] = val;
        return this;
      }
    };
    return { req, res, getStatus: () => statusCode, getData: () => responseData };
  }

  // 1. PIN Generator: 8-char unambiguous alphabet
  console.log('1. Testing 8-character PIN generator & bcrypt hashing...');
  const pin = generateGuardianPin();
  assert.strictEqual(pin.length, 8, 'PIN must be exactly 8 characters long');
  assert(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/.test(pin), 'PIN must use unambiguous alphabet');

  const hashed = await hashGuardianPin(pin);
  const match = await compareGuardianPin(pin, hashed);
  assert.strictEqual(match, true, 'bcrypt compare must match generated PIN');
  console.log(`   PASS: Generated PIN "${pin}" verified with bcrypt.`);

  // 2. Issue PIN for test student
  console.log('2. Testing Admin PIN issuance...');
  const issueMock = mockReqRes({ studentId: student.id });
  await issueSinglePin(issueMock.req, issueMock.res, () => {});
  assert.strictEqual(issueMock.getStatus(), 200);
  const issuedData = issueMock.getData().data;
  assert(issuedData.guardianPin, 'Plaintext PIN returned once on issue');
  const activePin = issuedData.guardianPin;
  console.log('   PASS: Admin issued single PIN successfully.');

  // 3. Test Login Success
  console.log('3. Testing Parent Portal Login with valid rollNumber and PIN...');
  const loginSuccessMock = mockReqRes({
    collegeId,
    rollNumber: student.rollNumber,
    pin: activePin
  });
  await login(loginSuccessMock.req, loginSuccessMock.res, () => {});
  assert.strictEqual(loginSuccessMock.getStatus(), 200, 'Login must succeed with 200');
  const sessionToken = loginSuccessMock.getData().data.token;
  assert(sessionToken, 'Login must issue bearer session token');
  console.log('   PASS: Parent login succeeded and issued session token.');

  // 4. Test Login Failure & Generic Error Message
  console.log('4. Testing Login Failure & Generic Error Message...');
  const loginFailMock = mockReqRes({
    collegeId,
    rollNumber: student.rollNumber,
    pin: 'WRONGPIN'
  });
  await login(loginFailMock.req, loginFailMock.res, () => {});
  assert.strictEqual(loginFailMock.getStatus(), 401);
  assert.strictEqual(loginFailMock.getData().message, 'Invalid roll number or PIN');
  console.log('   PASS: Generic error message returned on wrong PIN.');

  // 5. Test 5-Attempt Lockout
  console.log('5. Testing 5-Attempt Account Lockout...');
  for (let i = 0; i < 4; i++) {
    const fMock = mockReqRes({ collegeId, rollNumber: student.rollNumber, pin: 'WRONGPIN' });
    await login(fMock.req, fMock.res, () => {});
  }
  const sessionAfterFails = await prisma.guardianSession.findUnique({
    where: { college_id_studentId: { college_id: collegeId, studentId: student.id } }
  });
  assert(sessionAfterFails.lockedUntil !== null, 'Account must be locked out after 5 failures');
  console.log('   PASS: Account locked until: ' + sessionAfterFails.lockedUntil.toISOString());

  // 6. Test Middleware with Valid Token
  console.log('6. Testing Guardian Middleware authorization...');
  const authMock = mockReqRes({}, { authorization: `Bearer ${sessionToken}` });
  let nextCalled = false;
  await guardianProtect(authMock.req, authMock.res, () => { nextCalled = true; });
  assert.strictEqual(nextCalled, true, 'Valid token must pass through guardianProtect');
  assert.strictEqual(authMock.req.studentId, student.id, 'req.studentId must be set to session student');
  console.log('   PASS: Guardian protected route verified.');

  // 7. Test tokenEpoch Invalidation
  console.log('7. Testing tokenEpoch invalidation...');
  // Bump college tokenEpoch
  await prisma.college.update({
    where: { id: collegeId },
    data: { tokenEpoch: { increment: 1 } }
  });
  const epochMock = mockReqRes({}, { authorization: `Bearer ${sessionToken}` });
  await guardianProtect(epochMock.req, epochMock.res, () => {});
  assert.strictEqual(epochMock.getStatus(), 401, 'Bumping college tokenEpoch must revoke older tokens');
  assert.strictEqual(epochMock.getData().code, 'TOKEN_EPOCH_EXPIRED');
  console.log('   PASS: Security state change invalidated old session tokens.');

  // Restore tokenEpoch and reset lockout
  await prisma.college.update({
    where: { id: collegeId },
    data: { tokenEpoch: { decrement: 1 } }
  });
  await prisma.guardianSession.update({
    where: { id: sessionAfterFails.id },
    data: { failedAttempts: 0, lockedUntil: null }
  });

  // Clean up test token
  await prisma.guardianToken.deleteMany({ where: { sessionId: sessionAfterFails.id } });

  console.log('\n====================================================');
  console.log('ALL SUB-PHASE 8G TESTS PASSED SUCCESSFULLY!');
  console.log('====================================================\n');
  process.exit(0);
}

runTests().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
