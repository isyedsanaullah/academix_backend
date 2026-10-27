'use strict';

require('dotenv').config();
const assert = require('assert');
const crypto = require('crypto');
const { getSystemClient, closeAllClients } = require('../config/prismaManager');
const {
  validateTransition,
  transitionRequestStatus,
  addRequestNote
} = require('../services/subscriptionRequestTransition');

async function testPhase1() {
  console.log('🧪 Starting Phase 1 Unit Tests & Acceptance Validation...\n');

  // 1. Test Status Machine Rules (Pure Logic)
  console.log('--- 1. Testing Status Transition Validation Logic ---');

  // Allowed from new
  assert.strictEqual(validateTransition('new', 'contacted').allowed, true);
  assert.strictEqual(validateTransition('new', 'rejected').allowed, true);

  // Invalid from new
  const newToApproved = validateTransition('new', 'approved');
  assert.strictEqual(newToApproved.allowed, false);
  assert.strictEqual(newToApproved.status, 409, 'Invalid transition must return 409');

  // Allowed from contacted
  assert.strictEqual(validateTransition('contacted', 'rejected').allowed, true);
  assert.strictEqual(validateTransition('contacted', 'approved').allowed, true);

  // Invalid from contacted
  const contactedToNew = validateTransition('contacted', 'new');
  assert.strictEqual(contactedToNew.allowed, false);
  assert.strictEqual(contactedToNew.status, 409);

  // Re-opening rejected requires note
  const rejectToContactNoNote = validateTransition('rejected', 'contacted');
  assert.strictEqual(rejectToContactNoNote.allowed, false);
  assert.strictEqual(rejectToContactNoNote.status, 400, 'Re-opening without note must return 400');

  const rejectToContactWithNote = validateTransition('rejected', 'contacted', 'Spoke to principal, re-evaluating.');
  assert.strictEqual(rejectToContactWithNote.allowed, true);

  // Approved is terminal
  const approvedToAny = validateTransition('approved', 'contacted');
  assert.strictEqual(approvedToAny.allowed, false);
  assert.strictEqual(approvedToAny.status, 409);

  // Idempotency check
  const idempotentCheck = validateTransition('contacted', 'contacted');
  assert.strictEqual(idempotentCheck.allowed, true);
  assert.strictEqual(idempotentCheck.idempotent, true);

  console.log('  ✓ Status transition machine validated successfully.');

  // 2. Database Integration & Idempotency Tests
  console.log('\n--- 2. Testing Database State Transitions & Events ---');
  const prisma = getSystemClient();

  const testId = crypto.randomUUID();
  const dummyActor = {
    id: 'super-admin-test-id',
    name: 'Super Admin Test',
    email: 'superadmin@collegeshub.org'
  };

  // Create a test subscription request
  const testRequest = await prisma.subscriptionRequest.create({
    data: {
      id: testId,
      collegeName: 'Phase 1 Test Institute',
      adminEmail: `test-${Date.now()}@testinstitute.edu.pk`,
      phone: '0300-1112233',
      selectedPlan: 'standard',
      studentCount: 350,
      status: 'new'
    }
  });
  console.log(`  ✓ Created test subscription request [${testId}].`);

  // Transition new -> contacted
  const contactRes = await transitionRequestStatus({
    requestId: testId,
    targetStatus: 'contacted',
    actorUser: dummyActor,
    note: 'Initial phone call made.'
  });
  assert.strictEqual(contactRes.request.status, 'contacted');
  assert.ok(contactRes.event, 'Timeline event must be recorded');
  assert.strictEqual(contactRes.event.type, 'status_contacted');
  assert.strictEqual(contactRes.event.from_status, 'new');
  assert.strictEqual(contactRes.event.to_status, 'contacted');
  console.log('  ✓ Transitioned new -> contacted with timeline event.');

  // Double-click idempotency: transition to contacted again
  const doubleClickRes = await transitionRequestStatus({
    requestId: testId,
    targetStatus: 'contacted',
    actorUser: dummyActor
  });
  assert.strictEqual(doubleClickRes.idempotent, true, 'Double-click must be detected as idempotent');
  assert.strictEqual(doubleClickRes.event, undefined, 'No duplicate event created on double-click');
  console.log('  ✓ Double-click idempotency verified (zero duplicate events).');

  // Add internal note
  const noteRes = await addRequestNote({
    requestId: testId,
    note: 'Follow-up scheduled for Friday.',
    actorUser: dummyActor
  });
  assert.ok(noteRes.request.internal_notes.includes('Follow-up scheduled for Friday.'));
  assert.strictEqual(noteRes.event.type, 'note_added');
  console.log('  ✓ Internal note added and logged to timeline.');

  // Transition contacted -> rejected
  const rejectRes = await transitionRequestStatus({
    requestId: testId,
    targetStatus: 'rejected',
    actorUser: dummyActor,
    rejectionReason: 'Institution does not meet current capacity criteria.'
  });
  assert.strictEqual(rejectRes.request.status, 'rejected');
  assert.strictEqual(rejectRes.request.rejection_reason, 'Institution does not meet current capacity criteria.');
  console.log('  ✓ Transitioned contacted -> rejected with rejection reason.');

  // Illegal transition: rejected -> approved directly (must throw 409)
  let threw409 = false;
  try {
    await transitionRequestStatus({
      requestId: testId,
      targetStatus: 'approved',
      actorUser: dummyActor
    });
  } catch (err) {
    if (err.statusCode === 409) threw409 = true;
  }
  assert.strictEqual(threw409, true, 'Illegal transition must throw 409 Conflict');
  console.log('  ✓ Server-enforced transition barrier correctly threw 409 on invalid transition.');

  // Re-open rejected -> contacted with note
  const reopenRes = await transitionRequestStatus({
    requestId: testId,
    targetStatus: 'contacted',
    actorUser: dummyActor,
    note: 'Re-opened after receiving accreditation documents.'
  });
  assert.strictEqual(reopenRes.request.status, 'contacted');
  console.log('  ✓ Re-opened rejected -> contacted with required explanation note.');

  // Cleanup test request
  await prisma.subscriptionRequest.delete({
    where: { id: testId }
  });
  console.log('  ✓ Test cleanup completed.');

  console.log('\n🎉 ALL PHASE 1 STATUS MACHINE & EVENT TESTS PASSED!\n');
}

testPhase1()
  .catch((err) => {
    console.error('❌ Phase 1 tests failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await closeAllClients();
  });
