// ─── Legal Hold & Data Retention Service (Phase 10: N16) ───────────────
const { getSystemClient } = require('../config/prismaManager');

const PLATFORM_FLOORS = {
  TRASHED_STUDENT: 7,  // minimum 7 days
  STORED_FILE: 30      // minimum 30 days
};

/**
 * Checks whether an active legal hold covers the requested entity/scope
 */
async function getActiveLegalHold(collegeId, { studentId = null, sessionId = null } = {}) {
  const prisma = getSystemClient();

  // Find all active holds for this college
  const activeHolds = await prisma.legalHold.findMany({
    where: { college_id: collegeId, isActive: true }
  });

  if (activeHolds.length === 0) return null;

  for (const hold of activeHolds) {
    if (hold.scopeType === 'ALL_STUDENTS') {
      return hold;
    }

    if (hold.scopeType === 'SESSION' && sessionId && hold.targetId === sessionId) {
      return hold;
    }

    if (hold.scopeType === 'STUDENT' && studentId && hold.targetId === studentId) {
      return hold;
    }

    // If only studentId provided, check if the student belongs to a held session
    if (hold.scopeType === 'SESSION' && studentId && !sessionId) {
      const student = await prisma.student.findFirst({
        where: { id: studentId, college_id: collegeId },
        select: { session_id: true }
      });
      if (student?.session_id === hold.targetId) {
        return hold;
      }
    }
  }

  return null;
}

/**
 * Throws 403 LEGAL_HOLD_ACTIVE if an active hold protects the target entity
 */
async function assertNoLegalHold(collegeId, { studentId = null, sessionId = null } = {}) {
  const hold = await getActiveLegalHold(collegeId, { studentId, sessionId });
  if (hold) {
    const err = new Error(`Deletion blocked: active legal hold "${hold.title}" is in effect for this record.`);
    err.code = 'LEGAL_HOLD_ACTIVE';
    err.statusCode = 403;
    err.holdId = hold.id;
    err.holdTitle = hold.title;
    throw err;
  }
}

/**
 * Place a legal hold on a student, session, or institution-wide
 */
async function placeLegalHold(collegeId, { title, reason, scopeType, targetId = null, campus_id = null, placedBy }) {
  const prisma = getSystemClient();

  if (!title || typeof title !== 'string' || !title.trim()) {
    const err = new Error('Title is required for legal hold');
    err.statusCode = 422;
    throw err;
  }

  if (!reason || typeof reason !== 'string' || !reason.trim()) {
    const err = new Error('Reason is required for legal hold');
    err.statusCode = 422;
    throw err;
  }

  const validScopes = ['ALL_STUDENTS', 'SESSION', 'STUDENT'];
  if (!validScopes.includes(scopeType)) {
    const err = new Error(`Invalid scopeType. Must be one of: ${validScopes.join(', ')}`);
    err.statusCode = 422;
    throw err;
  }

  if (scopeType !== 'ALL_STUDENTS' && !targetId) {
    const err = new Error(`targetId is required when scopeType is ${scopeType}`);
    err.statusCode = 422;
    throw err;
  }

  // Cross-tenant verification
  if (scopeType === 'STUDENT') {
    const student = await prisma.student.findFirst({
      where: { id: targetId, college_id: collegeId }
    });
    if (!student) {
      const err = new Error('Target student not found in this institution');
      err.statusCode = 404;
      throw err;
    }
  } else if (scopeType === 'SESSION') {
    const session = await prisma.session.findFirst({
      where: { id: targetId, college_id: collegeId }
    });
    if (!session) {
      const err = new Error('Target academic session not found in this institution');
      err.statusCode = 404;
      throw err;
    }
  }

  return await prisma.legalHold.create({
    data: {
      college_id: collegeId,
      campus_id: campus_id || null,
      title: title.trim(),
      reason: reason.trim(),
      scopeType,
      targetId: targetId || null,
      placedBy: placedBy || 'admin',
      isActive: true
    }
  });
}

/**
 * Release a legal hold with audit reason
 */
async function releaseLegalHold(collegeId, holdId, { releasedBy, releaseReason }) {
  const prisma = getSystemClient();

  const hold = await prisma.legalHold.findFirst({
    where: { id: holdId, college_id: collegeId }
  });

  if (!hold) {
    const err = new Error('Legal hold not found');
    err.statusCode = 404;
    throw err;
  }

  if (!hold.isActive) {
    const err = new Error('Legal hold is already released');
    err.statusCode = 400;
    throw err;
  }

  if (!releaseReason || typeof releaseReason !== 'string' || !releaseReason.trim()) {
    const err = new Error('Release reason is strictly required to lift a legal hold');
    err.statusCode = 422;
    throw err;
  }

  return await prisma.legalHold.update({
    where: { id: holdId },
    data: {
      isActive: false,
      releasedAt: new Date(),
      releasedBy: releasedBy || 'admin',
      releaseReason: releaseReason.trim()
    }
  });
}

/**
 * List legal holds for a college
 */
async function listLegalHolds(collegeId, { isActive = null, campusId = null } = {}) {
  const prisma = getSystemClient();
  const where = { college_id: collegeId };
  if (isActive !== null) where.isActive = Boolean(isActive);
  if (campusId) where.campus_id = campusId;

  return await prisma.legalHold.findMany({
    where,
    orderBy: { createdAt: 'desc' }
  });
}

/**
 * Configure college retention policy enforcing platform floors
 */
async function setRetentionPolicy(collegeId, { entityType, retainDays, campus_id = null }) {
  const prisma = getSystemClient();
  const validEntities = ['TRASHED_STUDENT', 'STORED_FILE'];

  if (!validEntities.includes(entityType)) {
    const err = new Error(`Invalid entityType. Must be one of: ${validEntities.join(', ')}`);
    err.statusCode = 422;
    throw err;
  }

  const days = parseInt(retainDays, 10);
  const floor = PLATFORM_FLOORS[entityType];

  if (isNaN(days) || days < floor) {
    const err = new Error(`Retention window for ${entityType} cannot be shorter than the platform floor of ${floor} days.`);
    err.code = 'RETENTION_BELOW_FLOOR';
    err.statusCode = 422;
    throw err;
  }

  return await prisma.retentionPolicy.upsert({
    where: {
      college_id_entityType: {
        college_id: collegeId,
        entityType
      }
    },
    update: {
      retainDays: days,
      campus_id: campus_id || null
    },
    create: {
      college_id: collegeId,
      campus_id: campus_id || null,
      entityType,
      retainDays: days
    }
  });
}

/**
 * Get effective retention days (college policy or platform floor)
 */
async function getEffectiveRetentionDays(collegeId, entityType) {
  const prisma = getSystemClient();
  const floor = PLATFORM_FLOORS[entityType] || 7;

  const policy = await prisma.retentionPolicy.findUnique({
    where: {
      college_id_entityType: {
        college_id: collegeId,
        entityType
      }
    }
  });

  return Math.max(policy ? policy.retainDays : floor, floor);
}

module.exports = {
  PLATFORM_FLOORS,
  getActiveLegalHold,
  assertNoLegalHold,
  placeLegalHold,
  releaseLegalHold,
  listLegalHolds,
  setRetentionPolicy,
  getEffectiveRetentionDays
};

