const router = require('express').Router();
const {
  getPracticalSessions,
  createPracticalSession,
  updatePracticalSession,
  deletePracticalSession,
  getPracticalMarks,
  savePracticalMarks,
  getLabJournals,
  saveLabJournal,
  getExaminers,
  createExaminer,
  deleteExaminer,
  getStockItems,
  createStockItem,
  updateStockItem,
  recordStockMovement,
  getStockMovements
} = require('../controllers/practical.controller');

const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');
const { featureGate } = require('../middleware/loadEntitlements');

// Base gate: requires 'practicals' (which requires science groups; returns 403 GROUP_NOT_OFFERED for I.Com/FA-only colleges)
router.use(protect, tenantContext, featureGate('practicals'));

// ── 1. Practical Sessions (Timetable) ─────────────────────────────────────────
router.route('/sessions')
  .get(authorize('admin', 'registrar', 'principal', 'teacher', 'student'), getPracticalSessions)
  .post(authorize('admin', 'registrar', 'principal'), createPracticalSession);

router.route('/sessions/:id')
  .put(authorize('admin', 'registrar', 'principal'), updatePracticalSession)
  .delete(authorize('admin', 'registrar', 'principal'), deletePracticalSession);

// ── 2. Practical Marks & Attendance ───────────────────────────────────────────
router.route('/marks')
  .get(authorize('admin', 'registrar', 'principal', 'teacher'), getPracticalMarks)
  .post(authorize('admin', 'registrar', 'teacher'), savePracticalMarks);

// ── 3. Lab Journals ───────────────────────────────────────────────────────────
router.route('/journals')
  .get(featureGate('lab-journals'), authorize('admin', 'registrar', 'principal', 'teacher'), getLabJournals)
  .put(featureGate('lab-journals'), authorize('admin', 'registrar', 'teacher'), saveLabJournal);

// ── 4. Board Practical Examiners ──────────────────────────────────────────────
router.route('/examiners')
  .get(featureGate('board-practicals'), authorize('admin', 'registrar', 'principal'), getExaminers)
  .post(featureGate('board-practicals'), authorize('admin', 'registrar'), createExaminer);

router.route('/examiners/:id')
  .delete(featureGate('board-practicals'), authorize('admin', 'registrar'), deleteExaminer);

// ── 5. Lab Stock & Movements ──────────────────────────────────────────────────
router.route('/stock')
  .get(featureGate('lab-stock'), authorize('admin', 'registrar', 'principal', 'teacher'), getStockItems)
  .post(featureGate('lab-stock'), authorize('admin', 'registrar'), createStockItem);

router.route('/stock/:id')
  .put(featureGate('lab-stock'), authorize('admin', 'registrar'), updateStockItem);

router.route('/stock/:id/movement')
  .post(featureGate('lab-stock'), authorize('admin', 'registrar', 'teacher'), recordStockMovement);

router.route('/stock/:id/movements')
  .get(featureGate('lab-stock'), authorize('admin', 'registrar', 'principal'), getStockMovements);

router.meta = {
  feature: 'practicals'
};

module.exports = router;
