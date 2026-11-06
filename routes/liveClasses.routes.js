const router = require('express').Router();
const liveClassesController = require('../controllers/liveClasses.controller');
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');
const { featureGate } = require('../middleware/loadEntitlements');

router.use(protect, tenantContext, featureGate('live-class-lecture-library'));

router.post('/schedules', authorize('admin', 'principal', 'teacher'), liveClassesController.scheduleLiveClass);
router.get('/schedules', authorize('admin', 'principal', 'teacher', 'student'), liveClassesController.listLiveClasses);
router.post('/recordings', authorize('admin', 'principal', 'teacher'), liveClassesController.uploadLectureRecording);
router.get('/recordings', authorize('admin', 'principal', 'teacher', 'student'), liveClassesController.listLectureRecordings);

router.meta = {
  feature: 'live-class-lecture-library',
};

module.exports = router;

