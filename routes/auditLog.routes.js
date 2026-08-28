const router = require('express').Router();
const { getLogs } = require('../controllers/auditLog.controller');
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');

router.use(protect, tenantContext);
router.get('/', authorize('admin', 'principal', 'superAdmin'), getLogs);

module.exports = router;
