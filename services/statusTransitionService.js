/**
 * Status Transition Service
 * Manages reversible status changes for College, Student, and User resources.
 *
 * Rules:
 *  - Every status change generates a unique operationId.
 *  - StatusOperationLog stores: operationId, resourceType, resourceId, actorUserId,
 *    previousStatus, newStatus, createdAt, expiresAt (createdAt + 5s), undoneAt.
 *  - Undo receives the exact operationId and validates all 6 conditions atomically.
 *  - Status update, StatusOperationLog, and ActivityLog are committed in one transaction.
 *  - NEVER guesses via findFirst(orderBy createdAt desc) without operationId.
 */

const crypto = require('crypto');
const { ACTIONS, CATEGORIES, STATUSES } = require('../config/activityConstants');
const { sanitizeMetadata } = require('./activityLog.service');

const UNDO_WINDOW_MS = 5000; // 5-second Undo expiry

// ─── Resource Configuration ──────────────────────────────────────────────────

const RESOURCE_CONFIG = {
  college: {
    modelKey: 'college',
    statusField: 'isActive', // boolean: true=active, false=suspended
    category: CATEGORIES.COLLEGE,
    suspendAction: ACTIONS.COLLEGE_SUSPENDED,
    reactivateAction: ACTIONS.COLLEGE_REACTIVATED,
    getStatus: (record) => record.isActive ? 'active' : 'suspended',
    applyStatus: (newStatus) => ({ isActive: newStatus === 'active' }),
  },
  student: {
    modelKey: 'student',
    statusField: 'status', // string: 'active', 'inactive', 'suspended', 'graduated', 'dropped'
    category: CATEGORIES.STUDENT,
    suspendAction: ACTIONS.STUDENT_DEACTIVATED,
    reactivateAction: ACTIONS.STUDENT_REACTIVATED,
    getStatus: (record) => record.status || 'active',
    applyStatus: (newStatus) => ({ status: newStatus }),
  },
  user: {
    modelKey: 'user',
    statusField: 'isActive', // boolean
    category: CATEGORIES.ADMINISTRATION,
    suspendAction: ACTIONS.USER_DEACTIVATED,
    reactivateAction: ACTIONS.USER_REACTIVATED,
    getStatus: (record) => record.isActive ? 'active' : 'inactive',
    applyStatus: (newStatus) => ({ isActive: newStatus === 'active' }),
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resolveConfig(resourceType) {
  const key = resourceType?.toLowerCase();
  const config = RESOURCE_CONFIG[key];
  if (!config) {
    const err = new Error(`Resource type '${resourceType}' does not support status transitions.`);
    err.statusCode = 400;
    throw err;
  }
  return config;
}

async function logActivityTx(tx, { college_id, actorUser, action, category, resourceType, resourceId, metadata }) {
  try {
    const { sanitizeMetadata } = require('./activityLog.service');
    const safe = sanitizeMetadata(metadata);
    await tx.activityLog.create({
      data: {
        college_id: college_id || null,
        actorUserId: actorUser?.id || null,
        actorNameSnapshot: actorUser?.name || actorUser?.email || 'System',
        actorRoleSnapshot: actorUser?.role || 'system',
        action,
        category,
        resourceType,
        resourceId: resourceId ? String(resourceId) : null,
        status: STATUSES.COMPLETED,
        metadata: safe || undefined,
      }
    });
  } catch (e) {
    console.error('[StatusTransitionService] ActivityLog write failed inside tx:', e.message);
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Apply a status change atomically.
 * Returns { operationId, previousStatus, newStatus, expiresAt }.
 */
async function applyStatusChange({ tenantDb, resourceType, resourceId, newStatus, actorUser }) {
  const config = resolveConfig(resourceType);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + UNDO_WINDOW_MS);
  const operationId = crypto.randomUUID();

  return await tenantDb.$transaction(async (tx) => {
    // Fetch current record to capture exact previous status
    const record = await tx[config.modelKey].findUnique({ where: { id: resourceId } });
    if (!record) {
      const err = new Error(`${resourceType} with id '${resourceId}' not found.`);
      err.statusCode = 404;
      throw err;
    }

    const previousStatus = config.getStatus(record);
    if (previousStatus === newStatus) {
      const err = new Error(`${resourceType} is already in '${newStatus}' status.`);
      err.statusCode = 409;
      throw err;
    }

    // Determine college scope
    const college_id = record.college_id || null;

    // 1. Update resource status
    await tx[config.modelKey].update({
      where: { id: resourceId },
      data: config.applyStatus(newStatus),
    });

    // 2. Write StatusOperationLog
    await tx.statusOperationLog.create({
      data: {
        operationId,
        resourceType: config.modelKey,
        resourceId,
        actorUserId: actorUser.id,
        previousStatus,
        newStatus,
        college_id,
        createdAt: now,
        expiresAt,
        undoneAt: null,
      }
    });

    // 3. Write ActivityLog
    const isDeactivate = newStatus !== 'active';
    const action = isDeactivate ? config.suspendAction : config.reactivateAction;
    await logActivityTx(tx, {
      college_id,
      actorUser,
      action,
      category: config.category,
      resourceType: config.modelKey,
      resourceId,
      metadata: { previousStatus, newStatus },
    });

    return { operationId, previousStatus, newStatus, expiresAt };
  });
}

/**
 * Revert a status change atomically using the exact operationId.
 * Validates all 6 conditions before reverting.
 * Returns { restoredStatus } on success.
 */
async function revertOperation({ tenantDb, resourceType, resourceId, operationId, actorUser }) {
  const config = resolveConfig(resourceType);
  const now = new Date();

  return await tenantDb.$transaction(async (tx) => {
    // 1. Fetch operation by operationId
    const op = await tx.statusOperationLog.findUnique({ where: { operationId } });

    // Validation Suite — all checks must pass atomically
    if (!op) {
      const err = new Error('Invalid operation ID. No matching operation found.');
      err.statusCode = 400;
      throw err;
    }
    if (op.resourceType !== config.modelKey || op.resourceId !== resourceId) {
      const err = new Error('Operation ID does not match the target resource.');
      err.statusCode = 400;
      throw err;
    }
    if (op.actorUserId !== actorUser.id && actorUser.role !== 'superAdmin') {
      const err = new Error('You are not authorized to revert this operation.');
      err.statusCode = 403;
      throw err;
    }
    if (op.undoneAt !== null) {
      const err = new Error('This operation has already been undone.');
      err.statusCode = 409;
      throw err;
    }
    if (now > op.expiresAt) {
      const err = new Error('5-second Undo window has expired. The status change cannot be reverted.');
      err.statusCode = 410;
      throw err;
    }

    // 2. Re-read current resource to check state consistency
    const currentRecord = await tx[config.modelKey].findUnique({ where: { id: resourceId } });
    if (!currentRecord) {
      const err = new Error(`${resourceType} not found.`);
      err.statusCode = 404;
      throw err;
    }
    const currentStatus = config.getStatus(currentRecord);
    if (currentStatus !== op.newStatus) {
      const err = new Error(
        `Cannot undo: resource status has been changed by another action (expected '${op.newStatus}', found '${currentStatus}').`
      );
      err.statusCode = 409;
      throw err;
    }

    const college_id = currentRecord.college_id || op.college_id || null;

    // 3. Revert resource to previousStatus
    await tx[config.modelKey].update({
      where: { id: resourceId },
      data: config.applyStatus(op.previousStatus),
    });

    // 4. Mark operation as undone
    await tx.statusOperationLog.update({
      where: { id: op.id },
      data: { undoneAt: now },
    });

    // 5. Write ActivityLog for the undo event
    const action = op.previousStatus === 'active' ? config.reactivateAction : config.suspendAction;
    await logActivityTx(tx, {
      college_id,
      actorUser,
      action,
      category: config.category,
      resourceType: config.modelKey,
      resourceId,
      metadata: { restoredStatus: op.previousStatus, revertedFrom: op.newStatus, operationId },
    });

    return { restoredStatus: op.previousStatus };
  });
}

module.exports = {
  applyStatusChange,
  revertOperation,
  UNDO_WINDOW_MS,
};
