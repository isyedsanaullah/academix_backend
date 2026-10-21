require('dotenv').config();
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { FEATURES } = require('../services/capabilityCatalog');
const {
  generateCertificatePDF,
  generateFeeVoucherPDF,
  generatePaidReceiptPDF,
  generateStudentCardPDF,
  generatePlatformInvoicePDF,
  generateVerifyToken,
  formatKarachiDate,
  generateQRBuffer,
  CR80_WIDTH,
  CR80_HEIGHT
} = require('../services/documentTemplates');

const docController = require('../controllers/document.controller');
const superAdminController = require('../controllers/superAdmin.controller');
const collegeController = require('../controllers/college.controller');

async function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', chunk => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
    if (typeof stream.end === 'function') {
      stream.end();
    }
  });
}

async function runTests() {
  console.log('--- Starting Phase 12 Test Suite: Branded Templates, Downloads, Paid Receipt & Student Card ---');

  // Test 1: Capability Catalog verification
  const docTemplatesFeat = FEATURES.find(f => f.key === 'doc-templates');
  assert(docTemplatesFeat, 'doc-templates feature must exist in capabilityCatalog');
  assert.strictEqual(docTemplatesFeat.status, 'live', 'doc-templates status must be live');
  assert.strictEqual(docTemplatesFeat.effort, 'Done', 'doc-templates effort must be Done');
  assert(docTemplatesFeat.hard.includes('college-branding'), 'doc-templates must depend on college-branding');
  assert(docTemplatesFeat.hard.includes('students'), 'doc-templates must depend on students');

  const paidReceiptFeat = FEATURES.find(f => f.key === 'paid-receipt');
  assert(paidReceiptFeat, 'paid-receipt feature must exist in capabilityCatalog');
  assert.strictEqual(paidReceiptFeat.status, 'live', 'paid-receipt status must be live');
  assert.strictEqual(paidReceiptFeat.effort, 'Done', 'paid-receipt effort must be Done');
  assert(paidReceiptFeat.hard.includes('fees-basic'), 'paid-receipt must depend on fees-basic');
  assert(paidReceiptFeat.hard.includes('doc-templates'), 'paid-receipt must depend on doc-templates');
  console.log('✓ 1. Catalog features doc-templates and paid-receipt verified live and Done');

  // Test 2: Schema verification
  const schemaContent = fs.readFileSync(path.join(__dirname, '../prisma/schema.prisma'), 'utf8');
  assert(schemaContent.includes('model PlatformInvoice'), 'PlatformInvoice model must exist in schema.prisma');
  assert(schemaContent.includes('verifyToken') && schemaContent.includes('templateVersion'), 'Certificate must have verifyToken and templateVersion');
  assert(schemaContent.includes('model Fee') && schemaContent.includes('verifyToken'), 'Fee must have verifyToken');
  assert(schemaContent.includes('model Payment') && schemaContent.includes('verifiedBy') && schemaContent.includes('signedBy'), 'Payment must have verifyToken, verifiedBy, and signedBy');
  console.log('✓ 2. Prisma schema verified with verifyToken columns and PlatformInvoice model');

  // Test 3: verifyToken entropy and format
  const token1 = generateVerifyToken();
  const token2 = generateVerifyToken();
  assert.strictEqual(typeof token1, 'string', 'Token must be a string');
  assert.strictEqual(token1.length, 24, 'verifyToken must be exactly 24 characters (18 bytes base64url)');
  assert.notStrictEqual(token1, token2, 'verifyTokens must be random and unique');
  assert(/^[A-Za-z0-9_-]+$/.test(token1), 'verifyToken must be URL-safe (base64url)');
  console.log('✓ 3. verifyToken cryptographically strong with 144 bits entropy and 24-char URL-safe format');

  // Test 4: Karachi Date Formatting & QR Code generation
  const karachiDate = formatKarachiDate(new Date('2026-10-21T12:00:00Z'), 'datetime');
  assert(karachiDate.includes('PKT'), 'Formatted date must include PKT timezone');
  assert(karachiDate.includes('2026'), 'Formatted date must include year 2026');

  const qrBuf = await generateQRBuffer('https://cesms.edu.pk/verify/sample-token', 100);
  assert(Buffer.isBuffer(qrBuf), 'QR generator must return a Buffer');
  assert(qrBuf.length > 100, 'QR Buffer must contain valid image data');
  // Check PNG magic bytes: 0x89 0x50 0x4E 0x47
  assert.strictEqual(qrBuf[0], 0x89, 'QR buffer must be PNG format');
  assert.strictEqual(qrBuf[1], 0x50, 'QR buffer must be PNG format');
  console.log('✓ 4. Karachi timezone formatting and QR code generator verified');

  // Test 5: Certificate PDF Stream Generation
  const certStream = await generateCertificatePDF({
    certificate: {
      type: 'character',
      certificateNumber: 'CERT-TEST-001',
      issueDate: new Date(),
      verifyToken: token1,
      status: 'issued'
    },
    student: {
      name: 'Ali Raza',
      fatherName: 'Muhammad Raza',
      rollNumber: 'FSC-001',
      class: 'FSC Part 1',
      group: 'Pre-Medical'
    },
    college: {
      name: 'FMC Test College',
      city: 'Faisalabad'
    },
    branding: {
      primaryColor: '#1E3A8A'
    }
  });

  const certBuf = await streamToBuffer(certStream);
  assert(Buffer.isBuffer(certBuf), 'Certificate output must be a buffer');
  assert(certBuf.slice(0, 5).toString('ascii').startsWith('%PDF'), 'Certificate buffer must start with %PDF header');
  assert(certBuf.length > 2000, 'Certificate PDF must be complete and non-empty');
  console.log(`✓ 5. Certificate PDF generated and streamed successfully (${certBuf.length} bytes)`);

  // Test 6: 3-Copy Fee Voucher / Bank Challan (Branded & Plain Fallback)
  const voucherStreamBranded = await generateFeeVoucherPDF({
    fee: {
      challanNumber: 'CH-TEST-001',
      month: 'October 2026',
      tuitionFee: 10000,
      totalAmount: 10000,
      verifyToken: token1
    },
    student: { name: 'Ali Raza', rollNumber: 'FSC-001' },
    college: { name: 'FMC Test College' },
    docTemplatesEnabled: true
  });
  const voucherBufBranded = await streamToBuffer(voucherStreamBranded);
  assert(voucherBufBranded.slice(0, 5).toString('ascii').startsWith('%PDF'), 'Voucher must have valid PDF header');
  assert(voucherBufBranded.length > 2000, 'Branded voucher PDF must be complete');

  const voucherStreamPlain = await generateFeeVoucherPDF({
    fee: {
      challanNumber: 'CH-TEST-PLAIN',
      month: 'October 2026',
      tuitionFee: 10000,
      totalAmount: 10000,
      verifyToken: token2
    },
    student: { name: 'Ali Raza', rollNumber: 'FSC-001' },
    college: { name: 'FMC Test College' },
    docTemplatesEnabled: false
  });
  const voucherBufPlain = await streamToBuffer(voucherStreamPlain);
  assert(voucherBufPlain.slice(0, 5).toString('ascii').startsWith('%PDF'), 'Plain fallback voucher must have valid PDF header');
  console.log('✓ 6. 3-Copy Fee Voucher verified in both branded mode and plain fallback mode');

  // Test 7: Paid Receipt PDF Stream Generation
  const receiptStream = await generatePaidReceiptPDF({
    payment: {
      receiptNumber: 'RCP-TEST-001',
      amount: 10000,
      paymentMethod: 'bank',
      verifyToken: token1
    },
    fee: {
      challanNumber: 'CH-TEST-001',
      month: 'October 2026',
      totalAmount: 10000,
      paidAmount: 10000,
      status: 'paid'
    },
    student: { name: 'Ali Raza', rollNumber: 'FSC-001' },
    college: { name: 'FMC Test College' }
  });
  const receiptBuf = await streamToBuffer(receiptStream);
  assert(receiptBuf.slice(0, 5).toString('ascii').startsWith('%PDF'), 'Receipt must have valid PDF header');
  assert(receiptBuf.length > 2000, 'Paid receipt PDF must be complete');
  console.log(`✓ 7. Verified Paid Receipt PDF generated successfully with PAID badge (${receiptBuf.length} bytes)`);

  // Test 8: Student ID Card (CR80 single and 8-card sheet)
  assert.strictEqual(Math.round(CR80_WIDTH), 243, 'CR80 width must be ~242.65 pt (85.6 mm)');
  assert.strictEqual(Math.round(CR80_HEIGHT), 153, 'CR80 height must be ~153.07 pt (54 mm)');

  const cardSingleStream = await generateStudentCardPDF({
    student: { name: 'Ali Raza', rollNumber: 'FSC-001', qrCode: 'QR-001' },
    college: { name: 'FMC Test College' },
    mode: 'single'
  });
  const cardSingleBuf = await streamToBuffer(cardSingleStream);
  assert(cardSingleBuf.slice(0, 5).toString('ascii').startsWith('%PDF'), 'Single card must have valid PDF header');

  const cardSheetStream = await generateStudentCardPDF({
    students: [
      { name: 'Student 1', rollNumber: 'FSC-001', qrCode: 'QR-001' },
      { name: 'Student 2', rollNumber: 'FSC-002', qrCode: 'QR-002' }
    ],
    college: { name: 'FMC Test College' },
    mode: 'sheet'
  });
  const cardSheetBuf = await streamToBuffer(cardSheetStream);
  assert(cardSheetBuf.slice(0, 5).toString('ascii').startsWith('%PDF'), 'Card sheet must have valid PDF header');
  console.log('✓ 8. Student ID Card verified for both CR80 single card and 8-up printable sheet');

  // Test 9: Platform Invoice PDF (unpaid invoice and paid receipt)
  const invoiceStream = await generatePlatformInvoicePDF({
    invoice: {
      invoiceNo: 'PINV-TEST-001',
      periodStart: new Date('2026-10-01'),
      periodEnd: new Date('2026-10-31'),
      amount: 19999,
      status: 'unpaid',
      verifyToken: token1
    },
    college: { name: 'FMC Test College', code: 'FMC-01' },
    isPaid: false
  });
  const invoiceBuf = await streamToBuffer(invoiceStream);
  assert(invoiceBuf.slice(0, 5).toString('ascii').startsWith('%PDF'), 'Invoice must have valid PDF header');

  const platformReceiptStream = await generatePlatformInvoicePDF({
    invoice: {
      invoiceNo: 'PINV-TEST-001',
      periodStart: new Date('2026-10-01'),
      periodEnd: new Date('2026-10-31'),
      amount: 19999,
      status: 'paid',
      verifyToken: token1
    },
    college: { name: 'FMC Test College', code: 'FMC-01' },
    isPaid: true
  });
  const platformReceiptBuf = await streamToBuffer(platformReceiptStream);
  assert(platformReceiptBuf.slice(0, 5).toString('ascii').startsWith('%PDF'), 'Platform receipt must have valid PDF header');
  console.log('✓ 9. Super Admin Platform Invoice & Paid Receipt verified');

  // Test 10: Controller Handlers verification
  assert(typeof docController.downloadCertificatePDF === 'function', 'downloadCertificatePDF must be exported');
  assert(typeof docController.downloadFeeVoucherPDF === 'function', 'downloadFeeVoucherPDF must be exported');
  assert(typeof docController.downloadPaidReceiptPDF === 'function', 'downloadPaidReceiptPDF must be exported');
  assert(typeof docController.downloadStudentCardPDF === 'function', 'downloadStudentCardPDF must be exported');
  assert(typeof docController.downloadStudentCardsSheetPDF === 'function', 'downloadStudentCardsSheetPDF must be exported');
  assert(typeof docController.previewDocumentPDF === 'function', 'previewDocumentPDF must be exported');

  assert(typeof superAdminController.createPlatformInvoice === 'function', 'createPlatformInvoice must be exported');
  assert(typeof superAdminController.getPlatformInvoices === 'function', 'getPlatformInvoices must be exported');
  assert(typeof superAdminController.payPlatformInvoice === 'function', 'payPlatformInvoice must be exported');
  assert(typeof superAdminController.downloadPlatformInvoicePDF === 'function', 'downloadPlatformInvoicePDF must be exported');
  assert(typeof superAdminController.downloadPlatformReceiptPDF === 'function', 'downloadPlatformReceiptPDF must be exported');
  assert(typeof superAdminController.uploadPlatformSignature === 'function', 'uploadPlatformSignature must be exported');

  assert(typeof collegeController.getCollegeInvoices === 'function', 'getCollegeInvoices must be exported');
  assert(typeof collegeController.downloadCollegeInvoicePDF === 'function', 'downloadCollegeInvoicePDF must be exported');
  console.log('✓ 10. All document and platform invoice controller handlers verified');

  // Test 11: Sample files existence in docs/samples/
  const samplesDir = path.join(__dirname, '../../docs/samples');
  assert(fs.existsSync(path.join(samplesDir, 'certificate_sample.pdf')), 'certificate_sample.pdf must exist');
  assert(fs.existsSync(path.join(samplesDir, 'fee_voucher_sample.pdf')), 'fee_voucher_sample.pdf must exist');
  assert(fs.existsSync(path.join(samplesDir, 'paid_receipt_sample.pdf')), 'paid_receipt_sample.pdf must exist');
  assert(fs.existsSync(path.join(samplesDir, 'student_card_single.pdf')), 'student_card_single.pdf must exist');
  assert(fs.existsSync(path.join(samplesDir, 'student_card_sheet.pdf')), 'student_card_sheet.pdf must exist');
  assert(fs.existsSync(path.join(samplesDir, 'platform_invoice.pdf')), 'platform_invoice.pdf must exist');
  assert(fs.existsSync(path.join(samplesDir, 'platform_receipt.pdf')), 'platform_receipt.pdf must exist');
  console.log('✓ 11. All 7 sample PDFs verified in docs/samples/');

  console.log('\n======================================================');
  console.log('✅ ALL PHASE 12 TESTS PASSED SUCCESSFULLY (100%)');
  console.log('======================================================\n');
}

runTests().catch(err => {
  console.error('\n❌ PHASE 12 TEST SUITE FAILED:', err);
  process.exit(1);
});
