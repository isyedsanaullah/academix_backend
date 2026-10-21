const router = require('express').Router();
const { getVisitors, createVisitor, checkoutVisitor } = require('../controllers/visitor.controller');
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');
const { featureGate } = require('../middleware/loadEntitlements');

router.use(protect, tenantContext, featureGate('visitors'));

router.route('/').get(authorize('admin', 'employee', 'principal'), getVisitors).post(authorize('employee'), createVisitor);
router.put('/:id/checkout', authorize('employee', 'admin'), checkoutVisitor);


router.meta = {
  "feature": "visitors"
};

module.exports = router;