/**
 * Document Templates: Student ID Card Generator
 * ───────────────────────────────────────────────
 * Generates ISO/IEC 7810 ID-1 (CR80) Student Identity Cards:
 * - Dimensions: 85.60 mm x 53.98 mm (242.65 pt x 153.07 pt)
 * - Modes:
 *   1. Single Card (`single`): 2-page PDF (Page 1: Front, Page 2: Back)
 *   2. Printable Sheet (`sheet`): A4 page with 8 cards arranged 2x4 with cut lines.
 */

const PDFDocument = require('pdfkit');
const {
  DEFAULT_PRIMARY,
  DEFAULT_ACCENT,
  TEXT_DARK,
  TEXT_MUTED,
  BORDER_COLOR,
  BG_LIGHT,
  generateQRBuffer,
  formatKarachiDate,
  drawFallbackLogo
} = require('./shared');

const CR80_WIDTH = 242.65;
const CR80_HEIGHT = 153.07;

/**
 * Generate Student ID Card PDF
 *
 * @param {Object} data
 * @param {Object|Array} data.student - Single student or array of students (for sheet)
 * @param {Object} data.college - College record
 * @param {Object} data.branding - Branding details & image buffers
 * @param {String} data.mode - 'single' or 'sheet'
 * @returns {PDFDocument} PDFKit document stream
 */
async function generateStudentCardPDF(data) {
  const {
    student = {},
    students = [],
    college = {},
    branding = {},
    mode = 'single'
  } = data;

  if (mode === 'sheet') {
    return generateCardSheetPDF({
      students: students.length > 0 ? students : [student],
      college,
      branding
    });
  }

  return generateSingleCardPDF({
    student,
    college,
    branding
  });
}

/**
 * Generate 2-Page Single CR80 Card (Front + Back)
 */
async function generateSingleCardPDF({ student = {}, college = {}, branding = {} }) {
  const doc = new PDFDocument({
    size: [CR80_WIDTH, CR80_HEIGHT],
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    info: {
      Title: `STUDENT ID CARD - ${student.rollNumber || ''} - ${student.name || ''}`,
      Author: college.name || 'CESMS',
      Subject: 'Student Identity Card (CR80)'
    }
  });

  const qrBuffer = await generateQRBuffer(student.qrCode || student.rollNumber || 'CESMS-STUDENT', 60);

  // ── Page 1: Card Front ──
  drawCardFront(doc, 0, 0, CR80_WIDTH, CR80_HEIGHT, {
    student,
    college,
    branding,
    qrBuffer
  });

  // ── Page 2: Card Back ──
  doc.addPage({
    size: [CR80_WIDTH, CR80_HEIGHT],
    margins: { top: 0, bottom: 0, left: 0, right: 0 }
  });

  drawCardBack(doc, 0, 0, CR80_WIDTH, CR80_HEIGHT, {
    student,
    college,
    branding
  });

  return doc;
}

/**
 * Generate A4 Printable Sheet (8 Cards: 2 Columns x 4 Rows per page)
 */
async function generateCardSheetPDF({ students = [], college = {}, branding = {} }) {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 28, bottom: 28, left: 36, right: 36 },
    info: {
      Title: `STUDENT ID CARDS PRINT SHEET (${students.length} Students)`,
      Author: college.name || 'CESMS',
      Subject: 'CR80 Student ID Cards Printable Sheet'
    }
  });

  const colWidth = CR80_WIDTH;
  const colHeight = CR80_HEIGHT;
  const marginX = 36;
  const marginY = 32;
  const gapX = 38;
  const gapY = 32;

  // Pre-generate QR codes for students
  const qrBuffers = {};
  for (const s of students) {
    const key = s.qrCode || s.rollNumber || s.id;
    qrBuffers[key] = await generateQRBuffer(key, 55);
  }

  let indexOnPage = 0;

  for (let i = 0; i < students.length; i++) {
    if (i > 0 && indexOnPage === 8) {
      doc.addPage();
      indexOnPage = 0;
    }

    const s = students[i];
    const colIdx = indexOnPage % 2;
    const rowIdx = Math.floor(indexOnPage / 2);

    const x = marginX + colIdx * (colWidth + gapX);
    const y = marginY + rowIdx * (colHeight + gapY);

    // Cutting border guide around card
    doc.save();
    doc.rect(x - 2, y - 2, colWidth + 4, colHeight + 4)
      .lineWidth(0.5)
      .dash(3, { space: 3 })
      .stroke(BORDER_COLOR);
    doc.restore();

    // Render Front of Card
    const qrBuf = qrBuffers[s.qrCode || s.rollNumber || s.id];
    drawCardFront(doc, x, y, colWidth, colHeight, {
      student: s,
      college,
      branding,
      qrBuffer: qrBuf
    });

    indexOnPage++;
  }

  return doc;
}

