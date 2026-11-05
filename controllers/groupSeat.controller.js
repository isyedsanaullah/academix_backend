'use strict';

const groupSeatService = require('../services/groupSeatService');

/**
 * GET /api/groups/:groupId/seat-allocation?session_id=...
 */
async function getSeatAllocation(req, res) {
  try {
    const { groupId } = req.params;
    const sessionId = req.query.session_id || req.query.sessionId;

    if (!sessionId) {
      return res.status(400).json({ success: false, error: 'session_id is required' });
    }

    const data = await groupSeatService.getSeatAllocation({
      collegeId: req.collegeId,
      groupId,
      sessionId
    });

    return res.json({ success: true, data });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, error: err.message });
  }
}

/**
 * PUT /api/groups/:groupId/seat-allocation
 * Body: { sessionId, maxSeats, campusId }
 */
async function setSeatAllocation(req, res) {
  try {
    const { groupId } = req.params;
    const { sessionId, session_id, maxSeats, campusId } = req.body;
    const targetSession = sessionId || session_id;

    if (!targetSession) {
      return res.status(400).json({ success: false, error: 'sessionId is required' });
    }

    const result = await groupSeatService.setSeatAllocation({
      collegeId: req.collegeId,
      campusId: campusId || req.campusId || null,
      groupId,
      sessionId: targetSession,
      maxSeats: parseInt(maxSeats, 10)
    });

    return res.json({ success: true, ...result });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, error: err.message });
  }
}

/**
 * GET /api/groups/:groupId/fee-schedule?session_id=...
 */
async function getFeeSchedule(req, res) {
  try {
    const { groupId } = req.params;
    const sessionId = req.query.session_id || req.query.sessionId;

    if (!sessionId) {
      return res.status(400).json({ success: false, error: 'session_id is required' });
    }

    const schedule = await groupSeatService.getFeeSchedule({
      collegeId: req.collegeId,
      groupId,
      sessionId
    });

    return res.json({ success: true, schedule });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, error: err.message });
  }
}

/**
 * PUT /api/groups/:groupId/fee-schedule
 * Body: { sessionId, tuitionFeePkr, admissionFeePkr, campusId }
 */
async function setFeeSchedule(req, res) {
  try {
    const { groupId } = req.params;
    const { sessionId, session_id, tuitionFeePkr, admissionFeePkr, campusId } = req.body;
    const targetSession = sessionId || session_id;

    if (!targetSession) {
      return res.status(400).json({ success: false, error: 'sessionId is required' });
    }

    const schedule = await groupSeatService.setFeeSchedule({
      collegeId: req.collegeId,
      campusId: campusId || req.campusId || null,
      groupId,
      sessionId: targetSession,
      tuitionFeePkr,
      admissionFeePkr
    });

    return res.json({ success: true, schedule });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, error: err.message });
  }
}

module.exports = {
  getSeatAllocation,
  setSeatAllocation,
  getFeeSchedule,
  setFeeSchedule
};

