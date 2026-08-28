const router = require('express').Router();
const { getClasses, createClass, updateClass, deleteClass } = require('../controllers/class.controller');
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');

router.use(protect, tenantContext);
router.route('/').get(authorize('admin', 'principal', 'teacher'), getClasses).post(authorize('admin'), createClass);
router.route('/:id').put(authorize('admin'), updateClass).delete(authorize('admin'), deleteClass);

module.exports = router;
