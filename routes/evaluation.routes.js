const router = require('express').Router();
const { createSeason, getSeasons, getMyEvaluations, submitEvaluation, getTeacherRatings, generateQuestions } = require('../controllers/evaluation.controller');
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');

router.use(protect, tenantContext);

// Principal
router.post('/seasons', authorize('principal', 'admin'), createSeason);
router.get('/seasons', getSeasons);

// Student
router.get('/my', authorize('student'), getMyEvaluations);
router.post('/submit', authorize('student'), submitEvaluation);
router.get('/questions', authorize('student'), generateQuestions);

// All roles
router.get('/ratings', getTeacherRatings);

module.exports = router;
