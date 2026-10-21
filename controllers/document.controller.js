/**
 * Document Controller: Stream-Only PDF Generation
 * ────────────────────────────────────────────────
 * Handles on-demand streaming of verified academic documents:
 * - Certificates
 * - Fee Vouchers / Bank Challans
 * - Paid Receipts
 * - Student ID Cards (Single CR80 & Multi-Card A4 Sheets)
 * - Template Previews
 *
 * Invariant: Never stores generated PDFs in R2/S3 or disk.
 * Always generates dynamically and streams with attachment disposition.
 */

const { getSystemClient } = require('../config/prismaManager');
const {
  generateCertificatePDF,
  generateFeeVoucherPDF,
  generatePaidReceiptPDF,
  generateStudentCardPDF,
  generateVerifyToken
} = require('../services/documentTemplates');
const { recordVerifyToken } = require('../services/verifyToken.service');
const { getObjectStream, isR2Reference, parseR2Reference } = require('../services/storageService');

/**
 * Safely load image buffer from StoredFile ID, R2 reference, or data URI
 */
async function loadImageBuffer(ref, tenantDb, collegeId) {
  if (!ref || typeof ref !== 'string') return null;

  try {
    let fileId = ref;
    if (isR2Reference(ref)) {
      fileId = parseR2Reference(ref);
    }

    if (fileId.startsWith('data:')) {
      const parts = fileId.split(',');
      if (parts.length > 1) {
        return Buffer.from(parts[1], 'base64');
      }
    }

    // Try finding in StoredFile
    const storedFile = await tenantDb.storedFile.findFirst({
      where: {
        id: fileId,
        college_id: collegeId,
        status: 'ready',
        deletedAt: null
      }
    });

    if (!storedFile || !storedFile.objectKey) return null;

    const { body } = await getObjectStream(storedFile.objectKey);
    const chunks = [];
    for await (const chunk of body) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } catch (err) {
    // Non-fatal: missing image will fallback gracefully to vector shape
    return null;
  }
}

/**
 * Resolve College Branding and image buffers
 */
async function resolveCollegeBranding(college, tenantDb) {
  const settings = (college?.settings && typeof college.settings === 'object') ? college.settings : {};
  const branding = (settings.branding && typeof settings.branding === 'object') ? settings.branding : {};

  const logoRef = branding.logo_file_id || college?.logo;
  const stampRef = branding.stamp_file_id || branding.stamp;
  const principalSigRef = branding.signatures?.principal;
  const accountantSigRef = branding.signatures?.accountant;

  const [logoBuffer, stampBuffer, principalBuffer, accountantBuffer] = await Promise.all([
    loadImageBuffer(logoRef, tenantDb, college.id),
    loadImageBuffer(stampRef, tenantDb, college.id),
    loadImageBuffer(principalSigRef, tenantDb, college.id),
    loadImageBuffer(accountantSigRef, tenantDb, college.id)
  ]);

  return {
    ...branding,
    primaryColor: branding.primaryColor || '#1E3A8A',
    logoBuffer,
    stampBuffer,
    signatures: {
      ...branding.signatures,
      principalBuffer,
      accountantBuffer
    }
  };
}

/**
 * Check if requesting student owns the record
 */
function verifyStudentOwnership(req, studentId, studentUserId) {
  if (req.user?.role !== 'student') return true;

  const currentUserId = req.user.id || req.user._id;
  if (studentUserId && studentUserId === currentUserId) return true;
  if (req.user.studentId && req.user.studentId === studentId) return true;
  if (req.user.student_id && req.user.student_id === studentId) return true;

  return false;
}

/**
 * GET /api/documents/certificate/:id.pdf
 */
