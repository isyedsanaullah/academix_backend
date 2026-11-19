'use strict';

/**
 * Document Templates: 3-Copy Subscription Payment Voucher (UBL Bank Transfer)
 * ───────────────────────────────────────────────────────────────────────────
 * Generates ONE PDF containing 3 copies:
 *   1. BANK COPY
 *   2. COLLEGE COPY
 *   3. ACCOUNTS / OFFICE COPY
 *
 * Layout:
 *   - <= 5 line items: 3 side-by-side columns on A4 Landscape (matching Pakistani bank challans).
 *   - > 5 line items: 3 crisp full-width A4 Portrait pages (1 copy per page) so zero rows clip.
 */

const PDFDocument = require('pdfkit');
const {
  TEXT_DARK,
  TEXT_MUTED,
  BORDER_COLOR,
  BG_LIGHT,
  SUCCESS_COLOR,
  DANGER_COLOR,
  generateQRBuffer,
  formatKarachiDate,
  generateVerifyToken,
} = require('./shared');
const { BANK_DETAILS } = require('../../config/billingConfig');
const { getFrontendBaseUrl } = require('../../config/env');

const BRAND_BLUE = '#0A4D94';
const BRAND_GREEN = '#299A49';

const COPIES = [
  { title: 'BANK COPY', subtitle: 'To be retained by UBL branch' },
  { title: 'COLLEGE COPY', subtitle: 'To be retained by college administration' },
  { title: 'ACCOUNTS / OFFICE COPY', subtitle: 'For CollegesHub Accounts reconciliation' },
];

function formatPkr(val) {
  const num = Number(val || 0);
  const abs = Math.abs(num).toLocaleString('en-PK');
  return num < 0 ? `- PKR ${abs}` : `PKR ${abs}`;
}

function normalizeInvoiceLineItems(invoice) {
  if (Array.isArray(invoice.lineItems) && invoice.lineItems.length > 0) {
    return invoice.lineItems;
  }
  const planName = invoice.planId
    ? `${invoice.planId.charAt(0).toUpperCase() + invoice.planId.slice(1)} Plan`
    : 'Subscription Plan';
  return [
    {
      name: `${planName} (${invoice.billingCycle || 'MONTHLY'})`,
      quantity: 1,
      subtotalPkr: Number(invoice.amount || 0),
      status: String(invoice.status || 'UNPAID').toUpperCase(),
    },
  ];
}

function getDisplayRowStatus(invoiceStatus, itemStatus) {
  const inv = String(invoiceStatus || 'UNPAID').toUpperCase();
  if (itemStatus === 'APPLIED') return 'APPLIED';
  if (inv === 'APPROVED' || inv === 'PAID') return 'PAID';
  if (inv === 'PENDING_REVIEW') return 'PENDING';
  if (inv === 'REJECTED') return 'REJECTED';
  if (inv === 'VOID') return 'VOID';
  return 'UNPAID';
}

