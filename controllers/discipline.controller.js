const disciplineService = require('../services/disciplineService');

/**
 * Discipline & Counseling Controller (N32)
 */

async function recordIncident(req, res) {
  try {
    const incident = await disciplineService.recordIncident({
      collegeId: req.collegeId,
      campusId: req.campusId || null,
      studentId: req.body.studentId,
      sessionId: req.body.sessionId,
      incidentDate: req.body.incidentDate,
      category: req.body.category,
      severity: req.body.severity,
      description: req.body.description,
      actionTaken: req.body.actionTaken,
      fineAmountPkr: req.body.fineAmountPkr,
      suspensionDays: req.body.suspensionDays,
      reportedById: req.user.id,
      hearingDate: req.body.hearingDate,
      userRole: req.user.role,
      userPermissions: req.userPermissions || [],
    });
    return res.status(201).json({ success: true, data: incident });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, error: err.message, code: err.code });
  }
}

async function addCounselingLog(req, res) {
  try {
    const log = await disciplineService.addCounselingLog({
      collegeId: req.collegeId,
      campusId: req.campusId || null,
      incidentId: req.body.incidentId || null,
      studentId: req.body.studentId,
      counselorId: req.user.id,
      sessionDate: req.body.sessionDate,
      sessionNotes: req.body.sessionNotes,
      actionPlan: req.body.actionPlan,
      followUpDate: req.body.followUpDate,
      userRole: req.user.role,
      userPermissions: req.userPermissions || [],
    });
    return res.status(201).json({ success: true, data: log });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, error: err.message, code: err.code });
  }
}

async function getStudentDisciplinaryHistory(req, res) {
  try {
    const history = await disciplineService.getStudentDisciplinaryHistory({
      collegeId: req.collegeId,
      studentId: req.params.studentId,
      userRole: req.user.role,
      userPermissions: req.userPermissions || [],
    });
    return res.json({ success: true, data: history });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, error: err.message, code: err.code });
  }
}

module.exports = {
  recordIncident,
  addCounselingLog,
  getStudentDisciplinaryHistory,
};

