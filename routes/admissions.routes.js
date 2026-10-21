const router = require('express').Router();
const {
  getQuotaRules,
  createQuotaRule,
  updateQuotaRule,
  deleteQuotaRule,
  getScholarshipTiers,
  createScholarshipTier,
  deleteScholarshipTier,
  getMeritList,
  createDeskApplication,
  verifyDocument
} = require('../controllers/admissions.controller');

const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');
const { featureGate } = require('../middleware/loadEntitlements');

router.use(protect, tenantContext);

// Quota Rules
router.route('/quotas')
  .get(featureGate('quotas'), authorize('admin', 'registrar', 'principal'), getQuotaRules)
  .post(featureGate('quotas'), authorize('admin', 'registrar', 'principal'), createQuotaRule);

router.route('/quotas/:id')
  .put(featureGate('quotas'), authorize('admin', 'registrar', 'principal'), updateQuotaRule)
  .delete(featureGate('quotas'), authorize('admin', 'registrar', 'principal'), deleteQuotaRule);

// Scholarship Tiers
router.route('/scholarships')
  .get(featureGate('merit-scholarship-tiers'), authorize('admin', 'registrar', 'principal'), getScholarshipTiers)
  .post(featureGate('merit-scholarship-tiers'), authorize('admin', 'registrar', 'principal'), createScholarshipTier);

router.route('/scholarships/:id')
  .delete(featureGate('merit-scholarship-tiers'), authorize('admin', 'registrar', 'principal'), deleteScholarshipTier);

// Merit List
router.get('/merit-list', featureGate('merit-scholarship-tiers'), authorize('admin', 'registrar', 'principal', 'teacher'), getMeritList);

// Desk Entry & Document Verification
router.post('/desk', featureGate('admissions'), authorize('admin', 'registrar'), createDeskApplication);
router.put('/documents/:id/:doc', featureGate('admissions'), authorize('admin', 'registrar'), verifyDocument);

router.meta = {
  feature: ['quotas', 'merit-scholarship-tiers', 'admissions']
};

module.exports = router;
