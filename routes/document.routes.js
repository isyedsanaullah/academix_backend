const router = require('express').Router();
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');
const { featureGate } = require('../middleware/loadEntitlements');

const {
  downloadCertificatePDF,
  downloadFeeVoucherPDF,
  downloadPaidReceiptPDF,
  downloadStudentCardPDF,
  downloadStudentCardsSheetPDF,
  previewDocumentPDF
} = require('../controllers/document.controller');

// Require authentication and tenant context
router.use(protect, tenantContext);

// Certificate PDF download (doc-templates)
router.get(
  '/certificate/:id.pdf',
  featureGate('doc-templates'),
  authorize('admin', 'principal', 'registrar', 'student'),
  downloadCertificatePDF
);

// Fee Voucher / Bank Challan PDF download (fees-basic with plain fallback if doc-templates is off)
router.get(
  '/voucher/:feeId.pdf',
  featureGate('fees-basic'),
  authorize('admin', 'principal', 'accountant', 'student'),
  downloadFeeVoucherPDF
);

// Paid Receipt PDF download (paid-receipt)
router.get(
  '/receipt/:paymentId.pdf',
  featureGate('paid-receipt'),
  authorize('admin', 'principal', 'accountant', 'student'),
  downloadPaidReceiptPDF
);

// Student ID Card single CR80 PDF (doc-templates)
router.get(
  '/student-card/:studentId.pdf',
  featureGate('doc-templates'),
  authorize('admin', 'principal', 'registrar', 'student'),
  downloadStudentCardPDF
);

// Student ID Cards 8-cards-per-A4 printable sheet PDF (doc-templates)
router.post(
  '/student-cards.pdf',
  featureGate('doc-templates'),
  authorize('admin', 'principal', 'registrar'),
  downloadStudentCardsSheetPDF
);

// Template Preview PDF (doc-templates)
router.get(
  '/preview/:type.pdf',
  featureGate('doc-templates'),
  authorize('admin', 'principal'),
  previewDocumentPDF
);

router.meta = {
  feature: 'doc-templates'
};

module.exports = router;
