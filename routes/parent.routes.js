const express = require('express');
const router = express.Router();
const controller = require('../controllers/parentPortal.controller');
const { guardianProtect } = require('../middleware/guardianAuth.middleware');

// Public auth login
router.post('/auth/login', controller.login);

// Guardian protected routes
router.use(guardianProtect);

router.post('/auth/logout', controller.logout);
router.get('/student', controller.getStudentProfile);
router.get('/attendance', controller.getAttendance);
router.get('/fees', controller.getFees);
router.get('/results', controller.getResults);
router.get('/diary', controller.getDiary);
router.get('/calendar', controller.getCalendar);
router.get('/circulars', controller.getCirculars);
router.get('/notifications', controller.getNotifications);
router.post('/notifications/:id/read', controller.markNotificationRead);

// N22: Parent Web Push Alerts
router.post('/push/subscribe', controller.subscribePush);
router.post('/push/send-test', controller.sendPushTest);

module.exports = router;

