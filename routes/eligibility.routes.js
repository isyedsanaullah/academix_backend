const router = require('express').Router();
const {
  computeEligibility,
  getEligibilityRecords,
  overrideEligibility,
  getEligibilityRules,
  saveEligibilityRule,
  getDefaultersPdf
} = require('../controllers/eligibility.controller');

const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');
const { featureGate } = require('../middleware/loadEntitlements');

router.use(protect, tenantContext, featureGate('eligibility-lists'));

// Rules
router.route('/rules')
  .get(authorize('admin', 'registrar', 'principal'), getEligibilityRules)
  .post(authorize('admin', 'principal'), saveEligibilityRule);

// Compute & Records
router.route('/compute')
  .post(authorize('admin', 'registrar', 'principal'), computeEligibility);

router.route('/')
  .get(authorize('admin', 'registrar', 'principal', 'teacher'), getEligibilityRecords);

// Defaulters PDF export
router.route('/defaulters/pdf')
  .get(authorize('admin', 'registrar', 'principal'), getDefaultersPdf);

// Principal override
router.route('/:id/override')
  .put(authorize('admin', 'principal'), overrideEligibility);

router.meta = {
  feature: 'eligibility-lists'
};

module.exports = router;
