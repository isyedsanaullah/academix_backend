const router = require('express').Router();
const { sendMessage, getChatHistory, getAnnouncementDrafts, getConversation, deleteConversation, renameConversation, updateAnnouncementStatus } = require('../controllers/aiChat.controller');
const protect = require('../middleware/auth');
const tenantContext = require('../middleware/tenantContext');
const planGate = require('../middleware/planGate');

router.use(protect, tenantContext, planGate('ai-chat'));

router.post('/', sendMessage);
router.get('/history', getChatHistory);
router.get('/drafts', getAnnouncementDrafts);
router.route('/:id')
  .get(getConversation)
  .put(renameConversation)
  .delete(deleteConversation);
router.patch('/:id/announcement-status', updateAnnouncementStatus);

module.exports = router;

