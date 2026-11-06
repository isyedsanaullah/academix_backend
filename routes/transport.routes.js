'use strict';

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { featureGate } = require('../middleware/loadEntitlements');
const transportController = require('../controllers/transport.controller');

router.use(protect);
router.use(featureGate('transport-management'));

router.post('/routes', transportController.createRoute);
router.post('/stops', transportController.addStop);
router.post('/vehicles', transportController.addVehicle);
router.post('/allocations', transportController.allocateStudent);
router.delete('/allocations/:id', transportController.deallocateStudent);
router.post('/generate-fees', transportController.generateFees);

module.exports = router;