exports.downloadCertificatePDF = async (req, res, next) => {
  try {
    const { id } = req.params;
    const collegeId = req.collegeId;
    const tenantDb = req.tenantClient;
    const sysDb = getSystemClient();

    const cert = await tenantDb.certificate.findFirst({
      where: { id, college_id: collegeId }
    });

    if (!cert) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Certificate not found' });
    }

    const student = await tenantDb.student.findFirst({
      where: { id: cert.student_id, college_id: collegeId }
    });

    if (!student) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Student record not found' });
    }

    if (!verifyStudentOwnership(req, student.id, student.user_id)) {
      return res.status(403).json({ success: false, code: 'FORBIDDEN', message: 'You can only download your own certificate' });
    }

    // Auto-backfill verifyToken if missing
    let verifyToken = cert.verifyToken;
    if (!verifyToken) {
      verifyToken = generateVerifyToken();
      await tenantDb.certificate.update({
        where: { id: cert.id },
        data: { verifyToken }
      });
      cert.verifyToken = verifyToken;
    }
    await recordVerifyToken({
      token: verifyToken,
      collegeId,
      kind: 'certificate',
      refId: cert.id
    }).catch(err => console.error('Failed to register verifyToken for certificate:', err.message));

    const college = await sysDb.college.findUnique({ where: { id: collegeId } });
    const branding = await resolveCollegeBranding(college, tenantDb);

    // Resolve student photo
    const photoRef = student.photoThumb || student.photo;
    if (photoRef) {
      branding.studentPhotoBuffer = await loadImageBuffer(photoRef, tenantDb, collegeId);
    }

    const baseUrl = process.env.FRONTEND_URL || `${req.protocol}://${req.get('host')}`;
    const pdfDoc = await generateCertificatePDF({
      certificate: cert,
      student,
      college,
      branding,
      verifyBaseUrl: baseUrl
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="certificate_${cert.certificateNumber || cert.id}.pdf"`);
    res.setHeader('Cache-Control', 'no-store');

    pdfDoc.pipe(res);
    pdfDoc.end();
  } catch (error) { next(error); }
};

/**
 * GET /api/documents/voucher/:feeId.pdf
 */
exports.downloadFeeVoucherPDF = async (req, res, next) => {
  try {
    const { feeId } = req.params;
    const collegeId = req.collegeId;
    const tenantDb = req.tenantClient;
    const sysDb = getSystemClient();

    const fee = await tenantDb.fee.findFirst({
      where: { id: feeId, college_id: collegeId }
    });

    if (!fee) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Fee voucher not found' });
    }

    const student = await tenantDb.student.findFirst({
      where: { id: fee.student_id, college_id: collegeId }
    });

    if (!student) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Student record not found' });
    }

    if (!verifyStudentOwnership(req, student.id, student.user_id)) {
      return res.status(403).json({ success: false, code: 'FORBIDDEN', message: 'You can only download your own fee voucher' });
    }

    // Auto-backfill verifyToken if missing
    let verifyToken = fee.verifyToken;
    if (!verifyToken) {
      verifyToken = generateVerifyToken();
      await tenantDb.fee.update({
        where: { id: fee.id },
        data: { verifyToken }
      });
      fee.verifyToken = verifyToken;
    }
    await recordVerifyToken({
      token: verifyToken,
      collegeId,
      kind: 'voucher',
      refId: fee.id
    }).catch(err => console.error('Failed to register verifyToken for voucher:', err.message));

    const college = await sysDb.college.findUnique({ where: { id: collegeId } });
    const branding = await resolveCollegeBranding(college, tenantDb);

    // Check if doc-templates feature is enabled for rich branded template
    const docTemplatesEnabled = Boolean(req.entitlements?.features?.['doc-templates'] ?? true);

    const baseUrl = process.env.FRONTEND_URL || `${req.protocol}://${req.get('host')}`;
    const pdfDoc = await generateFeeVoucherPDF({
      fee,
      student,
      college,
      branding,
      docTemplatesEnabled,
      verifyBaseUrl: baseUrl
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="challan_${fee.challanNumber || fee.id}.pdf"`);
    res.setHeader('Cache-Control', 'no-store');

    pdfDoc.pipe(res);
    pdfDoc.end();
  } catch (error) { next(error); }
};

/**
 * GET /api/documents/receipt/:paymentId.pdf
 */
exports.downloadPaidReceiptPDF = async (req, res, next) => {
  try {
    const { paymentId } = req.params;
    const collegeId = req.collegeId;
    const tenantDb = req.tenantClient;
    const sysDb = getSystemClient();

    const payment = await tenantDb.payment.findFirst({
      where: { id: paymentId, college_id: collegeId }
    });

    if (!payment) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Payment record not found' });
    }

    const fee = await tenantDb.fee.findFirst({
      where: { id: payment.fee_id, college_id: collegeId }
    });

    if (!fee) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Associated fee record not found' });
    }

    const student = await tenantDb.student.findFirst({
      where: { id: payment.student_id, college_id: collegeId }
    });

    if (!student) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Student record not found' });
    }

    if (!verifyStudentOwnership(req, student.id, student.user_id)) {
      return res.status(403).json({ success: false, code: 'FORBIDDEN', message: 'You can only download your own paid receipt' });
    }

    // Receipt is only available if Payment exists and Fee status is paid (or settled)
    if (fee.status !== 'paid' && Number(fee.paidAmount || 0) < Number(fee.totalAmount || 0)) {
      return res.status(400).json({
        success: false,
        code: 'RECEIPT_UNAVAILABLE',
        message: 'Paid receipt is only printed when payment is verified and fee status is paid'
      });
    }

    // Auto-backfill verifyToken if missing
    let verifyToken = payment.verifyToken;
    if (!verifyToken) {
      verifyToken = generateVerifyToken();
      await tenantDb.payment.update({
        where: { id: payment.id },
        data: { verifyToken }
      });
      payment.verifyToken = verifyToken;
    }
    await recordVerifyToken({
      token: verifyToken,
      collegeId,
      kind: 'receipt',
      refId: payment.id
    }).catch(err => console.error('Failed to register verifyToken for receipt:', err.message));

    const college = await sysDb.college.findUnique({ where: { id: collegeId } });
    const branding = await resolveCollegeBranding(college, tenantDb);

    const baseUrl = process.env.FRONTEND_URL || `${req.protocol}://${req.get('host')}`;
    const pdfDoc = await generatePaidReceiptPDF({
      payment,
      fee,
      student,
      college,
      branding,
      verifyBaseUrl: baseUrl
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="receipt_${payment.receiptNumber || payment.id}.pdf"`);
    res.setHeader('Cache-Control', 'no-store');

    pdfDoc.pipe(res);
    pdfDoc.end();
  } catch (error) { next(error); }
};

/**
 * GET /api/documents/student-card/:studentId.pdf
 */
exports.downloadStudentCardPDF = async (req, res, next) => {
  try {
    const { studentId } = req.params;
    const collegeId = req.collegeId;
    const tenantDb = req.tenantClient;
    const sysDb = getSystemClient();

    const student = await tenantDb.student.findFirst({
      where: { id: studentId, college_id: collegeId }
    });

    if (!student) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Student not found' });
    }

    if (!verifyStudentOwnership(req, student.id, student.user_id)) {
      return res.status(403).json({ success: false, code: 'FORBIDDEN', message: 'You can only download your own student card' });
    }

    const college = await sysDb.college.findUnique({ where: { id: collegeId } });
    const branding = await resolveCollegeBranding(college, tenantDb);

    const photoRef = student.photoThumb || student.photo;
    if (photoRef) {
      student.photoBuffer = await loadImageBuffer(photoRef, tenantDb, collegeId);
    }

    const pdfDoc = await generateStudentCardPDF({
      student,
      college,
      branding,
      mode: 'single'
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="student_card_${student.rollNumber || student.id}.pdf"`);
    res.setHeader('Cache-Control', 'no-store');

    pdfDoc.pipe(res);
    pdfDoc.end();
  } catch (error) { next(error); }
};

/**
 * POST /api/documents/student-cards.pdf
 * Batch printable sheet (8 cards per A4 page)
 */
exports.downloadStudentCardsSheetPDF = async (req, res, next) => {
  try {
    const { studentIds } = req.body;
    const collegeId = req.collegeId;
    const tenantDb = req.tenantClient;
    const sysDb = getSystemClient();

    if (!Array.isArray(studentIds) || studentIds.length === 0) {
      return res.status(400).json({ success: false, code: 'BAD_REQUEST', message: 'studentIds array is required' });
    }

    const students = await tenantDb.student.findMany({
      where: {
        id: { in: studentIds },
        college_id: collegeId
      },
      take: 64 // Safety limit per print batch
    });

    if (students.length === 0) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'No matching students found' });
    }

    const college = await sysDb.college.findUnique({ where: { id: collegeId } });
    const branding = await resolveCollegeBranding(college, tenantDb);

    // Resolve thumbnails in parallel
    await Promise.all(students.map(async (s) => {
      const ref = s.photoThumb || s.photo;
      if (ref) {
        s.photoBuffer = await loadImageBuffer(ref, tenantDb, collegeId);
      }
    }));

    const pdfDoc = await generateStudentCardPDF({
      students,
      college,
      branding,
      mode: 'sheet'
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="student_cards_sheet_${students.length}.pdf"`);
    res.setHeader('Cache-Control', 'no-store');

    pdfDoc.pipe(res);
    pdfDoc.end();
  } catch (error) { next(error); }
};

/**
 * GET /api/documents/preview/:type.pdf
 * Admin / Principal template preview with sample collegiate data
 */
exports.previewDocumentPDF = async (req, res, next) => {
  try {
    const { type } = req.params;
    const collegeId = req.collegeId;
    const tenantDb = req.tenantClient;
    const sysDb = getSystemClient();

    const college = await sysDb.college.findUnique({ where: { id: collegeId } }) || {
      name: 'Faisalabad Model College',
      city: 'Faisalabad',
      address: 'West Canal Road, Faisalabad',
      phone: '+92 41 9200888',
      email: 'info@fmc.edu.pk'
    };

    const branding = await resolveCollegeBranding(college, tenantDb);
    const baseUrl = process.env.FRONTEND_URL || `${req.protocol}://${req.get('host')}`;

    const sampleStudent = {
      name: 'Muhammad Ahmed Khan',
      fatherName: 'Tariq Mehmood Khan',
      rollNumber: 'FSC-2026-042',
      class: 'FSC Part 1',
      group: 'Pre-Engineering',
      section: 'A',
      session: '2026-2028',
      qrCode: 'STUDENT-FSC-2026-042',
      guardianPhone: '0300-9876543',
      address: 'House 14-B, Peoples Colony No. 1, Faisalabad'
    };

    let pdfDoc;

    switch ((type || '').toLowerCase()) {
      case 'certificate': {
        const sampleCert = {
          type: 'character',
          certificateNumber: 'CERT-CHA-2026-SAMPLE',
          issueDate: new Date(),
          verifyToken: generateVerifyToken(),
          status: 'issued'
        };
        pdfDoc = await generateCertificatePDF({
          certificate: sampleCert,
          student: sampleStudent,
          college,
          branding,
          verifyBaseUrl: baseUrl,
          isSample: true
        });
        break;
      }
      case 'voucher': {
        const sampleFee = {
          challanNumber: 'CH-2026-10-SAMPLE',
          month: 'October 2026',
          tuitionFee: 12000,
          labFee: 2500,
          functionFee: 1500,
          otherCharges: 500,
          fine: 0,
          scholarshipDeduction: 2000,
          totalAmount: 14500,
          dueDate: new Date(Date.now() + 7 * 86400000),
          verifyToken: generateVerifyToken()
        };
        pdfDoc = await generateFeeVoucherPDF({
          fee: sampleFee,
          student: sampleStudent,
          college,
          branding,
          docTemplatesEnabled: true,
          verifyBaseUrl: baseUrl
        });
        break;
      }
      case 'receipt': {
        const samplePayment = {
          receiptNumber: 'RCP-2026-SAMPLE',
          amount: 14500,
          paymentMethod: 'bank',
          referenceNumber: 'HBL-DEP-9948201',
          receivedBy: 'Chief Accountant',
          verifyToken: generateVerifyToken(),
          createdAt: new Date()
        };
        const sampleFee = {
          challanNumber: 'CH-2026-10-SAMPLE',
          month: 'October 2026',
          tuitionFee: 12000,
          labFee: 2500,
          functionFee: 1500,
          otherCharges: 500,
          fine: 0,
          scholarshipDeduction: 2000,
          totalAmount: 14500,
          paidAmount: 14500,
          status: 'paid'
        };
        pdfDoc = await generatePaidReceiptPDF({
          payment: samplePayment,
          fee: sampleFee,
          student: sampleStudent,
          college,
          branding,
          verifyBaseUrl: baseUrl,
          isSample: true
        });
        break;
      }
      case 'card': {
        pdfDoc = await generateStudentCardPDF({
          student: sampleStudent,
          college,
          branding,
          mode: 'single'
        });
        break;
      }
      default:
        return res.status(400).json({
          success: false,
          code: 'INVALID_TYPE',
          message: "Valid preview types: 'certificate', 'voucher', 'receipt', 'card'"
        });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="preview_${type}.pdf"`);
    res.setHeader('Cache-Control', 'no-store');

    pdfDoc.pipe(res);
    pdfDoc.end();
  } catch (error) { next(error); }
};
