'use strict';

/**
 * adaptive2fa.test.js — Unit test for Adaptive 2FA & Known Device Recognition
 */

const assert = require('assert');
const {
  recordFailedPasswordAttempt,
  hasRecentFailedPassword,
  clearFailedPasswordAttempt,
  isKnownDevice
} = require('../controllers/twoFactor.controller');
const { verifyTotpCode, generate2FASetup, base32Decode, generateCodeForStep } = require('../services/twoFactorService');

async function runTests() {
  console.log('Testing Adaptive 2FA & Known Device Recognition...');

  // 1. Test Failed Password Tracking
  const testUserId = 'test-user-uuid-999';
  assert.strictEqual(hasRecentFailedPassword(testUserId), false, 'Initially should have no failed password');

  recordFailedPasswordAttempt(testUserId);
  assert.strictEqual(hasRecentFailedPassword(testUserId), true, 'Should detect recent failed password');

  clearFailedPasswordAttempt(testUserId);
  assert.strictEqual(hasRecentFailedPassword(testUserId), false, 'Should be cleared after successful auth');
  console.log('✔ Failed password tracker works correctly');

  // 2. Test TOTP verification window tolerance (+-2 window = +-60s)
  const setup = generate2FASetup('test@example.com');
  const secretBytes = base32Decode(setup.secretBase32);
  const nowMs = Date.now();
  const currentStep = Math.floor(nowMs / 1000 / 30);

  // Current step code
  const currentCode = generateCodeForStep(secretBytes, currentStep);
  const vCurrent = verifyTotpCode({ secretBase32: setup.secretBase32, code: currentCode, nowMs });
  assert.strictEqual(vCurrent.valid, true, 'Current code should be valid');

  // Code from 1 step ago (-30s)
  const stepMinus1Code = generateCodeForStep(secretBytes, currentStep - 1);
  const vMinus1 = verifyTotpCode({ secretBase32: setup.secretBase32, code: stepMinus1Code, nowMs });
  assert.strictEqual(vMinus1.valid, true, 'Code from -30s should be valid under window=2');

  // Code from 2 steps ago (-60s)
  const stepMinus2Code = generateCodeForStep(secretBytes, currentStep - 2);
  const vMinus2 = verifyTotpCode({ secretBase32: setup.secretBase32, code: stepMinus2Code, nowMs });
  assert.strictEqual(vMinus2.valid, true, 'Code from -60s should be valid under window=2');

  console.log('✔ TOTP +-60s drift window tolerance verified');

  // 3. Test Unknown Device Check
  const mockReqNoCookie = { cookies: {}, headers: {} };
  const mockUser = { id: 'some-user', college_id: 'col-1' };
  const isKnown = await isKnownDevice(mockReqNoCookie, mockUser);
  assert.strictEqual(isKnown, false, 'Device without cookie should not be recognized');
  console.log('✔ Unknown device rejection verified');

  console.log('✅ All Adaptive 2FA tests passed successfully!');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});

