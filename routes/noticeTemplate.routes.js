const router = require('express').Router();
const noticeTemplateController = require('../controllers/noticeTemplate.controller');
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');
const { featureGate } = require('../middleware/loadEntitlements');

router.use(protect, tenantContext, featureGate('notice-templates-scheduling'));

router.post('/', authorize('admin', 'principal', 'registrar'), noticeTemplateController.createTemplate);
router.get('/', authorize('admin', 'principal', 'registrar', 'teacher'), noticeTemplateController.listTemplates);
router.post('/:id/dispatch', authorize('admin', 'principal', 'registrar'), noticeTemplateController.dispatchFromTemplate);

router.meta = {
  feature: 'notice-templates-scheduling',
};

module.exports = router;

