const router = require('express').Router();
const { scanQR, getTodayLogs, getLogsByDate, requestEarlyExit, getMyExitRequests, getPendingExitRequests, reviewExitRequest, lookupQR } = require('../controllers/guard.controller');
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');
const planGate = require('../middleware/planGate');

router.use(protect, tenantContext, planGate('entry-system'));

// Guard: scan QR entry/exit + view logs
router.post('/scan', authorize('employee', 'admin'), scanQR);
router.get('/logs/today', authorize('employee', 'admin', 'principal'), getTodayLogs);
router.get('/logs', authorize('employee', 'admin', 'principal'), getLogsByDate);

// QR lookup (for fine page scanner etc)
router.get('/lookup', authorize('teacher', 'admin', 'employee'), lookupQR);

// Early exit: any authenticated user can request
router.post('/early-exit', authorize('student', 'teacher', 'employee'), requestEarlyExit);
router.get('/early-exit/my', authorize('student', 'teacher', 'employee'), getMyExitRequests);

// Principal: review early exit requests
router.get('/early-exit/pending', authorize('principal', 'admin'), getPendingExitRequests);
router.put('/early-exit/:id/review', authorize('principal', 'admin'), reviewExitRequest);

module.exports = router;
