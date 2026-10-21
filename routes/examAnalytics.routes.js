const router = require('express').Router();
const {
  getWeakStudents,
  getResultComparison
} = require('../controllers/examAnalytics.controller');

const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');
const { featureGate } = require('../middleware/loadEntitlements');

router.use(protect, tenantContext);

router.get(
  '/weak-students',
  featureGate('weak-student-lists'),
  authorize('admin', 'registrar', 'principal', 'teacher'),
  getWeakStudents
);

router.get(
  '/result-comparison',
  featureGate('result-comparison'),
  authorize('admin', 'registrar', 'principal', 'teacher'),
  getResultComparison
);

router.meta = {
  feature: ['weak-student-lists', 'result-comparison']
};

module.exports = router;
