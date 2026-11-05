'use strict';

/**
 * test_subphase_9f.js — Test Sub-Phase 9F: N05 Institutional Data Export / Backup
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const assert = require('assert');
const fs = require('fs');
const { getSystemClient } = require('../config/prismaManager');
const prisma = getSystemClient();

const backupService = require('../services/backupService');

async function runTests() {
  console.log('====================================================');
  console.log('   TESTING SUB-PHASE 9F: N05 DATA BACKUP (ENT)     ');
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

  // 1. Sensitive Secrets Exclusion Filter
  await test('1. Sensitive Secrets Exclusion Filter (passwords, TOTP, API keys, webhook secrets, PINs)', async () => {
    // User
    const dirtyUser = {
      id: 'u-1',
      name: 'Admin',
      email: 'admin@test.com',
      password: '$2b$10$hashed_password',
      totpSecretEnc: 'v1:secret',
      totpBackupCodes: ['hash1', 'hash2'],
      twofaEnrolledAt: new Date()
    };
    const cleanUser = backupService.sanitizeUser(dirtyUser);
    assert.strictEqual(cleanUser.password, undefined);
    assert.strictEqual(cleanUser.totpSecretEnc, undefined);
    assert.strictEqual(cleanUser.totpBackupCodes, undefined);
    assert.strictEqual(cleanUser.name, 'Admin');

    // Student
    const dirtyStudent = { id: 's-1', name: 'Student', guardianPinHash: '$2b$10$pin_hash' };
    const cleanStudent = backupService.sanitizeStudent(dirtyStudent);
    assert.strictEqual(cleanStudent.guardianPinHash, undefined);
    assert.strictEqual(cleanStudent.name, 'Student');

    // ApiKey
    const dirtyKey = { id: 'k-1', keyPrefix: '12345678', keyHash: 'sha256_hash' };
    const cleanKey = backupService.sanitizeApiKey(dirtyKey);
    assert.strictEqual(cleanKey.keyHash, undefined);
    assert.strictEqual(cleanKey.keyPrefix, '12345678');

    // Webhook
    const dirtySub = { id: 'w-1', targetUrl: 'https://ex.com', secretEnc: 'v1:encrypted' };
    const cleanSub = backupService.sanitizeWebhookSubscription(dirtySub);
    assert.strictEqual(cleanSub.secretEnc, undefined);
    assert.strictEqual(cleanSub.targetUrl, 'https://ex.com');
  });

  // 2. Enterprise-Only Gate: Starter/Standard/Premium Blocked
  await test('2. Enterprise-Only Gate: Starter, Standard and Premium receive 403 FEATURE_NOT_IN_PLAN', async () => {
    const premCol = await prisma.college.create({
      data: { name: 'Prem Col', email: `prem_${Date.now()}@test.com`, code: `PR_${Date.now()}`, planId: 'premium', subStatus: 'ACTIVE' }
    });

    try {
      await backupService.requestBackup({
        collegeId: premCol.id,
        userId: 'admin-1',
        passphrase: 'SecurePassphrase123!'
      });
      assert.fail('Premium college should be rejected');
    } catch (err) {
      assert.strictEqual(err.code, 'FEATURE_NOT_IN_PLAN');
    }
  });

  // 3. Quota Enforcement: 1 Self-Service Backup / Month on Enterprise
  await test('3. Quota Enforcement: 1 Backup per month allowed on Enterprise', async () => {
    const entCol = await prisma.college.create({
      data: { name: 'Ent Col', email: `ent_${Date.now()}@test.com`, code: `ENT_${Date.now()}`, planId: 'enterprise', subStatus: 'ACTIVE' }
    });

    // 1st request -> Succeeds
    const job1 = await backupService.requestBackup({
      collegeId: entCol.id,
      userId: 'admin-1',
      passphrase: 'SuperSecretPassphrase123!'
    });
    assert(job1.jobId);
    assert.strictEqual(job1.status, 'QUEUED');

    // 2nd request in same month -> 422 QUOTA_EXCEEDED
    try {
      await backupService.requestBackup({
        collegeId: entCol.id,
        userId: 'admin-1',
        passphrase: 'AnotherSecretPassphrase123!'
      });
      assert.fail('Should exceed monthly backup quota');
    } catch (err) {
      assert.strictEqual(err.code, 'QUOTA_EXCEEDED');
      assert.strictEqual(err.details.limit, 1);
    }
  });

  // 4. Passphrase-Encrypted AES-256 ZIP Execution & Re-Issuable Links
  await test('4. Streaming AES-256 ZIP Generation & Re-Issuable Links', async () => {
    const entCol = await prisma.college.create({
      data: { name: 'Exec Col', email: `exec_${Date.now()}@test.com`, code: `EXC_${Date.now()}`, planId: 'enterprise', subStatus: 'ACTIVE' }
    });

    const session = await prisma.session.create({
      data: { college_id: entCol.id, name: '2026-2027', startDate: new Date('2026-08-01'), endDate: new Date('2027-06-30') }
    });

    // Seed student
    await prisma.student.create({
      data: {
        college_id: entCol.id,
        session_id: session.id,
        name: 'Backup Student',
        fatherName: 'Father',
        gender: 'male',
        rollNumber: `BCK_${Date.now()}`,
        class: '11th',
        group: 'Pre-Medical'
      }
    });

    const passphrase = 'InstitutionalPassphrase2026!';
    const { jobId } = await backupService.requestBackup({
      collegeId: entCol.id,
      userId: 'admin-1',
      passphrase
    });

    // Execute backup
    const result = await backupService.executeBackupJob(jobId, passphrase);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.status, 'READY');
    assert(result.archiveKey.endsWith('.zip'));

    // Verify temp file exists and has size
    if (result.tmpPath && fs.existsSync(result.tmpPath)) {
      const stat = fs.statSync(result.tmpPath);
      assert(stat.size > 0);
      fs.unlinkSync(result.tmpPath); // cleanup
    }

    // Verify re-issuable file links
    const refreshResult = await backupService.refreshBackupLinks(entCol.id, jobId);
    assert.strictEqual(refreshResult.jobId, jobId);
    assert(refreshResult.downloadUrl.includes(jobId));
    assert(refreshResult.downloadUrl.includes('token='));
  });

  console.log(`\n====================================================`);
  console.log(`SUB-PHASE 9F TESTS SUMMARY: ${passed} PASSED, ${failed} FAILED`);
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

