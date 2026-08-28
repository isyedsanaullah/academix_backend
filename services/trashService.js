/**
 * Trash Service
 * Handles soft deletion, restoration, retention validation, and trash listing
 * for SOFT_DELETE_ALLOWED resources in Academix.pk.
 *
 * Rules:
 *  - SOFT_DELETE_ALLOWED: Announcement, Assignment, PDFDocument (Material), Quiz
 *  - All other models are PROTECTED and deletion is rejected.
 *  - Every operation uses unique deleteOperationId for exact restore tracking.
 *  - Soft delete, child rules, and ActivityLog are committed in one atomic transaction.
 *  - Restore only affects records linked by deleteOperationId.
 *  - 7-day retention: restore allowed while NOW() < deletedAt + 7 days.
 */

const crypto = require('crypto');
const { ACTIONS, CATEGORIES, STATUSES } = require('../config/activityConstants');
const { sanitizeMetadata } = require('./activityLog.service');

// ─── Resource Classification ─────────────────────────────────────────────────
const SOFT_DELETE_ALLOWED = ['announcement', 'assignment', 'pDFDocument', 'quiz'];

// Friendly resource name → Prisma model key (Prisma model names are camelCase)
const MODEL_MAP = {
  announcement: 'announcement',
  assignment: 'assignment',
  material: 'pDFDocument',
  pdfdocument: 'pDFDocument',
  quiz: 'quiz',
};

// Resource → ActivityLog action mappings
const DELETE_ACTION_MAP = {
  announcement: ACTIONS.ANNOUNCEMENT_DELETED,
  assignment:   ACTIONS.ASSIGNMENT_DELETED,
  pDFDocument:  ACTIONS.MATERIAL_DELETED,
  quiz:         ACTIONS.QUIZ_DELETED,
};
const RESTORE_ACTION_MAP = {
  announcement: ACTIONS.ANNOUNCEMENT_RESTORED,
  assignment:   ACTIONS.ASSIGNMENT_RESTORED,
  pDFDocument:  ACTIONS.MATERIAL_RESTORED,
  quiz:         ACTIONS.QUIZ_RESTORED,
};
const CATEGORY_MAP = {
  announcement: CATEGORIES.ANNOUNCEMENT,
  assignment:   CATEGORIES.ASSIGNMENT,
  pDFDocument:  CATEGORIES.ACADEMIC,
  quiz:         CATEGORIES.EXAMINATION,
};

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Resolve resourceType string to canonical Prisma model key.
 * Accepts 'Announcement', 'assignment', 'material', 'PDFDocument', 'quiz', etc.
 */
function resolveModelKey(resourceType) {
  const key = resourceType?.toLowerCase();
  const resolved = MODEL_MAP[key];
  if (!resolved) return null;
  return resolved;
}

function isSoftDeleteAllowed(modelKey) {
  return SOFT_DELETE_ALLOWED.includes(modelKey);
}

/**
 * Write an ActivityLog inside an existing Prisma transaction.
 */
async function logActivityTx(tx, { college_id, actorUser, action, category, resourceType, resourceId, metadata }) {
  try {
    const safe = sanitizeMetadata(metadata);
    await tx.activityLog.create({
      data: {
        college_id: college_id || null,
        actorUserId: actorUser?.id || null,
        actorNameSnapshot: actorUser?.name || actorUser?.email || 'System',
        actorRoleSnapshot: actorUser?.role || 'system',
        action,
        category,
        resourceType: resourceType || null,
        resourceId: resourceId ? String(resourceId) : null,
        status: STATUSES.COMPLETED,
        metadata: safe || undefined,
      }
    });
  } catch (e) {
    // ActivityLog failure must not abort the parent transaction.
    // Log to stderr only.
    console.error('[TrashService] ActivityLog write failed inside tx:', e.message);
  }
}

