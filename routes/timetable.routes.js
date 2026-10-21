const router = require('express').Router();
const {
  getTimetables,
  getMyTimetable,
  getTeacherTimetable,
  getTeacherToday,
  checkClashes,
  createTimetable,
  bulkCreateTimetable,
  updateTimetable,
  deleteTimetable,
  getTeacherSubjects,
  assignTeacherSubject,
  deleteTeacherSubject,
  getEligibleTeachersForSubject,
  getEligibleSubjectsForTeacher
} = require('../controllers/timetable.controller');
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');
const { featureGate } = require('../middleware/loadEntitlements');

router.use(protect, tenantContext, featureGate('timetable'));

// Student self-service with substitution overlay
router.get('/my', featureGate('student-timetable'), authorize('student'), getMyTimetable);

// Teacher self-service
router.get('/my-teacher', authorize('teacher'), getTeacherTimetable);
router.get('/teacher-today', featureGate('teacher-today'), authorize('teacher'), getTeacherToday);

// Conflict / Clash checking
router.post('/check-clashes', authorize('admin', 'principal', 'registrar'), checkClashes);

// Multi-subject Teacher endpoints
router.get('/teacher-subjects', featureGate('teacher-subjects'), authorize('admin', 'principal', 'registrar'), getTeacherSubjects);
router.post('/teacher-subjects', featureGate('teacher-subjects'), authorize('admin', 'principal'), assignTeacherSubject);
router.delete('/teacher-subjects/:id', featureGate('teacher-subjects'), authorize('admin', 'principal'), deleteTeacherSubject);
router.get('/subjects/:subjectId/teachers', featureGate('teacher-subjects'), authorize('admin', 'principal', 'registrar'), getEligibleTeachersForSubject);
router.get('/teachers/:teacherId/subjects', featureGate('teacher-subjects'), authorize('admin', 'principal', 'registrar'), getEligibleSubjectsForTeacher);

// Bulk create — admin & registrar
router.post('/bulk', authorize('admin', 'registrar'), bulkCreateTimetable);

// CRUD
router.route('/')
  .get(authorize('admin', 'registrar', 'principal', 'teacher', 'student'), getTimetables)
  .post(authorize('admin', 'registrar'), createTimetable);

router.route('/:id')
  .put(authorize('admin', 'registrar'), updateTimetable)
  .delete(authorize('admin', 'registrar'), deleteTimetable);

router.meta = {
  feature: 'timetable'
};

module.exports = router;