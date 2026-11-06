const examSeatingService = require('../services/examSeatingService');
const examPaperService = require('../services/examPaperService');
const resultRecheckService = require('../services/resultRecheckService');

/**
 * Exam Operations Controller (11A: N25, N26, N27)
 */

// --- N25: Exam Halls & Seating ---

async function createHall(req, res) {
  try {
    const hall = await examSeatingService.createHall({
      collegeId: req.collegeId,
      campusId: req.campusId || null,
      name: req.body.name,
      rows: req.body.rows,
      columns: req.body.columns,
      capacity: req.body.capacity,
    });
    return res.status(201).json({ success: true, data: hall });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, error: err.message, code: err.code });
  }
}

async function getHalls(req, res) {
  try {
    const halls = await examSeatingService.getHalls(req.collegeId, req.campusId);
    return res.json({ success: true, data: halls });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, error: err.message, code: err.code });
  }
}

async function generateSeatingPlan(req, res) {
  try {
    const plan = await examSeatingService.generateSeatingPlan({
      collegeId: req.collegeId,
      campusId: req.campusId || null,
      examId: req.body.examId,
      name: req.body.name,
      examDate: req.body.examDate,
      sessionTime: req.body.sessionTime || 'MORNING',
      hallIds: req.body.hallIds || [],
      candidates: req.body.candidates,
    });
    return res.status(201).json({ success: true, data: plan });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, error: err.message, code: err.code });
  }
}

async function assignInvigilator(req, res) {
  try {
    const duty = await examSeatingService.assignInvigilator({
      collegeId: req.collegeId,
      seatingPlanId: req.body.seatingPlanId,
      teacherId: req.body.teacherId,
      hallId: req.body.hallId,
      dutyDate: req.body.dutyDate,
      sessionTime: req.body.sessionTime || 'MORNING',
    });
    return res.status(201).json({ success: true, data: duty });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, error: err.message, code: err.code });
  }
}

async function getInvigilationRoster(req, res) {
  try {
    const roster = await examSeatingService.getInvigilationRoster(req.collegeId, {
      teacherId: req.query.teacherId,
      seatingPlanId: req.query.seatingPlanId,
    });
    return res.json({ success: true, data: roster });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, error: err.message, code: err.code });
  }
}

// --- N26: Question Paper Moderation Workflow ---

async function createPaperDraft(req, res) {
  try {
    const draft = await examPaperService.createDraft({
      collegeId: req.collegeId,
      campusId: req.campusId || null,
      examId: req.body.examId,
      subjectId: req.body.subjectId,
      className: req.body.className || req.body.class,
      setterId: req.user.id,
      fileId: req.body.fileId,
    });
    return res.status(201).json({ success: true, data: draft });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, error: err.message, code: err.code });
  }
}

async function submitPaperRevision(req, res) {
  try {
    const isSuperAdmin = req.user?.role === 'superadmin';
    const draft = await examPaperService.submitRevision({
      collegeId: req.collegeId,
      paperDraftId: req.params.id,
      fileId: req.body.fileId,
      uploadedById: req.user.id,
      changeNotes: req.body.changeNotes,
      isSuperAdmin,
    });
    return res.json({ success: true, data: draft });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, error: err.message, code: err.code });
  }
}

async function moderatePaperDraft(req, res) {
  try {
    const draft = await examPaperService.moderateDraft({
      collegeId: req.collegeId,
      paperDraftId: req.params.id,
      moderatorId: req.user.id,
      status: req.body.status,
      moderatorNote: req.body.moderatorNote,
    });
    return res.json({ success: true, data: draft });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, error: err.message, code: err.code });
  }
}

async function sealPaperDraft(req, res) {
  try {
    const draft = await examPaperService.sealPaper({
      collegeId: req.collegeId,
      paperDraftId: req.params.id,
      sealedBy: req.user.id,
    });
    return res.json({ success: true, data: draft });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, error: err.message, code: err.code });
  }
}

async function getPaperDownloadUrl(req, res) {
  try {
    const isSuperAdmin = req.user?.role === 'superadmin';
    const download = await examPaperService.getPaperDownloadUrl({
      collegeId: req.collegeId,
      paperDraftId: req.params.id,
      requesterId: req.user.id,
      requesterRole: req.user.role,
      isSuperAdmin,
    });
    return res.json({ success: true, data: download });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, error: err.message, code: err.code });
  }
}

// --- N27: Result Re-Check ---

async function submitRecheckTicket(req, res) {
  try {
    const ticket = await resultRecheckService.submitRecheckRequest({
      collegeId: req.collegeId,
      campusId: req.campusId || null,
      studentId: req.body.studentId,
      resultId: req.body.resultId,
      subjectId: req.body.subjectId,
      reason: req.body.reason,
      feePaidPkr: req.body.feePaidPkr,
      feeVoucherId: req.body.feeVoucherId,
    });
    return res.status(201).json({ success: true, data: ticket });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, error: err.message, code: err.code });
  }
}

async function processRecheckTicket(req, res) {
  try {
    const result = await resultRecheckService.processRecheck({
      collegeId: req.collegeId,
      campusId: req.campusId || null,
      requestId: req.params.id,
      reviewerUser: req.user,
      committeeNotes: req.body.committeeNotes,
      revisedMarks: req.body.revisedMarks,
      status: req.body.status,
    });
    return res.json({ success: true, data: result });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, error: err.message, code: err.code });
  }
}

async function listRecheckTickets(req, res) {
  try {
    const tickets = await resultRecheckService.getRecheckRequests(req.collegeId, {
      studentId: req.query.studentId,
      status: req.query.status,
    });
    return res.json({ success: true, data: tickets });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, error: err.message, code: err.code });
  }
}

module.exports = {
  createHall,
  getHalls,
  generateSeatingPlan,
  assignInvigilator,
  getInvigilationRoster,
  createPaperDraft,
  submitPaperRevision,
  moderatePaperDraft,
  sealPaperDraft,
  getPaperDownloadUrl,
  submitRecheckTicket,
  processRecheckTicket,
  listRecheckTickets,
};

