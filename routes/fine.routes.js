const router = require('express').Router();
const { createFine, getMyIssuedFines, getFines, getMyFines, updateFine } = require('../controllers/fine.controller');
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');
const { featureGate } = require('../middleware/loadEntitlements');

router.use(protect, tenantContext, featureGate('fines'));

// Student: view own fines
router.get('/my', authorize('student'), getMyFines);

// Teacher & Admin: create fine + view issued fines
router.get('/issued', authorize('teacher', 'admin'), getMyIssuedFines);
router.post('/', authorize('teacher', 'admin'), createFine);

// Admin: view all + update status
router.get('/', authorize('admin', 'accountant', 'principal'), getFines);
router.put('/:id', authorize('admin', 'accountant'), updateFine);


router.meta = {
  "feature": "fines"
};

module.exports = router;