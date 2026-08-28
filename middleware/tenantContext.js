/**
 * Tenant Context Middleware
 * ──────────────────────────
 * Injects college_id AND the correct tenant PostgreSQL DB connection (via Prisma) into the request.
 *
 * After this middleware runs, controllers can use:
 *   req.collegeId   — the UUID/String of the college
 *   req.isSuperAdmin — boolean
 *   req.tenantClient — Prisma Client instance bound to the college's PostgreSQL DB
 */
const { getTenantClient, getSystemClient } = require('../config/prismaManager');

const tenantContext = async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Not authenticated'
    });
  }

  // Super admins are not scoped to a single college
  if (req.user.role === 'superAdmin') {
    req.collegeId = req.query.college_id || req.body.college_id || null;
    req.isSuperAdmin = true;
    
    try {
      const systemClient = getSystemClient();
      let tenantClient = systemClient;
      if (req.collegeId) {
        const college = await systemClient.college.findUnique({
          where: { id: req.collegeId },
          select: { mongoUrl: true }
        });
        if (college) {
          const dbUrl = college.mongoUrl || process.env.DATABASE_URL;
          tenantClient = getTenantClient(dbUrl);
        }
      }
      req.tenantClient = tenantClient;
      return next();
    } catch (err) {
      console.error('❌ Failed to retrieve system/tenant database context for super admin:', err.message);
      return res.status(500).json({
        success: false,
        message: 'System database is unavailable.'
      });
    }
  }

  // All other roles must have a college_id
  if (!req.user.college_id) {
    return res.status(403).json({
      success: false,
      message: 'User is not associated with any college'
    });
  }

  req.collegeId = req.user.college_id;
  req.isSuperAdmin = false;

  try {
    // 1. Get the system database context to retrieve college details
    const systemClient = getSystemClient();
    
    // Query College from PostgreSQL system DB using system PrismaClient
    const college = await systemClient.college.findUnique({
      where: { id: req.collegeId },
      select: { mongoUrl: true, code: true, name: true }
    });

    if (!college) {
      return res.status(404).json({
        success: false,
        message: `College not found: ${req.collegeId}`
      });
    }

    const dbUrl = college.mongoUrl || process.env.DATABASE_URL;
    if (!dbUrl) {
      return res.status(400).json({
        success: false,
        message: `No database URL configured for college: ${college.name}`
      });
    }

    // 2. Get dynamic tenant Prisma Client using the college's PostgreSQL URL or fallback
    try {
      req.tenantClient = getTenantClient(dbUrl);
    } catch (err) {
      console.warn(`⚠️ Failed to initialize tenant client for college ${college.code}, falling back to system client:`, err.message);
      req.tenantClient = systemClient;
    }

    next();
  } catch (error) {
    console.error(`❌ Tenant context error for college ${req.collegeId}:`, error.message);
    return res.status(503).json({
      success: false,
      message: 'College database is not available. Please contact the administrator.'
    });
  }
};

module.exports = tenantContext;
