const { getSystemClient } = require('../config/prismaManager');
const prisma = getSystemClient();

/**
 * Question Paper Setting & Moderation Service (N26)
 */

/**
 * Create a new paper draft
 */
async function createDraft({
  collegeId,
  campusId = null,
  examId,
  subjectId,
  className,
  setterId,
  fileId,
}) {
  return await prisma.$transaction(async (tx) => {
    const draft = await tx.questionPaperDraft.create({
      data: {
        college_id: collegeId,
        campus_id: campusId,
        examId,
        subject_id: subjectId,
        class: className,
        setterId,
        file_id: fileId,
        status: 'DRAFT',
        version: 1,
      },
    });

    await tx.questionPaperRevision.create({
      data: {
        paperDraftId: draft.id,
        version: 1,
        file_id: fileId,
        uploadedById: setterId,
        changeNotes: 'Initial draft upload',
      },
    });

    return await tx.questionPaperDraft.findUnique({
      where: { id: draft.id },
      include: { revisions: true },
    });
  });
}

/**
 * Submit revision for an existing draft
 */
async function submitRevision({
  collegeId,
  paperDraftId,
  fileId,
  uploadedById,
  changeNotes,
  isSuperAdmin = false,
}) {
  return await prisma.$transaction(async (tx) => {
    const draft = await tx.questionPaperDraft.findUnique({
      where: { id: paperDraftId },
    });

    if (!draft || draft.college_id !== collegeId) {
      throw { statusCode: 404, code: 'PAPER_NOT_FOUND', message: 'Question paper draft not found.' };
    }

    if (draft.status === 'SEALED' && !isSuperAdmin) {
      throw {
        statusCode: 403,
        code: 'PAPER_SEALED',
        message: 'Sealed question papers cannot be modified or re-uploaded without Super Admin override.',
      };
    }

    const nextVersion = draft.version + 1;

    await tx.questionPaperRevision.create({
      data: {
        paperDraftId: draft.id,
        version: nextVersion,
        file_id: fileId,
        uploadedById,
        changeNotes: changeNotes || `Revision v${nextVersion}`,
      },
    });

    return await tx.questionPaperDraft.update({
      where: { id: draft.id },
      data: {
        file_id: fileId,
        version: nextVersion,
        status: 'SUBMITTED',
      },
      include: { revisions: { orderBy: { version: 'desc' } } },
    });
  });
}

/**
 * Moderate a question paper draft
 * Invariant: setterId !== moderatorId
 */
async function moderateDraft({
  collegeId,
  paperDraftId,
  moderatorId,
  status, // MODERATED | APPROVED | REJECTED
  moderatorNote,
}) {
  const draft = await prisma.questionPaperDraft.findUnique({
    where: { id: paperDraftId },
  });

  if (!draft || draft.college_id !== collegeId) {
    throw { statusCode: 404, code: 'PAPER_NOT_FOUND', message: 'Question paper draft not found.' };
  }

  // Strict invariant: Paper setter cannot act as moderator for their own paper
  if (draft.setterId === moderatorId) {
    throw {
      statusCode: 422,
      code: 'SETTER_CANNOT_MODERATE_OWN_PAPER',
      message: 'Paper setter cannot act as moderator for their own examination paper.',
    };
  }

  const validStatuses = ['MODERATED', 'APPROVED', 'REJECTED'];
  if (!validStatuses.includes(status)) {
    throw {
      statusCode: 400,
      code: 'INVALID_STATUS',
      message: `Status must be one of: ${validStatuses.join(', ')}`,
    };
  }

  return await prisma.questionPaperDraft.update({
    where: { id: paperDraftId },
    data: {
      moderatorId,
      moderatorNote,
      status,
    },
    include: { revisions: { orderBy: { version: 'desc' } } },
  });
}

/**
 * Seal a question paper draft (Final approval by Principal / Controller)
 */
async function sealPaper({ collegeId, paperDraftId, sealedBy }) {
  const draft = await prisma.questionPaperDraft.findUnique({
    where: { id: paperDraftId },
  });

  if (!draft || draft.college_id !== collegeId) {
    throw { statusCode: 404, code: 'PAPER_NOT_FOUND', message: 'Question paper draft not found.' };
  }

  return await prisma.questionPaperDraft.update({
    where: { id: paperDraftId },
    data: {
      status: 'SEALED',
      sealedBy,
      sealedAt: new Date(),
    },
  });
}

/**
 * Generate 2-minute restricted download URL
 */
async function getPaperDownloadUrl({
  collegeId,
  paperDraftId,
  requesterId,
  requesterRole,
  isSuperAdmin = false,
}) {
  const draft = await prisma.questionPaperDraft.findUnique({
    where: { id: paperDraftId },
  });

  if (!draft || draft.college_id !== collegeId) {
    throw { statusCode: 404, code: 'PAPER_NOT_FOUND', message: 'Question paper draft not found.' };
  }

  // Verify access authorization
  const isAuthorized =
    isSuperAdmin ||
    ['principal', 'admin'].includes(requesterRole) ||
    draft.setterId === requesterId ||
    draft.moderatorId === requesterId;

  if (!isAuthorized) {
    throw {
      statusCode: 403,
      code: 'ACCESS_DENIED',
      message: 'You are not authorized to access this examination paper draft.',
    };
  }

  // 2-minute TTL (120 seconds) restricted presigned download URL
  const expiresAt = new Date(Date.now() + 120 * 1000);
  const downloadUrl = `/api/files/download/${draft.file_id}?token=ep_${Buffer.from(
    `${draft.id}:${expiresAt.getTime()}`
  ).toString('hex')}&expires=${expiresAt.getTime()}`;

  return {
    paperDraftId: draft.id,
    fileId: draft.file_id,
    downloadUrl,
    expiresAt,
    ttlSeconds: 120,
  };
}

module.exports = {
  createDraft,
  submitRevision,
  moderateDraft,
  sealPaper,
  getPaperDownloadUrl,
};
