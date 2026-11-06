const router = require('express').Router();
const syllabusController = require('../controllers/syllabus.controller');
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');
const { featureGate } = require('../middleware/loadEntitlements');

router.use(protect, tenantContext, featureGate('syllabus-coverage-tracker'));

router.post('/breakdowns', authorize('admin', 'principal', 'teacher'), syllabusController.createBreakdown);
router.put('/units/:unitId/progress', authorize('admin', 'principal', 'teacher'), syllabusController.updateProgress);
router.get('/coverage-summary', authorize('admin', 'principal', 'teacher'), syllabusController.getCoverageSummary);

router.meta = {
  feature: 'syllabus-coverage-tracker',
};

module.exports = router;

