const router = require('express').Router();
const { getSubjects, createSubject, updateSubject, deleteSubject } = require('../controllers/subject.controller');
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');

router.use(protect, tenantContext);
router.route('/').get(authorize('admin', 'principal', 'teacher'), getSubjects).post(authorize('admin'), createSubject);
router.route('/:id').put(authorize('admin'), updateSubject).delete(authorize('admin'), deleteSubject);


router.meta = {
  "exempt": "core",
  "reason": "Core academic curriculum: subjects"
};

module.exports = router;