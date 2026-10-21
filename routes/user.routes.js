const router = require('express').Router();
const { getUsers, getUserById, updateUser, createUser, toggleUserStatus, resetUserPassword, deleteUser } = require('../controllers/user.controller');
const { applyUserStatus, undoUserStatus } = require('../controllers/statusTransition.controller');
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');

router.use(protect, tenantContext);

// Only Admin manages college user accounts
router.route('/')
  .get(authorize('admin', 'principal'), getUsers)
  .post(authorize('admin'), createUser);

router.route('/:id')
  .get(authorize('admin', 'principal'), getUserById)
  .put(authorize('admin'), updateUser);

router.put('/:id/toggle', authorize('admin'), toggleUserStatus);
router.put('/:id/reset-password', authorize('admin'), resetUserPassword);
router.delete('/:id', authorize('admin'), deleteUser);

// Reversible Status Transitions with 5-second Undo
router.post('/:id/status', authorize('admin'), applyUserStatus);
router.post('/:id/undo-status', authorize('admin'), undoUserStatus);


router.meta = {
  "exempt": "core",
  "reason": "Core identity and user management"
};

module.exports = router;