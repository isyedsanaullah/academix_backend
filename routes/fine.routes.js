const router = require('express').Router();
const { createFine, getMyIssuedFines, getFines, getMyFines, updateFine } = require('../controllers/fine.controller');
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');

router.use(protect, tenantContext);

// Student: view own fines
router.get('/my', authorize('student'), getMyFines);

// Teacher: create fine + view issued fines
router.get('/issued', authorize('teacher'), getMyIssuedFines);
router.post('/', authorize('teacher', 'admin'), createFine);

// Admin: view all + update status
router.get('/', authorize('admin', 'accountant', 'principal'), getFines);
router.put('/:id', authorize('admin', 'accountant'), updateFine);

module.exports = router;