function drawVoucherBlock(doc, { x, y, width, height, copyInfo, invoice, college, bank, items, qrBuffer, verifyUrl, compact }) {
  const invoiceStatus = String(invoice.status || 'UNPAID').toUpperCase();
  const isPaid = invoiceStatus === 'APPROVED' || invoiceStatus === 'PAID';
  const statusColor = isPaid ? BRAND_GREEN : DANGER_COLOR;
  const issueDateStr = formatKarachiDate(invoice.createdAt || new Date(), 'date');
  const dueDateStr = formatKarachiDate(invoice.dueDate || invoice.periodEnd || new Date(), 'date');
  const totalPkr = Number(invoice.amount || 0);
  const purposeText = invoice.purpose || `Academix subscription - ${(invoice.planId || 'Standard').toUpperCase()} - ${invoice.billingCycle || 'MONTHLY'}`;

  // Outer card border
  doc.rect(x, y, width, height).lineWidth(0.9).stroke(BRAND_BLUE);

  let curY = y + 4;

  // 1. Copy Header Bar
  doc.rect(x + 2, curY, width - 4, compact ? 18 : 24).fill(BRAND_BLUE);
  doc.fillColor('#FFFFFF')
    .font('Helvetica-Bold')
    .fontSize(compact ? 8 : 10)
    .text(copyInfo.title, x + 6, curY + (compact ? 4 : 6), {
      width: width - 12,
      align: 'center',
      characterSpacing: 0.8,
    });

  curY += compact ? 22 : 30;

  // 2. CollegesHub Brand & Voucher Header
  doc.fillColor(BRAND_BLUE)
    .font('Helvetica-Bold')
    .fontSize(compact ? 9.5 : 12)
    .text('COLLEGESHUB / ACADEMIX', x + 8, curY, { width: width - 16, align: 'center' });
  curY = doc.y + 1;
  doc.fillColor(BRAND_GREEN)
    .font('Helvetica-Bold')
    .fontSize(compact ? 6.5 : 8)
    .text('SUBSCRIPTION BANK PAYMENT VOUCHER', x + 8, curY, { width: width - 16, align: 'center' });

  curY = doc.y + 4;
  doc.moveTo(x + 8, curY).lineTo(x + width - 8, curY).lineWidth(0.5).stroke(BORDER_COLOR);
  curY += 5;

  // 3. Voucher No + Dates + Overall Status
  doc.fillColor(TEXT_DARK)
    .font('Helvetica-Bold')
    .fontSize(compact ? 7.5 : 9)
    .text(`Voucher / Invoice No: ${invoice.invoiceNo || 'INV-0000'}`, x + 8, curY, { width: width - 16 });
  curY = doc.y + 2;

  doc.font('Helvetica')
    .fontSize(compact ? 6.8 : 8.5)
    .fillColor(TEXT_DARK)
    .text(`Issue Date: ${issueDateStr}`, x + 8, curY)
    .fillColor(DANGER_COLOR)
    .font('Helvetica-Bold')
    .text(`Due Date: ${dueDateStr}`, x + 8, curY, { width: width - 16, align: 'right' });

  curY = doc.y + 5;

  // 4. Bank Box (UBL)
  const bankBoxH = compact ? 42 : 54;
  doc.rect(x + 8, curY, width - 16, bankBoxH).fill(BG_LIGHT);
  doc.rect(x + 8, curY, width - 16, bankBoxH).lineWidth(0.5).stroke(BORDER_COLOR);

  doc.fillColor(BRAND_BLUE)
    .font('Helvetica-Bold')
    .fontSize(compact ? 7.2 : 9)
    .text(`Bank: ${bank.bankName}`, x + 12, curY + 4, { width: width - 24 });

  doc.fillColor(TEXT_DARK)
    .font('Helvetica')
    .fontSize(compact ? 6.5 : 8)
    .text(`Account Title: ${bank.accountTitle}`, x + 12, curY + (compact ? 14 : 17), { width: width - 24 })
    .text(`Account No: ${bank.accountNumber}`, x + 12, curY + (compact ? 23 : 29), { width: width - 24 })
    .text(`IBAN: ${bank.iban || '—'}`, x + 12, curY + (compact ? 32 : 41), { width: width - 24 });

  curY += bankBoxH + 6;

  // 5. College & Purpose
  doc.fillColor(TEXT_MUTED)
    .font('Helvetica-Bold')
    .fontSize(compact ? 6.5 : 8)
    .text('PAYING INSTITUTION', x + 8, curY);
  curY = doc.y + 1;

  doc.fillColor(TEXT_DARK)
    .font('Helvetica-Bold')
    .fontSize(compact ? 8 : 10)
    .text(`${college?.name || 'Institution'}${college?.code ? ` (${college.code})` : ''}`, x + 8, curY, {
      width: width - 16,
    });
  curY = doc.y + 3;

  doc.fillColor(TEXT_MUTED)
    .font('Helvetica-Bold')
    .fontSize(compact ? 6.5 : 8)
    .text('PURPOSE', x + 8, curY);
  curY = doc.y + 1;

  doc.fillColor(TEXT_DARK)
    .font('Helvetica')
    .fontSize(compact ? 6.8 : 8.5)
    .text(purposeText, x + 8, curY, { width: width - 16 });
  curY = doc.y + 6;

  // 6. Line-Item Table (Item | Qty | Status | Amount)
  const tableX = x + 8;
  const tableW = width - 16;
  const itemW = tableW * 0.48;
  const qtyW = tableW * 0.10;
  const statusW = tableW * 0.18;
  const amtW = tableW * 0.24;

  const headerH = compact ? 14 : 18;
  doc.rect(tableX, curY, tableW, headerH).fill(BRAND_BLUE);
  doc.fillColor('#FFFFFF')
    .font('Helvetica-Bold')
    .fontSize(compact ? 6.3 : 8)
    .text('Description', tableX + 4, curY + (compact ? 3.5 : 5), { width: itemW - 4 })
    .text('Qty', tableX + itemW, curY + (compact ? 3.5 : 5), { width: qtyW, align: 'center' })
    .text('Status', tableX + itemW + qtyW, curY + (compact ? 3.5 : 5), { width: statusW, align: 'center' })
    .text('Amount', tableX + itemW + qtyW + statusW, curY + (compact ? 3.5 : 5), { width: amtW - 4, align: 'right' });

  curY += headerH;

  items.forEach((item, idx) => {
    const rowLabel = item.name || item.addonType || 'Subscription';
    const rowQty = item.quantity ?? 1;
    const rowStatus = getDisplayRowStatus(invoiceStatus, item.status);
    const rowAmt = item.subtotalPkr ?? item.subtotal ?? 0;
    const rowH = compact ? 18 : 22;

    doc.rect(tableX, curY, tableW, rowH).fill(idx % 2 === 0 ? BG_LIGHT : '#FFFFFF');
    doc.rect(tableX, curY, tableW, rowH).lineWidth(0.3).stroke(BORDER_COLOR);

    doc.fillColor(TEXT_DARK)
      .font('Helvetica')
      .fontSize(compact ? 6.2 : 7.8)
      .text(rowLabel, tableX + 4, curY + 3, { width: itemW - 6, height: rowH - 4, ellipsis: true });

    doc.fillColor(TEXT_DARK)
      .text(String(rowQty), tableX + itemW, curY + 4, { width: qtyW, align: 'center' });

    doc.fillColor(rowStatus === 'PAID' || rowStatus === 'APPLIED' ? SUCCESS_COLOR : DANGER_COLOR)
      .font('Helvetica-Bold')
      .fontSize(compact ? 6 : 7.5)
      .text(rowStatus, tableX + itemW + qtyW, curY + 4, { width: statusW, align: 'center' });

    doc.fillColor(TEXT_DARK)
      .font('Helvetica-Bold')
      .fontSize(compact ? 6.2 : 7.8)
      .text(formatPkr(rowAmt), tableX + itemW + qtyW + statusW, curY + 4, { width: amtW - 4, align: 'right' });

    curY += rowH;
  });

  // Total Row
  const totalH = compact ? 18 : 22;
  doc.rect(tableX, curY, tableW, totalH).fill('#EFF6FF');
  doc.rect(tableX, curY, tableW, totalH).lineWidth(0.8).stroke(BRAND_BLUE);
  doc.fillColor(BRAND_BLUE)
    .font('Helvetica-Bold')
    .fontSize(compact ? 7.5 : 9.5)
    .text(`TOTAL (${invoiceStatus})`, tableX + 4, curY + (compact ? 4.5 : 6), { width: itemW + qtyW + statusW - 4 })
    .fillColor(statusColor)
    .text(formatPkr(totalPkr), tableX + itemW + qtyW, curY + (compact ? 4.5 : 6), { width: statusW + amtW - 4, align: 'right' });

  curY += totalH + 8;

  // 7. QR Code & Verification Hint
  const qrSize = compact ? 42 : 58;
  if (qrBuffer) {
    try {
      doc.image(qrBuffer, x + 8, curY, { width: qrSize, height: qrSize });
    } catch {}
  }
  doc.fillColor(TEXT_MUTED)
    .font('Helvetica-Bold')
    .fontSize(compact ? 6.2 : 7.5)
    .text('PAYMENT INSTRUCTIONS', x + 14 + qrSize, curY + 2, { width: width - qrSize - 24 })
    .font('Helvetica')
    .fontSize(compact ? 5.8 : 7.2)
    .text('Deposit via UBL branch / online transfer, then upload receipt screenshot in your CollegesHub portal.', x + 14 + qrSize, doc.y + 1, {
      width: width - qrSize - 24,
    })
    .text(`Verify: ${verifyUrl.slice(0, 44)}`, x + 14 + qrSize, doc.y + 2, { width: width - qrSize - 24 });

  // 8. Signatures at bottom
  const sigY = y + height - (compact ? 32 : 44);
  const halfCol = (width - 28) / 2;
  doc.moveTo(x + 10, sigY).lineTo(x + 10 + halfCol, sigY).lineWidth(0.5).stroke(BORDER_COLOR);
  doc.moveTo(x + 18 + halfCol, sigY).lineTo(x + width - 10, sigY).lineWidth(0.5).stroke(BORDER_COLOR);
  doc.fillColor(TEXT_MUTED)
    .font('Helvetica')
    .fontSize(compact ? 5.8 : 7.2)
    .text('Depositor Signature', x + 10, sigY + 3, { width: halfCol, align: 'center' })
    .text('Bank Stamp & Signature', x + 18 + halfCol, sigY + 3, { width: halfCol, align: 'center' });

  doc.fontSize(compact ? 5.5 : 7).text(copyInfo.subtitle, x + 8, y + height - 11, {
    width: width - 16,
    align: 'center',
  });
}

