/**
 * Document Templates: Certificate Generator
 * ──────────────────────────────────────────
 * Generates official academic certificates:
 * - Character Certificate
 * - Bonafide Student Certificate
 * - Hope Certificate (BISE Exam Prediction)
 * - Migration / College Leaving Certificate
 *
 * Layout: A4 Portrait, ornate collegiate border, official seal,
 * student photograph, QR verification code, and principal signature block.
 */

const PDFDocument = require('pdfkit');
const {
  DEFAULT_PRIMARY,
  DEFAULT_ACCENT,
  TEXT_DARK,
  TEXT_MUTED,
  BORDER_COLOR,
  BG_LIGHT,
  drawHeader,
  drawFooter,
  drawWatermark,
  drawSignatureBlock,
  generateQRBuffer,
  formatKarachiDate,
  generateVerifyToken
} = require('./shared');

const CERTIFICATE_TITLES = {
  character: 'CHARACTER CERTIFICATE',
  bonafide: 'BONAFIDE STUDENT CERTIFICATE',
  hope: 'HOPE CERTIFICATE',
  migration: 'MIGRATION CERTIFICATE',
  leaving: 'COLLEGE LEAVING CERTIFICATE'
};

/**
 * Generate a Certificate PDF as a readable stream
 *
 * @param {Object} data
 * @param {Object} data.certificate - Certificate record
 * @param {Object} data.student - Student record
 * @param {Object} data.college - College record
 * @param {Object} data.branding - Branding details & image buffers
 * @param {String} data.verifyBaseUrl - Base URL for public verification
 * @returns {PDFDocument} PDFKit document stream
 */
