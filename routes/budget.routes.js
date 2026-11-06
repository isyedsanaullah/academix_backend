'use strict';

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { featureGate } = require('../middleware/loadEntitlements');
const budgetController = require('../controllers/budget.controller');

router.use(protect);
router.use(featureGate('department-budgets-cost-centers'));

router.post('/allocate', budgetController.allocateBudget);
router.get('/summary', budgetController.getSummary);

module.exports = router;

