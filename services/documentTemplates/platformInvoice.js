/**
 * Document Templates: Super Admin Platform Invoices & Paid Receipts
 * ──────────────────────────────────────────────────────────────────
 * Generates official B2B platform subscription invoices and paid receipts
 * issued by the Super Admin to tenant colleges using the unified template system.
 */

const PDFDocument = require('pdfkit');
const {
  DEFAULT_ACCENT,
  TEXT_DARK,
  TEXT_MUTED,
  BORDER_COLOR,
  BG_LIGHT,
  SUCCESS_COLOR,
  DANGER_COLOR,
  generateQRBuffer,
  formatKarachiDate,
  generateVerifyToken,
  drawWatermark,
  drawSignatureBlock,
  drawFooter
} = require('./shared');

const PLATFORM_BRANDING = {
  name: 'ACADEMIX ENTERPRISE CLOUD',
  tagline: 'College & Enterprise Student Management Infrastructure (CESMS)',
  address: 'National Technology Park, Sector G-10, Islamabad, Pakistan',
  phone: '+92 51 8800100',
  email: 'billing@cesms.edu.pk',
  website: 'https://cesms.edu.pk',
  primaryColor: '#0F172A', // Sleek Executive Slate 900
  accentColor: '#F59E0B'   // Amber 500
};

/**
 * Generate Platform Invoice PDF (or Paid Receipt if isPaid = true)
 *
 * @param {Object} data
 * @param {Object} data.invoice - PlatformInvoice record
 * @param {Object} data.college - Target College record
 * @param {Boolean} data.isPaid - True for paid receipt layout
 * @param {Object} data.branding - Optional platform branding overrides
 * @param {String} data.verifyBaseUrl - Base URL for public verification
 * @returns {PDFDocument} PDFKit document stream
 */
