const router = require('express').Router();
const multer = require('multer');
const {
  getCollegeInfo,
  getDashboard,
  getSettings,
  updateSettings,
  getStaff,
  addStaff,
  getBranding,
  updateBranding,
  uploadSignature,
  getCollegeInvoices,
  downloadCollegeInvoicePDF
} = require('../controllers/college.controller');
const { applyCollegeStatus, undoCollegeStatus } = require('../controllers/statusTransition.controller');
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');
const { featureGate } = require('../middleware/loadEntitlements');

const signatureUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
});

router.use(protect, tenantContext);

// Any authenticated user can see their college info
router.get('/info', getCollegeInfo);

router.get('/dashboard', authorize('admin', 'principal'), getDashboard);
router.route('/settings').get(authorize('admin'), getSettings).put(authorize('admin'), updateSettings);
router.route('/staff').get(authorize('admin', 'principal'), getStaff).post(authorize('admin'), addStaff);

// ── College Branding & Signatures (Phase 11) ─────────────────────────
router.get('/branding', featureGate('college-branding'), getBranding);
router.put('/branding', authorize('admin', 'principal'), featureGate('college-branding'), updateBranding);
router.post(
  '/branding/signature/:role',
  authorize('admin', 'principal', 'registrar', 'accountant'),
  featureGate('college-branding'),
  signatureUpload.single('signature'),
  uploadSignature
);

// Reversible Status Transitions (Super Admin only)
router.post('/:id/status', authorize('superAdmin'), applyCollegeStatus);
router.post('/:id/undo-status', authorize('superAdmin'), undoCollegeStatus);

// College Platform Invoices (Phase 12)
router.get('/invoices', authorize('admin'), getCollegeInvoices);
router.get('/invoices/:id.pdf', authorize('admin'), downloadCollegeInvoicePDF);


router.meta = {
  "exempt": "core",
  "reason": "College administration and configuration"
};

module.exports = router;