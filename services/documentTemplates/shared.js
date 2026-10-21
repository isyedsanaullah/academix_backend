/**
 * Document Templates: Shared Layout Engine
 * ─────────────────────────────────────────
 * Shared utilities for consistent, professional A4 & CR80 PDF document generation.
 * Handles headers, footers, QR generation, signature blocks, watermarks,
 * and Asia/Karachi time formatting.
 */

const crypto = require('crypto');
const qrcode = require('qrcode');

const DEFAULT_PRIMARY = '#1E3A8A'; // Premium Academic Navy
const DEFAULT_ACCENT = '#D97706';  // Warm Amber
const TEXT_DARK = '#0F172A';       // Slate 900
const TEXT_MUTED = '#475569';      // Slate 600
const TEXT_LIGHT = '#94A3B8';      // Slate 400
const BORDER_COLOR = '#CBD5E1';    // Slate 300
const BG_LIGHT = '#F8FAFC';        // Slate 50
const SUCCESS_COLOR = '#059669';   // Emerald 600
const DANGER_COLOR = '#DC2626';    // Red 600

/**
 * Generate a cryptographically strong 24-character URL-safe verify token (144 bits)
 */
function generateVerifyToken() {
  return crypto.randomBytes(18).toString('base64url');
}

/**
 * Format a Date object or ISO string in Asia/Karachi timezone
 */
function formatKarachiDate(dateInput, formatType = 'full') {
  if (!dateInput) return '—';
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return '—';

  const options = {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: 'short',
    day: '2-digit'
  };

  if (formatType === 'full' || formatType === 'datetime') {
    options.hour = '2-digit';
    options.minute = '2-digit';
    options.hour12 = true;
  }

  const formatted = new Intl.DateTimeFormat('en-GB', options).format(d);
  return formatType === 'datetime' ? `${formatted} PKT` : formatted;
}

/**
 * Generate a PNG Buffer for a QR Code
 */
async function generateQRBuffer(text, size = 120) {
  if (!text) return null;
  try {
    return await qrcode.toBuffer(String(text), {
      type: 'png',
      width: size,
      margin: 1,
      color: {
        dark: '#0F172A',
        light: '#FFFFFF'
      }
    });
  } catch (err) {
    console.error('Failed to generate QR code buffer:', err.message);
    return null;
  }
}

/**
 * Draw decorative header onto an A4 page
 */
function drawHeader(doc, college, branding = {}, options = {}) {
  const primaryColor = branding.primaryColor || DEFAULT_PRIMARY;
  const startX = options.startX || 36;
  const startY = options.startY || 36;
  const width = options.width || 523; // A4 portrait: 595 - 72 = 523

  // Top color accent band
  doc.rect(startX, startY, width, 4).fill(primaryColor);

  const headerY = startY + 12;

  // Render college logo or decorative monogram badge
  const logoWidth = 60;
  const logoHeight = 60;
  if (branding.logoBuffer) {
    try {
      doc.image(branding.logoBuffer, startX, headerY, { fit: [logoWidth, logoHeight], align: 'center', valign: 'center' });
    } catch {
      drawFallbackLogo(doc, college?.name || 'CESMS', startX, headerY, logoWidth, logoHeight, primaryColor);
    }
  } else {
    drawFallbackLogo(doc, college?.name || 'CESMS', startX, headerY, logoWidth, logoHeight, primaryColor);
  }

  // College Name & Details
  const textX = startX + logoWidth + 16;
  const textWidth = width - (logoWidth + 16);

  doc.fillColor(primaryColor)
    .font('Helvetica-Bold')
    .fontSize(15)
    .text((college?.name || 'ACADEMIX INTERMEDIATE COLLEGE').toUpperCase(), textX, headerY, {
      width: textWidth,
      align: 'left'
    });

  const addressLine = [college?.address, college?.city].filter(Boolean).join(', ');
  const contactLine = [
    college?.phone ? `Tel: ${college.phone}` : null,
    college?.email ? `Email: ${college.email}` : null,
    college?.website ? `Web: ${college.website}` : null
  ].filter(Boolean).join('  |  ');

  doc.fillColor(TEXT_MUTED)
    .font('Helvetica')
    .fontSize(8.5)
    .moveDown(0.2)
    .text(addressLine || 'Main Campus, Institutional Area, Pakistan', { width: textWidth })
    .moveDown(0.15)
    .text(contactLine || 'Tel: +92 41 9200000 | info@cesms.edu.pk', { width: textWidth });

  // Optional custom header lines
  if (Array.isArray(branding.headerLines) && branding.headerLines.length > 0) {
    branding.headerLines.slice(0, 2).forEach(line => {
      doc.moveDown(0.1).text(line, { width: textWidth });
    });
  }

  // Session / Sub-header bar
  const sepY = headerY + logoHeight + 10;
  doc.moveTo(startX, sepY).lineTo(startX + width, sepY).lineWidth(0.75).stroke(BORDER_COLOR);

  return sepY + 10;
}

