'use strict';

/**
 * Shared Safe User Field Projections
 * Prevents password hashes, 2FA/TOTP secrets, verification codes, and tokens
 * from leaking into API responses.
 */

// Base safe user projection for tenant management (keeps cnic for staff/student records, excludes auth secrets)
const SAFE_USER_SELECT = {
  id: true,
  college_id: true,
  name: true,
  email: true,
  username: true,
  emailVerified: true,
  role: true,
  phone: true,
  cnic: true,
  avatar: true,
  isActive: true,
  lastLogin: true,
  totpEnabled: true,
  twofaEnrolledAt: true,
  createdAt: true,
  updatedAt: true
};

// Strict safe user projection for Superadmin finance & accounting
// Omit cnic, qrCode, authProvider, and all tokens/secrets
const FINANCE_SAFE_USER_SELECT = {
  id: true,
  college_id: true,
  name: true,
  email: true,
  username: true,
  role: true,
  phone: true,
  avatar: true,
  isActive: true,
  lastLogin: true,
  totpEnabled: true,
  twofaEnrolledAt: true,
  createdAt: true,
  updatedAt: true
};

// Blacklist of forbidden sensitive fields for verification assertions
const FORBIDDEN_USER_FIELDS = [
  'password',
  'totpSecretEnc',
  'totpBackupCodes',
  'totpLastStep',
  'totpFailedAttempts',
  'totpLockedUntil',
  'verificationCode',
  'verificationCodeExpires',
  'resetCode',
  'resetCodeExpires',
  'firebaseUid',
  'qrCode',
  'authProvider'
];

/**
 * Strips forbidden fields from an in-memory user object as a secondary defense layer
 * @param {Object} user 
 * @param {Object} opts { omitCnic: boolean }
 * @returns {Object}
 */
function sanitizeUserResponse(user, opts = {}) {
  if (!user || typeof user !== 'object') return user;
  const clone = { ...user };
  FORBIDDEN_USER_FIELDS.forEach((field) => {
    delete clone[field];
  });
  if (opts.omitCnic) {
    delete clone.cnic;
  }
  return clone;
}

module.exports = {
  SAFE_USER_SELECT,
  FINANCE_SAFE_USER_SELECT,
  FORBIDDEN_USER_FIELDS,
  sanitizeUserResponse
};

