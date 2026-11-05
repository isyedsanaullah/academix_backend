'use strict';

/**
 * backup.routes.js — Phase 9F (#N05)
 * Routes for Institutional Data Backup (Enterprise-Only)
 */

const express = require('express');
const router = express.Router();
const controller = require('../controllers/backup.controller');
const { authMiddleware } = require('../middleware/auth');
const subscriptionGate = require('../middleware/subscriptionGate');

router.use(authMiddleware);
router.use(subscriptionGate('self-service-data-backup'));

// Only institution admins can request and access institutional backups
router.use((req, res, next) => {
  const role = String(req.user?.role || '').toLowerCase();
  if (role !== 'admin' && role !== 'superadmin') {
    return res.status(403).json({
      success: false,
      code: 'FORBIDDEN',
      message: 'Only institution administrators can request data backups.'
    });
  }
  next();
});

router.get('/', controller.listBackups);
router.post('/', controller.requestBackup);
router.post('/:id/refresh-links', controller.refreshLinks);

module.exports = router;

