const router = require('express').Router();
const disciplineController = require('../controllers/discipline.controller');
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');
const { featureGate } = require('../middleware/loadEntitlements');

router.use(protect, tenantContext, featureGate('discipline-counselling-records'));

// Disciplinary endpoints - strictly 403 to general teachers, students, and parents
router.post('/incidents', authorize('admin', 'principal'), disciplineController.recordIncident);
router.post('/incidents/:id/counseling', authorize('admin', 'principal'), disciplineController.addCounselingLog);
router.get('/students/:studentId', authorize('admin', 'principal'), disciplineController.getStudentDisciplinaryHistory);

router.meta = {
  feature: 'discipline-counselling-records',
};

module.exports = router;

