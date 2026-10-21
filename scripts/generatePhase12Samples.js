/**
 * Script to generate Phase 12 Sample PDFs in docs/samples/
 * - certificate_sample.pdf
 * - fee_voucher_sample.pdf
 * - paid_receipt_sample.pdf
 * - student_card_single.pdf
 * - student_card_sheet.pdf
 * - platform_invoice.pdf
 * - platform_receipt.pdf
 */

const fs = require('fs');
const path = require('path');
const {
  generateCertificatePDF,
  generateFeeVoucherPDF,
  generatePaidReceiptPDF,
  generateStudentCardPDF,
  generatePlatformInvoicePDF,
  generateVerifyToken
} = require('../services/documentTemplates');

async function savePdfToFile(pdfDoc, filePath) {
  return new Promise((resolve, reject) => {
    const stream = fs.createWriteStream(filePath);
    pdfDoc.pipe(stream);
    pdfDoc.end();
    stream.on('finish', () => resolve(filePath));
    stream.on('error', reject);
  });
}

async function main() {
  const outputDir = path.resolve(__dirname, '../../docs/samples');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log(`Generating Phase 12 Sample PDFs in: ${outputDir}`);

  const sampleCollege = {
    name: 'Faisalabad Model College',
    code: 'FMC-01',
    city: 'Faisalabad',
    address: 'West Canal Road, Faisalabad, Punjab',
    phone: '+92 41 9200888',
    email: 'info@fmc.edu.pk',
    website: 'https://fmc.edu.pk'
  };

  const sampleBranding = {
    primaryColor: '#1E3A8A',
    headerLines: ['Affiliated with Federal Board of Intermediate & Secondary Education (FBISE)'],
    footerNote: 'This is an authentic system-generated document. Verified via QR code.'
  };

  const sampleStudent = {
    id: 'sample-student-1',
    name: 'Muhammad Ahmed Khan',
    fatherName: 'Tariq Mehmood Khan',
    rollNumber: 'FSC-2026-042',
    class: 'FSC Part 1',
    group: 'Pre-Engineering',
    section: 'A',
    session: '2026-2028',
    qrCode: 'STUDENT-FSC-2026-042',
    guardianPhone: '0300-9876543',
    phone: '0312-3456789',
    address: 'House 14-B, Peoples Colony No. 1, Faisalabad',
    validUntil: '31 July 2028'
  };

  // 1. Certificate Sample
  console.log('→ Generating certificate_sample.pdf...');
  const certDoc = await generateCertificatePDF({
    certificate: {
      type: 'character',
      certificateNumber: 'CERT-CHA-2026-0042',
      issueDate: new Date(),
      verifyToken: generateVerifyToken(),
      status: 'issued',
      predictedPerformance: 'A+ Grade (85% - 90%)',
      academicConsistency: 'Top 5% in First Year Term Examinations'
    },
    student: sampleStudent,
    college: sampleCollege,
    branding: sampleBranding,
    isSample: true
  });
  await savePdfToFile(certDoc, path.join(outputDir, 'certificate_sample.pdf'));

  // 2. Fee Voucher Sample (3-Copy A4 Landscape)
  console.log('→ Generating fee_voucher_sample.pdf...');
  const voucherDoc = await generateFeeVoucherPDF({
    fee: {
      id: 'sample-fee-1',
      challanNumber: 'CH-2026-10-0042',
      month: 'October 2026',
      tuitionFee: 12500,
      labFee: 2500,
      functionFee: 1500,
      otherCharges: 500,
      fine: 0,
      scholarshipDeduction: 2000,
      totalAmount: 15000,
      dueDate: new Date(Date.now() + 10 * 86400000),
      verifyToken: generateVerifyToken()
    },
    student: sampleStudent,
    college: sampleCollege,
    branding: sampleBranding,
    docTemplatesEnabled: true
  });
  await savePdfToFile(voucherDoc, path.join(outputDir, 'fee_voucher_sample.pdf'));

  // 3. Paid Receipt Sample
  console.log('→ Generating paid_receipt_sample.pdf...');
  const receiptDoc = await generatePaidReceiptPDF({
    payment: {
      id: 'sample-pay-1',
      receiptNumber: 'RCP-2026-0042',
      amount: 15000,
      paymentMethod: 'bank',
      referenceNumber: 'HBL-FT-9912048',
      receivedBy: 'Muhammad Yasir (Chief Accountant)',
      verifyToken: generateVerifyToken(),
      createdAt: new Date()
    },
    fee: {
      id: 'sample-fee-1',
      challanNumber: 'CH-2026-10-0042',
      month: 'October 2026',
      tuitionFee: 12500,
      labFee: 2500,
      functionFee: 1500,
      otherCharges: 500,
      fine: 0,
      scholarshipDeduction: 2000,
      totalAmount: 15000,
      paidAmount: 15000,
      status: 'paid'
    },
    student: sampleStudent,
    college: sampleCollege,
    branding: sampleBranding,
    isSample: true
  });
  await savePdfToFile(receiptDoc, path.join(outputDir, 'paid_receipt_sample.pdf'));

  // 4. Student Card Single (CR80)
  console.log('→ Generating student_card_single.pdf...');
  const cardDoc = await generateStudentCardPDF({
    student: sampleStudent,
    college: sampleCollege,
    branding: sampleBranding,
    mode: 'single'
  });
  await savePdfToFile(cardDoc, path.join(outputDir, 'student_card_single.pdf'));

  // 5. Student Cards Sheet (8 per A4 page)
  console.log('→ Generating student_card_sheet.pdf...');
  const sheetStudents = Array.from({ length: 8 }).map((_, i) => ({
    ...sampleStudent,
    rollNumber: `FSC-2026-0${40 + i}`,
    name: `Student Candidate ${i + 1}`,
    qrCode: `STUDENT-FSC-2026-0${40 + i}`
  }));
  const sheetDoc = await generateStudentCardPDF({
    students: sheetStudents,
    college: sampleCollege,
    branding: sampleBranding,
    mode: 'sheet'
  });
  await savePdfToFile(sheetDoc, path.join(outputDir, 'student_card_sheet.pdf'));

  // 6. Platform Invoice
  console.log('→ Generating platform_invoice.pdf...');
  const invoiceDoc = await generatePlatformInvoicePDF({
    invoice: {
      id: 'sample-pinv-1',
      invoiceNo: 'PINV-2026-001',
      planId: 'standard',
      periodStart: new Date('2026-10-01'),
      periodEnd: new Date('2026-10-31'),
      amount: 19999,
      status: 'unpaid',
      verifyToken: generateVerifyToken(),
      createdAt: new Date('2026-10-01')
    },
    college: sampleCollege,
    isPaid: false
  });
  await savePdfToFile(invoiceDoc, path.join(outputDir, 'platform_invoice.pdf'));

  // 7. Platform Paid Receipt
  console.log('→ Generating platform_receipt.pdf...');
  const platformReceiptDoc = await generatePlatformInvoicePDF({
    invoice: {
      id: 'sample-pinv-1',
      invoiceNo: 'PINV-2026-001',
      planId: 'standard',
      periodStart: new Date('2026-10-01'),
      periodEnd: new Date('2026-10-31'),
      amount: 19999,
      status: 'paid',
      paidAt: new Date('2026-10-05'),
      method: 'bank',
      reference: 'MEEZAN-TRX-882910',
      verifiedBy: 'Super Admin Billing Ops',
      verifyToken: generateVerifyToken(),
      createdAt: new Date('2026-10-01')
    },
    college: sampleCollege,
    isPaid: true
  });
  await savePdfToFile(platformReceiptDoc, path.join(outputDir, 'platform_receipt.pdf'));

  console.log('✅ All Phase 12 sample PDFs generated successfully!');
}

main().catch(err => {
  console.error('Error generating sample PDFs:', err);
  process.exit(1);
});
