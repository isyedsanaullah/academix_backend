// ─── Campus Routes (Phase 10: §10.1 & N18) ─────────────────────────────
const express = require('express');
const router = express.Router();
const campusController = require('../controllers/campus.controller');
const { protect, authorize } = require('../middleware/auth');
const { subscriptionGate } = require('../middleware/subscriptionGate');

router.use(protect);
router.use(authorize('admin', 'principal', 'college_admin', 'super_admin'));
router.use(subscriptionGate('multi-campus-dashboard'));

router.get('/dashboard', campusController.getDashboard);
router.get('/', campusController.getCampuses);
router.post('/', campusController.createCampus);
router.put('/:id', campusController.updateCampus);
router.delete('/:id', campusController.deleteCampus);

module.exports = router;
