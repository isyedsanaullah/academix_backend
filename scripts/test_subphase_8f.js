require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const assert = require('assert');
const { getSystemClient } = require('../config/prismaManager');
const { sendMessage, activeDrivers } = require('../services/messagingAdapter');
const { calculateTotal, submitPaymentProof } = require('../controllers/subscription.controller');
const { FEATURE_REGISTRY } = require('../config/featureRegistry');

async function runTests() {
  console.log('--- Testing Sub-Phase 8F: Messaging Layer Foundation & Guardian Notification Feed ---');
  const prisma = getSystemClient();

  const college = await prisma.college.findFirst();
  assert(college, 'A test college must exist');
  const collegeId = college.id;

  const student = await prisma.student.findFirst({ where: { college_id: collegeId } });
  assert(student, 'A test student must exist');

  const user = await prisma.user.findFirst({ where: { college_id: collegeId } });
  assert(user, 'A test user must exist');

  // 1. Driver interface & isReal flag
  console.log('1. Testing Driver interface & isReal flag...');
  assert.strictEqual(activeDrivers.IN_APP.isReal, false, 'InAppMessagingDriver must have isReal === false');
  console.log('   PASS: InAppMessagingDriver.isReal is false.');

  // 2. In-App Message to Guardian
  console.log('2. Testing In-App Message to GUARDIAN recipient...');
  const guardianMsg = await sendMessage({
    collegeId,
    recipient: { type: 'GUARDIAN', studentId: student.id },
    title: 'Absence Notice',
    body: 'Your child was marked absent today.',
    kind: 'ABSENCE'
  });
  assert.strictEqual(guardianMsg.success, true);
  assert.strictEqual(guardianMsg.channel, 'IN_APP');
  assert.strictEqual(guardianMsg.costCredits, 0, 'In-app notification must cost 0 credits');

  const gnRecord = await prisma.guardianNotification.findUnique({
    where: { id: guardianMsg.id }
  });
  assert(gnRecord, 'GuardianNotification row must exist in DB');
  assert.strictEqual(gnRecord.student_id, student.id);
  assert.strictEqual(gnRecord.kind, 'ABSENCE');
  console.log('   PASS: GuardianNotification delivered at 0 credits.');

  // 3. In-App Message to User
  console.log('3. Testing In-App Message to USER recipient...');
  const userMsg = await sendMessage({
    collegeId,
    recipient: { type: 'USER', userId: user.id },
    title: 'System Notice',
    body: 'You have a new task assigned.',
    kind: 'TASK'
  });
  assert.strictEqual(userMsg.success, true);
  assert.strictEqual(userMsg.costCredits, 0);
  console.log('   PASS: User notification delivered at 0 credits.');

  // 4. Unavailable External Channels
  console.log('4. Testing Channel Availability Guards (SMS / WHATSAPP)...');
  try {
    await sendMessage({
      collegeId,
      recipient: { type: 'GUARDIAN', studentId: student.id },
      channel: 'SMS',
      body: 'Test SMS'
    });
    assert.fail('SMS should have thrown CHANNEL_NOT_AVAILABLE');
  } catch (err) {
    assert.strictEqual(err.code, 'CHANNEL_NOT_AVAILABLE');
    console.log('   PASS: SMS channel rejected with CHANNEL_NOT_AVAILABLE.');
  }

  // 5. Server-Side Rejection of Message Packs in calculateTotal and submitPayment
  console.log('5. Testing Rejection of Message Packs before payment...');
  function mockReqRes(body) {
    let statusCode = 200;
    let responseData = null;
    const req = { body, collegeId, user: { college_id: collegeId } };
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

  // calculateTotal rejection
  const calcMock = mockReqRes({
    type: 'ADDON_ORDER',
    lineItems: [{ addonType: 'SMS_PACK_500', quantity: 1 }]
  });
  await calculateTotal(calcMock.req, calcMock.res);
  assert.strictEqual(calcMock.getStatus(), 422, 'calculateTotal must return 422 for unpurchasable SMS pack');
  assert.strictEqual(calcMock.getData().code, 'ITEM_NOT_PURCHASABLE');
  console.log('   PASS: calculateTotal rejected unpurchasable pack with 422 ITEM_NOT_PURCHASABLE.');

  // submitPayment rejection
  const submitMock = mockReqRes({
    type: 'ADDON_ORDER',
    lineItems: [{ addonType: 'SMS_PACK_500', quantity: 1 }],
    paymentMethod: 'Bank Transfer',
    transactionId: `TXN-${Date.now()}`,
    screenshotUrl: 'https://example.com/proof.jpg'
  });
  await submitPaymentProof(submitMock.req, submitMock.res);
  assert.strictEqual(submitMock.getStatus(), 422, 'submitPayment must return 422 for unpurchasable SMS pack');
  assert.strictEqual(submitMock.getData().code, 'ITEM_NOT_PURCHASABLE');
  console.log('   PASS: submitPayment rejected unpurchasable pack with 422 ITEM_NOT_PURCHASABLE.');

  // 6. Registry Status: #84 and #85 remain coming_soon
  console.log('6. Testing Feature Registry for #84 and #85...');
  const f84 = FEATURE_REGISTRY.find(f => f.id === '#84');
  const f85 = FEATURE_REGISTRY.find(f => f.id === '#85');
  assert(f84 && f84.status === 'coming_soon', '#84 must remain coming_soon');
  assert(f85 && f85.status === 'coming_soon', '#85 must remain coming_soon');
  console.log('   PASS: #84 and #85 verified as coming_soon.');

  // Cleanup test notification
  await prisma.guardianNotification.delete({ where: { id: guardianMsg.id } });

  console.log('\n====================================================');
  console.log('ALL SUB-PHASE 8F TESTS PASSED SUCCESSFULLY!');
  console.log('====================================================\n');
  process.exit(0);
}

runTests().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});

