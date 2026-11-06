const { getSystemClient } = require('../config/prismaManager');
const prisma = getSystemClient();
const { checkAndCreateApprovalRequest } = require('./approvalService');

/**
 * Result Moderation & Student Re-Check Requests Service (N27)
 */

/**
 * Submit a re-check ticket
 */
async function submitRecheckRequest({
  collegeId,
  campusId = null,
  studentId,
  resultId,
  subjectId,
  reason,
  feePaidPkr = 500,
  feeVoucherId = null,
}) {
  const result = await prisma.result.findUnique({
    where: { id: resultId },
  });

  if (!result || result.college_id !== collegeId) {
    throw { statusCode: 404, code: 'RESULT_NOT_FOUND', message: 'Result not found.' };
  }

  // Extract original marks for this subject
  let originalMarks = 0;
  if (result.marks && typeof result.marks === 'object') {
    originalMarks = Number(result.marks[subjectId] || result.totalObtained || 0);
  } else if (result.totalObtained !== null && result.totalObtained !== undefined) {
    originalMarks = Number(result.totalObtained);
  }

  return await prisma.resultRecheckRequest.create({
    data: {
      college_id: collegeId,
      campus_id: campusId,
      student_id: studentId,
      resultId,
      subject_id: subjectId,
      reason,
      feePaidPkr: parseInt(feePaidPkr, 10),
      feeVoucherId,
      status: 'SUBMITTED',
      originalMarks,
    },
  });
}

/**
 * Process a re-check ticket with N11 approval integration
 */
async function processRecheck({
  collegeId,
  campusId = null,
  requestId,
  reviewerUser,
  committeeNotes,
  revisedMarks,
  status, // RESOLVED_UNCHANGED | RESOLVED_CHANGED | REJECTED
}) {
  const req = await prisma.resultRecheckRequest.findUnique({
    where: { id: requestId },
  });

  if (!req || req.college_id !== collegeId) {
    throw { statusCode: 404, code: 'RECHECK_REQUEST_NOT_FOUND', message: 'Re-check request not found.' };
  }

  const isMarksChanged = revisedMarks !== undefined && Number(revisedMarks) !== Number(req.originalMarks);

  if (isMarksChanged) {
    // 1. Check for N11 Multi-Step Approval Chain
    const approvalCheck = await checkAndCreateApprovalRequest({
      collegeId,
      campusId: campusId || req.campus_id,
      workflowType: 'MARKS_EDIT',
      requesterUser: reviewerUser,
      payload: {
        recheckRequestId: req.id,
        resultId: req.resultId,
        subjectId: req.subject_id,
        studentId: req.student_id,
        revisedMarks: Number(revisedMarks),
        originalMarks: Number(req.originalMarks),
        committeeNotes,
      },
    });

    if (approvalCheck.requiresApproval) {
      // Approval required: Hold in IN_REVIEW state, do not update Result table yet
      await prisma.resultRecheckRequest.update({
        where: { id: requestId },
        data: {
          status: 'IN_REVIEW',
          revisedMarks: Number(revisedMarks),
          committeeNotes,
          reviewedBy: reviewerUser.id,
        },
      });

      return {
        requiresApproval: true,
        approvalRequestId: approvalCheck.request.id,
        status: 'IN_REVIEW',
        message: 'Mark adjustment requires multi-step approval before result score is updated.',
      };
    }

    // 2. No approval workflow configured: commit directly inside transaction
    return await prisma.$transaction(async (tx) => {
      // Update Result score
      const result = await tx.result.findUnique({ where: { id: req.resultId } });
      if (result) {
        let updatedMarks = typeof result.marks === 'object' && result.marks !== null ? { ...result.marks } : {};
        updatedMarks[req.subject_id] = Number(revisedMarks);

        let totalObtained = 0;
        let count = 0;
        for (const v of Object.values(updatedMarks)) {
          const num = Number(v);
          if (!isNaN(num)) {
            totalObtained += num;
            count++;
          }
        }
        const totalMarks = result.totalMarks || (count * 100);
        const percentage = totalMarks > 0 ? (totalObtained / totalMarks) * 100 : 0;

        await tx.result.update({
          where: { id: req.resultId },
          data: {
            marks: updatedMarks,
            totalObtained,
            percentage,
          },
        });
      }

      // Update Recheck ticket
      return await tx.resultRecheckRequest.update({
        where: { id: requestId },
        data: {
          status: 'RESOLVED_CHANGED',
          revisedMarks: Number(revisedMarks),
          committeeNotes,
          reviewedBy: reviewerUser.id,
          resolvedAt: new Date(),
        },
      });
    });
  }

  // Marks unchanged or rejected
  const finalStatus = status === 'REJECTED' ? 'REJECTED' : 'RESOLVED_UNCHANGED';
  return await prisma.resultRecheckRequest.update({
    where: { id: requestId },
    data: {
      status: finalStatus,
      revisedMarks: req.originalMarks,
      committeeNotes,
      reviewedBy: reviewerUser.id,
      resolvedAt: new Date(),
    },
  });
}

/**
 * List re-checking requests
 */
async function getRecheckRequests(collegeId, filters = {}) {
  const where = {
    college_id: collegeId,
    ...(filters.studentId ? { student_id: filters.studentId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
  };

  return await prisma.resultRecheckRequest.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  });
}

module.exports = {
  submitRecheckRequest,
  processRecheck,
  getRecheckRequests,
};
