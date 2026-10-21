/**
 * Verify Token Service
 * ─────────────────────────────────────────────────────────────
 * Central registry for public document verification tokens.
 * Maintains O(1) single-query lookup table in the system database
 * for Certificates, Vouchers, Paid Receipts, and Platform Invoices.
 * Also logs verification attempts with IP hashing for abuse tracking.
 */

const crypto = require('crypto');
const { getSystemClient } = require('../config/prismaManager');

/**
 * Hash an IP address using SHA-256 for privacy-preserving rate limit / abuse tracking
 *
 * @param {string} ip
 * @returns {string} Hex string hash
 */
function hashIp(ip) {
  if (!ip) return 'unknown';
  return crypto.createHash('sha256').update(String(ip).trim()).digest('hex');
}

/**
 * Record or update a verification token in the system database
 *
 * @param {Object} params
 * @param {string} params.token
 * @param {string} params.collegeId
 * @param {string} params.kind - 'certificate' | 'voucher' | 'receipt' | 'invoice'
 * @param {string} params.refId - Entity ID in tenant or system DB
 * @returns {Promise<Object>} Created or updated VerifyToken record
 */
async function recordVerifyToken({ token, collegeId, kind, refId }) {
  if (!token || !collegeId || !kind || !refId) {
    throw new Error('token, collegeId, kind, and refId are required to record verifyToken');
  }

  const sysDb = getSystemClient();
  return sysDb.verifyToken.upsert({
    where: { token },
    update: {
      college_id: collegeId,
      kind: kind.toLowerCase(),
      ref_id: refId
    },
    create: {
      token,
      college_id: collegeId,
      kind: kind.toLowerCase(),
      ref_id: refId
    }
  });
}

/**
 * Lookup a verification token in the system database
 *
 * @param {string} token
 * @returns {Promise<Object|null>}
 */
async function lookupVerifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const sysDb = getSystemClient();
  return sysDb.verifyToken.findUnique({
    where: { token }
  });
}

/**
 * Log verification attempt in VerifyLog
 *
 * @param {Object} params
 * @param {string} params.token - Token or attempted token
 * @param {string} params.ip - Client IP address
 * @param {string} [params.userAgent] - Client User-Agent
 * @param {string} params.status - 'VERIFIED' | 'NOT_FOUND' | 'DISABLED' | 'RATE_LIMITED'
 * @returns {Promise<Object>}
 */
async function logVerifyAttempt({ token, ip, userAgent, status }) {
  try {
    const sysDb = getSystemClient();
    const tokenPrefix = (token || '').slice(0, 8);
    const ipHash = hashIp(ip);

    return await sysDb.verifyLog.create({
      data: {
        tokenPrefix,
        ipHash,
        userAgent: userAgent ? String(userAgent).slice(0, 255) : null,
        status: status || 'UNKNOWN'
      }
    });
  } catch (err) {
    // Non-blocking logging failure
    console.error('Failed to write VerifyLog entry:', err.message);
    return null;
  }
}

module.exports = {
  recordVerifyToken,
  lookupVerifyToken,
  logVerifyAttempt,
  hashIp
};
