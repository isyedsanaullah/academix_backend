'use strict';

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { featureGate } = require('../middleware/loadEntitlements');
const hostelController = require('../controllers/hostel.controller');

router.use(protect);
router.use(featureGate('hostel-management'));

router.post('/buildings', hostelController.createBuilding);
router.post('/rooms', hostelController.addRoom);
router.post('/allotments', hostelController.allotBed);
router.delete('/allotments/:id', hostelController.vacateBed);
router.post('/night-attendance', hostelController.markNightAttendance);
router.post('/generate-fees', hostelController.generateFees);

module.exports = router;

