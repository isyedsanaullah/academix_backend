const router = require('express').Router();
const {
  getUniversalTimetables,
  getUniversalTimetable,
  createUniversalTimetable,
  updateUniversalTimetable,
  deleteUniversalTimetable
} = require('../controllers/universalTimetable.controller');
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');

router.use(protect, tenantContext);

router.route('/')
  .get(authorize('admin', 'registrar', 'principal', 'teacher'), getUniversalTimetables)
  .post(authorize('admin', 'registrar'), createUniversalTimetable);

router.route('/:id')
  .get(authorize('admin', 'registrar', 'principal', 'teacher'), getUniversalTimetable)
  .put(authorize('admin', 'registrar'), updateUniversalTimetable)
  .delete(authorize('admin', 'registrar'), deleteUniversalTimetable);

module.exports = router;
