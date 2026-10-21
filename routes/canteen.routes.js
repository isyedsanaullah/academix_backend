const router = require('express').Router();
const { getTransactions, createTransaction } = require('../controllers/canteen.controller');
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');
const { featureGate } = require('../middleware/loadEntitlements');

router.use(protect, tenantContext, featureGate('canteen'));

router.route('/').get(authorize('admin', 'employee'), getTransactions).post(authorize('employee', 'admin'), createTransaction);


router.meta = {
  "feature": "canteen"
};

module.exports = router;