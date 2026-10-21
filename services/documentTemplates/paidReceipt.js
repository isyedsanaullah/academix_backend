/**
 * Document Templates: Paid Receipt Generator
 * ───────────────────────────────────────────
 * Generates official verified paid receipts for settled fees / vouchers.
 * Features:
 * - Prominent "PAID" official stamp & badge
 * - Receipt Number & Payment Transaction details
 * - Payment Method (Cash, Bank Deposit, EasyPaisa, JazzCash, Raast)
 * - Accountant Signature block and official College Stamp
 * - QR code linking to verified Payment verifyToken
 */

const PDFDocument = require('pdfkit');
const {
  DEFAULT_PRIMARY,
  DEFAULT_ACCENT,
  TEXT_DARK,
  TEXT_MUTED,
  BORDER_COLOR,
  BG_LIGHT,
  SUCCESS_COLOR,
  drawHeader,
  drawFooter,
  drawWatermark,
  drawSignatureBlock,
  generateQRBuffer,
  formatKarachiDate,
  generateVerifyToken
} = require('./shared');

/**
 * Generate Paid Receipt PDF as a stream
 *
 * @param {Object} data
 * @param {Object} data.payment - Payment record
 * @param {Object} data.fee - Fee record
 * @param {Object} data.student - Student record
 * @param {Object} data.college - College record
 * @param {Object} data.branding - Branding details & image buffers
 * @param {String} data.verifyBaseUrl - Base URL for public verification
 * @returns {PDFDocument} PDFKit document stream
 */
