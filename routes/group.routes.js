const router = require('express').Router();
const { getGroups, createGroup, updateGroup, deleteGroup } = require('../controllers/group.controller');
const { getGroupSubjects, addGroupSubject, updateGroupSubject, deleteGroupSubject } = require('../controllers/groupSubject.controller');
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');

router.use(protect, tenantContext);
router.route('/').get(authorize('admin', 'principal', 'teacher', 'registrar'), getGroups).post(authorize('admin', 'registrar'), createGroup);
router.route('/:id').put(authorize('admin', 'registrar'), updateGroup).delete(authorize('admin'), deleteGroup);

// Subject combinations per group
router.route('/:groupId/subjects')
  .get(authorize('admin', 'principal', 'teacher', 'registrar'), getGroupSubjects)
  .post(authorize('admin', 'registrar', 'principal'), addGroupSubject);

router.route('/:groupId/subjects/:id')
  .put(authorize('admin', 'registrar', 'principal'), updateGroupSubject)
  .delete(authorize('admin', 'registrar'), deleteGroupSubject);


router.meta = {
  "exempt": "core",
  "reason": "Core academic grouping"
};

module.exports = router;