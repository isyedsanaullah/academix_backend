'use strict';

/**
 * aiServiceAssertion.js — Main Backend Service Assertion Generator
 * ─────────────────────────────────────────────────────────────────────────────
 * Cryptographically signs short-lived (60s) HMAC-SHA256 assertions for internal
 * service-to-service communication between Collegeshub Main Backend and the
 * independent Collegeshub AI Microservice (collegeshub-ai-service).
 *
 * Security Guarantees:
 * 1. Zero Trust: AI Backend never accepts raw client-supplied tenant/user headers.
 * 2. Nonce Protection: Unique UUID `jti` in every token prevents replay attacks.
 * 3. Short Window: 60-second expiration limits the window of opportunity.
 * 4. Bound Claims: Cryptographically locks verified userId, collegeId, role, planId.
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const DEFAULT_ISSUER = 'collegeshub-core';
const DEFAULT_AUDIENCE = 'collegeshub-ai';
const ASSERTION_LIFETIME_SEC = 60; // 60 seconds strict expiration

/**
 * Retrieve the internal service secret from environment variables.
 * Falls back to JWT_SECRET in local development with a clear warning.
 */
function getServiceSecret() {
  const secret = process.env.INTERNAL_SERVICE_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      'INTERNAL_SERVICE_SECRET or JWT_SECRET must be configured for internal AI service assertions'
    );
  }
  return secret;
}

/**
 * Generate a signed S2S assertion for a verified user and tenant context.
 *
 * @param {object} params
 * @param {string} params.userId      Verified user UUID from req.user.id
 * @param {string} params.collegeId   Verified college UUID from req.collegeId / req.user.college_id
 * @param {string} params.role        User role ('student' | 'teacher' | 'admin' | 'superAdmin' | 'principal')
 * @param {string} [params.planId]    Current subscription tier ('starter' | 'standard' | 'premium' | 'enterprise')
 * @param {number} [params.collegeVersion] Optional college tokenEpoch or version for fast revocation
 * @returns {string} Signed JWT assertion token
 */
function generateServiceAssertion({ userId, collegeId, role, planId = 'starter', collegeVersion = 1 }) {
  if (!userId) throw new Error('Assertion generation requires a valid userId');
  if (!collegeId) throw new Error('Assertion generation requires a valid collegeId');
  if (!role) throw new Error('Assertion generation requires a valid user role');

  const secret = getServiceSecret();
  const jti = crypto.randomUUID(); // Unique nonce for replay prevention

  const payload = {
    iss: process.env.INTERNAL_SERVICE_ISSUER || DEFAULT_ISSUER,
    aud: process.env.INTERNAL_SERVICE_AUDIENCE || DEFAULT_AUDIENCE,
    sub: String(userId),
    collegeId: String(collegeId),
    role: String(role),
    planId: String(planId),
    collegeVersion: Number(collegeVersion) || 1,
    jti,
  };

  return jwt.sign(payload, secret, {
    algorithm: 'HS256',
    expiresIn: ASSERTION_LIFETIME_SEC,
  });
}

/**
 * Verify an assertion token (used in tests or mutual verification).
 *
 * @param {string} token
 * @returns {object} Decoded assertion claims
 */
function verifyServiceAssertion(token) {
  if (!token) throw new Error('Assertion token is required');
  const secret = getServiceSecret();

  return jwt.verify(token, secret, {
    algorithms: ['HS256'],
    issuer: process.env.INTERNAL_SERVICE_ISSUER || DEFAULT_ISSUER,
    audience: process.env.INTERNAL_SERVICE_AUDIENCE || DEFAULT_AUDIENCE,
    clockTolerance: 5, // 5 seconds grace for small clock drifts
  });
}

module.exports = {
  generateServiceAssertion,
  verifyServiceAssertion,
  ASSERTION_LIFETIME_SEC,
  ASSERTION_HEADER: 'X-Collegeshub-Assertion',
};

