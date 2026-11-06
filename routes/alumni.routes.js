const router = require('express').Router();
const alumniController = require('../controllers/alumni.controller');
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');
const { featureGate } = require('../middleware/loadEntitlements');

router.use(protect, tenantContext, featureGate('alumni-records-placement'));

router.post('/profiles', authorize('admin', 'principal', 'registrar'), alumniController.registerAlumni);
router.get('/profiles', authorize('admin', 'principal', 'registrar', 'teacher'), alumniController.listAlumni);
router.get('/analytics', authorize('admin', 'principal', 'registrar'), alumniController.getPlacementAnalytics);

router.meta = {
  feature: 'alumni-records-placement',
};

module.exports = router;

