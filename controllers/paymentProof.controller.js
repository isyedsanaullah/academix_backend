/**
 * Payment Proof Controller
 * ─────────────────────────────────────────────────────────────
 * Handles student submission and accountant verification of
 * mobile wallet & bank payment screenshots (EasyPaisa, JazzCash, Raast).
 *
 * Invariants:
 * 1. Strict amount bounds (0 < amount <= voucher outstanding balance)
 * 2. 6-30 char alphanumeric transactionId, globally unique per college
 * 3. Max 3 pending proofs per voucher
 * 4. Forensic warnings calculated for accountant queue
 * 5. Multi-tenant isolation and audit logging
 */

const { Prisma } = require('@prisma/client');
const { getSystemClient } = require('../config/prismaManager');
const {
  isValidTransactionId,
  canTransition,
  computeProofWarnings,
  ALLOWED_PAYMENT_METHODS
} = require('../services/paymentProof.service');
const { generateVerifyToken } = require('../services/documentTemplates');
const { recordVerifyToken } = require('../services/verifyToken.service');
const { getPresignedDownloadUrl } = require('../services/storageService');

const toDecimal = (val) => {
  if (val === null || val === undefined || val === '') return new Prisma.Decimal(0);
  try { return new Prisma.Decimal(val); } catch { return new Prisma.Decimal(0); }
};

/**
 * POST /api/payment-proofs
 * Student submits payment proof for a fee voucher
 */
