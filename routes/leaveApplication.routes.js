const router = require('express').Router();
const { applyLeave, getMyLeaves, getLeaveApplications, reviewLeave, getLeaveStats } = require('../controllers/leaveApplication.controller');
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');

router.use(protect, tenantContext);

// Student
router.post('/apply', authorize('student'), applyLeave);
router.get('/my', authorize('student'), getMyLeaves);

// Admin / Principal
router.get('/', authorize('admin', 'principal', 'registrar'), getLeaveApplications);
router.get('/stats', authorize('admin', 'principal'), getLeaveStats);
router.put('/:id/review', authorize('admin', 'principal'), reviewLeave);

module.exports = router;
