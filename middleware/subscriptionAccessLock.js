'use strict';

const { getSystemClient } = require('../config/prismaManager');
const { computeSubscriptionSnapshot } = require('../services/subscriptionStateService');

const INACTIVE_COLLEGE_MESSAGE = 'College subscription inactive, contact your administration';
const ADMIN_LOCKED_MESSAGE = 'Your trial or subscription has ended. Please renew your subscription to restore access.';

// Authenticated routes that remain accessible to ALL roles (or admin-only billing routes when locked)
const ALWAYS_ALLOWED_PREFIXES = [
  '/api/auth/update-password',
  '/api/auth/2fa',
  '/api/auth/known-devices',
  '/api/auth/step-up',
  '/api/auth/verify-email',
  '/api/auth/resend-verification',
  '/api/public',
  '/api/health',
];

const ADMIN_ALLOWED_WHEN_LOCKED_PREFIXES = [
  '/api/auth/me',
  '/api/me',
  '/api/college/info',
  '/api/colleges/info',
  '/api/colleges/invoices',
  '/api/subscription',
  '/api/files/download-key',
];

function stripQuery(url = '') {
  return String(url).split('?')[0].toLowerCase();
}

function matchesPrefix(path, prefixes) {
  return prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}.`));
}

/**
 * Evaluates subscription access lock for a request with an authenticated `req.user`.
 * - Super Admins are NEVER blocked.
 * - While locked (EXPIRED, DEACTIVATED, or overdue TRIAL/ACTIVE):
 *   - Non-admin college users (students, teachers, employees, staff) are blocked on ALL protected routes.
 *   - College Admins (`role === 'admin'`) are allowed ONLY on billing/renewal/auth-me routes.
 */
async function evaluateSubscriptionAccess(req, res, next) {
  try {
    if (!req.user) return next();

    // Super Admin is never blocked
    if (req.user.role === 'superAdmin' || req.user.isSuperAdmin) {
      return next();
    }

    const collegeId = req.user.college_id;
    if (!collegeId) {
      return next();
    }

    const prisma = getSystemClient();
    const college = await prisma.college.findUnique({
      where: { id: collegeId },
      select: {
        id: true,
        isActive: true,
        subStatus: true,
        trialStartedAt: true,
        trialEndsAt: true,
        periodStart: true,
        periodEnd: true,
        forceReadOnly: true,
        readOnlyReason: true,
      },
    });

    if (!college) {
      return res.status(403).json({
        success: false,
        code: 'SUBSCRIPTION_INACTIVE',
        message: INACTIVE_COLLEGE_MESSAGE,
      });
    }

    const snapshot = computeSubscriptionSnapshot(college);
    req.subscriptionSnapshot = snapshot;

    if (!snapshot.isLocked) {
      return next();
    }

    const cleanPath = stripQuery(req.originalUrl || req.url || '');
    const isAdmin = req.user.role === 'admin';

    // Non-admin college users are completely locked out of the system
    if (!isAdmin) {
      return res.status(403).json({
        success: false,
        code: 'SUBSCRIPTION_INACTIVE',
        lockReason: snapshot.lockReason,
        subStatus: snapshot.effectiveSubStatus,
        message: INACTIVE_COLLEGE_MESSAGE,
      });
    }

    // College admin while locked: allow only billing, renewal, and core session/info endpoints
    if (
      matchesPrefix(cleanPath, ALWAYS_ALLOWED_PREFIXES) ||
      matchesPrefix(cleanPath, ADMIN_ALLOWED_WHEN_LOCKED_PREFIXES)
    ) {
      return next();
    }

    return res.status(403).json({
      success: false,
      code: 'SUBSCRIPTION_LOCKED_RENEWAL_REQUIRED',
      lockReason: snapshot.lockReason,
      subStatus: snapshot.effectiveSubStatus,
      trialEndsAt: snapshot.trialEndsAt,
      periodEnd: snapshot.periodEnd,
      message: ADMIN_LOCKED_MESSAGE,
    });
  } catch (err) {
    console.error('[SubscriptionAccessLock] Error:', err.message);
    return res.status(500).json({
      success: false,
      code: 'SUBSCRIPTION_CHECK_ERROR',
      message: 'Failed to verify institution subscription status.',
    });
  }
}

module.exports = {
  evaluateSubscriptionAccess,
  INACTIVE_COLLEGE_MESSAGE,
  ADMIN_LOCKED_MESSAGE,
};

