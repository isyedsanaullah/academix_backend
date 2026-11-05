'use strict';

/**
 * export.routes.js — Phase 9B (#N01)
 * Centralized Export Center Routes
 */

const express = require('express');
const router = express.Router();
const protect = require('../middleware/auth');
const { subscriptionGate } = require('../middleware/subscriptionGate');
const {
  requestExport,
  listExports,
  getExportDetails,
  listBoardExportProfiles
} = require('../controllers/export.controller');

// Gated by export-center (#N01)
router.use(protect);
router.use(subscriptionGate('export-center'));

router.get('/board-profiles', listBoardExportProfiles);
router.post('/', requestExport);
router.get('/', listExports);
router.get('/:id', getExportDetails);

module.exports = router;