/**
 * Draw CR80 Card Front
 */
function drawCardFront(doc, x, y, w, h, { student, college, branding, qrBuffer }) {
  const primaryColor = branding.primaryColor || DEFAULT_PRIMARY;

  // Background
  doc.rect(x, y, w, h).fill('#FFFFFF');
  doc.rect(x, y, w, h).lineWidth(0.5).stroke(primaryColor);

  // Top College Header Band
  const headerH = 32;
  doc.rect(x, y, w, headerH).fill(primaryColor);

  // Top Accent Stripe
  doc.rect(x, y + headerH - 2, w, 2).fill(DEFAULT_ACCENT);

  // College Name & Crest
  const logoW = 20;
  const logoH = 20;
  if (branding.logoBuffer) {
    try {
      doc.image(branding.logoBuffer, x + 6, y + 6, { fit: [logoW, logoH] });
    } catch {
      drawFallbackLogo(doc, college.name || 'AC', x + 6, y + 6, logoW, logoH, '#FFFFFF');
    }
  } else {
    drawFallbackLogo(doc, college.name || 'AC', x + 6, y + 6, logoW, logoH, '#FFFFFF');
  }

  doc.fillColor('#FFFFFF')
    .font('Helvetica-Bold')
    .fontSize(7.5)
    .text((college.name || 'ACADEMIX COLLEGE').toUpperCase(), x + 30, y + 8, { width: w - 36, align: 'left' });

  doc.fillColor('#E2E8F0')
    .font('Helvetica')
    .fontSize(5.5)
    .text('STUDENT IDENTITY CARD', x + 30, y + 19, { width: w - 36, align: 'left', characterSpacing: 0.5 });

  // Photo Area (Left side)
  const photoX = x + 10;
  const photoY = y + headerH + 10;
  const photoW = 54;
  const photoH = 68;

  doc.rect(photoX, photoY, photoW, photoH).fill(BG_LIGHT);
  doc.rect(photoX, photoY, photoW, photoH).lineWidth(0.75).stroke(primaryColor);

  const studentPhoto = student.photoBuffer || branding.studentPhotoBuffer;
  if (studentPhoto) {
    try {
      doc.image(studentPhoto, photoX + 1, photoY + 1, { fit: [photoW - 2, photoH - 2], align: 'center', valign: 'center' });
    } catch {
      drawCardPhotoFallback(doc, photoX, photoY, photoW, photoH);
    }
  } else {
    drawCardPhotoFallback(doc, photoX, photoY, photoW, photoH);
  }

  // Student Details Area (Right side)
  const textX = photoX + photoW + 8;
  const textW = w - textX - 8;
  let textY = y + headerH + 8;

  // Student Name
  doc.fillColor(primaryColor)
    .font('Helvetica-Bold')
    .fontSize(8.5)
    .text((student.name || 'STUDENT NAME').toUpperCase(), textX, textY, { width: textW });

  textY = doc.y + 2;

  // Roll Number Highlight Box
  const rollW = textW;
  doc.rect(textX, textY, rollW, 13).fill('#EFF6FF');
  doc.rect(textX, textY, rollW, 13).lineWidth(0.4).stroke('#93C5FD');

  doc.fillColor(primaryColor)
    .font('Helvetica-Bold')
    .fontSize(7)
    .text(`ROLL NO: ${student.rollNumber || '0000'}`, textX + 4, textY + 2.5);

  textY += 16;

  // Class, Group, Section
  doc.fillColor(TEXT_DARK)
    .font('Helvetica-Bold')
    .fontSize(6.5)
    .text('Class: ', textX, textY, { continued: true })
    .font('Helvetica')
    .text(`${student.class || 'FSC-I'} (${student.section || 'A'})`);

  textY = doc.y + 2;
  doc.font('Helvetica-Bold')
    .text('Group: ', textX, textY, { continued: true })
    .font('Helvetica')
    .text(student.group || 'Pre-Medical');

  textY = doc.y + 2;
  doc.font('Helvetica-Bold')
    .text('Father: ', textX, textY, { continued: true })
    .font('Helvetica')
    .text(student.fatherName || '—');

  // QR Code (bottom right)
  const qrSize = 34;
  const qrX = w + x - qrSize - 8;
  const qrY = h + y - qrSize - 6;

  if (qrBuffer) {
    try {
      doc.image(qrBuffer, qrX, qrY, { width: qrSize, height: qrSize });
    } catch {}
  }

  // Bottom Session Stripe
  const btmY = h + y - 12;
  doc.rect(x, btmY, w - qrSize - 12, 12).fill(primaryColor);
  doc.fillColor('#FFFFFF')
    .font('Helvetica-Bold')
    .fontSize(5.5)
    .text(`SESSION: ${student.session || '2026-2028'}`, x + 6, btmY + 3);
}

