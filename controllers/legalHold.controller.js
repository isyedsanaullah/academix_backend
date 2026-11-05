// ─── Legal Hold & Data Retention Controller (Phase 10: N16) ───────────
const legalHoldService = require('../services/legalHoldService');
const { getSystemClient } = require('../config/prismaManager');

/**
 * List legal holds for the college
 */
async function listHolds(req, res) {
  try {
    const collegeId = req.user.college_id;
    const isActive = req.query.isActive !== undefined ? req.query.isActive === 'true' : null;
    const campusId = req.query.campusId || null;

    const holds = await legalHoldService.listLegalHolds(collegeId, { isActive, campusId });

    return res.json({
      success: true,
      holds
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message
    });
  }
}

/**
 * Place a legal hold (requires step-up token)
 */
async function placeHold(req, res) {
  try {
    const collegeId = req.user.college_id;
    const { title, reason, scopeType, targetId, campusId } = req.body;

    const hold = await legalHoldService.placeLegalHold(collegeId, {
      title,
      reason,
      scopeType,
      targetId,
      campus_id: campusId || null,
      placedBy: req.user.id
    });

    const prisma = getSystemClient();
    await prisma.auditLog.create({
      data: {
        college_id: collegeId,
        user_id: req.user.id,
        action: 'LEGAL_HOLD_PLACED',
        resource: 'LegalHold',
        resourceId: hold.id,
        details: JSON.stringify({ title, reason, scopeType, targetId }),
        ipAddress: req.ip
      }
    }).catch(() => {});

    return res.status(201).json({
      success: true,
      message: `Legal hold "${title}" placed successfully`,
      hold
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
 * Release an active legal hold (requires step-up token)
 */
async function releaseHold(req, res) {
  try {
    const collegeId = req.user.college_id;
    const { id } = req.params;
    const { releaseReason } = req.body;

    const hold = await legalHoldService.releaseLegalHold(collegeId, id, {
      releasedBy: req.user.id,
      releaseReason
    });

    const prisma = getSystemClient();
    await prisma.auditLog.create({
      data: {
        college_id: collegeId,
        user_id: req.user.id,
        action: 'LEGAL_HOLD_RELEASED',
        resource: 'LegalHold',
        resourceId: hold.id,
        details: JSON.stringify({ releaseReason }),
        ipAddress: req.ip
      }
    }).catch(() => {});

    return res.json({
      success: true,
      message: `Legal hold "${hold.title}" released successfully`,
      hold
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
 * Get retention policies for the college
 */
async function getRetentionPolicies(req, res) {
  try {
    const collegeId = req.user.college_id;
    const prisma = getSystemClient();

    const policies = await prisma.retentionPolicy.findMany({
      where: { college_id: collegeId }
    });

    return res.json({
      success: true,
      floors: legalHoldService.PLATFORM_FLOORS,
      policies
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message
    });
  }
}

/**
 * Configure retention policy enforcing platform floors
 */
async function setRetentionPolicy(req, res) {
  try {
    const collegeId = req.user.college_id;
    const { entityType, retainDays, campusId } = req.body;

    const policy = await legalHoldService.setRetentionPolicy(collegeId, {
      entityType,
      retainDays,
      campus_id: campusId || null
    });

    return res.json({
      success: true,
      policy
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      code: err.code || 'VALIDATION_ERROR',
      message: err.message
    });
  }
}

module.exports = {
  listHolds,
  placeHold,
  releaseHold,
  getRetentionPolicies,
  setRetentionPolicy
};

