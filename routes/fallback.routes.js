const router = require('express').Router();
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');
const { featureGate } = require('../middleware/loadEntitlements');
const { verifyDocument, notifyParents } = require('../controllers/fallback.controller');

router.use(protect, tenantContext);

router.post('/verify', authorize('admin', 'principal', 'registrar'), featureGate('students'), verifyDocument);
router.post('/notify/parents', authorize('admin', 'principal', 'teacher', 'registrar'), featureGate('announcements'), notifyParents);


router.meta = {
  "feature": [
    "students",
    "announcements"
  ]
};

module.exports = router;