/**
 * Apply resource-specific child soft-delete rules.
 * Child records are linked with the same deleteOperationId.
 *
 * Rules:
 *  Assignment → Submissions: PROTECTED (preserved, NOT soft-deleted)
 *  Quiz       → QuizAttempts: PROTECTED (preserved, NOT soft-deleted)
 */
async function softDeleteChildrenTx(tx, modelKey, parentId, deleteOperationId) {
  // No cascading soft-delete for any current SOFT_DELETE_ALLOWED resources.
  // Submissions and QuizAttempts are SOFT_DELETE_NOT_ALLOWED; they remain preserved.
  // If future resources require child cascade, add resource-specific logic here.
  return;
}

/**
 * Restore ONLY child records linked by the exact deleteOperationId.
 */
async function restoreChildrenByOperationIdTx(tx, modelKey, parentId, deleteOperationId) {
  // Mirror of softDeleteChildrenTx — currently no child cascades; nothing to restore.
  return;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Soft-delete a resource atomically.
 * Returns { deleteOperationId, deletedAt } on success.
 * Throws on invalid classification, expired state, or DB error.
 */
async function softDeleteResource({ tenantDb, resourceType, id, user, reason = null }) {
  const modelKey = resolveModelKey(resourceType);
  if (!modelKey || !isSoftDeleteAllowed(modelKey)) {
    const err = new Error(`Resource '${resourceType}' is protected and cannot be deleted.`);
    err.statusCode = 403;
    throw err;
  }

  const deleteOperationId = crypto.randomUUID();
  const now = new Date();

  return await tenantDb.$transaction(async (tx) => {
    // Fetch resource to verify it exists and is not already soft-deleted
    const item = await tx[modelKey].findUnique({ where: { id } });
    if (!item) {
      const err = new Error(`${resourceType} not found.`);
      err.statusCode = 404;
      throw err;
    }
    if (item.deletedAt) {
      const err = new Error(`${resourceType} is already in Trash.`);
      err.statusCode = 409;
      throw err;
    }

    // Soft-delete the resource
    await tx[modelKey].update({
      where: { id },
      data: {
        deletedAt: now,
        deletedBy: user.id,
        deleteReason: reason || null,
        deleteOperationId,
      }
    });

    // Apply resource-specific child rules
    await softDeleteChildrenTx(tx, modelKey, id, deleteOperationId);

    // Write ActivityLog inside the same transaction
    const college_id = item.college_id || item.collegeId || null;
    await logActivityTx(tx, {
      college_id,
      actorUser: user,
      action: DELETE_ACTION_MAP[modelKey],
      category: CATEGORY_MAP[modelKey],
      resourceType: modelKey,
      resourceId: id,
      metadata: {
        title: item.title || item.name || item.originalName || id,
        deleteOperationId,
        reason: reason || undefined,
      }
    });

    return { deleteOperationId, deletedAt: now };
  });
}

/**
 * Restore a soft-deleted resource atomically.
 * Validates 7-day retention window and exact deleteOperationId.
 * Returns { restored: true } on success.
 */
async function restoreResource({ tenantDb, resourceType, id, user }) {
  const modelKey = resolveModelKey(resourceType);
  if (!modelKey || !isSoftDeleteAllowed(modelKey)) {
    const err = new Error(`Resource '${resourceType}' cannot be managed through Trash.`);
    err.statusCode = 403;
    throw err;
  }

  const now = new Date();

  return await tenantDb.$transaction(async (tx) => {
    const item = await tx[modelKey].findUnique({ where: { id } });
    if (!item || !item.deletedAt) {
      const err = new Error(`${resourceType} is not in Trash.`);
      err.statusCode = 404;
      throw err;
    }

    // 7-day retention window check
    const retentionExpiry = new Date(item.deletedAt.getTime() + SEVEN_DAYS_MS);
    if (now >= retentionExpiry) {
      const err = new Error('7-day restore window has expired. This item is pending permanent cleanup.');
      err.statusCode = 410;
      throw err;
    }

    const opId = item.deleteOperationId;

    // Restore parent
    await tx[modelKey].update({
      where: { id },
      data: { deletedAt: null, deletedBy: null, deleteReason: null, deleteOperationId: null }
    });

    // Restore children only associated with the same deleteOperationId
    if (opId) {
      await restoreChildrenByOperationIdTx(tx, modelKey, id, opId);
    }

    // Write ActivityLog inside the same transaction
    const college_id = item.college_id || item.collegeId || null;
    await logActivityTx(tx, {
      college_id,
      actorUser: user,
      action: RESTORE_ACTION_MAP[modelKey],
      category: CATEGORY_MAP[modelKey],
      resourceType: modelKey,
      resourceId: id,
      metadata: { title: item.title || item.name || item.originalName || id }
    });

    return { restored: true };
  });
}

/**
 * Get trash items visible to the current user based on role and college scope.
 * Returns paginated list of soft-deleted records with retention info.
 */
async function getTrashForUser({ tenantDb, user, page = 1, limit = 20 }) {
  const skip = (page - 1) * limit;
  const now = new Date();
  const cutoff = new Date(now.getTime() - SEVEN_DAYS_MS);
  const college_id = user.college_id || null;

  const results = [];

  // Determine which models to query based on role
  const modelsToQuery = getModelsForRole(user.role);

  for (const modelKey of modelsToQuery) {
    // Build where clause based on role/scope
    const where = buildTrashWhereClause(modelKey, user, college_id);

    try {
      const items = await tenantDb[modelKey].findMany({
        where: { ...where, deletedAt: { not: null } },
        orderBy: { deletedAt: 'desc' },
        take: limit,
      });

      for (const item of items) {
        const retentionExpiry = new Date(item.deletedAt.getTime() + SEVEN_DAYS_MS);
        const isExpired = now >= retentionExpiry;
        const remainingMs = retentionExpiry - now;

        results.push({
          id: item.id,
          resourceType: modelKey,
          title: item.title || item.name || item.originalName || item.id,
          deletedAt: item.deletedAt,
          deletedBy: item.deletedBy,
          deleteReason: item.deleteReason,
          deleteOperationId: item.deleteOperationId,
          expiresAt: retentionExpiry,
          remainingMs: isExpired ? 0 : remainingMs,
          isExpired,
        });
      }
    } catch (e) {
      // Skip models that don't exist on this tenantDb
      console.warn(`[TrashService] Could not query model '${modelKey}':`, e.message);
    }
  }

  // Sort combined results by deletedAt desc and paginate
  results.sort((a, b) => b.deletedAt - a.deletedAt);
  const total = results.length;
  const paginated = results.slice(skip, skip + limit);

  return {
    items: paginated,
    pagination: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 }
  };
}

