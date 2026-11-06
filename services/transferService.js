// ─── Student Campus Transfer Service (Phase 10: N19) ───────────────────
const { getSystemClient } = require('../config/prismaManager');
const { checkAndCreateApprovalRequest } = require('./approvalService');

/**
 * Core transactional execution of an inter-campus student transfer
 * Option B Invariant: Campuses exist in one tenant. Transfer is a section move;
 * ledgers, files, attendance are preserved untouched; zero quota consumption.
 */
async function executeTransferCore(tx, payload, { dryRun = false } = {}) {
  const { collegeId, studentId, toSectionId, reason, actorUserId } = payload;

  if (!collegeId || !studentId || !toSectionId) {
    const err = new Error('collegeId, studentId, and toSectionId are strictly required for campus transfer');
    err.statusCode = 422;
    throw err;
  }

  // 1. Pessimistic lock on student row
  await tx.$executeRaw`SELECT id FROM "Student" WHERE id = ${studentId} AND college_id = ${collegeId} FOR UPDATE`;

  const student = await tx.student.findFirst({
    where: { id: studentId, college_id: collegeId }
  });
  if (!student) {
    const err = new Error('Student not found in this institution');
    err.statusCode = 404;
    throw err;
  }

  // 2. Resolve source section & source campus
  let fromSectionId = null;
  let fromCampusId = null;
  if (student.section) {
    const fromSection = await tx.section.findFirst({
      where: {
        college_id: collegeId,
        OR: [
          { id: student.section },
          { name: student.section },
          { code: student.section }
        ]
      }
    });
    if (fromSection) {
      fromSectionId = fromSection.id;
      fromCampusId = fromSection.campus_id;
    }
  }

  // If no source campus found from section, fall back to default campus
  if (!fromCampusId) {
    const defaultCampus = await tx.campus.findFirst({
      where: { college_id: collegeId, isDefault: true }
    });
    fromCampusId = defaultCampus ? defaultCampus.id : 'DEFAULT';
    fromSectionId = fromSectionId || 'DEFAULT';
  }

  // 3. Resolve destination section & destination campus
  const toSection = await tx.section.findFirst({
    where: { id: toSectionId, college_id: collegeId }
  });
  if (!toSection) {
    const err = new Error('Destination section not found in this institution');
    err.statusCode = 404;
    throw err;
  }

  if (!toSection.campus_id) {
    const err = new Error('Destination section has no assigned campus');
    err.statusCode = 422;
    throw err;
  }

  const toCampusId = toSection.campus_id;

  // Verify destination campus exists and is active
  const destinationCampus = await tx.campus.findFirst({
    where: { id: toCampusId, college_id: collegeId, isActive: true }
  });
  if (!destinationCampus) {
    const err = new Error('Destination campus is inactive or does not exist');
    err.statusCode = 422;
    throw err;
  }

  // 4. Seat capacity check in destination section
  const currentEnrolled = await tx.student.count({
    where: {
      college_id: collegeId,
      section: { in: [toSection.id, toSection.name, toSection.code].filter(Boolean) },
      status: { not: 'dropped' }
    }
  });

  const capacity = toSection.capacity || 40;
  if (currentEnrolled >= capacity) {
    const err = new Error(`Destination section "${toSection.name || toSection.code}" has reached its maximum capacity of ${capacity} seats.`);
    err.statusCode = 409;
    err.code = 'SECTION_CAPACITY_EXHAUSTED';
    throw err;
  }

  if (dryRun) {
    return { valid: true, fromCampusId, toCampusId, toSection };
  }

  // 5. Update Student section and class
  let targetClassName = student.class;
  if (toSection.class_id) {
    const cls = await tx.class.findUnique({ where: { id: toSection.class_id } });
    if (cls?.name) targetClassName = cls.name;
  }

  const updatedStudent = await tx.student.update({
    where: { id: student.id },
    data: {
      section: toSection.name || toSection.code || toSection.id,
      class: targetClassName
    }
  });

  // 6. Record transfer audit
  const transferRecord = await tx.studentCampusTransfer.create({
    data: {
      college_id: collegeId,
      student_id: student.id,
      fromSectionId: fromSectionId || 'UNKNOWN',
      toSectionId: toSection.id,
      fromCampusId: fromCampusId || 'UNKNOWN',
      toCampusId: toCampusId,
      reason: reason || 'Administrative inter-campus transfer',
      transferredBy: actorUserId || 'admin'
    }
  });

  return {
    success: true,
    transfer: transferRecord,
    student: updatedStudent,
    destinationCampus: destinationCampus.name
  };
}

/**
 * Higher-level transfer initiating point
 * Evaluates N11 Multi-Step Approval Chain:
 * - If active chain for CAMPUS_TRANSFER exists -> returns 202 with approvalRequestId
 * - If no chain exists -> executes immediately inside single transaction
 */
async function initiateTransfer({ collegeId, studentId, toSectionId, reason, actorUserId }) {
  const prisma = getSystemClient();

  // Pre-flight validation of existence
  const toSection = await prisma.section.findFirst({
    where: { id: toSectionId, college_id: collegeId }
  });
  if (!toSection) {
    const err = new Error('Destination section not found');
    err.statusCode = 404;
    throw err;
  }

  // Check N11 Approval Chain
  const approvalResult = await checkAndCreateApprovalRequest({
    collegeId,
    campusId: toSection.campus_id,
    workflowType: 'CAMPUS_TRANSFER',
    requesterUser: { id: actorUserId },
    payload: {
      collegeId,
      studentId,
      toSectionId,
      reason,
      actorUserId
    }
  });

  if (approvalResult?.requiresApproval) {
    return {
      status: 202,
      requiresApproval: true,
      approvalRequestId: approvalResult.approvalRequestId,
      message: 'Campus transfer submitted for multi-step approval workflow'
    };
  }

  // No approval chain required -> execute immediately
  const result = await prisma.$transaction(async (tx) => {
    return await executeTransferCore(tx, {
      collegeId,
      studentId,
      toSectionId,
      reason,
      actorUserId
    }, { dryRun: false });
  });

  return {
    status: 200,
    requiresApproval: false,
    ...result
  };
}

/**
 * List transfer history
 */
async function listTransfers(collegeId, { studentId = null, fromCampusId = null, toCampusId = null } = {}) {
  const prisma = getSystemClient();
  const where = { college_id: collegeId };
  if (studentId) where.student_id = studentId;
  if (fromCampusId) where.fromCampusId = fromCampusId;
  if (toCampusId) where.toCampusId = toCampusId;

  return await prisma.studentCampusTransfer.findMany({
    where,
    orderBy: { createdAt: 'desc' }
  });
}

module.exports = {
  executeTransferCore,
  initiateTransfer,
  listTransfers
};
