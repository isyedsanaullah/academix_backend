const router = require('express').Router();
const forumController = require('../controllers/forum.controller');
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');
const { featureGate } = require('../middleware/loadEntitlements');

router.use(protect, tenantContext, featureGate('class-discussion-forum'));

router.post('/questions', authorize('student', 'teacher', 'admin', 'principal'), forumController.createQuestion);
router.get('/questions', authorize('student', 'teacher', 'admin', 'principal'), forumController.listQuestions);
router.post('/questions/:id/answers', authorize('student', 'teacher', 'admin', 'principal'), forumController.postAnswer);
router.put('/questions/:id/answers/:answerId/accept', authorize('teacher', 'admin', 'principal'), forumController.acceptAnswer);

router.meta = {
  feature: 'class-discussion-forum',
};

module.exports = router;

