'use strict';

/**
 * Phase 4 — requireVerifiedEmail middleware
 *
 * Applied to endpoints that must not run until the college admin has verified
 * their email address. This covers:
 *   - Creating/importing users (staff, students)
 *   - Any import batch endpoints
 *   - The onboarding launch endpoint (Phase 7)
 *
 * Usage:
 *   router.post('/admin/staff', protect, requireVerifiedEmail, createStaff);
 *
 * Rules:
 *   - superAdmin is always allowed through (they register via a different flow).
 *   - All other roles: must have user.emailVerified === true.
 *   - Returns 403 with a clear code so the frontend can show the right message.
 */

module.exports = function requireVerifiedEmail(req, res, next) {
  // Super admin has no email verification requirement
  if (req.user && req.user.role === 'superAdmin') {
    return next();
  }

  if (!req.user || req.user.emailVerified !== true) {
    return res.status(403).json({
      success: false,
      message: 'Please verify your email address before performing this action.',
      code: 'EMAIL_NOT_VERIFIED'
    });
  }

  return next();
};
