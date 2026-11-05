// ─── Legal Hold & Data Retention Routes (Phase 10: N16) ───────────────
const express = require('express');
const router = express.Router();
const legalHoldController = require('../controllers/legalHold.controller');
const { protect, authorize } = require('../middleware/auth');
const { subscriptionGate } = require('../middleware/subscriptionGate');
const { requireStepUpAuth } = require('../middleware/stepUpAuth');

// All routes require authenticated administrative user and Enterprise entitlement
router.use(protect);
router.use(authorize('admin', 'principal', 'college_admin', 'super_admin'));
router.use(subscriptionGate('data-retention-legal-hold'));

router.get('/', legalHoldController.listHolds);
router.post('/', requireStepUpAuth, legalHoldController.placeHold);
router.post('/:id/release', requireStepUpAuth, legalHoldController.releaseHold);

router.get('/retention-policy', legalHoldController.getRetentionPolicies);
router.put('/retention-policy', legalHoldController.setRetentionPolicy);

module.exports = router;

