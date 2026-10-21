const router = require('express').Router();
const multer = require('multer');
const {
  getStudents,
  getStudent,
  createStudent,
  updateStudent,
  deleteStudent,
  getMyProfile,
  assignSections,
  shuffleStudent,
  uploadStudentPhoto,
  uploadBulkStudentPhotos
} = require('../controllers/student.controller');
const { applyStudentStatus, undoStudentStatus } = require('../controllers/statusTransition.controller');
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');

const { featureGate } = require('../middleware/loadEntitlements');
const { identifyStudent } = require('../controllers/fallback.controller');

const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
});

const bulkZipUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max for zip archives
});

router.use(protect, tenantContext);

// Identify student (QR code or search fallback)
router.post('/identify', authorize('admin', 'registrar', 'principal', 'teacher', 'employee'), featureGate('students'), identifyStudent);

// Student self-service (MUST be before /:id)
router.get('/my-profile', authorize('student'), getMyProfile);

// Bulk student photos zip upload (Phase 11 - MUST be before /:id)
router.post(
  '/photos/bulk',
  authorize('admin', 'registrar'),
  featureGate('student-photo'),
  bulkZipUpload.single('zip'),
  uploadBulkStudentPhotos
);

// Admin: batch section assignment
router.post('/assign-sections', authorize('admin', 'registrar'), assignSections);

// Student Shuffling (Admin, Registrar, and Principal)
router.put('/:id/shuffle', authorize('admin', 'registrar', 'principal'), shuffleStudent);

// Single student photo upload / replace (Phase 11)
router.post(
  '/:id/photo',
  authorize('admin', 'registrar', 'principal'),
  featureGate('student-photo'),
  photoUpload.single('photo'),
  uploadStudentPhoto
);

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

// Subject Assignment & Group Transfer (Phase 5)
const { getStudentSubjects, assignStudentSubjects, moveStudentGroup } = require('../controllers/groupSubject.controller');
router.route('/:id/subjects')
  .get(authorize('admin', 'registrar', 'principal', 'teacher', 'student'), getStudentSubjects)
  .post(authorize('admin', 'registrar'), assignStudentSubjects);

router.post('/:id/move-group', authorize('admin', 'registrar', 'principal'), featureGate('group-transfer'), moveStudentGroup);


router.meta = {
  "exempt": "core",
  "reason": "Core SIS entity: student records management"
};

module.exports = router;