/**
 * Determine which resource models a given role can see in Trash.
 */
function getModelsForRole(role) {
  switch (role) {
    case 'superAdmin':
      return ['announcement', 'assignment', 'pDFDocument', 'quiz'];
    case 'admin':
    case 'principal':
    case 'registrar':
      return ['announcement', 'assignment', 'pDFDocument', 'quiz'];
    case 'teacher':
      return ['announcement', 'assignment', 'pDFDocument', 'quiz'];
    case 'accountant':
      return ['announcement'];
    case 'student':
      return []; // Students do not have deletable resources
    default:
      return [];
  }
}

/**
 * Build Prisma where clause for trash listing, scoped by role.
 */
function buildTrashWhereClause(modelKey, user, college_id) {
  const base = college_id
    ? (modelKey === 'pDFDocument' ? { collegeId: college_id } : { college_id })
    : {};

  // Teachers only see records they created
  if (user.role === 'teacher') {
    const teacherField = modelKey === 'pDFDocument' ? { teacherId: user.id } : { teacher_id: user.id };
    return { ...base, ...teacherField };
  }

  return base;
}

module.exports = {
  softDeleteResource,
  restoreResource,
  getTrashForUser,
  resolveModelKey,
  isSoftDeleteAllowed,
  SEVEN_DAYS_MS,
  logActivityTx,
};
