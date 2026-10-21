const router = require('express').Router();
const { getOverview, getCollegeAnalytics, getLoginTrends } = require('../controllers/analytics.controller');
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');

const { featureGate } = require('../middleware/loadEntitlements');

router.use(protect, authorize('superAdmin'), featureGate('analytics-reports'));

router.get('/overview', getOverview);
router.get('/colleges', getCollegeAnalytics);
router.get('/logins', getLoginTrends);

router.meta = { feature: 'analytics-reports' };
module.exports = router;
