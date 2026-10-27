'use strict';

require('dotenv').config();
const assert = require('assert');
const { isValidSlug, isReservedSlug, normalizeSlug, RESERVED_SLUGS } = require('../utils/reservedSlugs');
const { generateToken, hashToken, verifyTokenHash } = require('../utils/token');
const { buildCollegeshubTemplate, toPlainText } = require('../services/mailService');
const { getSystemClient, closeAllClients } = require('../config/prismaManager');

async function testPhase0() {
  console.log('🧪 Starting Phase 0 Unit Tests & Acceptance Validation...\n');

  // 1. Slug Validation Tests
  console.log('--- 1. Testing Slug Validation & Reserved Slugs ---');
  assert.strictEqual(isValidSlug('fmc'), true, 'fmc should be valid');
  assert.strictEqual(isValidSlug('pcs'), true, 'pcs should be valid');
  assert.strictEqual(isValidSlug('punjab-college-99'), true, 'valid hyphenated slug');
  assert.strictEqual(isValidSlug('ab'), false, 'too short (<3 chars) must be rejected');
  assert.strictEqual(isValidSlug('a'.repeat(31)), false, 'too long (>30 chars) must be rejected');
  assert.strictEqual(isValidSlug('-fmc'), false, 'leading hyphen must be rejected');
  assert.strictEqual(isValidSlug('fmc-'), false, 'trailing hyphen must be rejected');
  assert.strictEqual(isValidSlug('fmc_college'), false, 'underscores must be rejected');
  assert.strictEqual(isValidSlug('fmc.college'), false, 'dots must be rejected');
  assert.strictEqual(isValidSlug('FMC'), true, 'uppercase normalized should be valid');

  // Reserved slug checks
  for (const reserved of ['admin', 'api', 'login', 'super-admin', 'billing', 'root']) {
    assert.strictEqual(isReservedSlug(reserved), true, `${reserved} must be recognized as reserved`);
    assert.strictEqual(isValidSlug(reserved), false, `${reserved} must be rejected by isValidSlug`);
  }
  console.log('  ✓ Slug rules and reserved slugs passed all assertions.');

  // 2. Token Generator & Verification Tests
  console.log('\n--- 2. Testing Crypto Token Generation & Constant-Time Verification ---');
  const tokenData = generateToken();
  assert.ok(tokenData.token, 'token must exist');
  assert.strictEqual(tokenData.token.length, 64, '32 bytes hex = 64 characters');
  assert.ok(tokenData.hash, 'hash must exist');
  assert.strictEqual(tokenData.hash.length, 64, 'SHA-256 hex = 64 characters');
  assert.strictEqual(hashToken(tokenData.token), tokenData.hash, 'hash matches sha256 of token');

  // Verify valid token
  assert.strictEqual(verifyTokenHash(tokenData.token, tokenData.hash), true, 'valid token verification must pass');

  // Verify tampered token
  const tamperedToken = tokenData.token.slice(0, -1) + (tokenData.token.endsWith('a') ? 'b' : 'a');
  assert.strictEqual(verifyTokenHash(tamperedToken, tokenData.hash), false, 'tampered token verification must fail');
  assert.strictEqual(verifyTokenHash('', tokenData.hash), false, 'empty token must fail');
  assert.strictEqual(verifyTokenHash(tokenData.token, 'invalidhash'), false, 'invalid hash must fail');
  console.log('  ✓ Token generation and timing-safe verification passed all assertions.');

  // 3. Mail Service Template Helper Test
  console.log('\n--- 3. Testing Collegeshub Branded Email Template ---');
  const html = buildCollegeshubTemplate({
    title: 'Welcome to Collegeshub',
    preheader: 'Your invitation has arrived',
    bodyHtml: '<p>Setup your college portal.</p>',
    buttonText: 'Setup College',
    buttonUrl: 'https://fmc.collegeshub.org/setup/abc123token'
  });

  assert.ok(html.includes('#0A4D94'), 'Must contain brand blue #0A4D94');
  assert.ok(html.includes('#299A49'), 'Must contain brand green #299A49');
  assert.ok(html.includes('.org'), 'Must contain .org branding');
  assert.ok(!html.includes('Academix'), 'Must NEVER contain legacy Academix string');

  const text = toPlainText({
    title: 'Welcome to Collegeshub',
    bodyText: 'Setup your college portal.',
    buttonText: 'Setup College',
    buttonUrl: 'https://fmc.collegeshub.org/setup/abc123token'
  });
  assert.ok(text.includes('Collegeshub.org'), 'Plain text has Collegeshub.org');
  assert.ok(text.includes('https://fmc.collegeshub.org/setup/abc123token'), 'Plain text has url');
  console.log('  ✓ Email template builder passed all assertions.');

  // 4. Database Backfill Validation
  console.log('\n--- 4. Validating Active Colleges in Database ---');
  const prisma = getSystemClient();
  const colleges = await prisma.college.findMany({
    select: {
      id: true,
      name: true,
      code: true,
      slug: true,
      status: true,
      tagline: true,
      activated_at: true
    }
  });

  assert.ok(colleges.length >= 2, 'Must have at least 2 colleges');
  for (const c of colleges) {
    assert.strictEqual(c.status, 'active', `College ${c.code} status must be active`);
    assert.ok(c.slug && c.slug.length >= 3, `College ${c.code} must have a valid slug`);
    assert.strictEqual(isValidSlug(c.slug), true, `Slug ${c.slug} must pass isValidSlug`);
    assert.ok(c.activated_at instanceof Date, `College ${c.code} must have activated_at date`);
    console.log(`  ✓ DB College [${c.code}]: slug="${c.slug}", status="${c.status}", activated_at=${c.activated_at.toISOString()}`);
  }

  console.log('\n🎉 ALL PHASE 0 UNIT TESTS & ACCEPTANCE CHECKS PASSED SUCCESSFULLY!\n');
}

testPhase0()
  .catch((err) => {
    console.error('❌ Phase 0 tests failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await closeAllClients();
  });
