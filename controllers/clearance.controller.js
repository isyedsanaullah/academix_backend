const clearanceService = require('../services/clearanceService');

/**
 * Clearance & Leaving Certificate Controller (N29)
 */

async function getHeads(req, res) {
  try {
    const heads = await clearanceService.seedDefaultHeads(req.collegeId, req.campusId);
    return res.json({ success: true, data: heads });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, error: err.message, code: err.code });
  }
}

async function initiateClearance(req, res) {
  try {
    const process = await clearanceService.initiateClearance({
      collegeId: req.collegeId,
      campusId: req.campusId || null,
      studentId: req.body.studentId,
      sessionId: req.body.sessionId,
      reason: req.body.reason,
      destination: req.body.destination,
      initiatedById: req.user.id,
    });
    return res.status(201).json({ success: true, data: process });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, error: err.message, code: err.code });
  }
}

async function updateClearanceItem(req, res) {
  try {
    const item = await clearanceService.updateClearanceItem({
      collegeId: req.collegeId,
      processId: req.params.id,
      headId: req.params.headId,
      status: req.body.status,
      duesAmountPkr: req.body.duesAmountPkr,
      remarks: req.body.remarks,
      clearedById: req.user.id,
    });
    return res.json({ success: true, data: item });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, error: err.message, code: err.code, unpaidDues: err.unpaidDues });
  }
}

async function issueLeavingCertificate(req, res) {
  try {
    const cert = await clearanceService.issueLeavingCertificate({
      collegeId: req.collegeId,
      campusId: req.campusId || null,
      processId: req.params.id,
      characterRating: req.body.characterRating,
      conductRemarks: req.body.conductRemarks,
      admissionDate: req.body.admissionDate,
      leavingDate: req.body.leavingDate,
      reasonForLeaving: req.body.reasonForLeaving,
      issuedById: req.user.id,
    });
    return res.status(201).json({ success: true, data: cert });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      error: err.message,
      code: err.code,
      pendingDepartments: err.pendingDepartments,
    });
  }
}

async function verifyCertificate(req, res) {
  try {
    const cert = await clearanceService.verifyCertificate(req.params.hash);
    return res.json({ success: true, data: cert });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, error: err.message, code: err.code });
  }
}

module.exports = {
  getHeads,
  initiateClearance,
  updateClearanceItem,
  issueLeavingCertificate,
  verifyCertificate,
};

