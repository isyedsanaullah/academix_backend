'use strict';

/**
 * digest.routes.js — Phase 9H (#N03)
 * Routes for Scheduled Executive Digest Configuration
 */

const express = require('express');
const router = express.Router();
const digestService = require('../services/digestService');
const { authMiddleware } = require('../middleware/auth');
const subscriptionGate = require('../middleware/subscriptionGate');

router.use(authMiddleware);
router.use(subscriptionGate('scheduled-reports-email'));

router.get('/', async (req, res) => {
  try {
    const collegeId = req.user.college_id || req.headers['x-college-id'];
    const config = await digestService.getDigestConfig(collegeId);
    return res.json({ success: true, data: config });
  } catch (err) {
    return res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: err.message });
  }
});

router.put('/', async (req, res) => {
  try {
    const collegeId = req.user.college_id || req.headers['x-college-id'];
    const { isEnabled, recipients, weekday, sendHour, campus_id } = req.body;

    const saved = await digestService.saveDigestConfig({
      collegeId,
      campusId: campus_id || req.user.campus_id || null,
      isEnabled,
      recipients,
      weekday,
      sendHour
    });

    return res.json({ success: true, data: saved });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, code: err.code || 'INTERNAL_ERROR', message: err.message });
  }
});

module.exports = router;

