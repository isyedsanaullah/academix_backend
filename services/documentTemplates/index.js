/**
 * Document Templates Index & Unified Registry
 * ─────────────────────────────────────────────
 * Exports all document templates for streaming PDF generation:
 * - Certificate (character, bonafide, hope, migration, leaving)
 * - Fee Voucher / Bank Challan (3-copy A4, branded or plain fallback)
 * - Paid Receipt (verified receipt with PAID stamp)
 * - Student ID Card (CR80 single and 8-card printable sheet)
 * - Platform Invoice & Paid Receipt (Super admin billing)
 */

const { generateCertificatePDF, CERTIFICATE_TITLES } = require('./certificate');
const { generateFeeVoucherPDF } = require('./feeVoucher');
const { generatePaidReceiptPDF } = require('./paidReceipt');
const { generateStudentCardPDF, CR80_WIDTH, CR80_HEIGHT } = require('./studentCard');
const { generatePlatformInvoicePDF, PLATFORM_BRANDING } = require('./platformInvoice');
const shared = require('./shared');

module.exports = {
  generateCertificatePDF,
  generateFeeVoucherPDF,
  generatePaidReceiptPDF,
  generateStudentCardPDF,
  generatePlatformInvoicePDF,
  CERTIFICATE_TITLES,
  PLATFORM_BRANDING,
  CR80_WIDTH,
  CR80_HEIGHT,
  ...shared
};
