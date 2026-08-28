const router = require('express').Router();
const { getStudents, getStudent, createStudent, updateStudent, deleteStudent, getMyProfile, assignSections, shuffleStudent } = require('../controllers/student.controller');
const { applyStudentStatus, undoStudentStatus } = require('../controllers/statusTransition.controller');
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');

router.use(protect, tenantContext);

// Student self-service (MUST be before /:id)
router.get('/my-profile', authorize('student'), getMyProfile);

// Admin: batch section assignment
router.post('/assign-sections', authorize('admin', 'registrar'), assignSections);

// Student Shuffling (Admin, Registrar, and Principal)
router.put('/:id/shuffle', authorize('admin', 'registrar', 'principal'), shuffleStudent);

// Admin & Registrar: full CRUD | Principal, Teacher: read-only
router.route('/')
  .get(authorize('admin', 'registrar', 'principal', 'teacher', 'accountant'), getStudents)
  .post(authorize('admin', 'registrar'), createStudent);

router.route('/:id')
  .get(authorize('admin', 'registrar', 'principal', 'teacher', 'student', 'accountant'), getStudent)
  .put(authorize('admin', 'registrar'), updateStudent)
  .delete(authorize('admin'), deleteStudent);

// Reversible Status Transitions (Admin / Registrar)
router.post('/:id/status', authorize('admin', 'registrar'), applyStudentStatus);
router.post('/:id/undo-status', authorize('admin', 'registrar'), undoStudentStatus);

module.exports = router;
