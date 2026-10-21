/**
 * Document Templates: Fee Voucher & Bank Challan Generator
 * ──────────────────────────────────────────────────────────
 * Generates official 3-copy bank challans / fee vouchers on a single A4 page:
 * - Copy 1: Bank Copy
 * - Copy 2: College Copy
 * - Copy 3: Student Copy
 *
 * Supported Modes:
 * - Branded Layout (Feature: 'doc-templates' active): Rich collegiate headers,
 *   primary theme colors, QR code verification, bank account details.
 * - Plain Fallback Layout (Feature: 'fees-basic' without 'doc-templates'):
 *   Clean monochrome tables, standard typography, no branding.
 */

const PDFDocument = require('pdfkit');
const {
  DEFAULT_PRIMARY,
  TEXT_DARK,
  TEXT_MUTED,
  BORDER_COLOR,
  BG_LIGHT,
  SUCCESS_COLOR,
  DANGER_COLOR,
  generateQRBuffer,
  formatKarachiDate,
  generateVerifyToken,
  drawWatermark
} = require('./shared');

/**
 * Generate a 3-Copy Fee Voucher / Bank Challan PDF
 *
 * @param {Object} data
 * @param {Object} data.fee - Fee record
 * @param {Object} data.student - Student record
 * @param {Object} data.college - College record
 * @param {Object} data.branding - Branding details
 * @param {Boolean} data.docTemplatesEnabled - Flag whether 'doc-templates' is active
 * @param {String} data.verifyBaseUrl - Base URL for public verification
 * @returns {PDFDocument} PDFKit document stream
 */
async function generateFeeVoucherPDF(data) {
  const {
    fee = {},
    student = {},
    college = {},
    branding = {},
    docTemplatesEnabled = true,
    verifyBaseUrl = 'https://cesms.edu.pk'
  } = data;

  // A4 Landscape: 841.89 x 595.28 pt
  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margins: { top: 18, bottom: 18, left: 18, right: 18 },
    info: {
      Title: `FEE CHALLAN - ${student.rollNumber || ''} - ${fee.month || ''}`,
      Author: college.name || 'CESMS',
      Subject: 'Fee Voucher & Bank Challan'
    }
  });

  const primaryColor = docTemplatesEnabled ? (branding.primaryColor || DEFAULT_PRIMARY) : '#334155';
  const verifyToken = fee.verifyToken || generateVerifyToken();
  const verifyUrl = `${verifyBaseUrl.replace(/\/+$/, '')}/verify/${verifyToken}`;
  const qrBuffer = await generateQRBuffer(verifyUrl, 80);

  const copies = [
    { title: 'BANK COPY', subtitle: 'To be retained by receiving bank branch' },
    { title: 'COLLEGE COPY', subtitle: 'To be submitted to college accounts office' },
    { title: 'STUDENT COPY', subtitle: 'To be preserved by student for records' }
  ];

  const pageWidth = 841.89;
  const pageHeight = 595.28;
  const marginX = 18;
  const marginY = 18;
  const usableWidth = pageWidth - marginX * 2; // 805.89 pt
  const panelGap = 12;
  const colWidth = (usableWidth - panelGap * 2) / 3; // ~260.6 pt each

  // Draw 3 columns
  copies.forEach((copyInfo, idx) => {
    const colX = marginX + idx * (colWidth + panelGap);
    drawChallanColumn(doc, {
      x: colX,
      y: marginY,
      width: colWidth,
      height: pageHeight - marginY * 2,
      copyInfo,
      fee,
      student,
      college,
      branding,
      primaryColor,
      docTemplatesEnabled,
      verifyToken,
      qrBuffer
    });

    // Draw dashed cutting separator between panels
    if (idx < 2) {
      const cutX = colX + colWidth + panelGap / 2;
      doc.save();
      doc.moveTo(cutX, marginY + 10)
        .lineTo(cutX, pageHeight - marginY - 10)
        .lineWidth(0.6)
        .dash(4, { space: 4 })
        .stroke(BORDER_COLOR);
      doc.restore();
    }
  });

  // Watermark if fee is void or cancelled
  if (fee.status === 'void' || fee.status === 'cancelled') {
    drawWatermark(doc, 'VOID');
  }

  return doc;
}

/**
 * Render one copy column of the Challan
 */
