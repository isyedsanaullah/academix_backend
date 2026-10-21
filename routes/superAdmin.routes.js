const router = require('express').Router();
const {
  getDashboard, getColleges, createCollege, getCollege,
  updateCollege, toggleCollegeStatus, deleteCollege,
  updateCollegePlan, updateCollegeFeatures, previewCollegeFeatures, getCollegeAudit,
  getSubscriptionOverview, getPlatformAnalytics,
  previewCustomPlan, saveCollegeCustomPlan, getCustomPricing, updateCustomPricingConfig,
  createPlatformInvoice, getPlatformInvoices, payPlatformInvoice,
  downloadPlatformInvoicePDF, downloadPlatformReceiptPDF, uploadPlatformSignature
} = require('../controllers/superAdmin.controller');
const {
  getSubscriptionRequests, getSubscriptionRequest, updateSubscriptionRequest
} = require('../controllers/subscriptionRequest.controller');
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');

router.use(protect, authorize('superAdmin'));

const {
  inviteCollege, getInvitations, resendInvitation, cancelInvitation
} = require('../controllers/invitation.controller');

router.get('/dashboard', getDashboard);
router.get('/subscriptions', getSubscriptionOverview);
router.get('/analytics', getPlatformAnalytics);

// College management & invitations
router.route('/invitations').get(getInvitations).post(inviteCollege);
router.post('/invitations/:id/resend', resendInvitation);
router.delete('/invitations/:id', cancelInvitation);

router.route('/colleges').get(getColleges).post(createCollege);
router.route('/colleges/:id').get(getCollege).put(updateCollege).delete(deleteCollege);
router.put('/colleges/:id/status', toggleCollegeStatus);
router.put('/colleges/:id/plan', updateCollegePlan);
router.put('/colleges/:id/features', updateCollegeFeatures);
router.post('/colleges/:id/features/preview', previewCollegeFeatures);
router.get('/colleges/:id/audit', getCollegeAudit);

// Custom plan builder routes (Phase 9)
router.post('/custom-plan/preview', previewCustomPlan);
router.route('/custom-plan/pricing').get(getCustomPricing).put(updateCustomPricingConfig);
router.post('/colleges/:id/custom-plan', saveCollegeCustomPlan);

// Subscription Requests management
router.route('/subscription-requests').get(getSubscriptionRequests);
router.route('/subscription-requests/:id').get(getSubscriptionRequest).put(updateSubscriptionRequest);

// Platform Subscription Invoices (Phase 12)
router.route('/invoices')
  .get(getPlatformInvoices)
  .post(createPlatformInvoice);

router.put('/invoices/:id/pay', payPlatformInvoice);
router.get('/invoices/:id.pdf', downloadPlatformInvoicePDF);
router.get('/invoices/:id/receipt.pdf', downloadPlatformReceiptPDF);

const multer = require('multer');
const signatureUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});
router.post('/branding/signature', signatureUpload.single('signature'), uploadPlatformSignature);

router.meta = {
  "exempt": "platform",
  "reason": "Platform super-admin multi-tenant control plane"
};

module.exports = router;