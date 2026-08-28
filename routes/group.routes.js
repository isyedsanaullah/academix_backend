const router = require('express').Router();
const { getGroups, createGroup, updateGroup, deleteGroup } = require('../controllers/group.controller');
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');

router.use(protect, tenantContext);
router.route('/').get(authorize('admin', 'principal', 'teacher'), getGroups).post(authorize('admin'), createGroup);
router.route('/:id').put(authorize('admin'), updateGroup).delete(authorize('admin'), deleteGroup);

module.exports = router;
