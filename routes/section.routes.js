const router = require('express').Router();
const { getSections, createSection, updateSection, deleteSection } = require('../controllers/section.controller');
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');

router.use(protect, tenantContext);
router.route('/').get(authorize('admin', 'principal', 'teacher'), getSections).post(authorize('admin'), createSection);
router.route('/:id').put(authorize('admin'), updateSection).delete(authorize('admin'), deleteSection);

module.exports = router;
