const router = require('express').Router();
const { getVisitors, createVisitor, checkoutVisitor } = require('../controllers/visitor.controller');
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');

router.use(protect, tenantContext);

router.route('/').get(authorize('admin', 'employee', 'principal'), getVisitors).post(authorize('employee'), createVisitor);
router.put('/:id/checkout', authorize('employee', 'admin'), checkoutVisitor);

module.exports = router;
