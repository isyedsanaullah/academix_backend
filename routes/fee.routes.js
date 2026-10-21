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
  getReceiptDetails,
  getFeeStructures,
  createFeeStructure,
  updateFeeStructure,
  deleteFeeStructure,
  generateFeesFromStructure,
  createFeeRefund,
  getFeeRefunds,
  voidFee
} = require('../controllers/fee.controller');
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');
const { featureGate } = require('../middleware/loadEntitlements');

router.use(protect, tenantContext);

// Phase 8: Group Fee Structures & Automated Generation
router.route('/structures')
  .get(featureGate('fee-college-types'), authorize('admin', 'principal', 'accountant', 'registrar'), getFeeStructures)
  .post(featureGate('fee-college-types'), authorize('admin', 'principal', 'accountant'), createFeeStructure);

router.route('/structures/:id')
  .put(featureGate('fee-college-types'), authorize('admin', 'principal', 'accountant'), updateFeeStructure)
  .delete(featureGate('fee-college-types'), authorize('admin', 'principal', 'accountant'), deleteFeeStructure);

router.post('/generate-from-structure', featureGate('fee-college-types'), authorize('admin', 'principal', 'accountant'), generateFeesFromStructure);

// Phase 8: Fee Refunds through Approval Model
router.route('/refunds')
  .get(featureGate('fee-refunds'), authorize('admin', 'principal', 'accountant'), getFeeRefunds)
  .post(featureGate('fee-refunds'), authorize('admin', 'principal', 'accountant'), createFeeRefund);

// Fee Structure Configuration (Legacy & Per-student)
router.get('/structure/:student_id', featureGate('fee-college-types'), authorize('admin', 'principal', 'accountant', 'registrar', 'student'), getFeeStructure);
router.post('/structure', featureGate('fee-college-types'), authorize('admin', 'principal', 'accountant'), saveFeeStructure);

// Fee Collection & Obligations (Admin, Principal, Accountant)
router.route('/')
  .get(featureGate('fees-basic'), authorize('admin', 'accountant', 'principal', 'registrar'), getFees)
  .post(featureGate('fees-basic'), authorize('admin', 'principal', 'accountant'), createFee);

router.get('/stats', featureGate('treasury-ledger'), authorize('admin', 'accountant', 'principal'), getFeeStats);
router.get('/defaulters', featureGate('defaulters-dues'), authorize('admin', 'accountant', 'principal'), getDefaulters);
router.get('/my', featureGate('fees-basic'), authorize('student'), getMyFees);
router.get('/receipt/:payment_id', featureGate('fees-basic'), authorize('admin', 'principal', 'accountant', 'student'), getReceiptDetails);

router.route('/:id')
  .get(featureGate('fees-basic'), authorize('admin', 'accountant', 'principal', 'registrar', 'student'), getFeeById)
  .put(featureGate('fee-college-types'), authorize('admin', 'principal', 'accountant'), updateFee);

router.put('/:id/payment', featureGate('fees-basic'), authorize('admin', 'principal', 'accountant'), recordPayment);
router.put('/:id/void', featureGate('fees-basic'), authorize('admin', 'principal'), voidFee);
router.get('/:id/payments', featureGate('treasury-ledger'), authorize('admin', 'principal', 'accountant', 'student'), getPaymentHistory);

router.meta = { feature: 'fees-basic' };
module.exports = router;

