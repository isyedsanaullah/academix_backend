'use strict';

/**
 * export.routes.js — Phase 9B (#N01)
 * Centralized Export Center Routes
 */

const express = require('express');
const router = express.Router();
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const { subscriptionGate } = require('../middleware/subscriptionGate');
const {
  requestExport,
  listExports,
  getExportDetails,
  listBoardExportProfiles,
  exportOffboardingBundle
} = require('../controllers/export.controller');

router.use(protect);

// T2.3 Unconditional safety rule: 30-day post-cancellation Admin offboarding archive (never plan-gated)
router.get('/offboarding', authorize('admin', 'principal', 'superAdmin'), exportOffboardingBundle);

// Gated by export-center (#N01)
router.use(subscriptionGate('export-center'));

router.get('/board-profiles', listBoardExportProfiles);
router.post('/', requestExport);
router.get('/', listExports);
router.get('/:id', getExportDetails);

module.exports = router;
