const router = require('express').Router();
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');
const { featureGate } = require('../middleware/loadEntitlements');

const {
  getAbsentTeachers,
  getAbsentTeacherPeriods,
  getEligibleSubstitutes,
  assignSubstitution,
  cancelSubstitution,
  getWeeklySubstitutionReport
} = require('../controllers/substitution.controller');

router.use(protect, tenantContext);

router.get('/absent-teachers', featureGate('substitutions'), authorize('admin', 'principal'), getAbsentTeachers);
router.get('/teacher-periods', featureGate('substitutions'), authorize('admin', 'principal'), getAbsentTeacherPeriods);
router.get('/eligible-substitutes', featureGate('substitutions'), authorize('admin', 'principal'), getEligibleSubstitutes);
router.post('/assign', featureGate('substitutions'), authorize('admin', 'principal'), assignSubstitution);
router.delete('/:id', featureGate('substitutions'), authorize('admin', 'principal'), cancelSubstitution);
router.get('/weekly-report', featureGate('substitutions'), authorize('admin', 'principal'), getWeeklySubstitutionReport);

router.meta = { feature: 'substitutions' };
module.exports = router;