exports.submitPaymentProof = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const collegeId = req.collegeId;
    const userId = req.user.id || req.user._id;

    const {
      feeId,
      method,
      amount,
      transactionId,
      paidOn,
      senderPhone,
      senderName,
      file_id
    } = req.body;

    if (!feeId || !method || amount === undefined || !transactionId || !file_id) {
      return res.status(400).json({
        success: false,
        code: 'MISSING_FIELDS',
        message: 'feeId, method, amount, transactionId, and file_id are required'
      });
    }

    const cleanMethod = String(method).toLowerCase().trim();
    if (!ALLOWED_PAYMENT_METHODS.includes(cleanMethod)) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_METHOD',
        message: `Payment method must be one of: ${ALLOWED_PAYMENT_METHODS.join(', ')}`
      });
    }

    const cleanTxId = String(transactionId).trim();
    if (!isValidTransactionId(cleanTxId)) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_TRANSACTION_ID',
        message: 'Transaction ID must be 6 to 30 alphanumeric characters'
      });
    }

    // Resolve Student
    let student = null;
    if (req.user.role === 'student') {
      student = await tenantDb.student.findFirst({
        where: { college_id: collegeId, user_id: userId }
      });
      if (!student) {
        return res.status(404).json({ success: false, code: 'STUDENT_NOT_FOUND', message: 'Student record not found' });
      }
    } else {
      // Admin/Staff submitting on behalf of a student
      const { studentId } = req.body;
      if (!studentId) {
        return res.status(400).json({ success: false, code: 'STUDENT_REQUIRED', message: 'studentId is required for staff submissions' });
      }
      student = await tenantDb.student.findFirst({
        where: { id: studentId, college_id: collegeId }
      });
      if (!student) {
        return res.status(404).json({ success: false, code: 'STUDENT_NOT_FOUND', message: 'Student not found' });
      }
    }

    // Verify Fee Voucher
    const fee = await tenantDb.fee.findFirst({
      where: { id: feeId, college_id: collegeId, student_id: student.id }
    });

    if (!fee) {
      return res.status(404).json({ success: false, code: 'VOUCHER_NOT_FOUND', message: 'Fee voucher not found for this student' });
    }

    if (fee.status === 'void') {
      return res.status(400).json({ success: false, code: 'VOUCHER_VOID', message: 'This fee voucher has been voided' });
    }

    const totalAmount = toDecimal(fee.totalAmount);
    const paidAmount = toDecimal(fee.paidAmount);
    const balance = totalAmount.minus(paidAmount);
    const proofAmount = toDecimal(amount);

    if (proofAmount.lte(0)) {
      return res.status(400).json({ success: false, code: 'INVALID_AMOUNT', message: 'Payment amount must be greater than 0' });
    }

    if (proofAmount.gt(balance)) {
      return res.status(400).json({
        success: false,
        code: 'AMOUNT_EXCEEDS_BALANCE',
        message: `Submitted amount (Rs. ${proofAmount}) exceeds voucher remaining balance (Rs. ${balance})`,
        balance: balance.toNumber()
      });
    }

    // Check duplicate transactionId in college
    const existingTx = await tenantDb.paymentProof.findFirst({
      where: { college_id: collegeId, transactionId: cleanTxId }
    });

    if (existingTx) {
      if (existingTx.student_id === student.id) {
        return res.status(409).json({
          success: false,
          code: 'DUPLICATE_TRANSACTION',
          message: `Transaction ID ${cleanTxId} has already been submitted for voucher ${existingTx.fee_id}`,
          voucherId: existingTx.fee_id
        });
      }
      return res.status(409).json({
        success: false,
        code: 'DUPLICATE_TRANSACTION',
        message: `Transaction ID ${cleanTxId} has already been registered in this institution.`
      });
    }

    // Enforce max 3 pending proofs per voucher
    const pendingCount = await tenantDb.paymentProof.count({
      where: { college_id: collegeId, fee_id: fee.id, status: 'pending' }
    });

    if (pendingCount >= 3) {
      return res.status(400).json({
        success: false,
        code: 'MAX_PENDING_PROOFS',
        message: 'Maximum 3 pending payment proofs allowed per voucher. Please wait for accountant review.'
      });
    }

    // Verify StoredFile exists and update category/entity
    const file = await tenantDb.storedFile.findFirst({
      where: { id: file_id, college_id: collegeId }
    });

    if (!file) {
      return res.status(404).json({ success: false, code: 'FILE_NOT_FOUND', message: 'Uploaded screenshot not found' });
    }

    const proof = await tenantDb.paymentProof.create({
      data: {
        college_id: collegeId,
        student_id: student.id,
        fee_id: fee.id,
        method: cleanMethod,
        amount: proofAmount,
        transactionId: cleanTxId,
        senderName: senderName || null,
        senderPhone: senderPhone ? String(senderPhone).trim() : null,
        paidOn: paidOn ? new Date(paidOn) : new Date(),
        file_id,
        status: 'pending'
      }
    });

    // Link file to PaymentProof entity
    await tenantDb.storedFile.update({
      where: { id: file_id },
      data: {
        entityType: 'PaymentProof',
        entityId: proof.id,
        category: 'payment-proofs'
      }
    });

    res.status(201).json({
      success: true,
      message: 'Payment proof submitted successfully. Awaiting accountant confirmation.',
      data: {
        ...proof,
        amount: proofAmount.toNumber()
      }
    });
  } catch (error) { next(error); }
};

/**
 * GET /api/payment-proofs
 * Accountant queue with forensic warnings
 */
