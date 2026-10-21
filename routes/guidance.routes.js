// routes/guidance.routes.js
// Phase 10: Guidance, Parent Meetings, Scholarships, and Student Feedback

const express = require('express');
const router = express.Router();
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');
const { featureGate } = require('../middleware/loadEntitlements');

const {
  getParentMeetings,
  createParentMeeting,
  updateParentMeeting,
  getCareerCounselling,
  createCareerCounselling,
  updateCareerCounselling,
  getScholarships,
  createScholarship,
  updateScholarship,
  sendRenewalReminders,
  submitFeedback,
  getFeedbackList,
  updateFeedback
} = require('../controllers/guidance.controller');

// Require authentication and tenant context
router.use(protect, tenantContext);

// ── 1. Parent-Teacher Meetings (ptm) ──────────────────────────────────────────
router.route('/parent-meetings')
  .get(featureGate('ptm'), authorize('admin', 'principal', 'teacher', 'registrar'), getParentMeetings)
  .post(featureGate('ptm'), authorize('admin', 'principal', 'teacher'), createParentMeeting);

router.route('/parent-meetings/:id')
  .put(featureGate('ptm'), authorize('admin', 'principal', 'teacher'), updateParentMeeting);

// ── 2. Career Counselling (career-counselling) ────────────────────────────────
router.route('/career-counselling')
  .get(featureGate('career-counselling'), authorize('admin', 'principal', 'teacher', 'student'), getCareerCounselling)
  .post(featureGate('career-counselling'), authorize('admin', 'principal', 'teacher'), createCareerCounselling);

router.route('/career-counselling/:id')
  .put(featureGate('career-counselling'), authorize('admin', 'principal', 'teacher'), updateCareerCounselling);

// ── 3. Scholarship Records (scholarship-tracking) ─────────────────────────────
router.route('/scholarships')
  .get(featureGate('scholarship-tracking'), authorize('admin', 'principal', 'registrar', 'accountant', 'student'), getScholarships)
  .post(featureGate('scholarship-tracking'), authorize('admin', 'principal', 'registrar'), createScholarship);

router.route('/scholarships/renewal-reminders')
  .post(featureGate('scholarship-tracking'), authorize('admin', 'principal', 'registrar'), sendRenewalReminders);

router.route('/scholarships/:id')
  .put(featureGate('scholarship-tracking'), authorize('admin', 'principal', 'registrar'), updateScholarship);

// ── 4. Student Feedback Box (feedback-box) ────────────────────────────────────
router.route('/feedback')
  .get(featureGate('feedback-box'), authorize('admin', 'principal', 'teacher'), getFeedbackList)
  .post(featureGate('feedback-box'), authorize('admin', 'principal', 'teacher', 'student'), submitFeedback);

router.route('/feedback/:id')
  .put(featureGate('feedback-box'), authorize('admin', 'principal'), updateFeedback);

router.meta = {
  feature: ['ptm', 'career-counselling', 'scholarship-tracking', 'feedback-box']
};

module.exports = router;
