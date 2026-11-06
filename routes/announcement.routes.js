const router = require('express').Router();
const {
  getAnnouncements,
  getAnnouncementById,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
  markCircularRead
} = require('../controllers/announcement.controller');
const noticeTemplateController = require('../controllers/noticeTemplate.controller');
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');
const { featureGate } = require('../middleware/loadEntitlements');

router.use(protect, tenantContext, featureGate('announcements'));

// --- N21: Notice Templates & Scheduling ---
router.post('/templates', featureGate('notice-templates-scheduling'), authorize('admin', 'principal', 'registrar'), noticeTemplateController.createTemplate);
router.get('/templates', featureGate('notice-templates-scheduling'), authorize('admin', 'principal', 'registrar', 'teacher'), noticeTemplateController.listTemplates);
router.post('/templates/:id/dispatch', featureGate('notice-templates-scheduling'), authorize('admin', 'principal', 'registrar'), noticeTemplateController.dispatchFromTemplate);

router.route('/')
  .get(authorize('admin', 'principal', 'registrar', 'teacher', 'student', 'employee'), getAnnouncements)
  .post(authorize('admin', 'principal', 'registrar'), createAnnouncement);

router.route('/:id')
  .get(authorize('admin', 'principal', 'registrar', 'teacher', 'student', 'employee'), getAnnouncementById)
  .put(authorize('admin', 'principal', 'registrar'), updateAnnouncement)
  .delete(authorize('admin', 'principal'), deleteAnnouncement);

router.post('/:id/read', authorize('admin', 'principal', 'registrar', 'teacher', 'student', 'employee'), markCircularRead);


router.meta = {
  "feature": "announcements"
};

module.exports = router;