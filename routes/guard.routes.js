const router = require('express').Router();
const { scanQR, getTodayLogs, getLogsByDate, requestEarlyExit, getMyExitRequests, getPendingExitRequests, reviewExitRequest, lookupQR } = require('../controllers/guard.controller');
const { makeGateManual } = require('../controllers/fallback.controller');
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');
const { featureGate } = require('../middleware/loadEntitlements');

router.use(protect, tenantContext);

// Guard: scan QR entry/exit + view logs
router.post('/scan', featureGate('gate-scanner'), authorize('employee', 'admin'), scanQR);
router.post('/manual', authorize('employee', 'admin'), featureGate(['gate-scanner', 'gate-manual-log']), makeGateManual(scanQR));
router.get('/logs/today', featureGate(['gate-scanner', 'gate-manual-log']), authorize('employee', 'admin', 'principal'), getTodayLogs);
router.get('/logs', featureGate(['gate-scanner', 'gate-manual-log']), authorize('employee', 'admin', 'principal'), getLogsByDate);

// QR lookup (for fine page scanner etc)
router.get('/lookup', featureGate('gate-scanner'), authorize('teacher', 'admin', 'employee'), lookupQR);

// Early exit: any authenticated user can request
router.post('/early-exit', featureGate('early-exit'), authorize('student', 'teacher', 'employee'), requestEarlyExit);
router.get('/early-exit/my', featureGate('early-exit'), authorize('student', 'teacher', 'employee'), getMyExitRequests);

// Principal: review early exit requests
router.get('/early-exit/pending', featureGate('early-exit'), authorize('principal', 'admin'), getPendingExitRequests);
router.put('/early-exit/:id/review', featureGate('early-exit'), authorize('principal', 'admin'), reviewExitRequest);


router.meta = {
  "feature": [
    "gate-scanner",
    "gate-manual-log",
    "early-exit"
  ]
};

module.exports = router;