const express = require('express');
const router = express.Router();
const controller = require('../controllers/biometricIngress.controller');
const { protect } = require('../middleware/auth.middleware');

// Path B punch ingress (authenticated via device bearer secret in header)
router.post('/devices/:deviceId/punches', controller.ingestPunches);

// Admin-facing device management and mapping endpoints
router.use(protect);
router.post('/devices', controller.registerDevice);
router.get('/devices', controller.getDevices);
router.post('/identity-maps', controller.createIdentityMap);
router.get('/unmapped', controller.getUnmappedPunches);

module.exports = router;