function drawChallanColumn(doc, p) {
  const {
    x, y, width, height, copyInfo,
    fee, student, college, branding,
    primaryColor, docTemplatesEnabled,
    verifyToken, qrBuffer
  } = p;

  // Outer border of copy
  doc.rect(x, y, width, height).lineWidth(0.75).stroke(primaryColor);

  let curY = y + 4;

  // 1. Copy Badge header
  doc.rect(x + 2, curY, width - 4, 18).fill(docTemplatesEnabled ? primaryColor : '#E2E8F0');
  doc.fillColor(docTemplatesEnabled ? '#FFFFFF' : '#0F172A')
    .font('Helvetica-Bold')
    .fontSize(8.5)
    .text(copyInfo.title, x, curY + 4, { width, align: 'center', characterSpacing: 1 });

  curY += 22;

  // 2. College Name & Details
  doc.fillColor(primaryColor)
    .font('Helvetica-Bold')
    .fontSize(10)
    .text((college.name || 'ACADEMIX INTERMEDIATE COLLEGE').toUpperCase(), x + 6, curY, {
      width: width - 12,
      align: 'center'
    });

  curY = doc.y + 2;
  doc.fillColor(TEXT_MUTED)
    .font('Helvetica')
    .fontSize(6.5)
    .text(college.city ? `${college.city}, Pakistan` : 'Main Campus', x + 6, curY, { width: width - 12, align: 'center' });

  curY = doc.y + 4;
  doc.moveTo(x + 10, curY).lineTo(x + width - 10, curY).lineWidth(0.5).stroke(BORDER_COLOR);
  curY += 4;

  // 3. Bank Account Information (from College.settings or defaults)
  const bankSettings = college.settings?.bankAccounts?.[0] || college.settings?.paymentAccounts?.[0] || {
    bankName: 'Habib Bank Limited (HBL)',
    title: college.name || 'Academix Intermediate College',
    accountNumber: '0042-790123456703',
    branch: 'College Campus Branch (0142)'
  };

  doc.rect(x + 6, curY, width - 12, 28).fill(BG_LIGHT);
  doc.rect(x + 6, curY, width - 12, 28).lineWidth(0.4).stroke(BORDER_COLOR);

  doc.fillColor(TEXT_DARK)
    .font('Helvetica-Bold')
    .fontSize(7)
    .text(bankSettings.bankName || 'DESIGNATED BANK BRANCH', x + 10, curY + 3, { width: width - 20 });

  doc.font('Helvetica')
    .fontSize(6.5)
    .text(`A/C Title: ${(bankSettings.title || college.name || '').slice(0, 34)}`, x + 10, curY + 12)
    .text(`A/C No: ${bankSettings.accountNumber || '0042-7901234567'}`, x + 10, curY + 20);

  curY += 32;

  // 4. Challan Metadata (Challan No, Issue Date, Due Date)
  const challanNo = fee.challanNumber || `CH-${fee.id?.slice(0, 8).toUpperCase() || '00000'}`;
  const issueDateStr = formatKarachiDate(fee.createdAt || new Date(), 'date');
  const dueDateStr = formatKarachiDate(fee.dueDate || new Date(), 'date');

  doc.fillColor(TEXT_DARK)
    .font('Helvetica-Bold')
    .fontSize(7.5)
    .text(`Challan No: ${challanNo}`, x + 6, curY);

  curY = doc.y + 2;
  doc.font('Helvetica')
    .fontSize(7)
    .text(`Issue Date: ${issueDateStr}`, x + 6, curY)
    .fillColor(DANGER_COLOR)
    .font('Helvetica-Bold')
    .text(`Due Date: ${dueDateStr}`, x + width / 2, curY, { width: width / 2 - 8, align: 'right' });

  curY = doc.y + 4;
  doc.moveTo(x + 6, curY).lineTo(x + width - 6, curY).lineWidth(0.5).stroke(BORDER_COLOR);
  curY += 4;

  // 5. Student Credentials
  doc.fillColor(TEXT_DARK).font('Helvetica-Bold').fontSize(7.5);
  doc.text(`Student: ${(student.name || 'Student Name').toUpperCase()}`, x + 6, curY);

  curY = doc.y + 1;
  doc.font('Helvetica').fontSize(7);
  doc.text(`Father Name: ${student.fatherName || '—'}`, x + 6, curY);

  curY = doc.y + 1;
  doc.text(`Roll No: ${student.rollNumber || '—'}`, x + 6, curY);
  doc.text(`Class: ${student.class || 'FSC-I'} (${student.section || 'A'})`, x + width / 2, curY, { width: width / 2 - 8, align: 'right' });

  curY = doc.y + 1;
  doc.text(`Month / Session: ${fee.month || 'Current Month'}`, x + 6, curY);

  curY = doc.y + 4;

  // 6. Fee Heads Breakdown Table
  const tableX = x + 6;
  const tableWidth = width - 12;
  const headColW = tableWidth * 0.65;
  const amtColW = tableWidth * 0.35;

  doc.rect(tableX, curY, tableWidth, 14).fill(docTemplatesEnabled ? primaryColor : '#CBD5E1');
  doc.fillColor(docTemplatesEnabled ? '#FFFFFF' : '#0F172A')
    .font('Helvetica-Bold')
    .fontSize(7)
    .text('Fee Description', tableX + 4, curY + 3)
    .text('Amount (PKR)', tableX + headColW, curY + 3, { width: amtColW - 4, align: 'right' });

  curY += 14;

  const feeItems = [
    { label: 'Tuition Fee', amt: Number(fee.tuitionFee || 0) },
    { label: 'Laboratory Charges', amt: Number(fee.labFee || 0) },
    { label: 'College Function / Activities', amt: Number(fee.functionFee || 0) },
    { label: 'Other College Charges', amt: Number(fee.otherCharges || 0) },
    { label: 'Late Fine / Disciplinary', amt: Number(fee.fine || 0) }
  ];

  const scholarship = Number(fee.scholarshipDeduction || 0);

  feeItems.forEach((item, rIdx) => {
    const rowBg = rIdx % 2 === 0 ? BG_LIGHT : '#FFFFFF';
    doc.rect(tableX, curY, tableWidth, 12).fill(rowBg);
    doc.rect(tableX, curY, tableWidth, 12).lineWidth(0.25).stroke(BORDER_COLOR);

    doc.fillColor(TEXT_DARK)
      .font('Helvetica')
      .fontSize(6.5)
      .text(item.label, tableX + 4, curY + 2.5)
      .text(item.amt.toLocaleString('en-PK'), tableX + headColW, curY + 2.5, { width: amtColW - 4, align: 'right' });

    curY += 12;
  });

  if (scholarship > 0) {
    doc.rect(tableX, curY, tableWidth, 12).fill('#ECFDF5');
    doc.rect(tableX, curY, tableWidth, 12).lineWidth(0.25).stroke(BORDER_COLOR);
    doc.fillColor(SUCCESS_COLOR)
      .font('Helvetica-Bold')
      .fontSize(6.5)
      .text('Less: Scholarship / Concession', tableX + 4, curY + 2.5)
      .text(`- ${scholarship.toLocaleString('en-PK')}`, tableX + headColW, curY + 2.5, { width: amtColW - 4, align: 'right' });
    curY += 12;
  }

  // Total Amount Row
  const totalAmount = Number(fee.totalAmount || 0);
  doc.rect(tableX, curY, tableWidth, 16).fill(BG_LIGHT);
  doc.rect(tableX, curY, tableWidth, 16).lineWidth(0.75).stroke(primaryColor);

  doc.fillColor(primaryColor)
    .font('Helvetica-Bold')
    .fontSize(8)
    .text('TOTAL AMOUNT DUE', tableX + 4, curY + 4)
    .text(`PKR ${totalAmount.toLocaleString('en-PK')}`, tableX + headColW, curY + 4, { width: amtColW - 4, align: 'right' });

  curY += 20;

  // 7. QR Code & Verify URL hint
  const qrSize = 48;
  const qrX = x + 8;
  if (qrBuffer) {
    try {
      doc.image(qrBuffer, qrX, curY, { width: qrSize, height: qrSize });
    } catch {}
  }

  const qrTextX = qrX + qrSize + 6;
  const qrTextW = width - (qrSize + 20);

  doc.fillColor(TEXT_MUTED)
    .font('Helvetica-Bold')
    .fontSize(6.5)
    .text('VERIFY AUTHENTICITY', qrTextX, curY + 4)
    .font('Helvetica')
    .fontSize(5.5)
    .text('Scan QR or visit public verify page:', qrTextX, curY + 14)
    .text(`Token: ${(verifyToken || '').slice(0, 14)}...`, qrTextX, curY + 23, { width: qrTextW });

  curY += qrSize + 8;

  // 8. Signature Blocks at the bottom of panel
  const sigY = height + y - 40;
  const halfCol = (width - 24) / 2;

  doc.moveTo(x + 10, sigY).lineTo(x + 10 + halfCol, sigY).lineWidth(0.5).stroke(BORDER_COLOR);
  doc.moveTo(x + 14 + halfCol, sigY).lineTo(x + width - 10, sigY).lineWidth(0.5).stroke(BORDER_COLOR);

  doc.fillColor(TEXT_MUTED)
    .font('Helvetica')
    .fontSize(6)
    .text('Depositor Signature', x + 10, sigY + 3, { width: halfCol, align: 'center' })
    .text('Authorized Bank Cashier', x + 14 + halfCol, sigY + 3, { width: halfCol, align: 'center' });

  // Micro bottom notice
  doc.fontSize(5.5).text(copyInfo.subtitle, x + 6, height + y - 10, { width: width - 12, align: 'center' });
}

module.exports = {
  generateFeeVoucherPDF
};
