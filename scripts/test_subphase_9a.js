'use strict';

/**
 * test_subphase_9a.js — Test Sub-Phase 9A: N07 Admin 2FA & Login Alerts
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const assert = require('assert');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { getSystemClient } = require('../config/prismaManager');
const prisma = getSystemClient();

const {
  generate2FASetup,
  encryptTotpSecret,
  decryptTotpSecret,
  generateCodeForStep,
  verifyTotpCode,
  base32Decode,
  signDeviceCookie,
  verifyDeviceCookie
} = require('../services/twoFactorService');

const {
  validate2FA,
  recover2FA,
  disable2FA,
  processKnownDevice
} = require('../controllers/twoFactor.controller');

const { handleCollegeAction } = require('../controllers/superAdminGovernance.controller');
const { STEP_UP_SECRET } = require('../middleware/stepUpAuth');

async function runTests() {
  console.log('====================================================');
  console.log('   TESTING SUB-PHASE 9A: N07 ADMIN 2FA & ALERTS    ');
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

  // 1. TOTP RFC 6238 Engine, Encryption & Replay Protection
  await test('1. TOTP RFC 6238 Engine, AES-256-GCM (v1:) & Replay Guard', async () => {
    const setup = generate2FASetup('admin@testcollege.edu.pk');
    assert(setup.secretBase32.length >= 26);
    assert(setup.secretEnc.startsWith('v1:'));
    assert.strictEqual(setup.plainBackupCodes.length, 10);
    assert.strictEqual(setup.hashedBackupCodes.length, 10);

    // Decrypt matches
    const decrypted = decryptTotpSecret(setup.secretEnc);
    assert.strictEqual(decrypted, setup.secretBase32);

    // Current step verification
    const now = Date.now();
    const currentStep = Math.floor(now / 1000 / 30);
    const secretBytes = base32Decode(setup.secretBase32);
    const validCode = generateCodeForStep(secretBytes, currentStep);

    const resValid = verifyTotpCode({ secretBase32: setup.secretBase32, code: validCode, nowMs: now });
    assert.strictEqual(resValid.valid, true);
    assert.strictEqual(resValid.step, BigInt(currentStep));

    // Replay protection: cannot reuse same step
    const resReplay = verifyTotpCode({
      secretBase32: setup.secretBase32,
      code: validCode,
      lastAcceptedStep: BigInt(currentStep),
      nowMs: now
    });
    assert.strictEqual(resReplay.valid, false);
    assert.strictEqual(resReplay.reason, 'REPLAYED_CODE');

    // +-1 window check
    const stepMinus1Code = generateCodeForStep(secretBytes, currentStep - 1);
    const resMinus1 = verifyTotpCode({ secretBase32: setup.secretBase32, code: stepMinus1Code, nowMs: now });
    assert.strictEqual(resMinus1.valid, true);

    const stepPlus1Code = generateCodeForStep(secretBytes, currentStep + 1);
    const resPlus1 = verifyTotpCode({ secretBase32: setup.secretBase32, code: stepPlus1Code, nowMs: now });
    assert.strictEqual(resPlus1.valid, true);

    const stepMinus2Code = generateCodeForStep(secretBytes, currentStep - 2);
    const resMinus2 = verifyTotpCode({ secretBase32: setup.secretBase32, code: stepMinus2Code, nowMs: now });
    assert.strictEqual(resMinus2.valid, false);
  });

  // 2. Pre-Auth Token Single-Use (JTI store) & Session Lockout
  await test('2. Pre-Auth Single-Use, Account Lockout on 5 Failures & JWT Scope', async () => {
    const col = await prisma.college.create({
      data: { name: '2FA Test College', email: `col2fa_${Date.now()}@test.com`, code: `2FA_${Date.now()}`, subStatus: 'ACTIVE' }
    });

    const setup = generate2FASetup('user2fa@test.com');
    const user = await prisma.user.create({
      data: {
        college_id: col.id,
        name: '2FA User',
        email: `user2fa_${Date.now()}@test.com`,
        role: 'admin',
        totpEnabled: true,
        totpSecretEnc: setup.secretEnc,
        totpBackupCodes: setup.hashedBackupCodes
      }
    });

    const jti = crypto.randomUUID();
    const preAuthToken = jwt.sign(
      { userId: user.id, collegeId: col.id, role: user.role, scope: 'PREAUTH_2FA', jti },
      process.env.JWT_SECRET,
      { expiresIn: '5m' }
    );

    // Fail 4 times
    for (let i = 1; i <= 4; i++) {
      let codeStatus = 200;
      let errData = null;
      const resMock = {
        status(s) { codeStatus = s; return this; },
        json(d) { errData = d; return this; }
      };
      await validate2FA({ body: { preAuthToken, code: '000000' } }, resMock);
      assert.strictEqual(codeStatus, 401);
      assert.strictEqual(errData.code, 'INVALID_2FA_CODE');
      assert.strictEqual(errData.attemptsRemaining, 5 - i);
    }

    // 5th failure -> Account Locked
    let lockStatus = 200;
    const resMock5 = {
      status(s) { lockStatus = s; return this; },
      json() { return this; }
    };
    await validate2FA({ body: { preAuthToken, code: '000000' } }, resMock5);
    assert.strictEqual(lockStatus, 401);

    const lockedUser = await prisma.user.findUnique({ where: { id: user.id } });
    assert(lockedUser.totpLockedUntil > new Date());

    // Next attempt returns 429 ACCOUNT_LOCKED_2FA
    let lockedStatus = 200;
    let lockedData = null;
    const resMockLocked = {
      status(s) { lockedStatus = s; return this; },
      json(d) { lockedData = d; return this; }
    };
    await validate2FA({ body: { preAuthToken, code: '000000' } }, resMockLocked);
    assert.strictEqual(lockedStatus, 429);
    assert.strictEqual(lockedData.code, 'ACCOUNT_LOCKED_2FA');
  });

  // 3. Valid 2FA Validation & Known-Device Cookie Flow
  await test('3. Valid 2FA Validation, JTI consumption & Known Device Alert', async () => {
    const col = await prisma.college.create({
      data: { name: 'Device Test College', email: `coldev_${Date.now()}@test.com`, code: `DEV_${Date.now()}`, subStatus: 'ACTIVE' }
    });

    const setup = generate2FASetup('devuser@test.com');
    const user = await prisma.user.create({
      data: {
        college_id: col.id,
        name: 'Device User',
        email: `devuser_${Date.now()}@test.com`,
        role: 'admin',
        totpEnabled: true,
        totpSecretEnc: setup.secretEnc,
        totpBackupCodes: setup.hashedBackupCodes
      }
    });

    const currentStep = Math.floor(Date.now() / 1000 / 30);
    const validCode = generateCodeForStep(base32Decode(setup.secretBase32), currentStep);

    const jti = crypto.randomUUID();
    const preAuthToken = jwt.sign(
      { userId: user.id, collegeId: col.id, role: user.role, scope: 'PREAUTH_2FA', jti },
      process.env.JWT_SECRET,
      { expiresIn: '5m' }
    );

    let cookieSet = {};
    const reqMock = {
      body: { preAuthToken, code: validCode },
      ip: '192.168.1.10',
      headers: { 'user-agent': 'Academix-Test-Agent' },
      cookies: {}
    };
    let valData = null;
    const resMock = {
      cookie(name, val, opts) { cookieSet[name] = val; },
      status() { return this; },
      json(d) { valData = d; return this; }
    };

    await validate2FA(reqMock, resMock);
    assert.strictEqual(valData.success, true);
    assert(valData.token);

    // Verify JTI consumed
    const used = await prisma.usedStepUpToken.findUnique({ where: { jti } });
    assert(used);
    assert.strictEqual(used.kind, 'preauth_2fa');

    // Attempting to reuse same pre-auth token must fail
    let reuseStatus = 200;
    const resMockReuse = {
      status(s) { reuseStatus = s; return this; },
      json() { return this; }
    };
    await validate2FA({ body: { preAuthToken, code: validCode } }, resMockReuse);
    assert.strictEqual(reuseStatus, 401);

    // Verify device cookie set
    const devCookie = cookieSet['__Host-acx_did'] || cookieSet['acx_did'];
    assert(devCookie);
    const verifiedDevId = verifyDeviceCookie(devCookie);
    assert(verifiedDevId);

    // Verify OutboxEvent('NEW_DEVICE_LOGIN') was created
    const outboxEvt = await prisma.outboxEvent.findFirst({
      where: { college_id: col.id, eventType: 'NEW_DEVICE_LOGIN' }
    });
    assert(outboxEvt);
    assert.strictEqual(outboxEvt.payload.userId, user.id);
  });

  // 4. Lost Device Recovery with Backup Code
  await test('4. Lost Device Recovery with 10-char Backup Code', async () => {
    const col = await prisma.college.create({
      data: { name: 'Recov College', email: `colrec_${Date.now()}@test.com`, code: `RCV_${Date.now()}`, subStatus: 'ACTIVE' }
    });

    const setup = generate2FASetup('recov@test.com');
    const user = await prisma.user.create({
      data: {
        college_id: col.id,
        name: 'Recov User',
        email: `recov_${Date.now()}@test.com`,
        role: 'admin',
        totpEnabled: true,
        totpSecretEnc: setup.secretEnc,
        totpBackupCodes: setup.hashedBackupCodes
      }
    });

    const backupCodeToUse = setup.plainBackupCodes[0];
    const jti = crypto.randomUUID();
    const preAuthToken = jwt.sign(
      { userId: user.id, collegeId: col.id, role: user.role, scope: 'PREAUTH_2FA', jti },
      process.env.JWT_SECRET,
      { expiresIn: '5m' }
    );

    let recovData = null;
    const resMock = {
      cookie() {},
      status() { return this; },
      json(d) { recovData = d; return this; }
    };

    await recover2FA({ body: { preAuthToken, backupCode: backupCodeToUse }, ip: '127.0.0.1', headers: {} }, resMock);
    assert.strictEqual(recovData.success, true);
    assert.strictEqual(recovData.remainingCodesCount, 9);

    // Verify remaining count in DB
    const userAfter = await prisma.user.findUnique({ where: { id: user.id } });
    assert.strictEqual(userAfter.totpBackupCodes.length, 9);
  });

  // 5. Super Admin Mandatory 2FA & reset-2fa Governance Action
  await test('5. Super Admin Mandatory 2FA & Governance reset-2fa with Step-Up', async () => {
    const superAdmin = await prisma.user.create({
      data: {
        name: 'Platform Super Admin',
        email: `sa_${Date.now()}@platform.com`,
        role: 'superAdmin',
        totpEnabled: true
      }
    });

    // Super Admin cannot disable 2FA
    let disStatus = 200;
    let disData = null;
    const resMockDis = {
      status(s) { disStatus = s; return this; },
      json(d) { disData = d; return this; }
    };
    await disable2FA({ user: superAdmin }, resMockDis);
    assert.strictEqual(disStatus, 403);
    assert.strictEqual(disData.code, 'SUPER_ADMIN_2FA_MANDATORY');

    // Super Admin resets a college admin's 2FA using reset-2fa governance action
    const col = await prisma.college.create({
      data: { name: 'Gov College', email: `colgov_${Date.now()}@test.com`, code: `GOV_${Date.now()}`, subStatus: 'ACTIVE' }
    });
    const colAdmin = await prisma.user.create({
      data: {
        college_id: col.id,
        name: 'College Admin',
        email: `ca_${Date.now()}@col.com`,
        role: 'admin',
        totpEnabled: true
      }
    });

    // Create step-up token for destructive action
    const stepUpJti = crypto.randomUUID();
    const stepUpToken = jwt.sign(
      { userId: superAdmin.id, actionClass: 'destructive', jti: stepUpJti },
      STEP_UP_SECRET,
      { expiresIn: '5m' }
    );

    let govData = null;
    const resMockGov = {
      status() { return this; },
      json(d) { govData = d; return this; }
    };

    await handleCollegeAction(
      {
        params: { id: col.id },
        body: { action: 'reset-2fa', userId: colAdmin.id, reason: 'Lost device and backup codes' },
        headers: { 'x-step-up-token': stepUpToken },
        user: superAdmin,
        ip: '127.0.0.1'
      },
      resMockGov
    );

    assert.strictEqual(govData.success, true);

    // Verify user 2FA was cleared
    const caAfter = await prisma.user.findUnique({ where: { id: colAdmin.id } });
    assert.strictEqual(caAfter.totpEnabled, false);
    assert.strictEqual(caAfter.totpSecretEnc, null);

    // Verify CollegeEntitlementAudit record
    const audit = await prisma.collegeEntitlementAudit.findFirst({
      where: { college_id: col.id, action: 'RESET_2FA' }
    });
    assert(audit);
    assert.strictEqual(audit.reason, 'Lost device and backup codes');
  });

  console.log(`\n====================================================`);
  console.log(`SUB-PHASE 9A TESTS SUMMARY: ${passed} PASSED, ${failed} FAILED`);
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
