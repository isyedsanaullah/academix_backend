'use strict';

const { getSystemClient } = require('../../../config/prismaManager');
const { buildPaymentWhere } = require('../utils/buildPaymentWhere');
const { clearOverviewCache } = require('./overview.service');
const { approvePayment: settleApprove, rejectPayment: settleReject } = require('../../../services/settlementService');

/**
 * Retrieves paginated, sorted, and filtered list of payments.
 * 
 * @param {Object} filters 
 * @returns {Promise<Object>}
 */
async function getPaymentsList(filters = {}) {
  const prisma = getSystemClient();
  const where = buildPaymentWhere(filters);

  const page = Math.max(1, parseInt(filters.page, 10) || 1);
  const limit = Math.max(1, Math.min(100, parseInt(filters.limit, 10) || 20));
  const skip = (page - 1) * limit;

  const validSortFields = ['createdAt', 'reviewedAt', 'amountPaid', 'receiptNumber'];
  const sortBy = validSortFields.includes(filters.sortBy) ? filters.sortBy : 'createdAt';
  const sortOrder = filters.sortOrder === 'asc' ? 'asc' : 'desc';

  const [payments, total, statusAggregates] = await Promise.all([
    prisma.collegeSubscriptionPayment.findMany({
      where,
      select: {
        id: true,
        receiptNumber: true,
        type: true,
        planId: true,
        billingCycle: true,
        expectedAmount: true,
        amountPaid: true,
        verifiedAmount: true,
        paymentMethod: true,
        transactionId: true,
        screenshotUrl: true,
        status: true,
        rejectionReason: true,
        overrideNote: true,
        submittedBy: true,
        reviewedBy: true,
        reviewedAt: true,
        isDuplicateSuspected: true,
        createdAt: true,
        college: {
          select: {
            id: true,
            name: true,
            code: true,
            planId: true,
            isTest: true
          }
        }
      },
      orderBy: { [sortBy]: sortOrder },
      skip,
      take: limit
    }),
    prisma.collegeSubscriptionPayment.count({ where }),
    prisma.collegeSubscriptionPayment.groupBy({
      by: ['status'],
      where,
      _count: { id: true },
      _sum: { amountPaid: true, verifiedAmount: true }
    })
  ]);

  const summary = {
    totalCount: total,
    approvedCount: 0,
    pendingCount: 0,
    rejectedCount: 0,
    totalAmountPaid: 0,
    totalVerifiedAmount: 0
  };

  for (const agg of statusAggregates) {
    if (agg.status === 'APPROVED') {
      summary.approvedCount = agg._count.id;
      summary.totalVerifiedAmount += agg._sum.verifiedAmount || 0;
    } else if (agg.status === 'PENDING' || agg.status === 'APPROVING') {
      summary.pendingCount += agg._count.id;
    } else if (agg.status === 'REJECTED') {
      summary.rejectedCount = agg._count.id;
    }
    summary.totalAmountPaid += agg._sum.amountPaid || 0;
  }

  return {
    payments,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    },
    summary
  };
}

/**
 * Retrieves single payment detail with college and duplicate analysis.
 * 
 * @param {string} paymentId 
 * @returns {Promise<Object|null>}
 */
async function getPaymentDetail(paymentId) {
  if (!paymentId) return null;
  const prisma = getSystemClient();

  const payment = await prisma.collegeSubscriptionPayment.findUnique({
    where: { id: paymentId },
    include: {
      college: {
        select: {
          id: true,
          name: true,
          code: true,
          planId: true,
          billingCycle: true,
          subStatus: true,
          isTest: true
        }
      }
    }
  });

  if (!payment) return null;

  let suspectedDuplicates = [];
  if (payment.isDuplicateSuspected || payment.transactionId) {
    suspectedDuplicates = await prisma.collegeSubscriptionPayment.findMany({
      where: {
        id: { not: payment.id },
        OR: [
          payment.transactionId ? { transactionId: payment.transactionId } : null,
          {
            college_id: payment.college_id,
            amountPaid: payment.amountPaid
          }
        ].filter(Boolean)
      },
      select: {
        id: true,
        receiptNumber: true,
        transactionId: true,
        amountPaid: true,
        status: true,
        createdAt: true
      },
      take: 5
    });
  }

  // Fetch recent college entitlement audit records for this payment if any
  const auditLogs = await prisma.collegeEntitlementAudit.findMany({
    where: { paymentId },
    orderBy: { createdAt: 'desc' },
    take: 10
  });

  return {
    ...payment,
    suspectedDuplicates,
    auditLogs
  };
}

/**
 * Approves a payment proof via the atomic settlement engine.
 */
async function approvePayment(paymentId, options = {}, adminUser = {}) {
  const adminId = adminUser.id || adminUser.email || 'superAdmin';
  const result = await settleApprove(paymentId, adminId, {
    overrideNote: options.adminNotes,
    verifiedAmountOverride: options.verifiedAmount,
    ipAddress: options.ipAddress
  });

  clearOverviewCache();
  return result;
}

/**
 * Rejects a payment proof via the settlement engine.
 */
async function rejectPayment(paymentId, options = {}, adminUser = {}) {
  const adminId = adminUser.id || adminUser.email || 'superAdmin';
  const result = await settleReject(paymentId, adminId, {
    reason: options.rejectionReason,
    ipAddress: options.ipAddress
  });

  clearOverviewCache();
  return result;
}

module.exports = {
  getPaymentsList,
  getPaymentDetail,
  approvePayment,
  rejectPayment
};
