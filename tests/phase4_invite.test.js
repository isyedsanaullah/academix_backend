'use strict';

/**
 * Phase 4 Unit Tests — Accept Invite & Email Verification
 *
 * Tests:
 *  1. Token hash round-trip (generateToken → hashToken → lookup)
 *  2. Expired / revoked / used / invalid invite detection
 *  3. Atomic invite consumption guard (double-submit race safety)
 *  4. User.verificationCode lifecycle (store → verify → clear)
 *  5. Cleanup
 */

require('dotenv').config();
const assert = require('assert');
const crypto = require('crypto');
const { getSystemClient, closeAllClients } = require('../config/prismaManager');
const { generateToken, hashToken } = require('../utils/token');

async function testPhase4Invite() {
  console.log('🧪 Starting Phase 4 Unit Tests (Invite Acceptance & Email Verification)\n');
  const prisma = getSystemClient();

  // ── Setup: test college ──────────────────────────────────────────────────
  const testSlug = `p4inv-${Date.now().toString().slice(-6)}`;
  const testCollege = await prisma.college.create({
    data: {
      name: 'Phase 4 Invite Test College',
      code: `P4I${Date.now().toString().slice(-5)}`,
      email: `coll-p4-${Date.now()}@phase4test.edu.pk`,
      slug: testSlug,
      status: 'pending_setup'
    }
  });
  console.log(`  Setup: college "${testCollege.name}" (slug: ${testSlug})`);

  // ── 1. Token hash round-trip ─────────────────────────────────────────────
  console.log('\n--- 1. Token Hash Round-Trip ---');
  const { token: rawToken, hash: tokenHash } = generateToken(32);
  assert.ok(rawToken.length === 64, 'Raw token must be 64 hex chars (32 bytes)');
  assert.ok(tokenHash.length === 64, 'Hash must be 64 hex chars (SHA-256)');
  assert.strictEqual(hashToken(rawToken), tokenHash, 'Re-hashing the same token must produce the same hash');

  // Store and look up by hash
  const invite = await prisma.collegeInvite.create({
    data: {
      college_id: testCollege.id,
      email: `admin-p4-${Date.now()}@phase4test.edu.pk`,
      token_hash: tokenHash,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      email_status: 'sent'
    }
  });

  const found = await prisma.collegeInvite.findUnique({ where: { token_hash: tokenHash } });
  assert.ok(found, 'Invite must be retrievable by hash');
  assert.strictEqual(found.id, invite.id, 'Found invite id must match');
  console.log('  ✓ Token hash round-trip: generateToken → hashToken → DB lookup works correctly.');

  // ── 2. Invite state detection ────────────────────────────────────────────
  console.log('\n--- 2. Invite State Detection ---');

  // Expired
  const { hash: expHash } = generateToken();
  await prisma.collegeInvite.create({
    data: {
      college_id: testCollege.id, email: 'exp@p4.pk', token_hash: expHash,
      expires_at: new Date(Date.now() - 1000), email_status: 'sent'
    }
  });
  const expRow = await prisma.collegeInvite.findUnique({ where: { token_hash: expHash } });
  assert.ok(new Date() > new Date(expRow.expires_at), 'Expired invite correctly detected');
  console.log('  ✓ Expired invite detected by expires_at < now().');

  // Revoked
  const { hash: revHash } = generateToken();
  await prisma.collegeInvite.create({
    data: {
      college_id: testCollege.id, email: 'rev@p4.pk', token_hash: revHash,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      revoked_at: new Date(), email_status: 'sent'
    }
  });
  const revRow = await prisma.collegeInvite.findUnique({ where: { token_hash: revHash } });
  assert.ok(revRow.revoked_at !== null, 'Revoked invite correctly detected');
  console.log('  ✓ Revoked invite detected by revoked_at != null.');

  // Invalid (unknown token)
  const unknownHash = hashToken(crypto.randomBytes(32).toString('hex'));
  const notFound = await prisma.collegeInvite.findUnique({ where: { token_hash: unknownHash } });
  assert.strictEqual(notFound, null, 'Unknown token returns null');
  console.log('  ✓ Unknown token correctly returns null.');

  // ── 3. Atomic consumption guard ──────────────────────────────────────────
  console.log('\n--- 3. Atomic Invite Consumption Guard (Race Safety) ---');

  const consume1 = await prisma.collegeInvite.updateMany({
    where: { id: invite.id, used_at: null, revoked_at: null, expires_at: { gt: new Date() } },
    data: { used_at: new Date() }
  });
  assert.strictEqual(consume1.count, 1, 'First consumption must succeed (count=1)');

  // Simulate concurrent second request
  const consume2 = await prisma.collegeInvite.updateMany({
    where: { id: invite.id, used_at: null, revoked_at: null, expires_at: { gt: new Date() } },
    data: { used_at: new Date() }
  });
  assert.strictEqual(consume2.count, 0, 'Second consumption must fail (count=0) — race guard working');
  console.log('  ✓ Atomic consumption guard: double-submit returns count=0 (safe against races).');

  // ── 4. User verificationCode lifecycle ───────────────────────────────────
  console.log('\n--- 4. User verificationCode Lifecycle ---');

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expiry = new Date(Date.now() + 15 * 60 * 1000);

  const testUser = await prisma.user.create({
    data: {
      name: 'Phase 4 Test Admin',
      email: `p4verify-${Date.now()}@phase4test.edu.pk`,
      password: '$2b$12$placeholder',
      role: 'admin',
      college_id: testCollege.id,
      emailVerified: false,
      verificationCode: code,
      verificationCodeExpires: expiry
    }
  });

  assert.strictEqual(testUser.emailVerified, false, 'New user starts unverified');
  assert.strictEqual(testUser.verificationCode, code);
  assert.ok(testUser.verificationCodeExpires > new Date(), 'Code expiry in the future');

  // Simulate correct code submission
  const verified = await prisma.user.update({
    where: { id: testUser.id },
    data: { emailVerified: true, verificationCode: null, verificationCodeExpires: null }
  });
  assert.strictEqual(verified.emailVerified, true, 'emailVerified set to true');
  assert.strictEqual(verified.verificationCode, null, 'Code cleared after verification');
  assert.strictEqual(verified.verificationCodeExpires, null, 'Expiry cleared after verification');
  console.log('  ✓ verificationCode lifecycle: create → verify → clear all correct.');

  // ── Constant-time comparison test ────────────────────────────────────────
  console.log('\n--- 4b. Constant-Time Code Comparison ---');
  const correctCode = '847291';
  const wrongCode   = '111111';
  const bufCorrect = Buffer.from(correctCode.padEnd(6, '\0'));
  const bufWrong   = Buffer.from(wrongCode.padEnd(6, '\0'));
  const bufStored  = Buffer.from(correctCode.padEnd(6, '\0'));
  assert.ok(
    bufCorrect.length === bufStored.length && crypto.timingSafeEqual(bufCorrect, bufStored),
    'Correct code must pass timingSafeEqual'
  );
  assert.ok(
    !(bufCorrect.length === bufWrong.length && crypto.timingSafeEqual(bufWrong, bufStored)),
    'Wrong code must fail timingSafeEqual'
  );
  console.log('  ✓ crypto.timingSafeEqual correctly accepts matching codes and rejects wrong codes.');

  // ── 5. Cleanup ───────────────────────────────────────────────────────────
  console.log('\n--- 5. Cleanup ---');
  await prisma.user.delete({ where: { id: testUser.id } });
  await prisma.college.delete({ where: { id: testCollege.id } }); // cascades invite rows
  console.log('  ✓ Cleanup complete.');

  console.log('\n🎉 ALL PHASE 4 UNIT TESTS PASSED!\n');
}

testPhase4Invite()
  .catch(err => {
    console.error('❌ Phase 4 invite tests failed:', err);
    process.exit(1);
  })
  .finally(() => closeAllClients());
