const router = require('express').Router();
const { getTeachers, getTeacher, createTeacher, updateTeacher, assignClasses } = require('../controllers/teacher.controller');
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');

router.use(protect, tenantContext);
router.route('/').get(authorize('admin', 'principal'), getTeachers).post(authorize('admin'), createTeacher);
router.route('/:id').get(authorize('admin', 'principal'), getTeacher).put(authorize('admin'), updateTeacher);
router.put('/:id/assign', authorize('admin'), assignClasses);

module.exports = router;
