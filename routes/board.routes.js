// routes/board.routes.js
// Routes for Board Registration, Exam Admission, Attendance Checks,
// Roll Number Slips, Datesheets, Results Entry & CSV Import, and Analytics.

const router = require('express').Router();
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');
const { featureGate } = require('../middleware/loadEntitlements');

const {
  getBoardForms,
  getBoardFormById,
  registerBatch,
  createExternalCandidate,
  createExamAdmissionBatch,
  updateBoardForm,
  updateBoardFormStatus,
  deleteBoardForm,
  getDatesheets,
  createDatesheet,
  updateDatesheet,
  deleteDatesheet,
  getRollNumberSlip,
  getBoardResults,
  createManualResult,
  importBoardResults,
  getUnmatchedResults,
  matchUnmatchedResult,
  getBoardResultAnalysis,
  getBoardResultAnalysisPdf,
  sendBoardFeeAlerts
} = require('../controllers/board.controller');

router.use(protect, tenantContext);

// ==============================================================================
// 1. Board Forms (Registration & Exam Admission)
// ==============================================================================
router.route('/forms')
  .get(featureGate('board-registration'), authorize('admin', 'registrar', 'principal', 'teacher'), getBoardForms);

router.post(
  '/forms/register-batch',
  featureGate('board-registration'),
  authorize('admin', 'registrar'),
  registerBatch
);

router.post(
  '/forms/exam-admission-batch',
  featureGate('board-exam-forms'),
  authorize('admin', 'registrar'),
  createExamAdmissionBatch
);

router.post(
  '/forms/external-candidate',
  featureGate(['board-exam-forms', 'board-candidates']),
  authorize('admin', 'registrar'),
  createExternalCandidate
);

router.route('/forms/:id')
  .get(featureGate('board-registration'), authorize('admin', 'registrar', 'principal', 'teacher', 'student'), getBoardFormById)
  .put(featureGate('board-registration'), authorize('admin', 'registrar'), updateBoardForm)
  .delete(featureGate('board-registration'), authorize('admin'), deleteBoardForm);

router.patch(
  '/forms/:id/status',
  featureGate('board-attendance-check'),
  authorize('admin', 'registrar', 'principal'),
  updateBoardFormStatus
);

router.get(
  '/forms/:id/slip',
  featureGate('board-slips'),
  authorize('admin', 'registrar', 'principal', 'teacher', 'student'),
  getRollNumberSlip
);

// ==============================================================================
// 2. Datesheets
// ==============================================================================
router.route('/datesheets')
  .get(featureGate('board-slips'), authorize('admin', 'registrar', 'principal', 'teacher', 'student'), getDatesheets)
  .post(featureGate('board-slips'), authorize('admin', 'registrar'), createDatesheet);

router.route('/datesheets/:id')
  .put(featureGate('board-slips'), authorize('admin', 'registrar'), updateDatesheet)
  .delete(featureGate('board-slips'), authorize('admin'), deleteDatesheet);

// ==============================================================================
// 3. Results (Manual Entry, CSV Import, Unmatched)
// ==============================================================================
router.route('/results')
  .get(featureGate('board-results'), authorize('admin', 'registrar', 'principal', 'teacher'), getBoardResults);

router.post(
  '/results/manual',
  featureGate('board-results'),
  authorize('admin', 'registrar', 'principal'),
  createManualResult
);

router.post(
  '/results/import',
  featureGate('board-result-import'),
  authorize('admin', 'registrar'),
  importBoardResults
);

router.get(
  '/results/unmatched',
  featureGate('board-results'),
  authorize('admin', 'registrar'),
  getUnmatchedResults
);

router.post(
  '/results/:id/match',
  featureGate('board-results'),
  authorize('admin', 'registrar'),
  matchUnmatchedResult
);

// ==============================================================================
// 4. Analytics & Reports
// ==============================================================================
router.get(
  '/results/analysis',
  featureGate('board-result-analysis'),
  authorize('admin', 'principal', 'registrar', 'teacher'),
  getBoardResultAnalysis
);

router.get(
  '/results/analysis/pdf',
  featureGate('board-result-analysis'),
  authorize('admin', 'principal', 'registrar'),
  getBoardResultAnalysisPdf
);

// ==============================================================================
// 5. Fee Deadline Alerts
// ==============================================================================
router.post(
  '/alerts/fee-deadline',
  featureGate('fee-board-alert'),
  authorize('admin', 'registrar', 'principal'),
  sendBoardFeeAlerts
);

router.meta = {
  feature: [
    'board-registration',
    'board-exam-forms',
    'board-slips',
    'board-results',
    'board-result-analysis',
    'board-attendance-check',
    'fee-board-alert'
  ]
};

module.exports = router;
