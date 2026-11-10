'use strict';

const { getSystemClient } = require('../../../config/prismaManager');
const { PLAN_PRICING, PLAN_LIMITS, normalizePlanId } = require('../../../config/planConstants');
const { FINANCE_SAFE_USER_SELECT } = require('../../../utils/safeUser');
const { getSettledAmount } = require('../definitions');

/**
 * Derives official plan price in PKR based on canonical planId and billingCycle.
 */
function derivePlanPrice(planId, billingCycle = 'MONTHLY') {
  const normPlan = normalizePlanId(planId);
  const cycle = String(billingCycle || 'MONTHLY').toUpperCase() === 'YEARLY' ? 'yearly' : 'monthly';
  const pricing = PLAN_PRICING[normPlan] || PLAN_PRICING.starter;
  return pricing[cycle] || pricing.monthly;
}

/**
 * Retrieves paginated list of colleges with billing setups and derived metrics.
 * 
 * @param {Object} filters 
 * @returns {Promise<Object>}
 */
async function getCollegeBillingList(filters = {}) {
  const prisma = getSystemClient();

  const page = Math.max(1, parseInt(filters.page, 10) || 1);
  const limit = Math.max(1, Math.min(100, parseInt(filters.limit, 10) || 20));
  const skip = (page - 1) * limit;

  const andConditions = [];

  // 1. Test Isolation
  if (!filters.includeTest) {
    andConditions.push({ isTest: false });
  }

  // 2. Plan filter
  if (filters.planId && filters.planId !== 'ALL') {
    andConditions.push({ planId: normalizePlanId(filters.planId) });
  }

  // 3. Status filter
  if (filters.subStatus && filters.subStatus !== 'ALL') {
    andConditions.push({ subStatus: String(filters.subStatus).toUpperCase() });
  }

  // 4. Search query q (name or code)
  if (filters.q) {
    const qTerm = String(filters.q).trim();
    andConditions.push({
      OR: [
        { name: { contains: qTerm, mode: 'insensitive' } },
        { code: { contains: qTerm, mode: 'insensitive' } }
      ]
    });
  }

  const where = andConditions.length > 0 ? { AND: andConditions } : {};

  // Summary aggregation: does not filter by subStatus so stats cards preserve their accurate counts
  const summaryAndConditions = [];
  if (!filters.includeTest) {
    summaryAndConditions.push({ isTest: false });
  }
  if (filters.planId && filters.planId !== 'ALL') {
    summaryAndConditions.push({ planId: normalizePlanId(filters.planId) });
  }
  if (filters.q) {
    const qTerm = String(filters.q).trim();
    summaryAndConditions.push({
      OR: [
        { name: { contains: qTerm, mode: 'insensitive' } },
        { code: { contains: qTerm, mode: 'insensitive' } }
      ]
    });
  }
  const summaryWhere = summaryAndConditions.length > 0 ? { AND: summaryAndConditions } : {};

  const [colleges, total, statusAggregates, totalSummaryCount] = await Promise.all([
    prisma.college.findMany({
      where,
      select: {
        id: true,
        name: true,
        code: true,
        slug: true,
        planId: true,
        billingCycle: true,
        subStatus: true,
        periodEnd: true,
        pendingDowngradePlanId: true,
        isTest: true,
        createdAt: true,
        subscriptionPayments: {
          select: {
            id: true,
            amountPaid: true,
            verifiedAmount: true,
            status: true,
            createdAt: true
          },
          orderBy: { createdAt: 'desc' },
          take: 5
        }
      },
      orderBy: { name: 'asc' },
      skip,
      take: limit
    }),
    prisma.college.count({ where }),
    prisma.college.groupBy({
      by: ['subStatus'],
      where: summaryWhere,
      _count: { id: true }
    }),
    prisma.college.count({ where: summaryWhere })
  ]);

  const summary = {
    total: totalSummaryCount,
    active: 0,
    trial: 0,
    expired: 0
  };

  for (const agg of statusAggregates) {
    const s = String(agg.subStatus || '').toUpperCase();
    const count = agg._count.id;
    if (s === 'ACTIVE') {
      summary.active += count;
    } else if (s === 'TRIAL') {
      summary.trial += count;
    } else if (s === 'EXPIRED' || s === 'SUSPENDED') {
      summary.expired += count;
    }
  }

  const enrichedColleges = colleges.map(c => {
    const normPlan = normalizePlanId(c.planId);
    const billingPrice = derivePlanPrice(normPlan, c.billingCycle);

    let totalSettledRevenue = 0;
    const payments = c.subscriptionPayments || [];
    const latestPayment = payments.length > 0 ? payments[0] : null;

    for (const p of payments) {
      totalSettledRevenue += getSettledAmount(p);
    }

    return {
      id: c.id,
      name: c.name,
      code: c.code,
      slug: c.slug,
      planId: normPlan,
      billingCycle: c.billingCycle || 'MONTHLY',
      billingPrice,
      subStatus: c.subStatus || 'ACTIVE',
      subscriptionExpiresAt: c.periodEnd,
      pendingDowngradePlanId: c.pendingDowngradePlanId,
      isTest: c.isTest,
      totalSettledRevenue,
      recentPaymentsCount: payments.length,
      latestPaymentDate: latestPayment ? latestPayment.createdAt : null,
      latestPaymentStatus: latestPayment ? latestPayment.status : null
    };
  });

  return {
    colleges: enrichedColleges,
    summary,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  };
}

