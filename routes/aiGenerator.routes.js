const router = require('express').Router();
const {
  generateQuiz, generatePaper, generateMCQ,
  generateNotes, generateAssignment, generateSyllabus
} = require('../controllers/aiGenerator.controller');
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');
const planGate = require('../middleware/planGate');

// All generator routes require auth + tenant + premium plan
router.use(protect, tenantContext, planGate('ai-generators'));

// Teachers and admins can generate content
router.post('/quiz', authorize('teacher', 'admin', 'principal'), generateQuiz);
router.post('/paper', authorize('teacher', 'admin', 'principal'), generatePaper);
router.post('/mcq', authorize('teacher', 'admin', 'principal'), generateMCQ);
router.post('/notes', authorize('teacher', 'admin', 'principal', 'student'), generateNotes);
router.post('/assignment', authorize('teacher', 'admin'), generateAssignment);
router.post('/syllabus', authorize('teacher', 'admin', 'principal'), generateSyllabus);

module.exports = router;
