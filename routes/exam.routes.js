const router = require('express').Router();
const { getExams, getExam, createExam, updateExam, deleteExam } = require('../controllers/exam.controller');
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');
const { featureGate } = require('../middleware/loadEntitlements');

router.use(protect, tenantContext, featureGate('exams-results'));

const { getWeakStudents, getResultComparison } = require('../controllers/examAnalytics.controller');

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