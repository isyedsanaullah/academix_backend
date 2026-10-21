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

const { featureGate } = require('../middleware/loadEntitlements');

router.use(protect, tenantContext, featureGate('universal-timetable'));

router.route('/')
  .get(authorize('admin', 'registrar', 'principal', 'teacher'), getUniversalTimetables)
  .post(authorize('admin', 'registrar'), createUniversalTimetable);

router.route('/:id')
  .get(authorize('admin', 'registrar', 'principal', 'teacher'), getUniversalTimetable)
  .put(authorize('admin', 'registrar'), updateUniversalTimetable)
  .delete(authorize('admin', 'registrar'), deleteUniversalTimetable);

router.meta = { feature: 'universal-timetable' };
module.exports = router;
