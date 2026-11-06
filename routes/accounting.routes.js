'use strict';

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { featureGate } = require('../middleware/loadEntitlements');
const accountingController = require('../controllers/accounting.controller');

router.use(protect);
router.use(featureGate('double-entry-accounting'));

router.post('/seed-chart', accountingController.seedChart);
router.post('/chart-of-accounts', accountingController.createAccountHead);
router.post('/vouchers', accountingController.postVoucher);
router.get('/trial-balance', accountingController.getTrialBalance);
router.get('/income-statement', accountingController.getIncomeStatement);

module.exports = router;

