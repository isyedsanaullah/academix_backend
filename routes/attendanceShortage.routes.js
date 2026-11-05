const express = require('express');
const router = express.Router();
const controller = require('../controllers/attendanceShortage.controller');
const { protect } = require('../middleware/auth.middleware');
const { subscriptionGate } = require('../middleware/subscriptionGate');

router.use(protect);
router.use(subscriptionGate('attendance-shortage-warnings'));

router.get('/', controller.getShortages);
router.post('/scan-now', controller.triggerScan);
router.post('/:id/acknowledge', controller.acknowledgeNotice);

module.exports = router;

