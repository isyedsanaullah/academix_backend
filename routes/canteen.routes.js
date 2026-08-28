const router = require('express').Router();
const { getTransactions, createTransaction } = require('../controllers/canteen.controller');
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');

router.use(protect, tenantContext);

router.route('/').get(authorize('admin', 'employee'), getTransactions).post(authorize('employee', 'admin'), createTransaction);

module.exports = router;