/**
 * Draw CR80 Card Back
 */
function drawCardBack(doc, x, y, w, h, { student, college, branding }) {
  const primaryColor = branding.primaryColor || DEFAULT_PRIMARY;

  // Background & border
  doc.rect(x, y, w, h).fill(BG_LIGHT);
  doc.rect(x, y, w, h).lineWidth(0.5).stroke(primaryColor);

  let curY = y + 8;

  // Title: Instructions
  doc.fillColor(primaryColor)
    .font('Helvetica-Bold')
    .fontSize(7)
    .text('CARD RULES & EMERGENCY INFORMATION', x + 8, curY, { width: w - 16, align: 'center' });

  curY += 12;
  doc.moveTo(x + 10, curY).lineTo(x + w - 10, curY).lineWidth(0.4).stroke(BORDER_COLOR);
  curY += 6;

  // Emergency Details Grid
  doc.fillColor(TEXT_DARK)
    .font('Helvetica-Bold')
    .fontSize(6)
    .text('Emergency Contact: ', x + 10, curY, { continued: true })
    .font('Helvetica')
    .text(student.guardianPhone || student.phone || '0300-1234567');

  curY = doc.y + 2;
  doc.font('Helvetica-Bold')
    .text('Residential Address: ', x + 10, curY, { continued: true })
    .font('Helvetica')
    .text((student.address || college.city || 'Main City').slice(0, 48));

  curY = doc.y + 2;
  doc.font('Helvetica-Bold')
    .text('Valid Until: ', x + 10, curY, { continued: true })
    .font('Helvetica')
    .text(student.validUntil || '31 July 2028');

  curY = doc.y + 6;
  doc.moveTo(x + 10, curY).lineTo(x + w - 10, curY).lineWidth(0.4).stroke(BORDER_COLOR);
  curY += 5;

  // Instructions
  doc.fillColor(TEXT_MUTED)
    .font('Helvetica')
    .fontSize(5)
    .text('1. This card is official institutional property and non-transferable.', x + 10, curY, { width: w - 20 })
    .text('2. Must be presented on campus, at security gates, and examination halls.', x + 10, doc.y + 1, { width: w - 20 })
    .text('3. If found, please return to the Principal / Registrar office.', x + 10, doc.y + 1, { width: w - 20 });

  // Principal Signature Block & Stamp (bottom)
  const sigY = h + y - 26;
  const sigWidth = 70;
  const sigX = w + x - sigWidth - 12;

  if (branding.signatures?.principalBuffer) {
    try {
      doc.image(branding.signatures.principalBuffer, sigX + (sigWidth - 45) / 2, sigY - 18, {
        fit: [45, 18],
        align: 'center'
      });
    } catch {}
  }

  doc.moveTo(sigX, sigY).lineTo(sigX + sigWidth, sigY).lineWidth(0.5).stroke(TEXT_DARK);
  doc.fillColor(TEXT_DARK)
    .font('Helvetica-Bold')
    .fontSize(5.5)
    .text('Principal Signature', sigX, sigY + 2, { width: sigWidth, align: 'center' });

  // College Address bar
  doc.fillColor(TEXT_MUTED)
    .font('Helvetica')
    .fontSize(4.5)
    .text(college.phone ? `Phone: ${college.phone}` : 'Main Campus', x + 10, sigY + 4);
}

function drawCardPhotoFallback(doc, x, y, w, h) {
  doc.fillColor(TEXT_MUTED)
    .font('Helvetica')
    .fontSize(6)
    .text('STUDENT\nPHOTO', x, y + h / 2 - 8, { width: w, align: 'center' });
}

module.exports = {
  generateStudentCardPDF,
  CR80_WIDTH,
  CR80_HEIGHT
};
