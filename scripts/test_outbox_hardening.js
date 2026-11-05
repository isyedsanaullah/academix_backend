'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const assert = require('assert');
const { getSystemClient } = require('../config/prismaManager');
const prisma = getSystemClient();
const {
  drainOnce,
  getDeadLetterEvents,
  retryDeadLetterEvent,
  MAX_ATTEMPTS
} = require('../workers/outboxWorker');
const { reserveUploadSlot } = require('../services/storageQuotaService');
const { reconcileCollegeStorage } = require('../services/storageReconciliationService');

async function testOutboxHardening() {
  console.log('--- Testing Phase 8.0: Outbox Hardening & Storage Whitelist ---');

  // Find a test college
  const college = await prisma.college.findFirst();
  assert.ok(college, 'Found a college for testing');

  // 1. Create a failing OutboxEvent
  console.log('1. Testing OutboxEvent DEAD_LETTER transition on failure...');
  const failingEvent = await prisma.outboxEvent.create({
    data: {
      college_id: college.id,
      eventType: 'FAILING_TEST_EVENT_THROW',
      payload: { test: true, collegeId: college.id },
      status: 'PENDING',
      attempts: 2, // 1 away from MAX_ATTEMPTS
      nextAttemptAt: new Date('2020-01-01T00:00:00Z'), // prioritize at top of queue
    }
  });

  // Drain once
  await drainOnce();

  // Check event status
  const checked = await prisma.outboxEvent.findUnique({ where: { id: failingEvent.id } });
  assert.strictEqual(checked.status, 'DEAD_LETTER', `Expected DEAD_LETTER, got ${checked.status}`);
  assert.ok(checked.failedAt, 'failedAt must be populated');
  assert.strictEqual(checked.attempts, 3, 'attempts must be 3');
  console.log('   PASS: Event transitioned to DEAD_LETTER after max attempts.');

  // Check that Super Admin alert notification was emitted
  const notif = await prisma.notification.findFirst({
    where: {
      recipient: 'SUPER_ADMIN',
      title: { contains: failingEvent.eventType }
    },
    orderBy: { createdAt: 'desc' }
  });
  assert.ok(notif, 'Super Admin alert notification must be emitted');
  console.log('   PASS: Super Admin notification emitted on DEAD_LETTER.');

  // 2. Test getDeadLetterEvents
  console.log('2. Testing getDeadLetterEvents querying...');
  const dlList = await getDeadLetterEvents({ collegeId: college.id, limit: 10 });
  assert.ok(dlList.total >= 1, 'At least 1 dead letter event returned');
  const found = dlList.events.find(e => e.id === failingEvent.id);
  assert.ok(found, 'Created dead letter event found in list');
  console.log('   PASS: getDeadLetterEvents retrieves dead-lettered events correctly.');

  // 3. Test retryDeadLetterEvent
  console.log('3. Testing retryDeadLetterEvent...');
  const retried = await retryDeadLetterEvent(failingEvent.id);
  assert.strictEqual(retried.status, 'PENDING', 'Status must be reset to PENDING');
  assert.strictEqual(retried.attempts, 0, 'Attempts must be reset to 0');
  assert.strictEqual(retried.retryCount, 1, 'retryCount must be incremented to 1');
  assert.strictEqual(retried.lastError, null, 'lastError must be cleared');
  assert.strictEqual(retried.failedAt, null, 'failedAt must be cleared');
  console.log('   PASS: retryDeadLetterEvent reset event to PENDING with retryCount incremented.');

  // 4. Test storage reservation category whitelist
  console.log('4. Testing storage reservation category whitelist...');
  const exemptCategories = ['EXPORTS', 'BACKUPS', 'REPORTS', 'RECEIPTS', 'IMPORT_SOURCE'];
  for (const cat of exemptCategories) {
    let failed = false;
    try {
      await reserveUploadSlot(college.id, 'tester', {
        filename: 'test.zip',
        category: cat,
        declaredSizeBytes: 1024
      });
    } catch (err) {
      failed = true;
      assert.strictEqual(err.code, 'CLIENT_CATEGORY_NOT_ALLOWED', `Expected CLIENT_CATEGORY_NOT_ALLOWED for ${cat}`);
    }
    assert.ok(failed, `Category ${cat} must be rejected for client upload reservation`);
  }
  console.log('   PASS: All server-exempt categories rejected for client reservations.');

  // 5. Cleanup test event
  await prisma.outboxEvent.delete({ where: { id: failingEvent.id } });
  if (notif) await prisma.notification.delete({ where: { id: notif.id } });

  console.log('\n====================================================');
  console.log('ALL PHASE 8.0 HARDENING TESTS PASSED SUCCESSFULLY!');
  console.log('====================================================');

  await prisma.$disconnect();
}

testOutboxHardening().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
