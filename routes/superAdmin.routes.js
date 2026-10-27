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
  getSubscriptionRequests,
  getSubscriptionRequest,
  updateSubscriptionRequest,
  markContacted,
  rejectSubscriptionRequest,
  addSubscriptionRequestNote,
  checkSlug,
  approveSubscriptionRequest,
  resendCollegeInvite,
  revokeCollegeInvite,
  getCollegeInviteStatus
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

// Subscription Requests management (Phase 1 & Phase 3)
router.get('/slugs/check', checkSlug);
router.route('/subscription-requests').get(getSubscriptionRequests);
router.route('/subscription-requests/:id').get(getSubscriptionRequest).put(updateSubscriptionRequest);
router.patch('/subscription-requests/:id/contact', markContacted);
router.patch('/subscription-requests/:id/reject', rejectSubscriptionRequest);
router.post('/subscription-requests/:id/notes', addSubscriptionRequestNote);
router.post('/subscription-requests/:id/approve', approveSubscriptionRequest);

// College Invite Management (Phase 3)
router.post('/colleges/:id/invite/resend', resendCollegeInvite);
router.post('/colleges/:id/invite/revoke', revokeCollegeInvite);
router.get('/colleges/:id/invite', getCollegeInviteStatus);

// College Subscription Management & Messaging (Phase 9)
const {
  getSubscription,
  assignSubscription,
  renewSubscription,
  editExpiry,
  editFeatureOverrides,
  suspendCollege,
  reactivateCollege,
  sendMessage,
  getMessages,
  retryMessageDelivery
} = require('../controllers/subscriptionManagement.controller');

router.get('/colleges/:id/subscription', getSubscription);
router.post('/colleges/:id/subscription/assign', assignSubscription);
router.post('/colleges/:id/subscription/renew', renewSubscription);
router.patch('/colleges/:id/subscription/expiry', editExpiry);
router.patch('/colleges/:id/subscription/features', editFeatureOverrides);
router.post('/colleges/:id/suspend', suspendCollege);
router.post('/colleges/:id/reactivate', reactivateCollege);
router.get('/colleges/:id/messages', getMessages);
router.post('/colleges/:id/messages', sendMessage);
router.post('/colleges/:id/messages/:deliveryId/retry', retryMessageDelivery);

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