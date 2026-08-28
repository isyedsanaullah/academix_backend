const router = require('express').Router();
const { getMyNotifications, markAsRead, markAllRead, createNotification, deleteNotification } = require('../controllers/notification.controller');
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');

router.use(protect, tenantContext);
router.get('/', getMyNotifications);
router.put('/read-all', markAllRead);
router.post('/', authorize('admin', 'principal'), createNotification);
router.route('/:id').put(markAsRead).delete(deleteNotification);

module.exports = router;
