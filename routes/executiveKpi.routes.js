const express = require('express');
const router = express.Router();
const controller = require('../controllers/executiveKpi.controller');
const { protect } = require('../middleware/auth.middleware');
const { subscriptionGate } = require('../middleware/subscriptionGate');

router.use(protect);
router.use(subscriptionGate('principal-executive-dashboard'));

router.get('/kpi-summary', controller.getKpiSummary);

module.exports = router;

