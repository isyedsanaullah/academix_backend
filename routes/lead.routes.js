const router = require('express').Router();
const {
  getEnquiryLeads,
  createEnquiryLead,
  updateEnquiryLead,
  convertLeadToApplication
} = require('../controllers/admissions.controller');

const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');
const { featureGate } = require('../middleware/loadEntitlements');

router.use(protect, tenantContext, featureGate('enquiry-leads'));

router.route('/')
  .get(authorize('admin', 'registrar', 'principal'), getEnquiryLeads)
  .post(authorize('admin', 'registrar'), createEnquiryLead);

router.route('/:id')
  .put(authorize('admin', 'registrar'), updateEnquiryLead);

router.route('/:id/convert')
  .post(authorize('admin', 'registrar'), convertLeadToApplication);

router.meta = {
  feature: 'enquiry-leads'
};

module.exports = router;
