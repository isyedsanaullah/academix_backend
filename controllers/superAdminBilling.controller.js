/**
 * superAdminBilling.controller.js — Phase 6A
 * Manages the Super Admin payment settlement queue.
 */

const { approvePayment, rejectPayment } = require('../services/settlementService');
const { getSystemClient } = require('../config/prismaManager');
const {
  getBillingOverview,
  getInvoiceBillingDetail,
  approveBillingInvoice,
  denyBillingInvoice,
  manualToggleCollegeSubscription,
  getCollegeBillingHistory,
  getBillingAuditLogs,
} = require('../services/superAdminBillingService');

function getPrisma() {
  return getSystemClient();
}

function assertSuperAdmin(req, res) {
  if (!req.user || req.user.role !== 'superAdmin') {
    res.status(403).json({
      success: false,
      code: 'FORBIDDEN',
      message: 'Super Admin access is required for billing operations.',
    });
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// GET /api/super-admin/billing/pending
// Returns all PENDING payments, flagging suspected duplicates
// ---------------------------------------------------------------------------
async function getPendingPayments(req, res) {
  try {
    const prisma = getPrisma();
    const payments = await prisma.collegeSubscriptionPayment.findMany({
      where: { status: 'PENDING' },
      include: {
        college: { select: { id: true, name: true, planId: true, subStatus: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Flag SLA violations (pending > 24h)
    const now = Date.now();
    const enriched = payments.map((p) => ({
      ...p,
      slaSlaBreached: now - new Date(p.createdAt).getTime() > 24 * 60 * 60 * 1000,
    }));

    return res.json({ payments: enriched });
  } catch (err) {
    console.error('[billing] getPendingPayments error:', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR', message: err.message });
  }
}

// ---------------------------------------------------------------------------
// GET /api/super-admin/billing/all
// Full payment history with filters
// ---------------------------------------------------------------------------
async function getAllPayments(req, res) {
  try {
    const prisma = getPrisma();
    const { status, college_id, from, to, page = 1, limit = 20 } = req.query;
    const where = {};
    if (status) where.status = status;
    if (college_id) where.college_id = college_id;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    const [payments, total] = await Promise.all([
      prisma.collegeSubscriptionPayment.findMany({
        where,
        include: { college: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: Number(limit),
      }),
      prisma.collegeSubscriptionPayment.count({ where }),
    ]);

    return res.json({ payments, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    return res.status(500).json({ error: 'INTERNAL_ERROR', message: err.message });
  }
}

// ---------------------------------------------------------------------------
// POST /api/super-admin/billing/approve/:paymentId
// Approve a pending payment — requires step-up token (added in 6B)
// ---------------------------------------------------------------------------
async function approvePaymentHandler(req, res) {
  const { paymentId } = req.params;
  const { overrideNote, verifiedAmountOverride } = req.body;
  const adminUserId = req.user.id;
  const ipAddress = req.ip;

  try {
    const result = await approvePayment(paymentId, adminUserId, {
      overrideNote,
      verifiedAmountOverride: verifiedAmountOverride ? Number(verifiedAmountOverride) : undefined,
      ipAddress,
    });
    return res.json({ success: true, ...result });
  } catch (err) {
    const statusCode = err.status || 500;
    return res.status(statusCode).json({
      error: err.code || err.message,
      detail: err.detail || undefined,
    });
  }
}

// ---------------------------------------------------------------------------
// POST /api/super-admin/billing/reject/:paymentId
// ---------------------------------------------------------------------------
async function rejectPaymentHandler(req, res) {
  const { paymentId } = req.params;
  const { reason } = req.body;
  const adminUserId = req.user.id;
  const ipAddress = req.ip;

  try {
    const result = await rejectPayment(paymentId, adminUserId, { reason, ipAddress });
    return res.json({ success: true, ...result });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
}

// ---------------------------------------------------------------------------
// GET /api/super-admin/billing/receipt/:paymentId
// Returns a 15-min presigned URL to view the uploaded payment proof
// ---------------------------------------------------------------------------
async function getReceiptUrl(req, res) {
  const { paymentId } = req.params;
  try {
    const prisma = getPrisma();
    const payment = await prisma.collegeSubscriptionPayment.findUnique({
      where: { id: paymentId },
    });
    if (!payment) return res.status(404).json({ error: 'NOT_FOUND' });

    const { getPresignedDownloadUrl } = require('../services/storageService');
    const url = await getPresignedDownloadUrl({ objectKey: payment.screenshotUrl, expiresIn: 900 });
    return res.json({ url, expiresIn: 900 });
  } catch (err) {
    return res.status(500).json({ error: 'INTERNAL_ERROR', message: err.message });
  }
}

// ---------------------------------------------------------------------------
// GET /api/super-admin/billing/verify/:receiptNumber?sig=<hmac>
// Public receipt verification (minimal data, HMAC-signed)
// ---------------------------------------------------------------------------
async function verifyReceipt(req, res) {
  const { receiptNumber } = req.params;
  const { sig } = req.query;

  // Verify HMAC
  const crypto = require('crypto');
  const secret = process.env.RECEIPT_VERIFY_SECRET || 'changeme';
  const expected = crypto.createHmac('sha256', secret).update(receiptNumber).digest('hex');
  if (sig !== expected) {
    return res.status(403).json({ error: 'INVALID_SIGNATURE' });
  }

  try {
    const prisma = getPrisma();
    const payment = await prisma.collegeSubscriptionPayment.findFirst({
      where: { receiptNumber },
      include: { college: { select: { name: true, planId: true } } },
    });
    if (!payment) return res.status(404).json({ error: 'RECEIPT_NOT_FOUND' });

    return res.json({
      receiptNumber: payment.receiptNumber,
      collegeDisplayName: payment.college.name,
      planName: payment.college.planId,
      amountPkr: payment.verifiedAmount ?? payment.amountPaid,
      verifiedAt: payment.reviewedAt,
      status: payment.status,
    });
  } catch (err) {
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
}

// ---------------------------------------------------------------------------
// Unified Accounts / Billing Handlers (PlatformInvoice + CollegeSubscription)
// ---------------------------------------------------------------------------

async function getBillingOverviewHandler(req, res) {
  if (!assertSuperAdmin(req, res)) return;
  try {
    const prisma = getPrisma();
    const { status, invoiceStatus, planId, search, page, limit } = req.query;
    const data = await getBillingOverview(prisma, { status, invoiceStatus, planId, search, page, limit });
    return res.status(200).json({ success: true, data });
  } catch (err) {
    console.error('[billing] getBillingOverviewHandler error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to load billing overview.' });
  }
}

async function getInvoiceDetailHandler(req, res) {
  if (!assertSuperAdmin(req, res)) return;
  try {
    const prisma = getPrisma();
    const data = await getInvoiceBillingDetail(prisma, req.params.invoiceId);
    let proofUrl = null;
    if (data.invoice?.proofObjectKey) {
      const { getPresignedDownloadUrl } = require('../services/storageService');
      proofUrl = await getPresignedDownloadUrl({ objectKey: data.invoice.proofObjectKey, expiresIn: 900 }).catch(() => null);
    }
    return res.status(200).json({ success: true, data: { ...data, proofUrl } });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, code: err.code, message: err.message });
  }
}

async function getInvoiceProofUrlHandler(req, res) {
  if (!assertSuperAdmin(req, res)) return;
  try {
    const prisma = getPrisma();
    const invoice = await prisma.platformInvoice.findUnique({ where: { id: req.params.invoiceId } });
    if (!invoice || !invoice.proofObjectKey) {
      return res.status(404).json({ success: false, message: 'No uploaded proof found for this invoice.' });
    }
    const { getPresignedDownloadUrl } = require('../services/storageService');
    const url = await getPresignedDownloadUrl({ objectKey: invoice.proofObjectKey, expiresIn: 900 });
    return res.status(200).json({
      success: true,
      url,
      mimeType: invoice.proofMimeType || null,
      expiresIn: 900,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Failed to generate proof URL.' });
  }
}

async function approveInvoiceHandler(req, res) {
  if (!assertSuperAdmin(req, res)) return;
  try {
    const prisma = getPrisma();
    const result = await approveBillingInvoice(prisma, {
      invoiceId: req.params.invoiceId,
      adminUserId: req.user.id,
      adminEmail: req.user.email || null,
      note: req.body?.note || null,
      ipAddress: req.ip || null,
    });
    return res.status(200).json({
      success: true,
      message: `Invoice ${result.invoice.invoiceNo} approved and subscription activated.`,
      data: result,
    });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, code: err.code, message: err.message });
  }
}

async function denyInvoiceHandler(req, res) {
  if (!assertSuperAdmin(req, res)) return;
  try {
    const prisma = getPrisma();
    const result = await denyBillingInvoice(prisma, {
      invoiceId: req.params.invoiceId,
      adminUserId: req.user.id,
      adminEmail: req.user.email || null,
      reason: req.body?.reason,
      ipAddress: req.ip || null,
    });
    return res.status(200).json({
      success: true,
      message: `Invoice ${result.invoice.invoiceNo} marked REJECTED.`,
      data: result,
    });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, code: err.code, message: err.message });
  }
}

async function activateCollegeSubscriptionHandler(req, res) {
  if (!assertSuperAdmin(req, res)) return;
  try {
    const prisma = getPrisma();
    const { reason, planId, billingCycle } = req.body || {};
    const result = await manualToggleCollegeSubscription(prisma, {
      collegeId: req.params.collegeId,
      action: 'ACTIVATE',
      reason,
      planId,
      billingCycle,
      adminUserId: req.user.id,
      adminEmail: req.user.email || null,
      ipAddress: req.ip || null,
    });
    return res.status(200).json({
      success: true,
      message: 'College subscription manually activated.',
      data: result,
    });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, code: err.code, message: err.message });
  }
}

async function deactivateCollegeSubscriptionHandler(req, res) {
  if (!assertSuperAdmin(req, res)) return;
  try {
    const prisma = getPrisma();
    const { reason } = req.body || {};
    const result = await manualToggleCollegeSubscription(prisma, {
      collegeId: req.params.collegeId,
      action: 'DEACTIVATE',
      reason,
      adminUserId: req.user.id,
      adminEmail: adminEmailOrNull(req),
      ipAddress: req.ip || null,
    });
    return res.status(200).json({
      success: true,
      message: 'College subscription manually deactivated.',
      data: result,
    });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, code: err.code, message: err.message });
  }
}

function adminEmailOrNull(req) {
  return req.user?.email || null;
}

async function getCollegeBillingHistoryHandler(req, res) {
  if (!assertSuperAdmin(req, res)) return;
  try {
    const prisma = getPrisma();
    const data = await getCollegeBillingHistory(prisma, req.params.collegeId);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, code: err.code, message: err.message });
  }
}

async function getBillingAuditLogsHandler(req, res) {
  if (!assertSuperAdmin(req, res)) return;
  try {
    const prisma = getPrisma();
    const { collegeId, action, page, limit } = req.query;
    const data = await getBillingAuditLogs(prisma, { collegeId, action, page, limit });
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Failed to fetch billing audit logs.' });
  }
}

module.exports = {
  getPendingPayments,
  getAllPayments,
  approvePaymentHandler,
  rejectPaymentHandler,
  getReceiptUrl,
  verifyReceipt,
  getBillingOverviewHandler,
  getInvoiceDetailHandler,
  getInvoiceProofUrlHandler,
  approveInvoiceHandler,
  denyInvoiceHandler,
  activateCollegeSubscriptionHandler,
  deactivateCollegeSubscriptionHandler,
  getCollegeBillingHistoryHandler,
  getBillingAuditLogsHandler,
};

