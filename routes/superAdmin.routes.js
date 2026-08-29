const router = require('express').Router();
const {
  getDashboard, getColleges, createCollege, getCollege,
  updateCollege, toggleCollegeStatus, deleteCollege,
  updateCollegePlan, updateCollegeFeatures, getSubscriptionOverview, getPlatformAnalytics
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

// Subscription Requests management
router.route('/subscription-requests').get(getSubscriptionRequests);
router.route('/subscription-requests/:id').get(getSubscriptionRequest).put(updateSubscriptionRequest);

module.exports = router;


