const router = require('express').Router();
const protect = require('../middleware/auth');
const tenantContext = require('../middleware/tenantContext');
const { loadEntitlements } = require('../middleware/loadEntitlements');
const { myCapabilities } = require('../controllers/fallback.controller');

router.get('/capabilities', protect, tenantContext, loadEntitlements, myCapabilities);


router.meta = {
  "exempt": "core",
  "reason": "Current authenticated user profile and capability resolution"
};

module.exports = router;