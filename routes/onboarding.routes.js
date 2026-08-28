const router = require('express').Router();
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');
const {
  getOnboardingStatus,
  saveStep1Profile,
  saveStep2Academic,
  saveStep3Staff,
  completeOnboarding
} = require('../controllers/onboarding.controller');

router.use(protect, tenantContext);
router.use(authorize('admin'));

router.get('/status', getOnboardingStatus);
router.post('/step-1', saveStep1Profile);
router.post('/step-2', saveStep2Academic);
router.post('/step-3', saveStep3Staff);
router.post('/complete', completeOnboarding);

module.exports = router;
