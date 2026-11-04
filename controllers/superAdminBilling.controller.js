/**
 * superAdminBilling.controller.js — Phase 6A
 * Manages the Super Admin payment settlement queue.
 */

const { approvePayment, rejectPayment } = require('../services/settlementService');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// GET /api/super-admin/billing/pending
// Returns all PENDING payments, flagging suspected duplicates
// ---------------------------------------------------------------------------
async function getPendingPayments(req, res) {
  try {
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

module.exports = {
  getPendingPayments,
  getAllPayments,
  approvePaymentHandler,
  rejectPaymentHandler,
  getReceiptUrl,
  verifyReceipt,
};