async function generateCertificatePDF(data) {
  const {
    certificate = {},
    student = {},
    college = {},
    branding = {},
    verifyBaseUrl = 'https://cesms.edu.pk'
  } = data;

  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 36, bottom: 36, left: 36, right: 36 },
    info: {
      Title: `${certificate.type ? certificate.type.toUpperCase() : 'ACADEMIC'} CERTIFICATE - ${student.name || ''}`,
      Author: college.name || 'CESMS',
      Subject: 'Official Academic Certificate'
    }
  });

  const primaryColor = branding.primaryColor || DEFAULT_PRIMARY;
  const certType = (certificate.type || 'character').toLowerCase();
  const certTitle = CERTIFICATE_TITLES[certType] || `${certType.toUpperCase()} CERTIFICATE`;
  const verifyToken = certificate.verifyToken || generateVerifyToken();
  const verifyUrl = `${verifyBaseUrl.replace(/\/+$/, '')}/verify/${verifyToken}`;

  // 1. Ornate double collegiate border
  doc.rect(20, 20, 555, 802).lineWidth(2).stroke(primaryColor);
  doc.rect(24, 24, 547, 794).lineWidth(0.5).stroke(DEFAULT_ACCENT);

  // Corner decorative accents
  const corners = [
    [26, 26], [561, 26], [26, 808], [561, 808]
  ];
  corners.forEach(([cx, cy]) => {
    doc.rect(cx - 3, cy - 3, 6, 6).fill(DEFAULT_ACCENT);
  });

  // 2. College Header
  const headerBottomY = drawHeader(doc, college, branding, {
    startX: 36,
    startY: 36,
    width: 523
  });

  // 3. Document Identification Bar
  const metaY = headerBottomY + 10;
  doc.rect(36, metaY, 523, 26).fill(BG_LIGHT);
  doc.rect(36, metaY, 523, 26).lineWidth(0.5).stroke(BORDER_COLOR);

  doc.fillColor(TEXT_DARK)
    .font('Helvetica-Bold')
    .fontSize(9)
    .text(`Certificate No: ${certificate.certificateNumber || 'CERT-PROVISIONAL'}`, 48, metaY + 8);

  const issueDateFormatted = formatKarachiDate(certificate.issueDate || certificate.createdAt || new Date());
  doc.font('Helvetica')
    .text(`Issue Date: ${issueDateFormatted}`, 360, metaY + 8, { width: 185, align: 'right' });

  // 4. Large Certificate Title Banner
  const titleY = metaY + 42;
  doc.fillColor(primaryColor)
    .font('Helvetica-Bold')
    .fontSize(18)
    .text(certTitle, 36, titleY, { width: 523, align: 'center', characterSpacing: 1.5 });

  doc.moveTo(180, titleY + 26).lineTo(415, titleY + 26).lineWidth(1.5).stroke(DEFAULT_ACCENT);

  // 5. Student Photo (top-right) if available
  const photoY = titleY + 40;
  const photoW = 75;
  const photoH = 90;
  const photoX = 470;

  doc.rect(photoX, photoY, photoW, photoH).lineWidth(1).stroke(BORDER_COLOR);
  if (branding.studentPhotoBuffer) {
    try {
      doc.image(branding.studentPhotoBuffer, photoX + 2, photoY + 2, {
        fit: [photoW - 4, photoH - 4],
        align: 'center',
        valign: 'center'
      });
    } catch {
      drawPhotoPlaceholder(doc, photoX, photoY, photoW, photoH);
    }
  } else {
    drawPhotoPlaceholder(doc, photoX, photoY, photoW, photoH);
  }

  // 6. Body Paragraph Text
  const bodyX = 48;
  const bodyY = photoY + 5;
  const bodyWidth = 405; // leave space for photo on the right

  doc.fillColor(TEXT_DARK)
    .font('Helvetica')
    .fontSize(11)
    .lineGap(6);

  let certificateContent = certificate.content;
  if (!certificateContent) {
    // Structured formal collegiate certificate paragraph
    certificateContent = `This is to certify that Mr. / Ms. ${student.name || '________________'} Son / Daughter of ${student.fatherName || '________________'}, bearing Roll No. ${student.rollNumber || '_______'}, was a bona fide student of this institution in ${student.class || 'Intermediate Part-I / Part-II'}, Group of ${student.group || 'Science / Arts'}.\n\nDuring his/her stay at the college, his/her conduct, moral character and general academic application have been found to be exemplary and highly satisfactory. He/she took active interest in institutional curricular and co-curricular pursuits and bears no disciplinary blemish on college records.\n\nWe wish him/her every success in all future academic and professional endeavors.`;
  }

  doc.text(certificateContent, bodyX, bodyY, {
    width: bodyWidth,
    align: 'justify'
  });

  // Predicted Performance (if hope certificate)
  if (certificate.predictedPerformance || certificate.academicConsistency) {
    const extraY = doc.y + 12;
    doc.rect(bodyX, extraY, 500, 36).fill(BG_LIGHT);
    doc.rect(bodyX, extraY, 500, 36).lineWidth(0.5).stroke(BORDER_COLOR);

    doc.fillColor(primaryColor)
      .font('Helvetica-Bold')
      .fontSize(9)
      .text('Board Examination Forecast / Evaluation:', bodyX + 12, extraY + 6);

    const perfText = [
      certificate.predictedPerformance ? `Expected Grade/Marks: ${certificate.predictedPerformance}` : null,
      certificate.academicConsistency ? `Academic Track: ${certificate.academicConsistency}` : null
    ].filter(Boolean).join('  |  ');

    doc.fillColor(TEXT_MUTED)
      .font('Helvetica')
      .fontSize(8.5)
      .text(perfText, bodyX + 12, extraY + 20);
  }

  // 7. QR Code for Public Verification (bottom-left)
  const qrY = 675;
  const qrSize = 75;
  const qrBuffer = await generateQRBuffer(verifyUrl, 120);

  if (qrBuffer) {
    try {
      doc.image(qrBuffer, 48, qrY, { width: qrSize, height: qrSize });
    } catch (e) {
      console.error('Failed to embed QR image:', e.message);
    }
  }

  doc.fillColor(TEXT_MUTED)
    .font('Helvetica-Bold')
    .fontSize(7.5)
    .text('SCAN TO VERIFY', 48, qrY + qrSize + 4, { width: qrSize, align: 'center' });

  doc.font('Helvetica')
    .fontSize(6.5)
    .text(verifyToken.slice(0, 12) + '...', 48, qrY + qrSize + 14, { width: qrSize, align: 'center' });

  // 8. Signatures & Official Stamp (Principal signature)
  const principalSig = branding.signatures?.principal;
  drawSignatureBlock(doc, [
    {
      title: 'Controller / Registrar',
      subtitle: college.name || 'Academix College'
    },
    {
      title: 'Principal',
      subtitle: 'Official College Seal',
      buffer: branding.signatures?.principalBuffer
    }
  ], {
    startX: 160,
    y: 730,
    width: 395,
    stampBuffer: branding.stampBuffer
  });

  // 9. Watermark if revoked or duplicate
  if (certificate.status === 'revoked') {
    drawWatermark(doc, 'REVOKED');
  } else if (data.isDuplicate) {
    drawWatermark(doc, 'DUPLICATE');
  } else if (data.isSample) {
    drawWatermark(doc, 'SAMPLE PREVIEW');
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

function drawPhotoPlaceholder(doc, x, y, w, h) {
  doc.rect(x, y, w, h).fill(BG_LIGHT);
  doc.rect(x, y, w, h).lineWidth(0.5).stroke(BORDER_COLOR);
  doc.fillColor(TEXT_MUTED)
    .font('Helvetica')
    .fontSize(7.5)
    .text('AFFIX\nSTUDENT\nPHOTO', x, y + h / 2 - 14, { width: w, align: 'center' });
}

module.exports = {
  generateCertificatePDF,
  CERTIFICATE_TITLES
};
