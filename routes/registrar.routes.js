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

const {
  createDeskApplication,
  verifyDocument,
  getMeritList
} = require('../controllers/admissions.controller');

// Applications
router.get('/applications', getApplications);
router.post('/applications/desk', createDeskApplication);
router.get('/applications/:id', getApplication);
router.put('/applications/:id/approve', approveApplication);
router.put('/applications/:id/reject', rejectApplication);
router.put('/applications/:id/entry-test', scheduleEntryTest);
router.put('/applications/:id/test-result', updateTestResult);
router.put('/applications/:id/documents/:doc', verifyDocument);

// Merit List (Quotas, Equivalence, Scholarship Tiers)
router.get('/merit-list', getMeritList);


router.meta = {
  "exempt": "core",
  "reason": "Registrar student records management"
};

module.exports = router;