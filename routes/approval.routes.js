const router = require('express').Router();
const { getPendingApprovals, approveRequest, rejectRequest } = require('../controllers/approval.controller');
const protect = require('../middleware/auth');
const tenantContext = require('../middleware/tenantContext');

// Principal + registrar/teachers (for principal_delete multi-approval)
router.use(protect, tenantContext);

router.get('/', getPendingApprovals);
router.put('/:id/approve', approveRequest);
router.put('/:id/reject', rejectRequest);

module.exports = router;
