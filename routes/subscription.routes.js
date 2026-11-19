const express = require('express');
const multer = require('multer');
const router = express.Router();
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');
const { createRateLimiter } = require('../middleware/rateLimit');
const { PROOF_UPLOAD_MAX_BYTES, PROOF_ALLOWED_MIMES } = require('../config/billingConfig');
const subscriptionController = require('../controllers/subscription.controller');

const proofUploadLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.user?.college_id || req.user?.id || 'anon',
  message: 'Too many payment proof upload attempts. Please wait 15 minutes before trying again.',
});

const proofMemoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PROOF_UPLOAD_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (PROOF_ALLOWED_MIMES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(Object.assign(new Error('Only JPG, PNG, or PDF files are allowed.'), { status: 400 }), false);
    }
  },
});

function handleMulterProofUpload(req, res, next) {
  proofMemoryUpload.single('proof')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        code: 'FILE_TOO_LARGE',
        message: 'Payment proof file must be 5 MB or smaller.',
      });
    }
    return res.status(err.status || 400).json({
      success: false,
      code: 'UPLOAD_VALIDATION_ERROR',
      message: err.message || 'Invalid upload file.',
    });
  });
}

/**
 * College Subscription & Entitlement Routes
 */
router.get('/current', protect, tenantContext, subscriptionController.getCurrentSubscription);
router.get('/status', protect, tenantContext, subscriptionController.getCurrentSubscription);
router.get('/plans-catalog', protect, tenantContext, authorize('admin'), subscriptionController.getPlansCatalogHandler);
router.get('/addon-catalog', protect, tenantContext, subscriptionController.getAddonCatalog);
router.post('/calculate-total', protect, tenantContext, authorize('admin'), subscriptionController.calculateTotal);
router.post('/checkout', protect, tenantContext, authorize('admin'), subscriptionController.checkoutSubscriptionHandler);
router.get('/invoices', protect, tenantContext, authorize('admin'), subscriptionController.getCollegeInvoicesHandler);
router.get('/invoices/:id/voucher.pdf', protect, tenantContext, authorize('admin'), subscriptionController.downloadInvoiceVoucherPdfHandler);
router.get('/invoices/:id/proof-url', protect, tenantContext, authorize('admin'), subscriptionController.getInvoiceProofUrlHandler);
router.post(
  '/invoices/:id/proof',
  protect,
  tenantContext,
  authorize('admin'),
  proofUploadLimiter,
  handleMulterProofUpload,
  subscriptionController.uploadInvoiceProofHandler
);
router.post('/submit-payment', protect, tenantContext, authorize('admin'), subscriptionController.submitPaymentProof);
router.post('/renew', protect, tenantContext, authorize('admin'), subscriptionController.submitPaymentProof);
router.get('/payment-history', protect, tenantContext, subscriptionController.getPaymentHistory);
router.get('/history', protect, tenantContext, subscriptionController.getPaymentHistory);

// Phase 10: N20 Message Credit Wallet & Consumption Ledger UI (Premium)
const creditWalletController = require('../controllers/creditWallet.controller');
const { subscriptionGate } = require('../middleware/subscriptionGate');

router.get('/credits/wallet', protect, tenantContext, subscriptionGate('message-credit-wallet'), creditWalletController.getWallet);
router.get('/credits/ledger', protect, tenantContext, subscriptionGate('message-credit-wallet'), creditWalletController.getLedger);

module.exports = router;
