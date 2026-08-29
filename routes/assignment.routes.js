const router = require('express').Router();
const { getAssignments, getAssignment, createAssignment, updateAssignment, submitAssignment, gradeSubmission, deleteAssignment, aiGradeSubmission, aiBatchGrade } = require('../controllers/assignment.controller');
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');
const planGate = require('../middleware/planGate');

router.use(protect, tenantContext, planGate('assignments-quizzes'));
router.route('/').get(authorize('admin', 'principal', 'teacher', 'student'), getAssignments).post(authorize('teacher', 'admin'), createAssignment);
router.route('/:id').get(authorize('admin', 'principal', 'teacher', 'student'), getAssignment).put(authorize('teacher', 'admin'), updateAssignment).delete(authorize('teacher', 'admin'), deleteAssignment);
router.post('/:id/submit', authorize('student'), submitAssignment);
router.post('/:id/grade', authorize('teacher', 'admin'), gradeSubmission);

// AI grading
router.post('/:id/ai-grade', authorize('teacher', 'admin'), aiGradeSubmission);
router.post('/:id/ai-batch-grade', authorize('teacher', 'admin'), aiBatchGrade);

module.exports = router;
