const router = require('express').Router();
const { getExams, getExam, createExam, updateExam, deleteExam } = require('../controllers/exam.controller');
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');
const planGate = require('../middleware/planGate');

router.use(protect, tenantContext, planGate('exams-results'));

router.route('/')
  .get(authorize('admin', 'registrar', 'principal', 'teacher', 'student', 'accountant'), getExams)
  .post(authorize('admin', 'registrar'), createExam);

router.route('/:id')
  .get(authorize('admin', 'registrar', 'principal', 'teacher', 'student'), getExam)
  .put(authorize('admin', 'registrar'), updateExam)
  .delete(authorize('admin'), deleteExam);

module.exports = router;
