'use strict';

const { getSystemClient } = require('../../../config/prismaManager');
const {
  CANONICAL_PLANS,
  calcMoM,
  getSettledAmount,
  resolvePlanBucket,
  createZeroFilledPlanBreakdown
} = require('../definitions');
const {
  startOfMonthPKT,
  endOfMonthPKT,
  formatPKT,
  toPKTDateString
} = require('../../../utils/pkt');

// In-memory cache with 60-second TTL
const overviewCache = new Map();
const CACHE_TTL_MS = 60 * 1000;

function clearOverviewCache() {
  overviewCache.clear();
}

/**
 * Fast navigation counter badges.
 * @param {boolean} includeTest 
 * @returns {Promise<{ accountingOverview: number, paymentsHistory: number, perCollegeBilling: number, accountantDetails: number }>}
 */
async function getNavCounts(includeTest = false) {
  const prisma = getSystemClient();

  let accountantWhere = { role: 'accountant' };
  if (!includeTest) {
    const testColleges = await prisma.college.findMany({
      where: { isTest: true },
      select: { id: true }
    });
    if (testColleges.length > 0) {
      accountantWhere = {
        role: 'accountant',
        NOT: { college_id: { in: testColleges.map(c => c.id) } }
      };
    }
  }

  const [paymentsHistory, perCollegeBilling, accountantDetails, pendingQueueCount] = await Promise.all([
    prisma.collegeSubscriptionPayment.count({
      where: includeTest ? {} : { college: { isTest: false } }
    }),
    prisma.college.count({
      where: includeTest ? {} : { isTest: false }
    }),
    prisma.user.count({
      where: accountantWhere
    }),
    prisma.collegeSubscriptionPayment.count({
      where: {
        status: 'PENDING',
        ...(includeTest ? {} : { college: { isTest: false } })
      }
    })
  ]);

  return {
    accountingOverview: pendingQueueCount,
    paymentsHistory,
    perCollegeBilling,
    accountantDetails,
    billingQueue: pendingQueueCount
  };
}

/**
 * Retrieves comprehensive Accounting Overview metrics and chart datasets.
 * Computes strictly in Asia/Karachi timezone.
 * 
 * @param {Object} filters 
 * @param {boolean} [filters.includeTest=false]
 * @param {Date} [filters.from]
 * @param {Date} [filters.to]
 * @returns {Promise<Object>}
 */
