const router = require('express').Router();
const {
  getSeasons, createSeason, updateSeason,
  getApplications, getApplication,
  approveApplication, rejectApplication,
  scheduleEntryTest, updateTestResult
} = require('../controllers/registrar.controller');
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');

router.use(protect, tenantContext, authorize('registrar', 'admin'));

// Admission Seasons
router.route('/seasons')
  .get(getSeasons)
  .post(createSeason);
router.put('/seasons/:id', updateSeason);

// Applications
router.get('/applications', getApplications);
router.get('/applications/:id', getApplication);
router.put('/applications/:id/approve', approveApplication);
router.put('/applications/:id/reject', rejectApplication);
router.put('/applications/:id/entry-test', scheduleEntryTest);
router.put('/applications/:id/test-result', updateTestResult);

module.exports = router;
