// routes/entryTest.routes.js
// Phase 10: Entry-test preparation routes (MCQ bank, Mock tests, Ranking, OMR 501, Aggregate, Registrations)

const express = require('express');
const router = express.Router();
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');
const { featureGate } = require('../middleware/loadEntitlements');

const {
  getMcqQuestions,
  createMcqQuestion,
  updateMcqQuestion,
  deleteMcqQuestion,
  getMockTests,
  createMockTest,
  getMockTestById,
  submitMockAttempt,
  recordOmrScan,
  getMockRankings,
  getAggregateFormulas,
  createAggregateFormula,
  calculateAggregate,
  getRegistrations,
  createRegistration,
  updateRegistration
} = require('../controllers/entryTest.controller');

// Base gate: requires 'mcq-bank' (which requires Pre-Medical or Pre-Engineering groups; returns 403 GROUP_NOT_OFFERED if not offered)
router.use(protect, tenantContext, featureGate('mcq-bank'));

// ── 1. MCQ Question Bank ───────────────────────────────────────────────────────
router.route('/mcq')
  .get(authorize('admin', 'principal', 'teacher', 'student'), getMcqQuestions)
  .post(authorize('admin', 'principal', 'teacher'), createMcqQuestion);

router.route('/mcq/:id')
  .put(authorize('admin', 'principal', 'teacher'), updateMcqQuestion)
  .delete(authorize('admin', 'principal'), deleteMcqQuestion);

// ── 2. Mock Tests & Marking ────────────────────────────────────────────────────
router.route('/mock-tests')
  .get(featureGate('mock-tests'), authorize('admin', 'principal', 'teacher', 'student'), getMockTests)
  .post(featureGate('mock-tests'), authorize('admin', 'principal', 'teacher'), createMockTest);

router.route('/mock-tests/:id')
  .get(featureGate('mock-tests'), authorize('admin', 'principal', 'teacher', 'student'), getMockTestById);

router.route('/mock-tests/:id/attempt')
  .post(featureGate('mock-tests'), authorize('admin', 'principal', 'teacher', 'student'), submitMockAttempt);

router.route('/mock-tests/:id/omr')
  .post(featureGate('mock-tests'), authorize('admin', 'principal', 'teacher'), recordOmrScan);

router.route('/mock-tests/:id/rankings')
  .get(featureGate('mock-tests'), authorize('admin', 'principal', 'teacher', 'student'), getMockRankings);

// ── 3. Aggregate Calculator ───────────────────────────────────────────────────
router.route('/aggregate-formulas')
  .get(featureGate('aggregate-calc'), authorize('admin', 'principal', 'teacher', 'student'), getAggregateFormulas)
  .post(featureGate('aggregate-calc'), authorize('admin', 'principal'), createAggregateFormula);

router.route('/calculate-aggregate')
  .post(featureGate('aggregate-calc'), authorize('admin', 'principal', 'teacher', 'student'), calculateAggregate);

// ── 4. Entry-Test & University Application Tracking ───────────────────────────
router.route('/registrations')
  .get(featureGate('entry-reg-tracking'), authorize('admin', 'principal', 'teacher', 'student'), getRegistrations)
  .post(featureGate('entry-reg-tracking'), authorize('admin', 'principal', 'teacher'), createRegistration);

router.route('/registrations/:id')
  .put(featureGate('entry-reg-tracking'), authorize('admin', 'principal', 'teacher'), updateRegistration);

router.meta = {
  feature: ['mcq-bank', 'mock-tests', 'aggregate-calc', 'entry-reg-tracking']
};

module.exports = router;
