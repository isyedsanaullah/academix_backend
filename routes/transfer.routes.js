// ─── Student Campus Transfer Routes (Phase 10: N19) ───────────────────
const express = require('express');
const router = express.Router();
const transferController = require('../controllers/transfer.controller');
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const { subscriptionGate } = require('../middleware/subscriptionGate');

router.use(protect);
router.use(authorize('admin', 'principal', 'college_admin', 'super_admin'));
router.use(subscriptionGate('cross-campus-transfers'));

router.get('/', transferController.listTransfers);
router.post('/', transferController.transferStudent);

module.exports = router;

