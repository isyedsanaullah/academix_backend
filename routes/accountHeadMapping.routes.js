'use strict';

/**
 * accountHeadMapping.routes.js — Phase 9J (#N04)
 * Routes for Chart of Accounts Mapping (N04 Accountant Journal CSV)
 */

const express = require('express');
const router = express.Router();
const protect = require('../middleware/auth');
const { subscriptionGate } = require('../middleware/subscriptionGate');
const {
  listMappings,
  upsertMapping,
  deleteMapping,
  seedDefaults,
  preflightCheck
} = require('../controllers/accountHeadMapping.controller');

// Gated by accountant-csv-export (#N04 - Starts in Premium)
router.use(protect);
router.use(subscriptionGate('accountant-csv-export'));

router.get('/mappings', listMappings);
router.post('/mappings', upsertMapping);
router.delete('/mappings/:id', deleteMapping);
router.post('/mappings/seed-defaults', seedDefaults);
router.get('/preflight', preflightCheck);

module.exports = router;

