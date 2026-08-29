const router = require('express').Router();
const { getTimetables, getMyTimetable, getTeacherTimetable, createTimetable, bulkCreateTimetable, updateTimetable, deleteTimetable } = require('../controllers/timetable.controller');
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');
const planGate = require('../middleware/planGate');

router.use(protect, tenantContext, planGate('timetable'));

// Student self-service (before /:id)
router.get('/my', authorize('student'), getMyTimetable);

// Teacher self-service
router.get('/my-teacher', authorize('teacher'), getTeacherTimetable);

// Bulk create — admin & registrar
router.post('/bulk', authorize('admin', 'registrar'), bulkCreateTimetable);

router.route('/').get(authorize('admin', 'registrar', 'principal', 'teacher', 'student'), getTimetables).post(authorize('admin', 'registrar'), createTimetable);
router.route('/:id').put(authorize('admin', 'registrar'), updateTimetable).delete(authorize('admin', 'registrar'), deleteTimetable);

module.exports = router;
