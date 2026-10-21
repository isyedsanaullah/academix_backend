/**
 * ActivityLog Routes
 * Exposes GET /api/activity-logs for activity reporting.
 */

const router = require('express').Router();
const { getActivities } = require('../controllers/activityLog.controller');
const protect = require('../middleware/auth');
const tenantContext = require('../middleware/tenantContext');

router.use(protect, tenantContext);

// GET /api/activity-logs - Retrieve role-scoped activity logs
router.get('/', getActivities);


router.meta = {
  "exempt": "core",
  "reason": "Audit and activity logs for tenant administration"
};

module.exports = router;