'use strict';

/**
 * security_safe_user.test.js
 * Automated contract and security tests for Phase 0.1
 * Verifies that password hashes, TOTP tokens, reset codes, and sensitive credentials
 * NEVER leak into user API responses or Superadmin finance responses.
 */

const assert = require('assert');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const {
  SAFE_USER_SELECT,
  FINANCE_SAFE_USER_SELECT,
  FORBIDDEN_USER_FIELDS,
  sanitizeUserResponse
} = require('../utils/safeUser');
const { getSystemClient, closeAllClients } = require('../config/prismaManager');

async function runTests() {
  console.log('====================================================');
  console.log('   PHASE 0.1 SAFE USER SECURITY TEST SUITE         ');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}`);
      console.error(`    ${err.message}`);
      failed++;
    }
  }

  async function asyncTest(name, fn) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}`);
      console.error(`    ${err.message}`);
      failed++;
    }
  }

  // Test 1: SAFE_USER_SELECT must not contain any forbidden fields
  test('SAFE_USER_SELECT projection excludes all forbidden sensitive fields', () => {
    FORBIDDEN_USER_FIELDS.forEach((field) => {
      assert.strictEqual(
        SAFE_USER_SELECT[field],
        undefined,
        `SAFE_USER_SELECT must not contain forbidden field: ${field}`
      );
    });
    // Explicitly verify qrCode and authProvider are dropped
    assert.strictEqual(SAFE_USER_SELECT.qrCode, undefined, 'qrCode must be dropped');
    assert.strictEqual(SAFE_USER_SELECT.authProvider, undefined, 'authProvider must be dropped');
  });

  // Test 2: FINANCE_SAFE_USER_SELECT must omit cnic as well
  test('FINANCE_SAFE_USER_SELECT projection excludes all forbidden fields AND cnic', () => {
    FORBIDDEN_USER_FIELDS.forEach((field) => {
      assert.strictEqual(
        FINANCE_SAFE_USER_SELECT[field],
        undefined,
        `FINANCE_SAFE_USER_SELECT must not contain forbidden field: ${field}`
      );
    });
    assert.strictEqual(
      FINANCE_SAFE_USER_SELECT.cnic,
      undefined,
      'FINANCE_SAFE_USER_SELECT must omit cnic'
    );
  });

  // Test 3: sanitizeUserResponse thoroughly purges forbidden fields
  test('sanitizeUserResponse purges auth secrets, tokens and optional cnic', () => {
    const dirtyUser = {
      id: 'usr_123',
      name: 'Accountant Ali',
      email: 'ali@college.edu.pk',
      password: '$2b$12$eX4mpleH4sh...',
      totpSecretEnc: 'secret_totp_key',
      totpBackupCodes: ['1234', '5678'],
      totpLastStep: 12345678n,
      totpFailedAttempts: 2,
      totpLockedUntil: new Date(),
      verificationCode: '654321',
      resetCode: 'abcdef',
      firebaseUid: 'fb_123',
      qrCode: 'data:image/png;base64,...',
      authProvider: 'local',
      cnic: '35201-1234567-1'
    };

    const clean = sanitizeUserResponse(dirtyUser, { omitCnic: true });
    FORBIDDEN_USER_FIELDS.forEach((field) => {
      assert.strictEqual(clean[field], undefined, `Field ${field} must be purged`);
    });
    assert.strictEqual(clean.cnic, undefined, 'CNIC must be purged when omitCnic: true');
    assert.strictEqual(clean.id, 'usr_123');
    assert.strictEqual(clean.name, 'Accountant Ali');
  });

  // Test 4: Live database query with SAFE_USER_SELECT does not return any secret
  await asyncTest('Live DB user query using SAFE_USER_SELECT returns zero secret fields', async () => {
    const prisma = getSystemClient();
    const user = await prisma.user.findFirst({
      select: SAFE_USER_SELECT
    });

    if (user) {
      FORBIDDEN_USER_FIELDS.forEach((field) => {
        assert.strictEqual(
          user[field],
          undefined,
          `Live query result must not expose ${field}`
        );
      });
      assert.strictEqual(user.password, undefined, 'password must never be returned');
      assert.strictEqual(user.totpSecretEnc, undefined, 'totpSecretEnc must never be returned');
    }
  });

  // Test 5: Live DB user query using FINANCE_SAFE_USER_SELECT does not return cnic
  await asyncTest('Live DB user query using FINANCE_SAFE_USER_SELECT returns zero secret fields AND zero cnic', async () => {
    const prisma = getSystemClient();
    const user = await prisma.user.findFirst({
      select: FINANCE_SAFE_USER_SELECT
    });

    if (user) {
      FORBIDDEN_USER_FIELDS.forEach((field) => {
        assert.strictEqual(
          user[field],
          undefined,
          `Live finance query result must not expose ${field}`
        );
      });
      assert.strictEqual(user.cnic, undefined, 'CNIC must never be returned in finance select');
    }
  });

  await closeAllClients();

  console.log('\n----------------------------------------------------');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('----------------------------------------------------');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});

