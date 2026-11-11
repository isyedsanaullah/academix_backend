'use strict';

const router = require('express').Router();
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const {
  getSummary,
  getTimeseries,
  getByModel,
  getByCollege,
  getByFeature,
  getRequests,
  getPricing,
  createPricing,
  updatePricing,
  getAlerts,
  updateAlerts,
  exportCsv
} = require('../controllers/superAdminAiUsage.controller');

// Enforce Super Admin authentication and RBAC authorization across all AI usage endpoints
router.use(protect, authorize('superAdmin'));

router.get('/summary', getSummary);
router.get('/timeseries', getTimeseries);
router.get('/by-model', getByModel);
router.get('/by-college', getByCollege);
router.get('/by-feature', getByFeature);
router.get('/requests', getRequests);
router.get('/pricing', getPricing);
router.post('/pricing', createPricing);
router.put('/pricing/:id', updatePricing);
router.get('/alerts', getAlerts);
router.put('/alerts', updateAlerts);
router.get('/export', exportCsv);

module.exports = router;

