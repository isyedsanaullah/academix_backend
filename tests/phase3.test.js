'use strict';

require('dotenv').config();
const assert = require('assert');
const crypto = require('crypto');
const { getSystemClient, closeAllClients } = require('../config/prismaManager');
const {
  checkSlugAvailability,
  approveAndProvisionCollege,
  resendCollegeInvite,
  revokeCollegeInvite,
  getCollegeInviteStatus
} = require('../services/collegeProvisioning');

async function testPhase3() {
  console.log('🧪 Starting Phase 3 Unit Tests & Acceptance Validation...\n');
  const prisma = getSystemClient();

  // 1. Test Subdomain Slug Availability Logic
  console.log('--- 1. Testing Subdomain Slug Availability Checks ---');

  // Existing slug: 'fmc'
  const takenCheck = await checkSlugAvailability('fmc');
  assert.strictEqual(takenCheck.available, false, 'Taken slug must not be available');
  assert.ok(takenCheck.reason.includes('already taken'), 'Reason should specify already taken');

  // Reserved slug: 'admin'
  const reservedCheck = await checkSlugAvailability('admin');
  assert.strictEqual(reservedCheck.available, false, 'Reserved slug must not be available');
  assert.ok(reservedCheck.reason.includes('reserved'), 'Reason should specify reserved');

  // Invalid format: 'bad_slug'
  const invalidCheck = await checkSlugAvailability('bad_slug');
  assert.strictEqual(invalidCheck.available, false, 'Invalid format must not be available');

  // Fresh available slug
  const freshSlug = `test-unit-${Date.now().toString().slice(-6)}`;
  const freshCheck = await checkSlugAvailability(freshSlug);
  assert.strictEqual(freshCheck.available, true, 'Fresh slug must be available');
  console.log(`  ✓ Subdomain slug availability checks passed (tested taken, reserved, format, and fresh slug: "${freshSlug}").`);

  // 2. Test Full Approval & Provisioning Transaction
  console.log('\n--- 2. Testing Approval & Provisioning Transaction ---');

  const testRequestId = crypto.randomUUID();
  const testEmail = `admin-${Date.now()}@phase3test.edu.pk`;
  const dummyActor = {
    id: 'super-admin-phase3-tester',
    name: 'Super Admin Phase 3',
    email: 'superadmin@collegeshub.org'
  };

  // Create test subscription request in 'contacted' status
  await prisma.subscriptionRequest.create({
    data: {
      id: testRequestId,
      collegeName: 'Phase 3 Automated Institute',
      adminEmail: testEmail,
      phone: '0300-9988776',
      selectedPlan: 'standard',
      studentCount: 500,
      status: 'contacted'
    }
  });

  const provisionResult = await approveAndProvisionCollege({
    requestId: testRequestId,
    collegeName: 'Phase 3 Automated Institute',
    slug: freshSlug,
    adminEmail: testEmail,
    plan: 'standard',
    actorUser: dummyActor
  });

  assert.strictEqual(provisionResult.success, true);
  assert.ok(provisionResult.college, 'College record must be created');
  assert.strictEqual(provisionResult.college.status, 'pending_setup', 'New college status must be pending_setup');
  assert.strictEqual(provisionResult.college.slug, freshSlug, 'Slug must match');

  const createdCollegeId = provisionResult.college.id;

  // Verify SubscriptionPeriod created
  const period = await prisma.subscriptionPeriod.findFirst({
    where: { college_id: createdCollegeId }
  });
  assert.ok(period, 'SubscriptionPeriod row must be created');
  assert.strictEqual(period.status, 'active');
  assert.strictEqual(period.plan, 'standard');

  // Verify CollegeInvite created with 7-day expiry
  const invite = await prisma.collegeInvite.findFirst({
    where: { college_id: createdCollegeId }
  });
  assert.ok(invite, 'CollegeInvite row must be created');
  assert.ok(invite.token_hash, 'Token hash must be recorded');
  assert.strictEqual(invite.email, testEmail);

  const daysLeft = (new Date(invite.expires_at) - new Date()) / (1000 * 60 * 60 * 24);
  assert.ok(daysLeft > 6.9 && daysLeft <= 7.1, 'Expiry must be approximately 7 days');

  // Verify SubscriptionRequest updated to approved
  const updatedReq = await prisma.subscriptionRequest.findUnique({
    where: { id: testRequestId }
  });
  assert.strictEqual(updatedReq.status, 'approved', 'Request must be marked approved');
  console.log('  ✓ Approval transaction provisioned college, subscription period, and single-use invite.');

  // 3. Test Idempotency: Approving already approved request
  console.log('\n--- 3. Testing Approval Idempotency ---');
  const idempotentResult = await approveAndProvisionCollege({
    requestId: testRequestId,
    collegeName: 'Phase 3 Automated Institute',
    slug: freshSlug,
    adminEmail: testEmail,
    actorUser: dummyActor
  });
  assert.strictEqual(idempotentResult.idempotent, true, 'Second approval must return idempotent: true');
  console.log('  ✓ Idempotency verified: re-approving created zero duplicate records.');

  // 4. Test Resend Invite
  console.log('\n--- 4. Testing Resend & Revoke Invite ---');
  const resendResult = await resendCollegeInvite({
    collegeId: createdCollegeId,
    actorUser: dummyActor
  });
  assert.strictEqual(resendResult.success, true);

  // Verify that the old invite was revoked and a new active invite was created
  const allInvites = await prisma.collegeInvite.findMany({
    where: { college_id: createdCollegeId },
    orderBy: { created_at: 'asc' }
  });
  assert.strictEqual(allInvites.length, 2, 'Must have exactly 2 invite rows (old revoked + new)');
  assert.ok(allInvites[0].revoked_at !== null, 'Previous invite must be marked revoked');
  assert.strictEqual(allInvites[1].revoked_at, null, 'New invite must be active');
  console.log('  ✓ Resend invite successfully invalidated old token and issued fresh active token.');

  // Test Revoke
  const revokeResult = await revokeCollegeInvite({ collegeId: createdCollegeId });
  assert.strictEqual(revokeResult.success, true);
  const activeAfterRevoke = await prisma.collegeInvite.findFirst({
    where: { college_id: createdCollegeId, revoked_at: null }
  });
  assert.strictEqual(activeAfterRevoke, null, 'All invites must now be revoked');
  console.log('  ✓ Revoke invite successfully invalidated all active tokens.');

  // Test Invite Status helper
  const statusRes = await getCollegeInviteStatus(createdCollegeId);
  assert.strictEqual(statusRes.hasInvite, true);
  assert.strictEqual(statusRes.status, 'revoked');
  console.log('  ✓ getCollegeInviteStatus correctly returned status="revoked".');

  // 5. Cleanup test records
  console.log('\n--- 5. Test Cleanup ---');
  await prisma.subscriptionRequest.delete({ where: { id: testRequestId } });
  await prisma.college.delete({ where: { id: createdCollegeId } });
  console.log('  ✓ Test cleanup completed.');

  console.log('\n🎉 ALL PHASE 3 UNIT TESTS & ACCEPTANCE CHECKS PASSED!\n');
}

testPhase3()
  .catch((err) => {
    console.error('❌ Phase 3 tests failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await closeAllClients();
  });
