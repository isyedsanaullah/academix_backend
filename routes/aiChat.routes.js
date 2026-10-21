const router = require('express').Router();
const {
  sendMessage,
  getChatHistory,
  getAnnouncementDrafts,
  getConversation,
  deleteConversation,
  renameConversation,
  updateAnnouncementStatus,
  downloadReport,
  previewReport
} = require('../controllers/aiChat.controller');
const protect = require('../middleware/auth');
const tenantContext = require('../middleware/tenantContext');
const { featureGate } = require('../middleware/loadEntitlements');

// Public/Token-authenticated preview & download endpoints
router.get('/reports/preview/:token', previewReport);
router.get('/reports/download/:token', protect, downloadReport);

router.use(protect, tenantContext, featureGate('ai-chat'));

router.post('/', sendMessage);
router.get('/history', getChatHistory);
router.get('/drafts', getAnnouncementDrafts);
router.route('/:id')
  .get(getConversation)
  .put(renameConversation)
  .delete(deleteConversation);
router.patch('/:id/announcement-status', updateAnnouncementStatus);


router.meta = {
  "feature": "ai-chat"
};

module.exports = router;