async function generatePaidReceiptPDF(data) {
  const {
    payment = {},
    fee = {},
    student = {},
    college = {},
    branding = {},
    verifyBaseUrl = 'https://cesms.edu.pk'
  } = data;

  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 36, bottom: 36, left: 36, right: 36 },
    info: {
      Title: `PAID RECEIPT - ${payment.receiptNumber || 'RCP'} - ${student.rollNumber || ''}`,
      Author: college.name || 'CESMS',
      Subject: 'Official Fee Payment Receipt'
    }
  });

  const primaryColor = branding.primaryColor || DEFAULT_PRIMARY;
  const verifyToken = payment.verifyToken || generateVerifyToken();
  const verifyUrl = `${verifyBaseUrl.replace(/\/+$/, '')}/verify/${verifyToken}`;

  // 1. Double collegiate border
  doc.rect(24, 24, 547, 794).lineWidth(1.5).stroke(primaryColor);
  doc.rect(28, 28, 539, 786).lineWidth(0.5).stroke(BORDER_COLOR);

  // 2. Header
  const headerBottomY = drawHeader(doc, college, branding, {
    startX: 36,
    startY: 36,
    width: 523
  });

  // 3. Receipt Banner with Large PAID Stamp
  const bannerY = headerBottomY + 10;
  doc.rect(36, bannerY, 523, 40).fill(BG_LIGHT);
  doc.rect(36, bannerY, 523, 40).lineWidth(0.5).stroke(BORDER_COLOR);

  doc.fillColor(primaryColor)
    .font('Helvetica-Bold')
    .fontSize(15)
    .text('OFFICIAL PAYMENT RECEIPT', 48, bannerY + 12);

  // Large PAID circular badge / stamp on top right
  const paidBadgeX = 420;
  const paidBadgeY = bannerY + 6;
  doc.rect(paidBadgeX, paidBadgeY, 125, 28).fill('#ECFDF5');
  doc.rect(paidBadgeX, paidBadgeY, 125, 28).lineWidth(1.5).stroke(SUCCESS_COLOR);
  doc.fillColor(SUCCESS_COLOR)
    .font('Helvetica-Bold')
    .fontSize(13)
    .text('✓ PAID IN FULL', paidBadgeX, paidBadgeY + 7, { width: 125, align: 'center', characterSpacing: 1 });

  // 4. Receipt Metadata Box
  const metaY = bannerY + 50;
  const metaBoxW = 250;
  const metaBoxH = 68;

  // Left metadata: Receipt No & Dates
  doc.rect(36, metaY, metaBoxW, metaBoxH).fill(BG_LIGHT);
  doc.rect(36, metaY, metaBoxW, metaBoxH).lineWidth(0.5).stroke(BORDER_COLOR);

  doc.fillColor(TEXT_DARK)
    .font('Helvetica-Bold')
    .fontSize(8.5)
    .text(`Receipt Number: ${payment.receiptNumber || 'RCP-000000'}`, 48, metaY + 8)
    .font('Helvetica')
    .text(`Voucher / Challan: ${fee.challanNumber || fee.id?.slice(0, 8).toUpperCase() || '—'}`, 48, metaY + 24)
    .text(`Payment Date: ${formatKarachiDate(payment.createdAt || fee.paidDate || new Date(), 'full')}`, 48, metaY + 38)
    .text(`Payment Method: ${(payment.paymentMethod || 'Cash').toUpperCase()}`, 48, metaY + 52);

  // Right metadata: Student Details
  const studentBoxX = 36 + metaBoxW + 23;
  doc.rect(studentBoxX, metaY, metaBoxW, metaBoxH).fill(BG_LIGHT);
  doc.rect(studentBoxX, metaY, metaBoxW, metaBoxH).lineWidth(0.5).stroke(BORDER_COLOR);

  doc.fillColor(TEXT_DARK)
    .font('Helvetica-Bold')
    .fontSize(8.5)
    .text(`Student: ${(student.name || 'Student Name').toUpperCase()}`, studentBoxX + 12, metaY + 8)
    .font('Helvetica')
    .text(`Father Name: ${student.fatherName || '—'}`, studentBoxX + 12, metaY + 24)
    .text(`Roll No: ${student.rollNumber || '—'}   |   Class: ${student.class || 'FSC-I'}`, studentBoxX + 12, metaY + 38)
    .text(`Month / Term: ${fee.month || 'Current Month'}`, studentBoxX + 12, metaY + 52);

  // 5. Payment Breakdown Table
  let curY = metaY + metaBoxH + 18;
  const tableX = 36;
  const tableW = 523;

  doc.rect(tableX, curY, tableW, 20).fill(primaryColor);
  doc.fillColor('#FFFFFF')
    .font('Helvetica-Bold')
    .fontSize(8.5)
    .text('Fee Description', tableX + 12, curY + 6)
    .text('Billed (PKR)', tableX + 280, curY + 6, { width: 100, align: 'right' })
    .text('Settled (PKR)', tableX + 400, curY + 6, { width: 110, align: 'right' });

  curY += 20;

  const rows = [
    { desc: 'Tuition Fee', billed: Number(fee.tuitionFee || 0) },
    { desc: 'Laboratory Fee', billed: Number(fee.labFee || 0) },
    { desc: 'College Function & Activity Dues', billed: Number(fee.functionFee || 0) },
    { desc: 'Other Institutional Charges', billed: Number(fee.otherCharges || 0) },
    { desc: 'Late Fine / Penalties', billed: Number(fee.fine || 0) }
  ];

  rows.forEach((r, idx) => {
    const rowBg = idx % 2 === 0 ? BG_LIGHT : '#FFFFFF';
    doc.rect(tableX, curY, tableW, 18).fill(rowBg);
    doc.rect(tableX, curY, tableW, 18).lineWidth(0.25).stroke(BORDER_COLOR);

    doc.fillColor(TEXT_DARK)
      .font('Helvetica')
      .fontSize(8)
      .text(r.desc, tableX + 12, curY + 5)
      .text(r.billed.toLocaleString('en-PK'), tableX + 280, curY + 5, { width: 100, align: 'right' })
      .text(r.billed.toLocaleString('en-PK'), tableX + 400, curY + 5, { width: 110, align: 'right' });

    curY += 18;
  });

  // Scholarship row if any
  const scholarship = Number(fee.scholarshipDeduction || 0);
  if (scholarship > 0) {
    doc.rect(tableX, curY, tableW, 18).fill('#ECFDF5');
    doc.rect(tableX, curY, tableW, 18).lineWidth(0.25).stroke(BORDER_COLOR);
    doc.fillColor(SUCCESS_COLOR)
      .font('Helvetica-Bold')
      .fontSize(8)
      .text('Less: Scholarship / Fee Concession', tableX + 12, curY + 5)
      .text(`- ${scholarship.toLocaleString('en-PK')}`, tableX + 280, curY + 5, { width: 100, align: 'right' })
      .text(`- ${scholarship.toLocaleString('en-PK')}`, tableX + 400, curY + 5, { width: 110, align: 'right' });
    curY += 18;
  }

  // Grand Total Settled Row
  const paidAmount = Number(payment.amount || fee.paidAmount || fee.totalAmount || 0);
  doc.rect(tableX, curY, tableW, 26).fill(BG_LIGHT);
  doc.rect(tableX, curY, tableW, 26).lineWidth(1).stroke(primaryColor);

  doc.fillColor(primaryColor)
    .font('Helvetica-Bold')
    .fontSize(10)
    .text('TOTAL AMOUNT PAID', tableX + 12, curY + 8)
    .fillColor(SUCCESS_COLOR)
    .fontSize(11)
    .text(`PKR ${paidAmount.toLocaleString('en-PK')}`, tableX + 380, curY + 7, { width: 130, align: 'right' });

  curY += 36;

  // 6. Transaction Reference & Verification Details
  doc.rect(tableX, curY, tableW, 40).fill(BG_LIGHT);
  doc.rect(tableX, curY, tableW, 40).lineWidth(0.5).stroke(BORDER_COLOR);

  const refNo = payment.referenceNumber || payment.idempotencyKey || 'DIRECT-BANK-SETTLEMENT';
  doc.fillColor(TEXT_DARK)
    .font('Helvetica-Bold')
    .fontSize(8)
    .text('Payment Verification Reference:', tableX + 12, curY + 8)
    .font('Helvetica')
    .text(`Transaction Reference: ${refNo}  |  Received By: ${payment.receivedBy || 'Accounts Department'}`, tableX + 12, curY + 22);

  // 7. QR Code for Verification
  const qrY = 650;
  const qrSize = 75;
  const qrBuffer = await generateQRBuffer(verifyUrl, 120);

  if (qrBuffer) {
    try {
      doc.image(qrBuffer, 48, qrY, { width: qrSize, height: qrSize });
    } catch {}
  }

  doc.fillColor(TEXT_MUTED)
    .font('Helvetica-Bold')
    .fontSize(7.5)
    .text('VERIFIED PAYMENT', 48, qrY + qrSize + 4, { width: qrSize, align: 'center' });

  doc.font('Helvetica')
    .fontSize(6.5)
    .text(verifyToken.slice(0, 12) + '...', 48, qrY + qrSize + 14, { width: qrSize, align: 'center' });

  // 8. Signature Block (Accountant Signature & Stamp)
  drawSignatureBlock(doc, [
    {
      title: 'Depositor / Student',
      subtitle: student.name || 'Verified'
    },
    {
      title: 'College Accountant',
      subtitle: 'Accounts & Finance Department',
      buffer: branding.signatures?.accountantBuffer
    }
  ], {
    startX: 160,
    y: 715,
    width: 395,
    stampBuffer: branding.stampBuffer
  });

  // 9. Watermark if sample or duplicate
  if (data.isDuplicate) {
    drawWatermark(doc, 'DUPLICATE');
  } else if (data.isSample) {
    drawWatermark(doc, 'SAMPLE RECEIPT');
  }

  // 10. Footer
  drawFooter(doc, branding, {
    startX: 36,
    width: 523,
    bottomY: 805,
    verifyUrl
  });

  return doc;
}

module.exports = {
  generatePaidReceiptPDF
};