exports.getPaymentProofs = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const collegeId = req.collegeId;
    const { status = 'pending', studentId, feeId, page = 1, limit = 50 } = req.query;

    const where = { college_id: collegeId };
    if (status && status !== 'all') {
      where.status = status;
    }
    if (studentId) where.student_id = studentId;
    if (feeId) where.fee_id = feeId;

    const skip = (Math.max(1, Number(page)) - 1) * Number(limit);
    const take = Math.min(100, Math.max(1, Number(limit)));

    const [total, proofs] = await Promise.all([
      tenantDb.paymentProof.count({ where }),
      tenantDb.paymentProof.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take
      })
    ]);

    // Fetch related records in batch
    const studentIds = [...new Set(proofs.map(p => p.student_id))];
    const feeIds = [...new Set(proofs.map(p => p.fee_id))];
    const fileIds = [...new Set(proofs.map(p => p.file_id))];

    const [students, fees, files] = await Promise.all([
      tenantDb.student.findMany({
        where: { id: { in: studentIds } },
        select: { id: true, name: true, rollNumber: true, class: true, phone: true }
      }),
      tenantDb.fee.findMany({
        where: { id: { in: feeIds } },
        select: { id: true, challanNumber: true, month: true, totalAmount: true, paidAmount: true, dueDate: true, createdAt: true, status: true }
      }),
      tenantDb.storedFile.findMany({
        where: { id: { in: fileIds } },
        select: { id: true, objectKey: true, checksumSha256: true }
      })
    ]);

    const studentMap = Object.fromEntries(students.map(s => [s.id, s]));
    const feeMap = Object.fromEntries(fees.map(f => [f.id, f]));
    const fileMap = Object.fromEntries(files.map(f => [f.id, f]));

    // Compute warnings and presigned URLs for each proof
    const enrichedProofs = await Promise.all(proofs.map(async (proof) => {
      const student = studentMap[proof.student_id] || null;
      const fee = feeMap[proof.fee_id] || null;
      const file = fileMap[proof.file_id] || null;

      const warnings = fee ? await computeProofWarnings({ proof, fee, tenantDb }) : [];

      let screenshotUrl = null;
      if (file?.objectKey) {
        try {
          screenshotUrl = await getPresignedDownloadUrl(file.objectKey, 3600);
        } catch {}
      }

      return {
        ...proof,
        amount: Number(proof.amount),
        student,
        fee: fee ? {
          ...fee,
          totalAmount: Number(fee.totalAmount),
          paidAmount: Number(fee.paidAmount || 0)
        } : null,
        screenshotUrl,
        warnings
      };
    }));

    res.json({
      success: true,
      total,
      page: Number(page),
      limit: take,
      data: enrichedProofs
    });
  } catch (error) { next(error); }
};

/**
 * PUT /api/payment-proofs/:id/verify
 * Accountant verifies payment proof and creates authoritative Payment record
 */
