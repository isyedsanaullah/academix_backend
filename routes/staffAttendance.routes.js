const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth.middleware');
const { subscriptionGate } = require('../middleware/subscriptionGate');
const controller = require('../controllers/staffAttendance.controller');

// All staff attendance routes require standard+ tier entitlement for 'staff-attendance-register'
router.use(protect);
router.use(subscriptionGate('staff-attendance-register'));

router.get('/summary', controller.getSummary);
router.get('/', controller.getAttendance);
router.post('/', controller.markAttendance);
router.put('/:id', controller.updateAttendance);

module.exports = router;

