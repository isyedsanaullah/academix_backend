/**
 * Public & Office Verification Controller
 * ─────────────────────────────────────────────────────────────
 * Handles public document verification for:
 * - Academic Certificates
 * - Fee Vouchers / Challans
 * - Paid Receipts
 * - Platform Invoices
 *
 * Implements:
 * - O(1) single-query lookup via VerifyToken table
 * - Rate limiting (30 req/min per IP)
 * - Identical uniform 404 response for unknown/expired tokens
 * - Cache-Control: no-store
 * - Abuse logging via VerifyLog with IP hash
 * - Sanitized responses (zero privacy leaks: no CNIC, phone, address, marks, roll number)
 * - College entitlement plan check (qr-verify, voucher-verify)
 */

const { getSystemClient, getTenantClient } = require('../config/prismaManager');
const { lookupVerifyToken, logVerifyAttempt } = require('../services/verifyToken.service');
const { getEntitlements } = require('../middleware/loadEntitlements');

/**
 * Mask student name to first name and second initial only
 * e.g. "Muhammad Ahmed Khan" -> "Muhammad A."
 */
function maskStudentName(fullName) {
  if (!fullName || typeof fullName !== 'string') return 'Student';
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  const first = parts[0];
  const secondInitial = parts[1] ? parts[1].charAt(0).toUpperCase() + '.' : '';
  return `${first} ${secondInitial}`.trim();
}

/**
 * Standard uniform 404 response
 */
function sendUniformNotFound(res, req, token) {
  const ip = req.ip || req.connection?.remoteAddress;
  logVerifyAttempt({
    token,
    ip,
    userAgent: req.get('user-agent'),
    status: 'NOT_FOUND'
  }).catch(() => {});

  res.setHeader('Cache-Control', 'no-store');
  return res.status(404).json({
    success: false,
    code: 'NOT_FOUND',
    message: 'Document verification record not found'
  });
}

/**
 * GET /api/public/verify/:token
 * Public unauthenticated document verification endpoint
 */
exports.verifyPublicDocument = async (req, res, next) => {
  const { token } = req.params;
  const ip = req.ip || req.connection?.remoteAddress;
  const userAgent = req.get('user-agent');

  res.setHeader('Cache-Control', 'no-store');

  if (!token || typeof token !== 'string' || token.length < 16 || !/^[A-Za-z0-9_-]+$/.test(token)) {
    return sendUniformNotFound(res, req, token);
  }

  try {
    const sysDb = getSystemClient();
    const tokenRecord = await lookupVerifyToken(token);

    if (!tokenRecord) {
      return sendUniformNotFound(res, req, token);
    }

    const { kind, college_id: collegeId, ref_id: refId } = tokenRecord;

    // 1. Platform Invoices (Super Admin)
    if (kind === 'invoice') {
      const invoice = await sysDb.platformInvoice.findFirst({
        where: { OR: [{ id: refId }, { verifyToken: token }] }
      });

      if (!invoice) {
        return sendUniformNotFound(res, req, token);
      }

      await logVerifyAttempt({ token, ip, userAgent, status: 'VERIFIED' });

      return res.json({
        success: true,
        kind: 'invoice',
        status: (invoice.status || 'unpaid').toUpperCase(),
        issueDate: invoice.createdAt,
        institution: {
          name: 'CESMS Platform',
          logo: null
        },
        document: {
          invoiceNumber: invoice.invoiceNo,
          amount: Number(invoice.amount),
          periodStart: invoice.periodStart,
          periodEnd: invoice.periodEnd,
          paidDate: invoice.paidAt || null,
          method: invoice.method || null
        }
      });
    }

    // 2. Academic / College Documents
    const college = await sysDb.college.findUnique({
      where: { id: collegeId },
      select: { id: true, name: true, logo: true, code: true, settings: true }
    });

    if (!college) {
      return sendUniformNotFound(res, req, token);
    }

    // Check college plan entitlements
    const requiredFeature = kind === 'certificate' ? 'qr-verify' : 'voucher-verify';
    const ent = await getEntitlements(college.id);

    if (!ent.active || !ent.features[requiredFeature]?.on) {
      await logVerifyAttempt({ token, ip, userAgent, status: 'DISABLED' });
      return res.status(200).json({
        success: false,
        code: 'VERIFICATION_DISABLED',
        message: 'Verification is not available for this institution',
        institution: {
          name: college.name,
          logo: college.logo || null
        }
      });
    }

    const tenantDb = await getTenantClient(college.id);

    // 3. Certificate Verification
    if (kind === 'certificate') {
      const cert = await tenantDb.certificate.findFirst({
        where: { OR: [{ id: refId }, { verifyToken: token }] }
      });

      if (!cert) {
        return sendUniformNotFound(res, req, token);
      }

      const student = await tenantDb.student.findFirst({
        where: { id: cert.student_id },
        select: { name: true, fatherName: true, class: true, group: true }
      });

      const certStatus = cert.status === 'revoked' ? 'REVOKED' : 'VALID';
      await logVerifyAttempt({ token, ip, userAgent, status: 'VERIFIED' });

      return res.json({
        success: true,
        kind: 'certificate',
        status: certStatus,
        issueDate: cert.issueDate || cert.createdAt,
        institution: {
          name: college.name,
          logo: college.logo || null
        },
        document: {
          type: cert.type,
          certificateNumber: cert.certificateNumber,
          studentName: student?.name || 'N/A',
          fatherName: student?.fatherName || 'N/A',
          class: student?.class || 'N/A',
          group: student?.group || 'N/A'
        }
      });
    }

    // 4. Fee Voucher Verification
    if (kind === 'voucher') {
      const fee = await tenantDb.fee.findFirst({
        where: { OR: [{ id: refId }, { verifyToken: token }] }
      });

      if (!fee) {
        return sendUniformNotFound(res, req, token);
      }

      const student = await tenantDb.student.findFirst({
        where: { id: fee.student_id },
        select: { name: true }
      });

      let voucherStatus = 'UNPAID';
      if (fee.status === 'void') {
        voucherStatus = 'VOID';
      } else if (fee.status === 'paid') {
        voucherStatus = 'PAID';
      } else if (fee.status === 'partial') {
        voucherStatus = 'PARTIAL';
      } else if (fee.status === 'overdue') {
        voucherStatus = 'OVERDUE';
      }

      await logVerifyAttempt({ token, ip, userAgent, status: 'VERIFIED' });

      return res.json({
        success: true,
        kind: 'voucher',
        status: voucherStatus,
        issueDate: fee.createdAt,
        institution: {
          name: college.name,
          logo: college.logo || null
        },
        document: {
          voucherNumber: fee.challanNumber,
          studentName: maskStudentName(student?.name),
          amount: Number(fee.totalAmount),
          dueDate: fee.dueDate
        }
      });
    }

    // 5. Paid Receipt Verification
    if (kind === 'receipt') {
      const payment = await tenantDb.payment.findFirst({
        where: { OR: [{ id: refId }, { verifyToken: token }] }
      });

      if (!payment) {
        return sendUniformNotFound(res, req, token);
      }

      await logVerifyAttempt({ token, ip, userAgent, status: 'VERIFIED' });

      return res.json({
        success: true,
        kind: 'receipt',
        status: 'PAID',
        issueDate: payment.createdAt,
        institution: {
          name: college.name,
          logo: college.logo || null
        },
        document: {
          receiptNumber: payment.receiptNumber,
          amount: Number(payment.amount),
          paidDate: payment.createdAt,
          method: payment.paymentMethod
        }
      });
    }

    return sendUniformNotFound(res, req, token);
  } catch (error) {
    next(error);
  }
};
