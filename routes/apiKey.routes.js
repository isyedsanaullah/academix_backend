'use strict';

/**
 * apiKey.routes.js — Phase 9E (#N06)
 * Admin Management Routes for Public API Keys.
 * Requires authMiddleware + subscriptionGate('public-api-webhooks').
 */

const express = require('express');
const router = express.Router();
const apiKeyService = require('../services/apiKeyService');
const { authMiddleware } = require('../middleware/auth');
const subscriptionGate = require('../middleware/subscriptionGate');

router.use(authMiddleware);
router.use(subscriptionGate('public-api-webhooks'));

// Only institution admins can manage API keys
router.use((req, res, next) => {
  const role = String(req.user?.role || '').toLowerCase();
  if (role !== 'admin' && role !== 'superadmin') {
    return res.status(403).json({
      success: false,
      code: 'FORBIDDEN',
      message: 'Only institution administrators can manage API keys.'
    });
  }
  next();
});

router.get('/', async (req, res) => {
  try {
    const collegeId = req.user.college_id || req.headers['x-college-id'];
    const keys = await apiKeyService.listApiKeys(collegeId);
    return res.json({ success: true, data: keys });
  } catch (err) {
    return res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const collegeId = req.user.college_id || req.headers['x-college-id'];
    const { name, scopes, expiresAt, campus_id } = req.body;

    const result = await apiKeyService.generateApiKey({
      collegeId,
      campusId: campus_id || req.user.campus_id || null,
      name,
      scopes,
      expiresAt,
      createdBy: req.user.id
    });

    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, code: err.code || 'INTERNAL_ERROR', message: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const collegeId = req.user.college_id || req.headers['x-college-id'];
    await apiKeyService.revokeApiKey(collegeId, req.params.id);
    return res.json({ success: true, message: 'API key revoked successfully.' });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, code: err.code || 'INTERNAL_ERROR', message: err.message });
  }
});

module.exports = router;

