const router = require('express').Router();
const { getExams, getExam, createExam, updateExam, deleteExam } = require('../controllers/exam.controller');
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');
const { featureGate } = require('../middleware/loadEntitlements');

router.use(protect, tenantContext, featureGate('exams-results'));

const { getWeakStudents, getResultComparison } = require('../controllers/examAnalytics.controller');
const examOps = require('../controllers/examOperations.controller');

// --- 11A.1: N25 Exam Seating Plan & Invigilation Roster (Standard) ---
router.post('/halls', featureGate('exam-seating-invigilation'), authorize('admin', 'principal', 'registrar'), examOps.createHall);
router.get('/halls', featureGate('exam-seating-invigilation'), authorize('admin', 'principal', 'registrar', 'teacher'), examOps.getHalls);
router.post('/seating-plan/generate', featureGate('exam-seating-invigilation'), authorize('admin', 'principal', 'registrar'), examOps.generateSeatingPlan);
router.post('/invigilation-roster/assign', featureGate('exam-seating-invigilation'), authorize('admin', 'principal', 'registrar'), examOps.assignInvigilator);
router.get('/invigilation-roster', featureGate('exam-seating-invigilation'), authorize('admin', 'principal', 'registrar', 'teacher'), examOps.getInvigilationRoster);

// --- 11A.2: N26 Paper-Setting & Moderation Workflow (Premium) ---
router.post('/papers/drafts', featureGate('paper-setting-moderation'), authorize('admin', 'principal', 'teacher'), examOps.createPaperDraft);
router.post('/papers/drafts/:id/revisions', featureGate('paper-setting-moderation'), authorize('admin', 'principal', 'teacher'), examOps.submitPaperRevision);
router.post('/papers/drafts/:id/moderate', featureGate('paper-setting-moderation'), authorize('admin', 'principal', 'teacher'), examOps.moderatePaperDraft);
router.post('/papers/drafts/:id/seal', featureGate('paper-setting-moderation'), authorize('admin', 'principal'), examOps.sealPaperDraft);
router.get('/papers/drafts/:id/download-url', featureGate('paper-setting-moderation'), authorize('admin', 'principal', 'teacher'), examOps.getPaperDownloadUrl);

// --- 11A.3: N27 Result Moderation & Re-Check Requests (Premium) ---
router.post('/recheck/apply', featureGate('result-moderation-recheck'), authorize('admin', 'principal', 'teacher', 'student'), examOps.submitRecheckTicket);
router.post('/recheck/requests/:id/process', featureGate('result-moderation-recheck'), authorize('admin', 'principal', 'teacher'), examOps.processRecheckTicket);
router.get('/recheck/requests', featureGate('result-moderation-recheck'), authorize('admin', 'principal', 'teacher', 'student'), examOps.listRecheckTickets);

router.route('/')
  .get(authorize('admin', 'registrar', 'principal', 'teacher', 'student', 'accountant'), getExams)
  .post(authorize('admin', 'registrar'), createExam);

router.get('/weak-students', featureGate('weak-student-lists'), authorize('admin', 'registrar', 'principal', 'teacher'), getWeakStudents);
router.get('/result-comparison', featureGate('result-comparison'), authorize('admin', 'registrar', 'principal', 'teacher'), getResultComparison);

router.route('/:id')
  .get(authorize('admin', 'registrar', 'principal', 'teacher', 'student'), getExam)
  .put(authorize('admin', 'registrar'), updateExam)
  .delete(authorize('admin'), deleteExam);


router.meta = {
  "feature": "exams-results"
};

module.exports = router;