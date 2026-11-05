'use strict';

/**
 * apiKeyService.js — Phase 9E (#N06)
 * Service for Public API Keys:
 * - SHA-256 key hashing with 8-character lookup prefix
 * - Constant-time comparison
 * - Scoped read-only access (v1)
 * - Single-reveal key creation
 */

const crypto = require('crypto');
const { getSystemClient } = require('../config/prismaManager');

function getPrisma() {
  return getSystemClient();
}

function hashKey(rawKey) {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

/**
 * Generate a new API key for an institution
 * Raw key is revealed only ONCE upon creation.
 */
async function generateApiKey({
  collegeId,
  campusId = null,
  name,
  scopes = ['read:students', 'read:attendance', 'read:fees', 'read:academics'],
  expiresAt = null,
  createdBy
}) {
  const prisma = getPrisma();

  if (!name || typeof name !== 'string' || !name.trim()) {
    throw Object.assign(new Error('API key name is required.'), { status: 400, code: 'INVALID_NAME' });
  }

  // Generate 8-char prefix + 24-byte random hex
  const keyPrefix = crypto.randomBytes(4).toString('hex'); // 8 hex chars
  const secretPart = crypto.randomBytes(24).toString('hex'); // 48 hex chars
  const rawKey = `acx_live_${keyPrefix}_${secretPart}`;

  const keyHash = hashKey(rawKey);

  const apiKey = await prisma.apiKey.create({
    data: {
      college_id: collegeId,
      campus_id: campusId,
      name: name.trim(),
      keyPrefix,
      keyHash,
      scopes,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      isActive: true,
      createdBy
    }
  });

  return {
    id: apiKey.id,
    name: apiKey.name,
    keyPrefix: apiKey.keyPrefix,
    scopes: apiKey.scopes,
    expiresAt: apiKey.expiresAt,
    createdAt: apiKey.createdAt,
    rawKey // Only time the plaintext key is returned!
  };
}

/**
 * Validate raw API key presented in request header
 * Uses constant-time hash comparison
 */
async function validateApiKey(rawKey) {
  if (!rawKey || typeof rawKey !== 'string') return null;

  const parts = rawKey.split('_');
  if (parts.length !== 4 || parts[0] !== 'acx' || parts[1] !== 'live') {
    return null;
  }

  const keyPrefix = parts[2];
  const computedHash = hashKey(rawKey);
  const prisma = getPrisma();

  const candidates = await prisma.apiKey.findMany({
    where: {
      keyPrefix,
      isActive: true
    }
  });

  for (const candidate of candidates) {
    const candidateHashBuf = Buffer.from(candidate.keyHash, 'utf8');
    const computedHashBuf = Buffer.from(computedHash, 'utf8');

    if (candidateHashBuf.length === computedHashBuf.length && crypto.timingSafeEqual(candidateHashBuf, computedHashBuf)) {
      // Check expiration
      if (candidate.expiresAt && new Date(candidate.expiresAt) < new Date()) {
        return { valid: false, reason: 'EXPIRED', key: candidate };
      }

      // Update lastUsedAt in background
      prisma.apiKey.update({
        where: { id: candidate.id },
        data: { lastUsedAt: new Date() }
      }).catch(err => console.error('[apiKeyService] Error updating lastUsedAt:', err));

      return { valid: true, key: candidate };
    }
  }

  return null;
}

/**
 * Revoke / deactivate an API key
 */
async function revokeApiKey(collegeId, apiKeyId) {
  const prisma = getPrisma();
  return prisma.apiKey.updateMany({
    where: { id: apiKeyId, college_id: collegeId },
    data: { isActive: false }
  });
}

/**
 * List all API keys for an institution (excluding secrets)
 */
async function listApiKeys(collegeId) {
  const prisma = getPrisma();
  return prisma.apiKey.findMany({
    where: { college_id: collegeId },
    select: {
      id: true,
      name: true,
      keyPrefix: true,
      scopes: true,
      isActive: true,
      createdAt: true,
      expiresAt: true,
      lastUsedAt: true,
      createdBy: true
    },
    orderBy: { createdAt: 'desc' }
  });
}

module.exports = {
  generateApiKey,
  validateApiKey,
  revokeApiKey,
  listApiKeys
};

