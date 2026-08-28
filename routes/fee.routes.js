const router = require('express').Router();
const {
  getFees,
  createFee,
  updateFee,
  recordPayment,
  getDefaulters,
  getFeeStats,
  getMyFees,
  getFeeById,
  saveFeeStructure,
  getFeeStructure,
  getPaymentHistory,
  getReceiptDetails
} = require('../controllers/fee.controller');
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');

router.use(protect, tenantContext);

// Fee Structure Configuration (Admin, Principal, Accountant)
router.get('/structure/:student_id', authorize('admin', 'principal', 'accountant', 'registrar', 'student'), getFeeStructure);
router.post('/structure', authorize('admin', 'principal', 'accountant'), saveFeeStructure);

// Fee Collection & Obligations (Admin, Principal, Accountant)
router.route('/')
  .get(authorize('admin', 'accountant', 'principal', 'registrar'), getFees)
  .post(authorize('admin', 'principal', 'accountant'), createFee);

router.get('/stats', authorize('admin', 'accountant', 'principal'), getFeeStats);
router.get('/defaulters', authorize('admin', 'accountant', 'principal'), getDefaulters);
router.get('/my', authorize('student'), getMyFees);
router.get('/receipt/:payment_id', authorize('admin', 'principal', 'accountant', 'student'), getReceiptDetails);

router.route('/:id')
  .get(authorize('admin', 'accountant', 'principal', 'registrar', 'student'), getFeeById)
  .put(authorize('admin', 'principal', 'accountant'), updateFee);

router.put('/:id/payment', authorize('admin', 'principal', 'accountant'), recordPayment);
router.get('/:id/payments', authorize('admin', 'principal', 'accountant', 'student'), getPaymentHistory);

module.exports = router;

