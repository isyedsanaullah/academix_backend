// ─── Student Campus Transfer Controller (Phase 10: N19) ───────────────
const transferService = require('../services/transferService');

/**
 * Initiate an inter-campus student transfer
 */
async function transferStudent(req, res) {
  try {
    const collegeId = req.user.college_id;
    const { studentId, toSectionId, reason } = req.body;

    const result = await transferService.initiateTransfer({
      collegeId,
      studentId,
      toSectionId,
      reason,
      actorUserId: req.user.id
    });

    return res.status(result.status || 200).json(result);
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      code: err.code || 'TRANSFER_ERROR',
      message: err.message
    });
  }
}

/**
 * List transfer history
 */
async function listTransfers(req, res) {
  try {
    const collegeId = req.user.college_id;
    const { studentId, fromCampusId, toCampusId } = req.query;

    const transfers = await transferService.listTransfers(collegeId, {
      studentId,
      fromCampusId,
      toCampusId
    });

    return res.json({
      success: true,
      transfers
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message
    });
  }
}

module.exports = {
  transferStudent,
  listTransfers
};

