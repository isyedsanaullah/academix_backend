const router = require('express').Router();
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');
const { featureGate } = require('../middleware/loadEntitlements');

const {
  generateDraft,
  getDraft,
  listDrafts,
  applyDraft,
  deleteDraft,
  explainDraft,
  getConstraints,
  createConstraint,
  deleteConstraint,
  getBenchmark
} = require('../controllers/timetableGenerator.controller');

router.use(protect, tenantContext);

// Generation & Drafts (gated 'timetable-generator', roles admin & principal)
router.post('/generate', featureGate('timetable-generator'), authorize('admin', 'principal'), generateDraft);
router.get('/drafts', featureGate('timetable-generator'), authorize('admin', 'principal'), listDrafts);
router.get('/drafts/:id', featureGate('timetable-generator'), authorize('admin', 'principal'), getDraft);
router.post('/drafts/:id/apply', featureGate('timetable-generator'), authorize('admin', 'principal'), applyDraft);
router.delete('/drafts/:id', featureGate('timetable-generator'), authorize('admin', 'principal'), deleteDraft);

// AI Assist (gated 'ai-timetable-assist', roles admin & principal)
router.post('/drafts/:id/explain', featureGate('ai-timetable-assist'), authorize('admin', 'principal'), explainDraft);

// Constraints Screen CRUD (gated 'timetable-generator', roles admin & principal)
router.get('/constraints', featureGate('timetable-generator'), authorize('admin', 'principal'), getConstraints);
router.post('/constraints', featureGate('timetable-generator'), authorize('admin', 'principal'), createConstraint);
router.delete('/constraints/:id', featureGate('timetable-generator'), authorize('admin', 'principal'), deleteConstraint);

// Benchmark endpoint
router.get('/benchmark', featureGate('timetable-generator'), authorize('admin', 'principal'), getBenchmark);

router.meta = {
  feature: 'timetable-generator'
};

module.exports = router;
