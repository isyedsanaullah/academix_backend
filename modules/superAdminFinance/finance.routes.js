'use strict';

const express = require('express');
const router = express.Router();
const controller = require('./finance.controller');

// 1. Navigation Badges (Lightweight)
router.get('/nav-counts', controller.getNavCounts);

// 2. Accounting Overview
router.get('/overview', controller.getOverview);

// 3. Payments History
router.get('/payments', controller.getPayments);
router.get('/payments/export', controller.exportPayments);
router.get('/payments/:id', controller.getPaymentById);
router.post('/payments/:id/approve', controller.approvePayment);
router.post('/payments/:id/reject', controller.rejectPayment);

// 4. Per-College Billing
router.get('/colleges', controller.getColleges);
router.get('/colleges/:id', controller.getCollegeById);
router.post('/colleges/:id/change-plan', controller.changePlan);

// 5. Accountant Details
router.get('/accountants', controller.getAccountants);

module.exports = router;

