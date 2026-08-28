/**
 * ActivityLog Service
 * Handles activity logging and role-scoped activity retrieval.
 */

const { getSystemClient, getTenantClient } = require('../config/prismaManager');
const { buildVisibilityQuery } = require('./activityVisibilityPolicy');
const { formatActivityForViewer } = require('./activityPresenter');
const { STATUSES } = require('../config/activityConstants');

// Forbidden metadata fields (security rule)
const FORBIDDEN_METADATA_KEYS = [
  'password', 'passwordHash', 'hash', 'token', 'refreshToken',
  'accessToken', 'apiKey', 'secret', 'encryptedKey', 'cvv', 'pin'
];

/**
 * Sanitize metadata object to prevent logging credentials or sensitive keys.
 */
function sanitizeMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') return null;

  const sanitized = {};
  for (const [key, value] of Object.entries(metadata)) {
    const lowerKey = key.toLowerCase();
    if (FORBIDDEN_METADATA_KEYS.some(k => lowerKey.includes(k.toLowerCase()))) {
      continue; // Skip sensitive fields
    }
    // Avoid serializing huge circular DB objects
    if (value && typeof value === 'object') {
      if (value.id || value._id || value.name || value.title) {
        sanitized[key] = {
          id: value.id || value._id,
          name: value.name || value.title || value.label || undefined
        };
      } else {
        sanitized[key] = String(value).slice(0, 100);
      }
    } else {
      sanitized[key] = value;
    }
  }
  return Object.keys(sanitized).length > 0 ? sanitized : null;
}

/**
 * Internal method to log an application event.
 */
async function logActivity({
  college_id = null,
  actorUser = null,
  action,
  category,
  resourceType = null,
  resourceId = null,
  targetUserId = null,
  title = null,
  description = null,
  status = STATUSES.COMPLETED,
  metadata = null
}) {
  try {
    let tenantDb;
    if (college_id) {
      const systemDb = getSystemClient();
      const college = await systemDb.college.findUnique({
        where: { id: college_id },
        select: { mongoUrl: true }
      }).catch(() => null);

      const connectionUrl = college?.mongoUrl || process.env.DATABASE_URL;
      tenantDb = getTenantClient(connectionUrl);
    } else {
      tenantDb = getSystemClient();
    }

    const sanitizedMeta = sanitizeMetadata(metadata);

    const record = await tenantDb.activityLog.create({
      data: {
        college_id: college_id || null,
        actorUserId: actorUser?.id || actorUser?._id || null,
        actorNameSnapshot: actorUser?.name || actorUser?.email || 'System User',
        actorRoleSnapshot: actorUser?.role || 'system',
        action,
        category,
        resourceType: resourceType || null,
        resourceId: resourceId ? String(resourceId) : null,
        targetUserId: targetUserId || null,
        title: title || null,
        description: description || null,
        status: status || STATUSES.COMPLETED,
        metadata: sanitizedMeta || undefined,
      }
    });

    return record;
  } catch (error) {
    console.error('❌ Failed to create ActivityLog:', error.message);
    return null;
  }
}

/**
 * Retrieve activity logs for a user with role-scoped policy and viewer-specific presentation formatting.
 */
async function getActivitiesForUser(reqUser, tenantDb, options = {}) {
  const page = parseInt(options.page) || 1;
  const limit = parseInt(options.limit) || 20;
  const skip = (page - 1) * limit;

  // Build Prisma query condition via Visibility Policy
  const where = buildVisibilityQuery(reqUser, options);

  const [rawLogs, total] = await Promise.all([
    tenantDb.activityLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit
    }),
    tenantDb.activityLog.count({ where })
  ]);

  // Transform each log via ActivityPresenter
  const formattedLogs = rawLogs.map(log => {
    const presented = formatActivityForViewer(log, reqUser);
    return {
      id: log.id,
      college_id: log.college_id,
      actorUserId: log.actorUserId,
      actorName: log.actorNameSnapshot,
      actorRole: log.actorRoleSnapshot,
      action: log.action,
      category: log.category,
      resourceType: log.resourceType,
      resourceId: log.resourceId,
      targetUserId: log.targetUserId,
      title: presented.title,
      description: presented.description,
      status: log.status || 'completed',
      metadata: log.metadata,
      createdAt: log.createdAt,
    };
  });

  return {
    logs: formattedLogs,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1
    }
  };
}

module.exports = {
  logActivity,
  getActivitiesForUser,
  sanitizeMetadata,
};
