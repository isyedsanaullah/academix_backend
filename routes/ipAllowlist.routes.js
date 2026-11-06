// ─── IP Allow-list Routes (Phase 10: N15) ──────────────────────────────
const express = require('express');
const router = express.Router();
const ipAllowlistController = require('../controllers/ipAllowlist.controller');
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const { subscriptionGate } = require('../middleware/subscriptionGate');

// All endpoints require authenticated admin/principal and Enterprise entitlement
router.use(protect);
router.use(authorize('admin', 'principal', 'college_admin', 'super_admin'));
router.use(subscriptionGate('ip-allowlist-session-controls'));

router.get('/rules', ipAllowlistController.getRules);
router.post('/rules', ipAllowlistController.createRule);
router.delete('/rules/:id', ipAllowlistController.deleteRule);
router.patch('/mode', ipAllowlistController.updateMode);
router.get('/violations', ipAllowlistController.getViolations);

module.exports = router;

