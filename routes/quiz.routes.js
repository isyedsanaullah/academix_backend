const router = require('express').Router();
const {
  getQuizzes,
  getQuiz,
  createQuiz,
  updateQuiz,
  publishQuiz,
  deleteQuiz,
  generateAIQuizJob,
  getJobStatus,
  getQuestionBank,
  updateQuestionBankItem,
  startAttempt,
  saveAnswer,
  logViolation,
  submitAttempt,
  getQuizAnalytics,
  releaseResults
} = require('../controllers/quiz.controller');

const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');

router.use(protect, tenantContext);

// Base Quizzes Route
router.route('/')
  .get(authorize('admin', 'principal', 'teacher', 'student'), getQuizzes)
  .post(authorize('teacher', 'admin'), createQuiz);

// AI Background Generation Job Routes
router.post('/ai-generate-job', authorize('teacher', 'admin'), generateAIQuizJob);
router.get('/jobs/:jobId', authorize('teacher', 'admin'), getJobStatus);

// Question Bank Routes
router.get('/question-bank', authorize('teacher', 'admin'), getQuestionBank);
router.put('/question-bank/:id', authorize('teacher', 'admin'), updateQuestionBankItem);

// Single Quiz Operations
router.route('/:id')
  .get(authorize('admin', 'principal', 'teacher', 'student'), getQuiz)
  .put(authorize('teacher', 'admin'), updateQuiz)
  .delete(authorize('teacher', 'admin'), deleteQuiz);

router.post('/:id/publish', authorize('teacher', 'admin'), publishQuiz);

// Student Quiz Attempt Execution & Resumption
router.post('/:id/start-attempt', authorize('student'), startAttempt);
router.post('/attempt/:attemptId/save-answer', authorize('student'), saveAnswer);
router.post('/attempt/:attemptId/violation', authorize('student'), logViolation);
router.post('/attempt/:attemptId/submit', authorize('student'), submitAttempt);

// Analytics & Results
router.get('/:id/analytics', authorize('teacher', 'admin', 'principal'), getQuizAnalytics);
router.post('/:id/release-results', authorize('teacher', 'admin'), releaseResults);

module.exports = router;
