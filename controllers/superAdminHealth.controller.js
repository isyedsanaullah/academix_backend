/**
 * superAdminHealth.controller.js — Phase 6C Health Dashboard API
 * Aggregates platform operational metrics, subscription statuses, financial MRR/ARR,
 * SLA breaches, and outbox event health.
 */

const { getSystemClient } = require('../config/prismaManager');

/**
 * GET /api/super-admin/health
 * Returns consolidated platform health and subscription KPI metrics.
 */
async function getHealthOverview(req, res) {
  try {
    const prisma = getSystemClient();
    const now = new Date();
    const fourteenDaysAhead = new Date(now.getTime() + 14 * 86400000);
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 3600000);
    const tenMinutesAgo = new Date(now.getTime() - 10 * 60000);

    // 1. Colleges status breakdown
    const colleges = await prisma.college.findMany({
      select: {
        id: true,
        name: true,
        subStatus: true,
        planId: true,
        billingCycle: true,
        periodEnd: true,
        trialEndsAt: true,
        forceReadOnly: true,
        readOnlyReason: true
      }
    });

    let activeCount = 0;
    let trialCount = 0;
    let readOnlyCount = 0;
    let suspendedCount = 0;
    let expiringSoonCount = 0;
    const readOnlyBreakdown = {
      SUBSCRIPTION_EXPIRED: 0,
      TRIAL_EXPIRED: 0,
      MANUAL: 0,
      OTHER: 0
    };

    // 2. Fetch latest plan pricing to calculate MRR
    const latestVersions = await prisma.planVersion.findMany({
      orderBy: { version: 'desc' }
    });
    const priceMap = {};
    for (const pv of latestVersions) {
      if (!priceMap[pv.planId]) {
        priceMap[pv.planId] = {
          monthly: pv.monthlyPricePkr,
          yearly: pv.yearlyPricePkr
        };
      }
    }

    let mrrTotal = 0;

    for (const col of colleges) {
      if (col.subStatus === 'SUSPENDED') {
        suspendedCount++;
      } else if (col.forceReadOnly) {
        readOnlyCount++;
        const reason = col.readOnlyReason || 'OTHER';
        if (readOnlyBreakdown[reason] !== undefined) {
          readOnlyBreakdown[reason]++;
        } else {
          readOnlyBreakdown.OTHER++;
        }
      } else if (col.subStatus === 'TRIAL') {
        trialCount++;
        if (col.trialEndsAt && new Date(col.trialEndsAt) <= fourteenDaysAhead) {
          expiringSoonCount++;
        }
      } else if (col.subStatus === 'ACTIVE') {
        activeCount++;
        if (col.periodEnd && new Date(col.periodEnd) <= fourteenDaysAhead) {
          expiringSoonCount++;
        }

        // Calculate contribution to MRR
        const planKey = (col.planId || 'starter').toLowerCase();
        const prices = priceMap[planKey] || { monthly: 0, yearly: 0 };
        if (col.billingCycle === 'YEARLY') {
          mrrTotal += Math.round(prices.yearly / 12);
        } else {
          mrrTotal += prices.monthly;
        }
      }
    }

    const arrTotal = mrrTotal * 12;
    const arpu = activeCount > 0 ? Math.round(mrrTotal / activeCount) : 0;

    // 3. Billing SLA & Pending payments
    const pendingPayments = await prisma.collegeSubscriptionPayment.findMany({
      where: { status: 'PENDING' },
      select: {
        id: true,
        createdAt: true,
        college_id: true,
        amount: true,
        isDuplicateSuspected: true
      }
    });

    const pendingCount = pendingPayments.length;
    let breachedSlaCount = 0;
    let duplicateSuspectedCount = 0;

    for (const p of pendingPayments) {
      if (new Date(p.createdAt) < twentyFourHoursAgo) {
        breachedSlaCount++;
      }
      if (p.isDuplicateSuspected) {
        duplicateSuspectedCount++;
      }
    }

    // 4. Outbox events health
    const outboxCounts = await prisma.outboxEvent.groupBy({
      by: ['status'],
      _count: { id: true }
    });
    const outboxStats = {
      PENDING: 0,
      PROCESSING: 0,
      FAILED: 0,
      COMPLETED: 0
    };
    for (const o of outboxCounts) {
      if (outboxStats[o.status] !== undefined) {
        outboxStats[o.status] = o._count.id;
      }
    }

    // Stuck processing count
    const stuckProcessingCount = await prisma.outboxEvent.count({
      where: {
        status: 'PROCESSING',
        updatedAt: { lt: tenMinutesAgo }
      }
    });

    return res.json({
      success: true,
      timestamp: now.toISOString(),
      summary: {
        totalColleges: colleges.length,
        active: activeCount,
        trial: trialCount,
        readOnly: readOnlyCount,
        suspended: suspendedCount,
        expiringSoon: expiringSoonCount,
        readOnlyBreakdown
      },
      financials: {
        currency: 'PKR',
        mrr: mrrTotal,
        arr: arrTotal,
        arpu: arpu
      },
      billingQueue: {
        pendingCount,
        breachedSlaCount,
        duplicateSuspectedCount
      },
      systemHealth: {
        outbox: {
          ...outboxStats,
          stuckProcessing: stuckProcessingCount
        },
        status: stuckProcessingCount > 0 || outboxStats.FAILED > 5 ? 'DEGRADED' : 'HEALTHY'
      }
    });
  } catch (error) {
    console.error('[getHealthOverview] Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve health metrics', error: error.message });
  }
}

module.exports = {
  getHealthOverview
};

