'use strict';

/**
 * approvalWorkflow.routes.js — Phase 9D (#N11)
 * Routes for Multi-Step Approval Workflows
 */

const express = require('express');
const router = express.Router();
const controller = require('../controllers/approvalWorkflow.controller');
const { authMiddleware } = require('../middleware/auth');
const subscriptionGate = require('../middleware/subscriptionGate');

// All routes require authentication and N11 feature entitlement
router.use(authMiddleware);
router.use(subscriptionGate('approval-workflows'));

router.get('/chains', controller.listChains);
router.post('/chains', controller.configureChain);
router.get('/requests', controller.listRequests);
router.get('/requests/:id', controller.getRequest);
router.post('/requests/:id/approve', controller.approve);
router.post('/requests/:id/reject', controller.reject);
router.post('/requests/:id/cancel', controller.cancel);

module.exports = router;

