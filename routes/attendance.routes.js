const router = require('express').Router();
const { markAttendance, markBulkAttendance, getAttendance, getAttendanceStats, getMyAttendance, qrGateScan, getTeacherAttendanceView } = require('../controllers/attendance.controller');
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');
const planGate = require('../middleware/planGate');

// QR Gate Scan — public endpoint for gate scanner device (uses college_id in body)
router.post('/qr-scan', protect, tenantContext, qrGateScan);

router.use(protect, tenantContext, planGate('attendance'));

// Teacher: read-only attendance view
router.get('/teacher-view', authorize('teacher'), getTeacherAttendanceView);

// Teachers mark attendance | Admin/Registrar/Principal view
router.get('/', authorize('admin', 'registrar', 'principal', 'teacher', 'accountant'), getAttendance);
router.get('/stats', authorize('admin', 'registrar', 'principal', 'teacher'), getAttendanceStats);
router.get('/my', authorize('student'), getMyAttendance);
router.post('/', authorize('admin', 'teacher'), markAttendance);
router.post('/bulk', authorize('admin', 'teacher'), markBulkAttendance);

module.exports = router;