/**
 * Generate a 3-copy Subscription Bank Voucher PDF (Bank Copy, College Copy, Accounts/Office Copy).
 * @returns {Promise<PDFDocument>}
 */
async function generateSubscriptionVoucherPDF({ invoice = {}, college = {}, verifyBaseUrl } = {}) {
  const bank = invoice.bankDetailsSnapshot && typeof invoice.bankDetailsSnapshot === 'object'
    ? { ...BANK_DETAILS, ...invoice.bankDetailsSnapshot }
    : BANK_DETAILS;
  const items = normalizeInvoiceLineItems(invoice);
  const verifyToken = invoice.verifyToken || generateVerifyToken();
  const baseUrl = (verifyBaseUrl || getFrontendBaseUrl()).replace(/\/+$/, '');
  const verifyUrl = `${baseUrl}/verify/${verifyToken}`;
  const qrBuffer = await generateQRBuffer(verifyUrl, 90);

  const useLandscapeSinglePage = items.length <= 5;

  const doc = new PDFDocument({
    size: 'A4',
    layout: useLandscapeSinglePage ? 'landscape' : 'portrait',
    margins: { top: 18, bottom: 18, left: 18, right: 18 },
    info: {
      Title: `Subscription Voucher - ${invoice.invoiceNo || 'INV'} - ${college?.name || 'College'}`,
      Author: 'CollegesHub Billing',
      Subject: invoice.purpose || 'Academix Subscription Payment Voucher',
    },
  });

  if (useLandscapeSinglePage) {
    const pageWidth = 841.89;
    const pageHeight = 595.28;
    const marginX = 18;
    const marginY = 18;
    const usableWidth = pageWidth - marginX * 2;
    const gap = 12;
    const colW = (usableWidth - gap * 2) / 3;

    COPIES.forEach((copyInfo, idx) => {
      const colX = marginX + idx * (colW + gap);
      drawVoucherBlock(doc, {
        x: colX,
        y: marginY,
        width: colW,
        height: pageHeight - marginY * 2,
        copyInfo,
        invoice,
        college,
        bank,
        items,
        qrBuffer,
        verifyUrl,
        compact: true,
      });

      if (idx < 2) {
        const cutX = colX + colW + gap / 2;
        doc.save();
        doc.moveTo(cutX, marginY + 8)
          .lineTo(cutX, pageHeight - marginY - 8)
          .lineWidth(0.6)
          .dash(4, { space: 4 })
          .stroke(BORDER_COLOR);
        doc.restore();
      }
    });
  } else {
    // Multi-page portrait (1 full copy per page) when there are many add-on rows
    COPIES.forEach((copyInfo, idx) => {
      if (idx > 0) doc.addPage();
      drawVoucherBlock(doc, {
        x: 32,
        y: 32,
        width: 595.28 - 64,
        height: 841.89 - 64,
        copyInfo,
        invoice,
        college,
        bank,
        items,
        qrBuffer,
        verifyUrl,
        compact: false,
      });
    });
  }

  return doc;
}

module.exports = {
  generateSubscriptionVoucherPDF,
  COPIES,
};
