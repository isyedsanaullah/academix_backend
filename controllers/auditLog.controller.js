// ─── Audit Log Controller (Multi-DB with Prisma) ───────────────────
const { getSystemClient, getTenantClient } = require('../config/prismaManager');

exports.getLogs = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { action, user_id, page = 1, limit = 50 } = req.query;
    
    const where = {};
    if (req.collegeId) where.college_id = req.collegeId;
    if (action) where.action = action;
    if (user_id) where.user_id = user_id;

    const take = parseInt(limit) || 50;
    const skip = (parseInt(page) - 1) * take;

    const [logs, total] = await Promise.all([
      tenantDb.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take
      }),
      tenantDb.auditLog.count({ where })
    ]);

    res.json({
      success: true,
      data: logs.map(l => ({ ...l, _id: l.id })),
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / take)
      }
    });
  } catch (error) {
    next(error);
  }
};

// Utility function to create audit log (used by other controllers/middleware)
exports.createLog = async ({ college_id, user_id, action, resource, resourceId, details, ipAddress, userAgent }) => {
  try {
    let tenantDb;
    if (college_id) {
      const systemDb = getSystemClient();
      const college = await systemDb.college.findUnique({
        where: { id: college_id }
      });
      const connectionUrl = college?.mongoUrl || process.env.DATABASE_URL;
      tenantDb = getTenantClient(connectionUrl);
    } else {
      tenantDb = getSystemClient();
    }

    await tenantDb.auditLog.create({
      data: {
        college_id: college_id || null,
        user_id,
        action,
        resource: resource || null,
        resourceId: resourceId || null,
        details: details || null,
        ipAddress: ipAddress || null,
        userAgent: userAgent || null
      }
    });
  } catch (error) {
    console.error('❌ Audit log creation error:', error.message);
  }
};
