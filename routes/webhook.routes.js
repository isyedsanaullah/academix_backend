'use strict';

/**
 * webhook.routes.js — Phase 9E (#N06)
 * Admin Management Routes for Webhooks.
 * Requires authMiddleware + subscriptionGate('public-api-webhooks').
 */

const express = require('express');
const router = express.Router();
const webhookService = require('../services/webhookService');
const { authMiddleware } = require('../middleware/auth');
const subscriptionGate = require('../middleware/subscriptionGate');
const { getSystemClient } = require('../config/prismaManager');

function getPrisma() {
  return getSystemClient();
}

router.use(authMiddleware);
router.use(subscriptionGate('public-api-webhooks'));

// Only institution admins can manage webhooks
router.use((req, res, next) => {
  const role = String(req.user?.role || '').toLowerCase();
  if (role !== 'admin' && role !== 'superadmin') {
    return res.status(403).json({
      success: false,
      code: 'FORBIDDEN',
      message: 'Only institution administrators can manage webhooks.'
    });
  }
  next();
});

router.get('/subscriptions', async (req, res) => {
  try {
    const collegeId = req.user.college_id || req.headers['x-college-id'];
    const prisma = getPrisma();
    const subs = await prisma.webhookSubscription.findMany({
      where: { college_id: collegeId },
      select: {
        id: true,
        targetUrl: true,
        events: true,
        isActive: true,
        consecutiveAbandoned: true,
        disabledReason: true,
        createdAt: true
      },
      orderBy: { createdAt: 'desc' }
    });
    return res.json({ success: true, data: subs });
  } catch (err) {
    return res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: err.message });
  }
});

router.post('/subscriptions', async (req, res) => {
  try {
    const collegeId = req.user.college_id || req.headers['x-college-id'];
    const { targetUrl, events, campus_id } = req.body;

    const result = await webhookService.createSubscription({
      collegeId,
      campusId: campus_id || req.user.campus_id || null,
      targetUrl,
      events
    });

    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, code: err.code || 'INTERNAL_ERROR', message: err.message });
  }
});

router.post('/subscriptions/:id/rotate-secret', async (req, res) => {
  try {
    const collegeId = req.user.college_id || req.headers['x-college-id'];
    const result = await webhookService.rotateSecret({
      collegeId,
      subscriptionId: req.params.id
    });
    return res.json({ success: true, data: result });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, code: err.code || 'INTERNAL_ERROR', message: err.message });
  }
});

router.delete('/subscriptions/:id', async (req, res) => {
  try {
    const collegeId = req.user.college_id || req.headers['x-college-id'];
    const prisma = getPrisma();
    await prisma.webhookSubscription.deleteMany({
      where: { id: req.params.id, college_id: collegeId }
    });
    return res.json({ success: true, message: 'Subscription removed successfully.' });
  } catch (err) {
    return res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: err.message });
  }
});

router.get('/deliveries', async (req, res) => {
  try {
    const collegeId = req.user.college_id || req.headers['x-college-id'];
    const prisma = getPrisma();
    const deliveries = await prisma.webhookDelivery.findMany({
      where: { college_id: collegeId },
      take: 50,
      orderBy: { createdAt: 'desc' }
    });
    return res.json({ success: true, data: deliveries });
  } catch (err) {
    return res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: err.message });
  }
});

router.post('/deliveries/:id/retry', async (req, res) => {
  try {
    const result = await webhookService.deliverWebhook(req.params.id);
    return res.json({ success: true, data: result });
  } catch (err) {
    return res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: err.message });
  }
});

module.exports = router;

