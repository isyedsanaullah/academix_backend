const router = require('express').Router();
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');
const { featureGate } = require('../middleware/loadEntitlements');

const {
  submitPaymentProof,
  getPaymentProofs,
  verifyPaymentProof,
  rejectPaymentProof,
  markDuplicatePaymentProof,
  getDailyProofsReport,
  stubPaymentOcr,
  getPaymentAccounts,
  updatePaymentAccounts
} = require('../controllers/paymentProof.controller');

router.use(protect, tenantContext);

// Settings for College Payment Accounts (EasyPaisa, JazzCash, Bank accounts)
router.route('/accounts')
  .get(featureGate('payment-proof'), authorize('student', 'admin', 'principal', 'accountant'), getPaymentAccounts)
  .put(featureGate('payment-proof'), authorize('admin'), updatePaymentAccounts);

// Daily proofs summary report
router.get('/daily-report', featureGate('payment-proof'), authorize('accountant', 'admin', 'principal'), getDailyProofsReport);

// Core Proof Submission & Queue
router.route('/')
  .post(featureGate('payment-proof'), authorize('student', 'admin'), submitPaymentProof)
  .get(featureGate('payment-proof'), authorize('accountant', 'admin', 'principal'), getPaymentProofs);

// Accountant Actions
router.put('/:id/verify', featureGate('payment-proof'), authorize('accountant', 'admin'), verifyPaymentProof);
router.put('/:id/reject', featureGate('payment-proof'), authorize('accountant', 'admin'), rejectPaymentProof);
router.put('/:id/duplicate', featureGate('payment-proof'), authorize('accountant', 'admin'), markDuplicatePaymentProof);

// Enterprise AI OCR Stub
router.post('/:id/ocr', featureGate('ai-payment-ocr'), authorize('accountant', 'admin'), stubPaymentOcr);

router.meta = { feature: 'payment-proof' };
module.exports = router;