async function generatePlatformInvoicePDF(data) {
  const {
    invoice = {},
    college = {},
    isPaid = invoice.status === 'paid',
    branding = {},
    verifyBaseUrl = 'https://cesms.edu.pk'
  } = data;

  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 36, bottom: 36, left: 36, right: 36 },
    info: {
      Title: `${isPaid ? 'PAID RECEIPT' : 'SUBSCRIPTION INVOICE'} - ${invoice.invoiceNo || 'INV'} - ${college.name || ''}`,
      Author: 'Academix Cloud Platform',
      Subject: 'Platform Subscription Billing'
    }
  });

  const primaryColor = branding.primaryColor || PLATFORM_BRANDING.primaryColor;
  const accentColor = branding.accentColor || PLATFORM_BRANDING.accentColor;
  const verifyToken = invoice.verifyToken || generateVerifyToken();
  const verifyUrl = `${verifyBaseUrl.replace(/\/+$/, '')}/verify/${verifyToken}`;

  // 1. Double border
  doc.rect(24, 24, 547, 794).lineWidth(1.5).stroke(primaryColor);
  doc.rect(28, 28, 539, 786).lineWidth(0.5).stroke(accentColor);

  // 2. Platform Header
  const startX = 36;
  const startY = 36;
  const width = 523;

  doc.rect(startX, startY, width, 5).fill(accentColor);

  const headerY = startY + 14;
  doc.fillColor(primaryColor)
    .font('Helvetica-Bold')
    .fontSize(16)
    .text(PLATFORM_BRANDING.name, startX, headerY);

  doc.fillColor(TEXT_MUTED)
    .font('Helvetica')
    .fontSize(8)
    .text(PLATFORM_BRANDING.tagline, startX, headerY + 18)
    .text(`${PLATFORM_BRANDING.address}  |  Tel: ${PLATFORM_BRANDING.phone}  |  Email: ${PLATFORM_BRANDING.email}`, startX, headerY + 30);

  const sepY = headerY + 46;
  doc.moveTo(startX, sepY).lineTo(startX + width, sepY).lineWidth(0.75).stroke(BORDER_COLOR);

  // 3. Document Title & Status Banner
  const bannerY = sepY + 12;
  doc.rect(startX, bannerY, width, 36).fill(BG_LIGHT);
  doc.rect(startX, bannerY, width, 36).lineWidth(0.5).stroke(BORDER_COLOR);

  const docTitle = isPaid ? 'PLATFORM SUBSCRIPTION RECEIPT' : 'PLATFORM SUBSCRIPTION INVOICE';
  doc.fillColor(primaryColor)
    .font('Helvetica-Bold')
    .fontSize(13)
    .text(docTitle, startX + 12, bannerY + 11);

  if (isPaid) {
    const badgeW = 110;
    doc.rect(startX + width - badgeW - 12, bannerY + 6, badgeW, 24).fill('#ECFDF5');
    doc.rect(startX + width - badgeW - 12, bannerY + 6, badgeW, 24).lineWidth(1).stroke(SUCCESS_COLOR);
    doc.fillColor(SUCCESS_COLOR)
      .font('Helvetica-Bold')
      .fontSize(11)
      .text('✓ PAID', startX + width - badgeW - 12, bannerY + 12, { width: badgeW, align: 'center' });
  } else {
    const badgeW = 110;
    doc.rect(startX + width - badgeW - 12, bannerY + 6, badgeW, 24).fill('#FEF2F2');
    doc.rect(startX + width - badgeW - 12, bannerY + 6, badgeW, 24).lineWidth(1).stroke('#EF4444');
    doc.fillColor('#DC2626')
      .font('Helvetica-Bold')
      .fontSize(11)
      .text('DUE FOR PAYMENT', startX + width - badgeW - 12, bannerY + 12, { width: badgeW, align: 'center' });
  }

  // 4. Two-Column Metadata Box: Invoice Info & College Info
  const boxY = bannerY + 48;
  const colW = (width - 20) / 2;
  const boxH = 80;

  // Left: Invoice Specs
  doc.rect(startX, boxY, colW, boxH).fill(BG_LIGHT);
  doc.rect(startX, boxY, colW, boxH).lineWidth(0.5).stroke(BORDER_COLOR);

  doc.fillColor(primaryColor)
    .font('Helvetica-Bold')
    .fontSize(8.5)
    .text('INVOICE DETAILS', startX + 10, boxY + 8);

  doc.fillColor(TEXT_DARK)
    .font('Helvetica')
    .fontSize(8)
    .text(`Invoice Number: ${invoice.invoiceNo || 'INV-000000'}`, startX + 10, boxY + 24)
    .text(`Issue Date: ${formatKarachiDate(invoice.createdAt || new Date(), 'date')}`, startX + 10, boxY + 38)
    .text(`Billing Period: ${formatKarachiDate(invoice.periodStart, 'date')} - ${formatKarachiDate(invoice.periodEnd, 'date')}`, startX + 10, boxY + 52)
    .text(`Subscription Plan: ${(invoice.planId || college.subscription?.plan || 'Standard').toUpperCase()}`, startX + 10, boxY + 66);

  // Right: Billed Institution
  const rightX = startX + colW + 20;
  doc.rect(rightX, boxY, colW, boxH).fill(BG_LIGHT);
  doc.rect(rightX, boxY, colW, boxH).lineWidth(0.5).stroke(BORDER_COLOR);

  doc.fillColor(primaryColor)
    .font('Helvetica-Bold')
    .fontSize(8.5)
    .text('BILLED TO (INSTITUTION)', rightX + 10, boxY + 8);

  doc.fillColor(TEXT_DARK)
    .font('Helvetica')
    .fontSize(8)
    .text(`Institution: ${college.name || 'Tenant College'}`, rightX + 10, boxY + 24)
    .text(`College Code: ${college.code || '—'}   |   City: ${college.city || '—'}`, rightX + 10, boxY + 38)
    .text(`Billing Contact: ${college.email || '—'}`, rightX + 10, boxY + 52)
    .text(`Campus Address: ${(college.address || 'Pakistan').slice(0, 36)}`, rightX + 10, boxY + 66);

  // 5. Line Item Billing Table
  let curY = boxY + boxH + 18;

  doc.rect(startX, curY, width, 22).fill(primaryColor);
  doc.fillColor('#FFFFFF')
    .font('Helvetica-Bold')
    .fontSize(8.5)
    .text('Item Description', startX + 12, curY + 6)
    .text('Period', startX + 280, curY + 6, { width: 110, align: 'center' })
    .text('Amount (PKR)', startX + 400, curY + 6, { width: 110, align: 'right' });

  curY += 22;

  const planName = (invoice.planId || college.subscription?.plan || 'Standard').toUpperCase();
  const periodText = `${formatKarachiDate(invoice.periodStart, 'date')} to ${formatKarachiDate(invoice.periodEnd, 'date')}`;
  const amount = Number(invoice.amount || 0);

  doc.rect(startX, curY, width, 24).fill(BG_LIGHT);
  doc.rect(startX, curY, width, 24).lineWidth(0.25).stroke(BORDER_COLOR);

  doc.fillColor(TEXT_DARK)
    .font('Helvetica-Bold')
    .fontSize(8.5)
    .text(`Academix Platform Cloud License — ${planName} Tier`, startX + 12, curY + 7);

  doc.fillColor(TEXT_MUTED)
    .font('Helvetica')
    .fontSize(8)
    .text(periodText, startX + 280, curY + 7, { width: 110, align: 'center' })
    .fillColor(TEXT_DARK)
    .font('Helvetica-Bold')
    .text(amount.toLocaleString('en-PK'), startX + 400, curY + 7, { width: 110, align: 'right' });

  curY += 24;

  // Total Billed
  doc.rect(startX, curY, width, 28).fill('#F1F5F9');
  doc.rect(startX, curY, width, 28).lineWidth(1).stroke(primaryColor);

  doc.fillColor(primaryColor)
    .font('Helvetica-Bold')
    .fontSize(10)
    .text('TOTAL AMOUNT', startX + 12, curY + 9)
    .fillColor(isPaid ? SUCCESS_COLOR : primaryColor)
    .fontSize(12)
    .text(`PKR ${amount.toLocaleString('en-PK')}`, startX + 380, curY + 8, { width: 130, align: 'right' });

  curY += 40;

  // 6. Payment Settlement Status Box
  doc.rect(startX, curY, width, 48).fill(BG_LIGHT);
  doc.rect(startX, curY, width, 48).lineWidth(0.5).stroke(BORDER_COLOR);

  if (isPaid) {
    doc.fillColor(SUCCESS_COLOR).font('Helvetica-Bold').fontSize(8.5);
    doc.text('Payment Settlement Details:', startX + 12, curY + 8);

    doc.fillColor(TEXT_DARK).font('Helvetica').fontSize(8);
    const paidDate = formatKarachiDate(invoice.paidAt || invoice.updatedAt || new Date(), 'full');
    doc.text(`Settled On: ${paidDate}   |   Method: ${(invoice.method || 'Bank Transfer').toUpperCase()}`, startX + 12, curY + 22);
    doc.text(`Reference / Transaction ID: ${invoice.reference || 'DIRECT-CLEARING'}   |   Verified By: ${invoice.verifiedBy || 'Super Admin Platform Operations'}`, startX + 12, curY + 34);
  } else {
    doc.fillColor(DANGER_COLOR).font('Helvetica-Bold').fontSize(8.5);
    doc.text('Payment Instructions:', startX + 12, curY + 8);

    doc.fillColor(TEXT_DARK).font('Helvetica').fontSize(8);
    doc.text('Please transfer dues to: Academix Cloud Operations (Meezan Bank, A/C: 0102-0103984501)', startX + 12, curY + 22);
    doc.text('After payment, submit transaction ID and screenshot in College Portal or to billing@cesms.edu.pk', startX + 12, curY + 34);
  }

  // 7. QR Code for Verification
  const qrY = 645;
  const qrSize = 75;
  const qrBuffer = await generateQRBuffer(verifyUrl, 120);

  if (qrBuffer) {
    try {
      doc.image(qrBuffer, 48, qrY, { width: qrSize, height: qrSize });
    } catch {}
  }

  doc.fillColor(TEXT_MUTED)
    .font('Helvetica-Bold')
    .fontSize(7)
    .text('VERIFY INVOICE', 48, qrY + qrSize + 4, { width: qrSize, align: 'center' });

  doc.font('Helvetica')
    .fontSize(6)
    .text(verifyToken.slice(0, 12) + '...', 48, qrY + qrSize + 14, { width: qrSize, align: 'center' });

  // 8. Super Admin Signature Block
  drawSignatureBlock(doc, [
    {
      title: 'Platform Billing Officer',
      subtitle: 'Finance Operations'
    },
    {
      title: 'Super Admin Authority',
      subtitle: 'Academix Cloud Infrastructure',
      buffer: branding.superAdminSignatureBuffer
    }
  ], {
    startX: 160,
    y: 715,
    width: 395,
    stampBuffer: branding.platformStampBuffer
  });

  // 9. Watermark if void
  if (invoice.status === 'void') {
    drawWatermark(doc, 'VOID');
  }

  // 10. Footer
  drawFooter(doc, {
    footerNote: 'This platform invoice is issued by Academix Cloud Platform. All intellectual property and cloud operations belong to CESMS.'
  }, {
    startX: 36,
    width: 523,
    bottomY: 805,
    verifyUrl
  });

  return doc;
}

module.exports = {
  generatePlatformInvoicePDF,
  PLATFORM_BRANDING
};