/**
 * Draw fallback circular collegiate crest monogram
 */
function drawFallbackLogo(doc, name, x, y, w, h, primaryColor) {
  const radius = Math.min(w, h) / 2;
  const cx = x + w / 2;
  const cy = y + h / 2;

  doc.circle(cx, cy, radius - 2).lineWidth(1.5).stroke(primaryColor);
  doc.circle(cx, cy, radius - 5).fillAndStroke(BG_LIGHT, primaryColor);

  const initials = (name || 'AC')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0])
    .join('')
    .toUpperCase();

  doc.fillColor(primaryColor)
    .font('Helvetica-Bold')
    .fontSize(14)
    .text(initials, x, cy - 6, { width: w, align: 'center' });
}

/**
 * Draw standard footer onto the page
 */
function drawFooter(doc, branding = {}, options = {}) {
  const startX = options.startX || 36;
  const width = options.width || 523;
  const bottomY = options.bottomY || 805; // A4 height is 842 pt
  const verifyUrl = options.verifyUrl;

  doc.moveTo(startX, bottomY - 20).lineTo(startX + width, bottomY - 20).lineWidth(0.5).stroke(BORDER_COLOR);

  const note = branding.footerNote || 'This is an authentic system-generated document. Alteration or unauthorized duplication is strictly prohibited.';
  const generatedText = `Generated: ${formatKarachiDate(new Date(), 'datetime')}${verifyUrl ? `  •  Verify: ${verifyUrl}` : ''}`;

  doc.fillColor(TEXT_LIGHT)
    .font('Helvetica')
    .fontSize(7)
    .text(note, startX, bottomY - 14, { width, align: 'center' })
    .moveDown(0.2)
    .text(generatedText, startX, bottomY - 6, { width, align: 'center' });
}

/**
 * Draw a high-contrast watermark across the document page
 */
function drawWatermark(doc, text = 'VOID') {
  doc.save();
  doc.rotate(-35, { origin: [297, 421] });
  doc.fillColor('#DC2626')
    .fillOpacity(0.08)
    .font('Helvetica-Bold')
    .fontSize(80)
    .text(text.toUpperCase(), 0, 380, { width: 595, align: 'center' });
  doc.restore();
}

/**
 * Draw signature blocks with optional signature images and stamp
 */
function drawSignatureBlock(doc, signatures = [], options = {}) {
  const startX = options.startX || 36;
  const y = options.y || 700;
  const totalWidth = options.width || 523;
  const stampBuffer = options.stampBuffer;

  const count = signatures.length;
  if (count === 0) return;

  const colWidth = (totalWidth - (count - 1) * 20) / count;

  signatures.forEach((sig, idx) => {
    const colX = startX + idx * (colWidth + 20);

    // If signature image buffer provided, place it above the line
    if (sig.buffer) {
      try {
        doc.image(sig.buffer, colX + (colWidth - 90) / 2, y - 35, {
          fit: [90, 32],
          align: 'center',
          valign: 'bottom'
        });
      } catch {
        // Fallback: leave space for ink signature
      }
    }

    // Signature line
    doc.moveTo(colX, y).lineTo(colX + colWidth, y).lineWidth(0.75).stroke(TEXT_DARK);

    // Title & Name
    doc.fillColor(TEXT_DARK)
      .font('Helvetica-Bold')
      .fontSize(8.5)
      .text(sig.title || 'Authorized Signatory', colX, y + 4, { width: colWidth, align: 'center' });

    if (sig.subtitle) {
      doc.fillColor(TEXT_MUTED)
        .font('Helvetica')
        .fontSize(7.5)
        .text(sig.subtitle, colX, y + 16, { width: colWidth, align: 'center' });
    }
  });

  // Stamp overlay if provided
  if (stampBuffer) {
    try {
      const stampX = startX + totalWidth / 2 - 35;
      doc.save();
      doc.image(stampBuffer, stampX, y - 40, {
        fit: [70, 70],
        align: 'center',
        valign: 'center'
      });
      doc.restore();
    } catch {
      // Ignored if stamp buffer render fails
    }
  }
}

module.exports = {
  DEFAULT_PRIMARY,
  DEFAULT_ACCENT,
  TEXT_DARK,
  TEXT_MUTED,
  TEXT_LIGHT,
  BORDER_COLOR,
  BG_LIGHT,
  SUCCESS_COLOR,
  DANGER_COLOR,
  generateVerifyToken,
  formatKarachiDate,
  generateQRBuffer,
  drawHeader,
  drawFooter,
  drawWatermark,
  drawSignatureBlock,
  drawFallbackLogo
};