/**
 * Retrieves comprehensive college billing setup, limits, usage, ledger, and accountants.
 * 
 * @param {string} collegeIdOrCode 
 * @returns {Promise<Object|null>}
 */
async function getCollegeBillingDetail(collegeIdOrCode) {
  if (!collegeIdOrCode) return null;
  const prisma = getSystemClient();

  const college = await prisma.college.findFirst({
    where: {
      OR: [
        { id: collegeIdOrCode },
        { code: collegeIdOrCode },
        { slug: collegeIdOrCode }
      ]
    },
    include: {
      subscriptionPayments: {
        select: {
          id: true,
          receiptNumber: true,
          type: true,
          planId: true,
          billingCycle: true,
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
          createdAt: true
        },
        orderBy: { createdAt: 'desc' }
      }
    }
  });

  if (!college) return null;

  const normPlan = normalizePlanId(college.planId);
  const billingPrice = derivePlanPrice(normPlan, college.billingCycle);
  const baseLimits = PLAN_LIMITS[normPlan] || PLAN_LIMITS.starter;

  // Fetch usage metrics from CollegeUsage
  const usageRows = await prisma.collegeUsage.findMany({
    where: { college_id: college.id, period: 'total' }
  });
  const usageMap = {};
  for (const row of usageRows) {
    usageMap[row.metric] = Number(row.value);
  }

  // Fetch accountants using strict FINANCE_SAFE_USER_SELECT (omits cnic, passwords, tokens)
  const accountants = await prisma.user.findMany({
    where: {
      college_id: college.id,
      role: 'accountant'
    },
    select: FINANCE_SAFE_USER_SELECT
  });

  // Calculate settled totals
  let totalSettledRevenue = 0;
  let pendingAmount = 0;
  let blockingPayment = null;
  const ledger = college.subscriptionPayments || [];

  for (const p of ledger) {
    totalSettledRevenue += getSettledAmount(p);
    if (['PENDING', 'APPROVING'].includes(p.status)) {
      pendingAmount += p.amountPaid;
      if (!blockingPayment) blockingPayment = p;
    }
  }

  return {
    college: {
      id: college.id,
      name: college.name,
      code: college.code,
      slug: college.slug,
      planId: normPlan,
      billingCycle: college.billingCycle || 'MONTHLY',
      billingPrice,
      subStatus: college.subStatus || 'ACTIVE',
      subscriptionExpiresAt: college.periodEnd,
      pendingDowngradePlanId: college.pendingDowngradePlanId,
      isTest: college.isTest,
      createdAt: college.createdAt
    },
    limits: {
      maxStudents: baseLimits.maxStudents,
      maxStaff: baseLimits.maxStaff,
      maxStorageBytes: baseLimits.maxStorageBytes,
      maxAdmins: baseLimits.maxAdmins,
      maxCampuses: baseLimits.maxCampuses
    },
    usage: {
      students: usageMap.students || 0,
      staff: usageMap.staff || 0,
      storageBytes: usageMap.storageBytes || 0
    },
    financialSummary: {
      totalSettledRevenue,
      pendingAmount,
      totalPayments: ledger.length,
      blockingPayment: blockingPayment ? { id: blockingPayment.id, status: blockingPayment.status, amountPaid: blockingPayment.amountPaid } : null
    },
    accountants,
    ledger
  };
}

module.exports = {
  getCollegeBillingList,
  getCollegeBillingDetail,
  derivePlanPrice
};
