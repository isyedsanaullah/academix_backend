'use strict';

const router = require('express').Router();
const multer = require('multer');
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');
const requireVerifiedEmail = require('../middleware/requireVerifiedEmail');

const {
  getOnboardingState,
  updateOnboardingStep,
  uploadOnboardingMedia,
  getOnboardingStatus,
  getReviewChecklist,
  launchCollegeWorkspace,
  saveStep1Profile,
  saveStep2Academic,
  saveStep3Staff,
  completeOnboarding
} = require('../controllers/onboarding.controller');

const {
  getStaffList,
  createStaff,
  resendStaffInvite
} = require('../controllers/staffInvite.controller');

const {
  getStudentTemplate,
  importStudents,
  downloadBatchErrors,
  getRecentBatches
} = require('../controllers/studentImport.controller');

const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5 MB max
});

router.use(protect, tenantContext);
router.use(authorize('admin'));

// ── Phase 5 Standard Routes ──
router.get('/', getOnboardingState);                       // GET /admin/onboarding
router.patch('/steps/:step', updateOnboardingStep);        // PATCH /admin/onboarding/steps/:step
router.post('/upload', memoryUpload.single('file'), uploadOnboardingMedia); // POST /admin/onboarding/upload

// ── Phase 6 Staff Accounts (Requires Verified Email) ──
router.get('/staff', getStaffList);
router.post('/staff', requireVerifiedEmail, createStaff);
router.post('/staff/:userId/resend', requireVerifiedEmail, resendStaffInvite);

// ── Phase 6 Student Bulk Import (Requires Verified Email) ──
router.get('/students/template', getStudentTemplate);
router.post('/students/import', requireVerifiedEmail, importStudents);
router.get('/students/batches/:id/errors', downloadBatchErrors);
router.get('/students/batches', getRecentBatches);

// ── Phase 7 Review, Launch & Workspace Gating ──
router.get('/review', getReviewChecklist);
router.post('/launch', requireVerifiedEmail, launchCollegeWorkspace);

// ── Backward Compatibility Routes ──
router.get('/status', getOnboardingStatus);
router.post('/step-1', saveStep1Profile);
router.post('/step-2', saveStep2Academic);
router.post('/step-3', saveStep3Staff);
router.post('/complete', requireVerifiedEmail, launchCollegeWorkspace);

router.meta = {
  "exempt": "core",
  "reason": "Initial college onboarding setup"
};

module.exports = router;