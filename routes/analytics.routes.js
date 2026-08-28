const router = require('express').Router();
const { getOverview, getCollegeAnalytics, getLoginTrends } = require('../controllers/analytics.controller');
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');

router.use(protect, authorize('superAdmin'));

router.get('/overview', getOverview);
router.get('/colleges', getCollegeAnalytics);
router.get('/logins', getLoginTrends);

module.exports = router;
