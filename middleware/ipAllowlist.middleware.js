// ─── IP Allow-list Enforcement Middleware (Phase 10: N15) ─────────────
const { getSystemClient } = require('../config/prismaManager');
const { isIpAllowed, recordViolation } = require('../services/ipAllowlistService');

// Administrative and financial roles covered by allow-list
const COVERED_ROLES = new Set([
  'admin',
  'principal',
  'registrar',
  'accountant',
  'college_admin'
]);

/**
 * Express middleware that checks client IP against active institutional allow-list rules
 */
async function ipAllowlistMiddleware(req, res, next) {
  try {
    // 1. Exemption: Public or unauthenticated routes
    if (!req.user && !req.apiKey) {
      return next();
    }

    // 2. Exemption: Super Admin
    if (req.user?.isSuperAdmin || req.user?.role === 'super_admin') {
      return next();
    }

    // 3. Exemption: API Keys (N06)
    if (req.apiKey) {
      return next();
    }

    // 4. Exemption: Non-administrative roles (teachers, students, guardians)
    const role = (req.user?.role || '').toLowerCase();
    const isAdminClass = Boolean(req.user?.isAdminClass || req.user?.customRole?.isAdminClass);
    const isCoveredRole = COVERED_ROLES.has(role) || isAdminClass;

    if (!isCoveredRole) {
      return next();
    }

    // 5. Exemption: Specific exempted URL prefixes
    const url = req.originalUrl || req.url;
    if (
      url.startsWith('/api/biometric') ||
      url.startsWith('/api/parent') ||
      url.startsWith('/api/webhooks') ||
      url.startsWith('/api/auth') ||
      url.startsWith('/public')
    ) {
      return next();
    }

    // 6. Tenant identification
    const collegeId = req.user?.college_id || req.headers['x-expected-college-id'];
    if (!collegeId) {
      return next();
    }

    const prisma = getSystemClient();
    const college = await prisma.college.findUnique({
      where: { id: collegeId },
      select: { id: true, planId: true, ipAllowlistMode: true }
    });

    if (!college) {
      return next();
    }

    const mode = (college.ipAllowlistMode || 'OFF').toUpperCase();
    if (mode === 'OFF') {
      return next();
    }

    // 7. Client IP extraction via Express req.ip (honors trust proxy configuration)
    const clientIp = req.ip || req.connection?.remoteAddress || '';

    // 8. Fetch active rules
    const rules = await prisma.ipAllowlistRule.findMany({
      where: { college_id: collegeId, isActive: true }
    });

    // If no rules exist, do not block
    if (rules.length === 0) {
      return next();
    }

    // 9. Evaluation
    const allowed = isIpAllowed(clientIp, rules);

    if (allowed) {
      return next();
    }

    // Violation encountered
    try {
      await recordViolation({
        college_id: collegeId,
        campus_id: req.user?.campus_id || null,
        userId: req.user?.id || null,
        ip: clientIp,
        path: url,
        mode
      });
    } catch (e) {
      console.warn('[IpAllowlist] Record violation error:', e.message);
    }

    if (mode === 'LOG_ONLY') {
      // In LOG_ONLY mode, record without blocking
      return next();
    }

    if (mode === 'ENFORCE') {
      return res.status(403).json({
        success: false,
        code: 'IP_NOT_ALLOWED',
        message: 'Access denied: your IP address is not permitted by institutional allow-list policy'
      });
    }

    return next();
  } catch (err) {
    console.error('[IpAllowlist] Middleware exception:', err);
    return next(); // Fail open for resilience, or next(err) if preferred
  }
}

module.exports = {
  ipAllowlistMiddleware,
  COVERED_ROLES
};
