const router = require('express').Router();
const { getTransactions, createTransaction } = require('../controllers/canteen.controller');
const {
  openShift,
  closeShift,
  createOrder,
  topupStudentAccount,
  voidOrder
} = require('../controllers/canteenPOS.controller');
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');
const { featureGate } = require('../middleware/loadEntitlements');

router.use(protect, tenantContext, featureGate('canteen'));

router.route('/')
  .get(authorize('admin', 'employee'), getTransactions)
  .post(authorize('employee', 'admin'), createTransaction);

// Phase 7D: POS Shifts, Orders, and Offline Cash Topups
router.post('/shifts/open', authorize('employee', 'admin'), openShift);
router.post('/shifts/:id/close', authorize('employee', 'admin'), closeShift);
router.post('/orders', authorize('employee', 'admin'), createOrder);
router.post('/orders/:id/void', authorize('employee', 'admin'), voidOrder);
router.post('/accounts/:studentId/topup', authorize('employee', 'admin'), topupStudentAccount);


router.meta = {
  "feature": "canteen"
};

module.exports = router;