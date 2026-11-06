const syllabusService = require('../services/syllabusService');

/**
 * Syllabus Controller (N23)
 */

async function createBreakdown(req, res) {
  try {
    const breakdown = await syllabusService.createBreakdown({
      collegeId: req.collegeId,
      campusId: req.campusId || null,
      sessionId: req.body.sessionId,
      className: req.body.className || req.body.class,
      subjectId: req.body.subjectId,
      boardName: req.body.boardName,
      totalHours: req.body.totalHours,
      units: req.body.units,
    });
    return res.status(201).json({ success: true, data: breakdown });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, error: err.message, code: err.code });
  }
}

async function updateProgress(req, res) {
  try {
    const progress = await syllabusService.updateProgress({
      collegeId: req.collegeId,
      campusId: req.campusId || null,
      unitId: req.params.unitId,
      sectionId: req.body.sectionId,
      teacherId: req.user.id,
      status: req.body.status,
      actualHours: req.body.actualHours,
      notes: req.body.notes,
    });
    return res.json({ success: true, data: progress });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, error: err.message, code: err.code });
  }
}

async function getCoverageSummary(req, res) {
  try {
    const summary = await syllabusService.getCoverageSummary({
      collegeId: req.collegeId,
      sessionId: req.query.sessionId,
      className: req.query.class || req.query.className,
      subjectId: req.query.subjectId,
      sectionId: req.query.sectionId,
      currentWeek: parseInt(req.query.currentWeek || 12, 10),
    });
    return res.json({ success: true, data: summary });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, error: err.message, code: err.code });
  }
}

module.exports = {
  createBreakdown,
  updateProgress,
  getCoverageSummary,
};

