// ─── IP Allow-list Controller (Phase 10: N15) ─────────────────────────
const ipAllowlistService = require('../services/ipAllowlistService');
const { getSystemClient } = require('../config/prismaManager');

/**
 * List all IP allowlist rules for the caller's college
 */
async function getRules(req, res) {
  try {
    const collegeId = req.user.college_id;
    const campusId = req.query.campusId || null;
    const rules = await ipAllowlistService.getCollegeRules(collegeId, campusId);

    const prisma = getSystemClient();
    const college = await prisma.college.findUnique({
      where: { id: collegeId },
      select: { ipAllowlistMode: true }
    });

    return res.json({
      success: true,
      mode: college?.ipAllowlistMode || 'OFF',
      rules
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message
    });
  }
}

/**
 * Create a new allowlist rule
 */
async function createRule(req, res) {
  try {
    const collegeId = req.user.college_id;
    const { label, cidr, campusId } = req.body;
    const currentIp = req.ip;

    const rule = await ipAllowlistService.createRule(collegeId, {
      label,
      cidr,
      campus_id: campusId || null,
      createdBy: req.user.id,
      currentIp
    });

    return res.status(201).json({
      success: true,
      rule
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      code: err.code || 'VALIDATION_ERROR',
      message: err.message
    });
  }
}

/**
 * Delete an allowlist rule
 */
async function deleteRule(req, res) {
  try {
    const collegeId = req.user.college_id;
    const { id } = req.params;
    const currentIp = req.ip;

    await ipAllowlistService.deleteRule(collegeId, id, currentIp);

    return res.json({
      success: true,
      message: 'Rule deleted successfully'
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      code: err.code || 'ERROR',
      message: err.message
    });
  }
}

/**
 * Update allowlist mode (OFF, LOG_ONLY, ENFORCE)
 */
async function updateMode(req, res) {
  try {
    const collegeId = req.user.college_id;
    const { mode } = req.body;
    const currentIp = req.ip;

    const updated = await ipAllowlistService.setAllowlistMode(collegeId, mode, currentIp);

    return res.json({
      success: true,
      mode: updated.ipAllowlistMode
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      code: err.code || 'MODE_UPDATE_ERROR',
      message: err.message
    });
  }
}

/**
 * Retrieve violations summary
 */
async function getViolations(req, res) {
  try {
    const collegeId = req.user.college_id;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 50;

    const summary = await ipAllowlistService.getViolationsSummary(collegeId, { page, limit });

    return res.json({
      success: true,
      ...summary
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message
    });
  }
}

module.exports = {
  getRules,
  createRule,
  deleteRule,
  updateMode,
  getViolations
};