exports.verifyPaymentProof = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const collegeId = req.collegeId;
    const accountantId = req.user.id || req.user._id;
    const { id } = req.params;

    const proof = await tenantDb.paymentProof.findFirst({
      where: { id, college_id: collegeId }
    });

    if (!proof) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Payment proof not found' });
    }

    if (!canTransition(proof.status, 'verified')) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_TRANSITION',
        message: `Cannot verify a proof currently in '${proof.status}' status`
      });
    }

    const fee = await tenantDb.fee.findFirst({
      where: { id: proof.fee_id, college_id: collegeId }
    });

    if (!fee) {
      return res.status(404).json({ success: false, code: 'FEE_NOT_FOUND', message: 'Associated fee voucher not found' });
    }

    const payAmt = toDecimal(proof.amount);
    const feeTotal = toDecimal(fee.totalAmount);
    const existingPaid = toDecimal(fee.paidAmount || 0);
    const newPaidSum = existingPaid.plus(payAmt);

    if (newPaidSum.gt(feeTotal)) {
      return res.status(400).json({
        success: false,
        code: 'PAYMENT_EXCEEDS_BALANCE',
        message: 'Payment amount exceeds remaining voucher balance'
      });
    }

    const receiptNumber = `RCP-${Date.now().toString(36).toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const verifyToken = generateVerifyToken();
    const newFeeStatus = newPaidSum.gte(feeTotal) ? 'paid' : 'partial';

    // Atomic transaction: Payment + Fee update + Proof update + Ledger
    const result = await tenantDb.$transaction(async (tx) => {
      // 1. Create Payment
      const payment = await tx.payment.create({
        data: {
          college_id: collegeId,
          fee_id: fee.id,
          student_id: proof.student_id,
          amount: payAmt,
          paymentMethod: proof.method,
          receiptNumber,
          referenceNumber: proof.transactionId,
          receivedBy: accountantId,
          verifiedBy: accountantId,
          verifyToken,
          remarks: `Verified from payment proof (${proof.method.toUpperCase()}: ${proof.transactionId})`
        }
      });

      // 2. Update Fee
      const updatedFee = await tx.fee.update({
        where: { id: fee.id },
        data: {
          paidAmount: newPaidSum,
          status: newFeeStatus,
          paidDate: new Date(),
          receiptNumber
        }
      });

      // 3. Update PaymentProof
      const updatedProof = await tx.paymentProof.update({
        where: { id: proof.id },
        data: {
          status: 'verified',
          verifiedBy: accountantId,
          verifiedAt: new Date(),
          payment_id: payment.id
        }
      });

      // 4. Treasury transaction
      await tx.transaction.create({
        data: {
          college_id: collegeId,
          type: 'income',
          category: 'fee_collection',
          amount: payAmt,
          description: `Payment proof verified - ${proof.method.toUpperCase()} ${proof.transactionId}`,
          reference: receiptNumber,
          relatedTo: { model: 'Payment', id: payment.id, fee_id: fee.id }
        }
      });

      return { payment, fee: updatedFee, proof: updatedProof };
    });

    // Register verifyToken in system DB
    await recordVerifyToken({
      token: verifyToken,
      collegeId,
      kind: 'receipt',
      refId: result.payment.id
    }).catch(err => console.error('Failed to register receipt verifyToken:', err.message));

    // Audit Log & Student Notification
    const sysDb = getSystemClient();
    await sysDb.collegeEntitlementAudit.create({
      data: {
        college_id: collegeId,
        actorUserId: accountantId,
        actorEmail: req.user.email || null,
        action: 'VERIFY_PAYMENT_PROOF',
        featureKey: 'payment-proof',
        previousVal: 'pending',
        newVal: 'verified',
        reason: `Transaction ${proof.transactionId} verified for Rs. ${payAmt}`
      }
    }).catch(() => {});

    // Notify student with receipt link
    const student = await tenantDb.student.findUnique({
      where: { id: proof.student_id },
      select: { user_id: true, name: true }
    });

    if (student?.user_id) {
      await tenantDb.notification.create({
        data: {
          college_id: collegeId,
          recipient: student.user_id,
          title: 'Fee Payment Verified',
          message: `Your payment of Rs. ${payAmt} (${proof.method.toUpperCase()}) for challan ${fee.challanNumber} has been verified successfully. Receipt No: ${receiptNumber}.`,
          type: 'fee',
          link: `/student/fees`
        }
      }).catch(() => {});
    }

    res.json({
      success: true,
      message: 'Payment proof verified successfully. Official payment and receipt generated.',
      data: {
        proof: result.proof,
        payment: { ...result.payment, amount: payAmt.toNumber() },
        receiptNumber
      }
    });
  } catch (error) { next(error); }
};

/**
 * PUT /api/payment-proofs/:id/reject
 * Accountant rejects payment proof with a mandatory reason
 */
exports.rejectPaymentProof = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const collegeId = req.collegeId;
    const accountantId = req.user.id || req.user._id;
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
      return res.status(400).json({
        success: false,
        code: 'REASON_REQUIRED',
        message: 'A rejection reason is required'
      });
    }

    const proof = await tenantDb.paymentProof.findFirst({
      where: { id, college_id: collegeId }
    });

    if (!proof) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Payment proof not found' });
    }

    if (!canTransition(proof.status, 'rejected')) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_TRANSITION',
        message: `Cannot reject a proof currently in '${proof.status}' status`
      });
    }

    const updated = await tenantDb.paymentProof.update({
      where: { id: proof.id },
      data: {
        status: 'rejected',
        rejectReason: reason.trim(),
        verifiedBy: accountantId,
        verifiedAt: new Date()
      }
    });

    // Audit log
    const sysDb = getSystemClient();
    await sysDb.collegeEntitlementAudit.create({
      data: {
        college_id: collegeId,
        actorUserId: accountantId,
        actorEmail: req.user.email || null,
        action: 'REJECT_PAYMENT_PROOF',
        featureKey: 'payment-proof',
        previousVal: proof.status,
        newVal: 'rejected',
        reason: reason.trim()
      }
    }).catch(() => {});

    // Notify student
    const student = await tenantDb.student.findUnique({
      where: { id: proof.student_id },
      select: { user_id: true }
    });

    if (student?.user_id) {
      await tenantDb.notification.create({
        data: {
          college_id: collegeId,
          recipient: student.user_id,
          title: 'Payment Proof Rejected',
          message: `Your payment proof for transaction ${proof.transactionId} was rejected by the accountant. Reason: ${reason.trim()}`,
          type: 'fee',
          link: `/student/fees`
        }
      }).catch(() => {});
    }

    res.json({
      success: true,
      message: 'Payment proof rejected successfully',
      data: updated
    });
  } catch (error) { next(error); }
};

/**
 * PUT /api/payment-proofs/:id/duplicate
 * Mark payment proof as duplicate
 */
exports.markDuplicatePaymentProof = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const collegeId = req.collegeId;
    const accountantId = req.user.id || req.user._id;
    const { id } = req.params;

    const proof = await tenantDb.paymentProof.findFirst({
      where: { id, college_id: collegeId }
    });

    if (!proof) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Payment proof not found' });
    }

    const updated = await tenantDb.paymentProof.update({
      where: { id: proof.id },
      data: {
        status: 'duplicate',
        rejectReason: 'Marked as duplicate transaction by accountant',
        verifiedBy: accountantId,
        verifiedAt: new Date()
      }
    });

    res.json({
      success: true,
      message: 'Payment proof marked as duplicate',
      data: updated
    });
  } catch (error) { next(error); }
};

/**
 * GET /api/payment-proofs/daily-report
 * Daily payment proofs summary report for accountant dashboard
 */
exports.getDailyProofsReport = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const collegeId = req.collegeId;
    const { date } = req.query;

    const targetDate = date ? new Date(date) : new Date();
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    const proofs = await tenantDb.paymentProof.findMany({
      where: {
        college_id: collegeId,
        createdAt: { gte: startOfDay, lte: endOfDay }
      }
    });

    const summary = {
      date: startOfDay.toISOString().slice(0, 10),
      totalSubmitted: proofs.length,
      pending: { count: 0, amount: 0 },
      verified: { count: 0, amount: 0 },
      rejected: { count: 0, amount: 0 },
      duplicate: { count: 0, amount: 0 }
    };

    proofs.forEach((p) => {
      const s = (p.status || 'pending').toLowerCase();
      const amt = Number(p.amount || 0);
      if (summary[s]) {
        summary[s].count += 1;
        summary[s].amount += amt;
      }
    });

    res.json({
      success: true,
      data: summary
    });
  } catch (error) { next(error); }
};

/**
 * POST /api/payment-proofs/:id/ocr
 * Enterprise add-on stub returning 501
 */
exports.stubPaymentOcr = async (req, res) => {
  return res.status(501).json({
    success: false,
    code: 'NOT_BUILT',
    message: 'AI Payment OCR is an Enterprise add-on under development.'
  });
};

/**
 * GET /api/payment-proofs/accounts
 * Retrieve college payment accounts (for student view)
 */
exports.getPaymentAccounts = async (req, res, next) => {
  try {
    const sysDb = getSystemClient();
    const college = await sysDb.college.findUnique({
      where: { id: req.collegeId },
      select: { settings: true }
    });

    const settings = (college?.settings && typeof college.settings === 'object') ? college.settings : {};
    const accounts = Array.isArray(settings.paymentAccounts) ? settings.paymentAccounts : [];

    res.json({
      success: true,
      data: accounts
    });
  } catch (error) { next(error); }
};

/**
 * PUT /api/payment-proofs/accounts
 * Update college payment accounts (Admin only)
 */
exports.updatePaymentAccounts = async (req, res, next) => {
  try {
    const sysDb = getSystemClient();
    const { paymentAccounts } = req.body;

    if (!Array.isArray(paymentAccounts)) {
      return res.status(400).json({
        success: false,
        code: 'BAD_REQUEST',
        message: 'paymentAccounts array is required'
      });
    }

    const college = await sysDb.college.findUnique({
      where: { id: req.collegeId },
      select: { settings: true }
    });

    const currentSettings = (college?.settings && typeof college.settings === 'object') ? college.settings : {};
    const updatedSettings = {
      ...currentSettings,
      paymentAccounts
    };

    await sysDb.college.update({
      where: { id: req.collegeId },
      data: { settings: updatedSettings }
    });

    res.json({
      success: true,
      message: 'Payment accounts updated successfully',
      data: paymentAccounts
    });
  } catch (error) { next(error); }
};
