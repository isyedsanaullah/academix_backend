const alumniService = require('../services/alumniService');

/**
 * Alumni Controller (N34)
 */

async function registerAlumni(req, res) {
  try {
    const profile = await alumniService.registerAlumni({
      collegeId: req.collegeId,
      campusId: req.campusId || null,
      studentId: req.body.studentId,
      fullName: req.body.fullName,
      fatherName: req.body.fatherName,
      matricRollNumber: req.body.matricRollNumber,
      boardRollNumber: req.body.boardRollNumber,
      passingYear: req.body.passingYear,
      academicGroup: req.body.academicGroup,
      finalBoardMarks: req.body.finalBoardMarks,
      finalBoardTotal: req.body.finalBoardTotal,
      currentStatus: req.body.currentStatus,
      universityName: req.body.universityName,
      degreeProgram: req.body.degreeProgram,
      email: req.body.email,
      phone: req.body.phone,
      linkedInUrl: req.body.linkedInUrl,
      isTestimonialShared: req.body.isTestimonialShared,
    });
    return res.status(201).json({ success: true, data: profile });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, error: err.message, code: err.code });
  }
}

async function listAlumni(req, res) {
  try {
    const list = await alumniService.listAlumni(req.collegeId, {
      passingYear: req.query.passingYear,
      academicGroup: req.query.academicGroup,
      currentStatus: req.query.currentStatus,
    });
    return res.json({ success: true, data: list });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, error: err.message, code: err.code });
  }
}

async function getPlacementAnalytics(req, res) {
  try {
    const analytics = await alumniService.getPlacementAnalytics(req.collegeId);
    return res.json({ success: true, data: analytics });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, error: err.message, code: err.code });
  }
}

module.exports = {
  registerAlumni,
  listAlumni,
  getPlacementAnalytics,
};

