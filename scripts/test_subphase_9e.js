'use strict';

/**
 * test_subphase_9e.js — Test Sub-Phase 9E: N06 Public REST API & Webhooks
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const assert = require('assert');
const { getSystemClient } = require('../config/prismaManager');
const prisma = getSystemClient();

const apiKeyService = require('../services/apiKeyService');
const webhookCrypto = require('../services/webhookCrypto');
const ssrfProtection = require('../services/ssrfProtection');
const apiUsageService = require('../services/apiUsageService');
const webhookService = require('../services/webhookService');

async function runTests() {
  console.log('====================================================');
  console.log('   TESTING SUB-PHASE 9E: N06 PUBLIC API & WEBHOOKS ');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`FAIL: ${name}`);
      console.error(`      ${err.message}`);
      failed++;
    }
  }

  // 1. API Key Generation, Hashing & Constant-Time Validation
  await test('1. API Key Generation, SHA-256 Hashing & Constant-Time Validation', async () => {
    const col = await prisma.college.create({
      data: { name: 'Key Col', email: `key_${Date.now()}@test.com`, code: `KC_${Date.now()}`, planId: 'enterprise', subStatus: 'ACTIVE' }
    });

    const keyResult = await apiKeyService.generateApiKey({
      collegeId: col.id,
      name: 'Integration Key',
      createdBy: 'admin-1'
    });

    assert(keyResult.rawKey.startsWith('acx_live_'));
    assert.strictEqual(keyResult.keyPrefix.length, 8);

    // Verify DB stores hash, not raw key
    const dbKey = await prisma.apiKey.findUnique({ where: { id: keyResult.id } });
    assert.notStrictEqual(dbKey.keyHash, keyResult.rawKey);
    assert.strictEqual(dbKey.keyPrefix, keyResult.keyPrefix);

    // Validate raw key
    const validResult = await apiKeyService.validateApiKey(keyResult.rawKey);
    assert.strictEqual(validResult.valid, true);
    assert.strictEqual(validResult.key.id, keyResult.id);

    // Tampered key fails
    const badKey = keyResult.rawKey.slice(0, -4) + 'abcd';
    const invalidResult = await apiKeyService.validateApiKey(badKey);
    assert.strictEqual(invalidResult, null);
  });

  // 2. Webhook Secrets AES-256-GCM Encryption, HMAC Signing & Rotation
  await test('2. Webhook Secrets AES-256-GCM Encryption, HMAC Signing & Rotation', async () => {
    const rawSecret = 'whsec_test_secret_1234567890abcdef';
    const encrypted = webhookCrypto.encryptWebhookSecret(rawSecret);

    assert(encrypted.startsWith('v1:'));
    assert.notStrictEqual(encrypted, rawSecret);

    const decrypted = webhookCrypto.decryptWebhookSecret(encrypted);
    assert.strictEqual(decrypted, rawSecret);

    // Sign payload
    const payload = { event: 'student.created', studentId: 'stu-1' };
    const { signatureHeader, timestamp } = webhookCrypto.signWebhookPayload(rawSecret, payload);
    assert(signatureHeader.startsWith(`t=${timestamp},v1=`));

    // Secret Rotation
    const col = await prisma.college.create({
      data: { name: 'Wh Col', email: `wh_${Date.now()}@test.com`, code: `WH_${Date.now()}`, planId: 'enterprise', subStatus: 'ACTIVE' }
    });

    process.env.ALLOW_TEST_WEBHOOK_LOOPBACK = 'true';
    const sub = await webhookService.createSubscription({
      collegeId: col.id,
      targetUrl: 'https://example.com/webhook',
      events: ['student.*']
    });
    assert(sub.rawSecret.startsWith('whsec_'));

    const rotated = await webhookService.rotateSecret({
      collegeId: col.id,
      subscriptionId: sub.id
    });
    assert(rotated.rawSecret.startsWith('whsec_'));
    assert.notStrictEqual(rotated.rawSecret, sub.rawSecret);
  });

  // 3. Anti-SSRF Defense Checks
  await test('3. Anti-SSRF Defense Blocks Private, Localhost and Cloud Metadata Targets', async () => {
    process.env.ALLOW_TEST_WEBHOOK_LOOPBACK = 'false';

    // Loopback
    assert.strictEqual(ssrfProtection.isRestrictedIp('127.0.0.1'), true);
    assert.strictEqual(ssrfProtection.isRestrictedIp('::1'), true);

    // Cloud Metadata
    assert.strictEqual(ssrfProtection.isRestrictedIp('169.254.169.254'), true);

    // Private IPv4
    assert.strictEqual(ssrfProtection.isRestrictedIp('10.0.0.5'), true);
    assert.strictEqual(ssrfProtection.isRestrictedIp('172.16.50.1'), true);
    assert.strictEqual(ssrfProtection.isRestrictedIp('192.168.1.1'), true);

    // Public IPv4 (safe)
    assert.strictEqual(ssrfProtection.isRestrictedIp('8.8.8.8'), false);
    assert.strictEqual(ssrfProtection.isRestrictedIp('1.1.1.1'), false);

    // URL validation: HTTP rejected
    try {
      await ssrfProtection.validateWebhookUrl('http://api.example.com/wh');
      assert.fail('Should reject non-HTTPS');
    } catch (err) {
      assert.strictEqual(err.code, 'HTTPS_REQUIRED');
    }

    // URL validation: non-443 port rejected
    try {
      await ssrfProtection.validateWebhookUrl('https://api.example.com:8443/wh');
      assert.fail('Should reject non-443');
    } catch (err) {
      assert.strictEqual(err.code, 'INVALID_PORT');
    }

    // URL validation: localhost rejected
    try {
      await ssrfProtection.validateWebhookUrl('https://localhost/wh');
      assert.fail('Should reject localhost');
    } catch (err) {
      assert.strictEqual(err.code, 'SSRF_RESTRICTED');
    }
  });

  // 4. DB-Atomic Multi-Instance Rate Limiting (ApiUsageWindow)
  await test('4. DB-Atomic Multi-Instance Rate Limiting rejects with 429 over limit', async () => {
    const col = await prisma.college.create({
      data: { name: 'Rate Col', email: `rate_${Date.now()}@test.com`, code: `RT_${Date.now()}`, planId: 'enterprise', subStatus: 'ACTIVE' }
    });

    const keyResult = await apiKeyService.generateApiKey({
      collegeId: col.id,
      name: 'Rate Test Key',
      createdBy: 'admin-1'
    });

    // Test with low limit: 3 calls per minute
    const perMinuteLimit = 3;

    // Call 1 -> Allowed
    const res1 = await apiUsageService.recordAndCheckApiUsage(col.id, keyResult.id, perMinuteLimit);
    assert.strictEqual(res1.allowed, true);
    assert.strictEqual(res1.minuteCount, 1);

    // Call 2 -> Allowed
    const res2 = await apiUsageService.recordAndCheckApiUsage(col.id, keyResult.id, perMinuteLimit);
    assert.strictEqual(res2.allowed, true);
    assert.strictEqual(res2.minuteCount, 2);

    // Call 3 -> Allowed (hits limit)
    const res3 = await apiUsageService.recordAndCheckApiUsage(col.id, keyResult.id, perMinuteLimit);
    assert.strictEqual(res3.allowed, true);
    assert.strictEqual(res3.minuteCount, 3);

    // Call 4 -> Exceeds limit -> Rejected with 429
    const res4 = await apiUsageService.recordAndCheckApiUsage(col.id, keyResult.id, perMinuteLimit);
    assert.strictEqual(res4.allowed, false);
    assert.strictEqual(res4.reason, 'RATE_LIMIT_EXCEEDED');
    assert.strictEqual(res4.retryAfterSeconds, 60);
  });

  // 5. Suspended Institution Rejection & Read-Only Access
  await test('5. Suspended Institutions are Blocked; Read-Only can Read', async () => {
    const apiKeyAuth = require('../middleware/apiKeyAuth');

    // Suspended College
    const suspCol = await prisma.college.create({
      data: { name: 'Susp Col', email: `susp_${Date.now()}@test.com`, code: `SP_${Date.now()}`, planId: 'enterprise', subStatus: 'SUSPENDED' }
    });
    const suspKey = await apiKeyService.generateApiKey({ collegeId: suspCol.id, name: 'Susp Key', createdBy: 'admin' });

    let status = null;
    let json = null;
    const fakeRes = {
      status(c) { status = c; return this; },
      json(data) { json = data; return this; },
      setHeader() {}
    };

    await apiKeyAuth({ headers: { authorization: `Bearer ${suspKey.rawKey}` } }, fakeRes, () => {});
    assert.strictEqual(status, 403);
    assert.strictEqual(json.code, 'ACCOUNT_SUSPENDED');

    // Read-Only College (subscription expired)
    const roCol = await prisma.college.create({
      data: {
        name: 'RO Col',
        email: `ro_${Date.now()}@test.com`,
        code: `RO_${Date.now()}`,
        planId: 'enterprise',
        subStatus: 'ACTIVE',
        periodEnd: new Date(Date.now() - 86400000) // Expired yesterday -> Read-Only
      }
    });
    const roKey = await apiKeyService.generateApiKey({ collegeId: roCol.id, name: 'RO Key', createdBy: 'admin' });

    let calledNext = false;
    await apiKeyAuth({ headers: { authorization: `Bearer ${roKey.rawKey}` } }, fakeRes, () => { calledNext = true; });
    assert.strictEqual(calledNext, true, 'Read-only college must be permitted to read from Public API');
  });

  // 6. Webhook Delivery Worker, Backoff & Auto-Disable at 5 Abandoned
  await test('6. Webhook Delivery Retry, Abandoned Tracking & Auto-Disable', async () => {
    process.env.ALLOW_TEST_WEBHOOK_LOOPBACK = 'true';

    const col = await prisma.college.create({
      data: { name: 'FailWh Col', email: `fwh_${Date.now()}@test.com`, code: `FWH_${Date.now()}`, planId: 'enterprise', subStatus: 'ACTIVE' }
    });

    // Create subscription pointing to non-existent endpoint
    const sub = await webhookService.createSubscription({
      collegeId: col.id,
      targetUrl: 'https://192.0.2.1/invalid-webhook-destination',
      events: ['test.event']
    });

    // Emit event
    const [delivery] = await webhookService.emitDomainEvent(col.id, 'test.event', { hello: 'world' });
    assert(delivery.id);
    assert.strictEqual(delivery.status, 'PENDING');

    // Simulate 4 failed delivery attempts
    for (let attempt = 1; attempt <= 4; attempt++) {
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: { attempt: attempt - 1, status: 'PENDING', nextAttemptAt: new Date(Date.now() - 1000) }
      });
      const res = await webhookService.deliverWebhook(delivery.id);
      assert.strictEqual(res.status, 'PENDING');
      assert.strictEqual(res.attempt, attempt);
    }

    // 5th attempt: should become ABANDONED and increment consecutiveAbandoned to 1
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: { attempt: 4, status: 'PENDING', nextAttemptAt: new Date(Date.now() - 1000) }
    });
    const finalRes = await webhookService.deliverWebhook(delivery.id);
    assert.strictEqual(finalRes.status, 'ABANDONED');
    assert.strictEqual(finalRes.attempt, 5);

    const updatedSub = await prisma.webhookSubscription.findUnique({ where: { id: sub.id } });
    assert.strictEqual(updatedSub.consecutiveAbandoned, 1);
    assert.strictEqual(updatedSub.isActive, true);

    // Simulate 4 more abandoned deliveries (total 5 consecutive abandoned) -> auto-disable
    await prisma.webhookSubscription.update({
      where: { id: sub.id },
      data: { consecutiveAbandoned: 4 }
    });

    // Another abandoned delivery
    const d2 = await prisma.webhookDelivery.create({
      data: {
        college_id: col.id,
        subscriptionId: sub.id,
        eventType: 'test.event',
        payloadJson: {},
        attempt: 4,
        status: 'PENDING',
        nextAttemptAt: new Date(Date.now() - 1000)
      }
    });

    await webhookService.deliverWebhook(d2.id);

    const disabledSub = await prisma.webhookSubscription.findUnique({ where: { id: sub.id } });
    assert.strictEqual(disabledSub.isActive, false, 'Subscription must be auto-disabled after 5 consecutive abandoned deliveries');
    assert(disabledSub.disabledReason.includes('5 consecutive abandoned'));

    // Verify outbox alert was created
    const outbox = await prisma.outboxEvent.findFirst({
      where: { college_id: col.id, eventType: 'WEBHOOK_SUBSCRIPTION_DISABLED' }
    });
    assert(outbox);
  });

  console.log(`\n====================================================`);
  console.log(`SUB-PHASE 9E TESTS SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log(`====================================================`);

  if (failed > 0) process.exit(1);
}

runTests()
  .catch(err => {
    console.error('Fatal error during test run:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

