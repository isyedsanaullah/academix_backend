const router = require('express').Router();
const { getResults, createResult, updateResult, bulkCreateResults, getResultById, getMyResults } = require('../controllers/result.controller');
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');
const planGate = require('../middleware/planGate');

router.use(protect, tenantContext, planGate('exams-results'));

router.route('/')
  .get(authorize('admin', 'registrar', 'principal', 'teacher', 'accountant'), getResults)
  .post(authorize('teacher'), createResult);

router.post('/bulk', authorize('teacher'), bulkCreateResults);
router.get('/my', authorize('student'), getMyResults);

router.route('/:id')
  .get(authorize('admin', 'registrar', 'principal', 'teacher', 'student'), getResultById)
  .put(authorize('teacher'), updateResult);

module.exports = router;
