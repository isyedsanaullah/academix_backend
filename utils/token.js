'use strict';

const crypto = require('crypto');

/**
 * Generate a cryptographically secure token and its SHA-256 hash.
 * Only the hash should be stored in the database.
 * The raw token is sent only in single-use links or one-time emails.
 *
 * @param {number} [byteLength=32]
 * @returns {{ token: string, hash: string }}
 */
function generateToken(byteLength = 32) {
  const token = crypto.randomBytes(byteLength).toString('hex');
  const hash = hashToken(token);
  return { token, hash };
}

/**
 * Compute SHA-256 hash of a string in hex encoding.
 * @param {string} token
 * @returns {string}
 */
function hashToken(token) {
  if (!token || typeof token !== 'string') {
    throw new TypeError('Token must be a non-empty string');
  }
  return crypto.createHash('sha256').update(token.trim()).digest('hex');
}

/**
 * Constant-time comparison of a raw token against a stored SHA-256 hash.
 * Prevents timing attacks.
 *
 * @param {string} rawToken
 * @param {string} storedHash
 * @returns {boolean}
 */
function verifyTokenHash(rawToken, storedHash) {
  if (!rawToken || !storedHash || typeof rawToken !== 'string' || typeof storedHash !== 'string') {
    return false;
  }

  const computedHash = hashToken(rawToken);
  const computedBuffer = Buffer.from(computedHash, 'utf8');
  const storedBuffer = Buffer.from(storedHash, 'utf8');

  if (computedBuffer.length !== storedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(computedBuffer, storedBuffer);
}

module.exports = {
  generateToken,
  hashToken,
  verifyTokenHash
};