async function getAccountingOverview(filters = {}) {
  const includeTest = Boolean(filters.includeTest);
  const cacheKey = `overview_${includeTest}_${filters.from ? filters.from.toISOString() : ''}_${filters.to ? filters.to.toISOString() : ''}`;

  const cached = overviewCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  const prisma = getSystemClient();
  const collegeIsolation = includeTest ? {} : { college: { isTest: false } };

  // Fetch all APPROVED payments for settled revenue and plan breakdown
  const approvedPayments = await prisma.collegeSubscriptionPayment.findMany({
    where: {
      status: 'APPROVED',
      ...collegeIsolation
    },
    select: {
      id: true,
      status: true,
      college_id: true,
      type: true,
      planId: true,
      amountPaid: true,
      verifiedAmount: true,
      createdAt: true,
      reviewedAt: true,
      college: {
        select: {
          planId: true
        }
      }
    }
  });

  // Fetch PENDING and APPROVING payments for queue and pending totals
  const pendingPayments = await prisma.collegeSubscriptionPayment.findMany({
    where: {
      status: { in: ['PENDING', 'APPROVING'] },
      ...collegeIsolation
    },
    select: {
      id: true,
      status: true,
      amountPaid: true,
      createdAt: true
    },
    orderBy: { createdAt: 'asc' }
  });

  // Fetch REJECTED payments for distribution metrics
  const rejectedCount = await prisma.collegeSubscriptionPayment.count({
    where: {
      status: 'REJECTED',
      ...collegeIsolation
    }
  });

  // 1. Total Revenue Collected
  let totalRevenueCollected = 0;
  for (const p of approvedPayments) {
    totalRevenueCollected += getSettledAmount(p);
  }

  // 2. Pending Amount & Billing Queue metrics
  let pendingAmount = 0;
  let slaBreached = 0;
  const now = Date.now();
  const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;

  for (const p of pendingPayments) {
    pendingAmount += Number(p.amountPaid) || 0;
    if (p.status === 'PENDING' && new Date(p.createdAt).getTime() < twentyFourHoursAgo) {
      slaBreached++;
    }
  }

  const pendingOnly = pendingPayments.filter(p => p.status === 'PENDING');
  const billingQueue = {
    count: pendingOnly.length,
    slaBreached,
    oldestCreatedAt: pendingOnly.length > 0 ? pendingOnly[0].createdAt : null
  };

  // 3. This Month vs Last Month (strictly Asia/Karachi boundaries)
  const curMonthStart = startOfMonthPKT(0);
  const curMonthEnd = endOfMonthPKT(0);
  const prevMonthStart = startOfMonthPKT(-1);
  const prevMonthEnd = endOfMonthPKT(-1);

  let thisMonthAmount = 0;
  let lastMonthAmount = 0;

  for (const p of approvedPayments) {
    const revDate = new Date(p.reviewedAt || p.createdAt);
    if (revDate >= curMonthStart && revDate <= curMonthEnd) {
      thisMonthAmount += getSettledAmount(p);
    } else if (revDate >= prevMonthStart && revDate <= prevMonthEnd) {
      lastMonthAmount += getSettledAmount(p);
    }
  }

  const momStats = calcMoM(thisMonthAmount, lastMonthAmount);
  const thisMonthVsLastMonth = {
    thisMonth: thisMonthAmount,
    lastMonth: lastMonthAmount,
    percentage: momStats.percentage,
    isNewBaseline: momStats.isNewBaseline,
    diff: momStats.diff
  };

  // 4. Revenue by Subscription Plan (Canonical tiers + ADDONS_CREDITS)
  const planBreakdown = createZeroFilledPlanBreakdown();
  for (const p of approvedPayments) {
    const bucket = resolvePlanBucket(p, p.college);
    const amount = getSettledAmount(p);
    if (planBreakdown[bucket]) {
      planBreakdown[bucket].amount += amount;
      planBreakdown[bucket].count += 1;
    }
  }

  for (const key of Object.keys(planBreakdown)) {
    planBreakdown[key].percentage = totalRevenueCollected > 0
      ? Math.round((planBreakdown[key].amount / totalRevenueCollected) * 1000) / 10
      : 0;
  }

  // 5. Multi-Chart Datasets
  // a) Monthly Revenue Trend (Last 6 months in PKT)
  const revenueTrend = [];
  for (let m = -5; m <= 0; m++) {
    const mStart = startOfMonthPKT(m);
    const mEnd = endOfMonthPKT(m);
    const mDate = new Date(mStart.getTime() + 5 * 60 * 60 * 1000); // PKT wall date
    const monthKey = mDate.toISOString().slice(0, 7);
    const label = formatPKT(mStart, { month: 'short', year: 'numeric', day: undefined, hour: undefined, minute: undefined });

    let mRevenue = 0;
    let mCount = 0;

    for (const p of approvedPayments) {
      const revDate = new Date(p.reviewedAt || p.createdAt);
      if (revDate >= mStart && revDate <= mEnd) {
        mRevenue += getSettledAmount(p);
        mCount++;
      }
    }

    revenueTrend.push({
      month: monthKey,
      label,
      amount: mRevenue,
      count: mCount
    });
  }

  // b) Monthly Comparison (Day 1 to 31)
  const monthlyComparison = [];
  const curPKTOffset = 5 * 60 * 60 * 1000;
  for (let d = 1; d <= 31; d++) {
    monthlyComparison.push({
      day: d,
      currentMonth: 0,
      previousMonth: 0
    });
  }

  for (const p of approvedPayments) {
    const revDate = new Date(p.reviewedAt || p.createdAt);
    if (revDate >= curMonthStart && revDate <= curMonthEnd) {
      const pktDay = new Date(revDate.getTime() + curPKTOffset).getUTCDate();
      if (pktDay >= 1 && pktDay <= 31) {
        monthlyComparison[pktDay - 1].currentMonth += getSettledAmount(p);
      }
    } else if (revDate >= prevMonthStart && revDate <= prevMonthEnd) {
      const pktDay = new Date(revDate.getTime() + curPKTOffset).getUTCDate();
      if (pktDay >= 1 && pktDay <= 31) {
        monthlyComparison[pktDay - 1].previousMonth += getSettledAmount(p);
      }
    }
  }

  // c) Plan Distribution for Charts
  const planDistribution = [
    { plan: 'starter', label: 'Starter', ...planBreakdown.starter },
    { plan: 'standard', label: 'Standard', ...planBreakdown.standard },
    { plan: 'premium', label: 'Premium', ...planBreakdown.premium },
    { plan: 'enterprise', label: 'Enterprise', ...planBreakdown.enterprise },
    { plan: 'addons_credits', label: 'Add-ons & Credits', ...planBreakdown.addons_credits }
  ];

  // d) Status Distribution
  const statusDistribution = [
    { status: 'APPROVED', count: approvedPayments.length, amount: totalRevenueCollected },
    { status: 'PENDING', count: pendingPayments.length, amount: pendingAmount },
    { status: 'REJECTED', count: rejectedCount, amount: 0 }
  ];

  const result = {
    cards: {
      totalRevenueCollected,
      pendingAmount,
      billingQueue,
      thisMonthVsLastMonth,
      revenueByPlan: planBreakdown
    },
    charts: {
      revenueTrend,
      monthlyComparison,
      planDistribution,
      statusDistribution
    },
    meta: {
      includeTest,
      timezone: 'Asia/Karachi',
      generatedAt: new Date().toISOString()
    }
  };

  overviewCache.set(cacheKey, { timestamp: Date.now(), data: result });
  return result;
}

module.exports = {
  getAccountingOverview,
  getNavCounts,
  clearOverviewCache
};
