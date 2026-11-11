'use strict';

const assert = require('assert');
process.env.INTERNAL_SERVICE_SECRET = 'test-internal-secret-for-ai-microservice-32bytes';

const {
  generateServiceAssertion,
  verifyServiceAssertion,
  ASSERTION_LIFETIME_SEC,
  ASSERTION_HEADER,
} = require('../services/aiServiceAssertion');

console.log('Testing aiServiceAssertion.js...');

// 1. Header constant check
assert.strictEqual(ASSERTION_HEADER, 'X-Collegeshub-Assertion');

// 2. Successful generation and decoding
const token = generateServiceAssertion({
  userId: 'user-uuid-1234',
  collegeId: 'college-uuid-5678',
  role: 'student',
  planId: 'premium',
});

assert(typeof token === 'string' && token.split('.').length === 3, 'Token must be valid JWT format');

const decoded = verifyServiceAssertion(token);
assert.strictEqual(decoded.sub, 'user-uuid-1234');
assert.strictEqual(decoded.collegeId, 'college-uuid-5678');
assert.strictEqual(decoded.role, 'student');
assert.strictEqual(decoded.planId, 'premium');
assert.strictEqual(decoded.iss, 'collegeshub-core');
assert.strictEqual(decoded.aud, 'collegeshub-ai');
assert(decoded.jti && typeof decoded.jti === 'string', 'Token must contain jti nonce');
assert(decoded.exp - decoded.iat === ASSERTION_LIFETIME_SEC, 'Expiration must be strictly 60 seconds');

// 3. Successive tokens must have unique nonces
const token2 = generateServiceAssertion({
  userId: 'user-uuid-1234',
  collegeId: 'college-uuid-5678',
  role: 'student',
});
const decoded2 = verifyServiceAssertion(token2);
assert.notStrictEqual(decoded.jti, decoded2.jti, 'Successive tokens must generate distinct jti nonces');

// 4. Missing required fields must throw
assert.throws(() => {
  generateServiceAssertion({ collegeId: 'c1', role: 'student' });
}, /requires a valid userId/);

assert.throws(() => {
  generateServiceAssertion({ userId: 'u1', role: 'student' });
}, /requires a valid collegeId/);

assert.throws(() => {
  generateServiceAssertion({ userId: 'u1', collegeId: 'c1' });
}, /requires a valid user role/);

// 5. Tampered token must fail verification
const tamperedToken = token.slice(0, -5) + 'abcde';
assert.throws(() => {
  verifyServiceAssertion(tamperedToken);
}, /invalid signature/);

console.log('✅ All aiServiceAssertion tests passed successfully.');

