'use strict';

/**
 * requirePermission.js — Phase 9C (#N10)
 * Permission Check Middleware:
 * Verifies that the authenticated user possesses the required permission,
 * either implicitly via fixed system role or explicitly via an active custom role.
 * Super Admin bypasses all checks platform-wide.
 * On downgrade/lack of N10 entitlement, custom roles are dormant and base role applies.
 */

const { getUserPermissions } = require('../services/customRoleService');

function requirePermission(requiredPermission) {
  return async function (req, res, next) {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          code: 'UNAUTHORIZED',
          message: 'Authentication required'
        });
      }

      const role = String(req.user.role || '').toLowerCase();

      // Super Admin bypasses all checks globally
      if (role === 'superadmin') {
        return next();
      }

      const collegeId = req.user.college_id || req.headers['x-college-id'];
      if (!collegeId) {
        return res.status(403).json({
          success: false,
          code: 'COLLEGE_REQUIRED',
          message: 'College context is required for permission check'
        });
      }

      const userPermissions = await getUserPermissions(collegeId, req.user);
      req.userPermissions = userPermissions;

      if (!userPermissions.includes(requiredPermission)) {
        return res.status(403).json({
          success: false,
          code: 'INSUFFICIENT_PERMISSIONS',
          message: `Missing required permission: ${requiredPermission}`
        });
      }

      return next();
    } catch (err) {
      console.error(`[requirePermission] Error checking permission ${requiredPermission}:`, err);
      return res.status(500).json({
        success: false,
        code: 'INTERNAL_ERROR',
        message: 'Error verifying permissions'
      });
    }
  };
}

module.exports = requirePermission;

