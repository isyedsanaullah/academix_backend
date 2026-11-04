const { getSystemClient } = require('../config/prismaManager');
const { getEntitlements } = require('./entitlements');
const {
  getDailyKey,
  getMonthlyKey,
  getCycleKey
} = require('../config/planConstants');

class QuotaExceededError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'QuotaExceededError';
    this.code = 'QUOTA_EXCEEDED';
    this.details = details;
  }
}

/**
 * Resolves the standardized storage period key for a given metric.
 */
function resolvePeriodKey(metric, annualQuotaCycleStart = null, date = new Date()) {
  const lifetimeMetrics = ['students', 'staff', 'admins', 'campuses', 'storageBytes'];
  if (lifetimeMetrics.includes(metric)) {
    return 'total';
  }

  if (metric === 'applications') {
    return getCycleKey(annualQuotaCycleStart || date);
  }

  if (metric.startsWith('tutorChat:')) {
    return getDailyKey(date);
  }

  // Default for all monthly metered quotas
  return getMonthlyKey(date);
}

/**
 * Resolves the numerical limit from effectiveLimits for a specific metric.
 */
function resolveLimit(effectiveLimits, metric) {
  if (metric === 'students') return effectiveLimits.maxStudents;
  if (metric === 'staff') return effectiveLimits.maxStaff;
  if (metric === 'admins') return effectiveLimits.maxAdmins;
  if (metric === 'campuses') return effectiveLimits.maxCampuses;
  if (metric === 'storageBytes') return effectiveLimits.maxStorageBytes;
  if (metric === 'applications') return effectiveLimits.maxApplications;
  if (metric === 'aiQuizGenerations') return effectiveLimits.aiQuizGenerationsMonthly;
  if (metric === 'aiNotesGenerations') return effectiveLimits.aiNotesMonthly;
  if (metric === 'documentOcr') return effectiveLimits.documentOcrMonthly;
  if (metric === 'noticeTranslation') return effectiveLimits.noticeTranslationMonthly;
  if (metric === 'askYourData') return effectiveLimits.askYourDataMonthly;
  if (metric === 'exportsCsv') return effectiveLimits.exportsMonthly?.csv ?? 0;
  if (metric === 'exportsPdf') return effectiveLimits.exportsMonthly?.pdf ?? 0;
  if (metric === 'apiCalls') return effectiveLimits.apiCallsMonthly;
  if (metric === 'backupZip') return effectiveLimits.backupZipMonthly;
  if (metric.startsWith('tutorChat:')) return effectiveLimits.tutorDailyPerStudent;

  return 0;
}

/**
 * Checks whether a college has remaining quota for a requested operation.
 *
 * @param {string} collegeId - College UUID
 * @param {string} metric - Quota metric slug
 * @param {number} [requestedAmount=1] - Requested quantity
 * @param {object} [dbClient] - Optional prisma client
 * @returns {Promise<object>} - { allowed, current, limit, remaining, requestedAmount, metric, period }
 */
async function checkQuota(collegeId, metric, requestedAmount = 1, dbClient = null) {
  const prisma = dbClient || getSystemClient();
  const entitlements = await getEntitlements(collegeId, prisma);

  const period = resolvePeriodKey(metric, entitlements.annualQuotaCycleStart);
  const limit = resolveLimit(entitlements.effectiveLimits, metric);

  const usageRecord = await prisma.collegeUsage.findUnique({
    where: {
      college_id_metric_period: {
        college_id: collegeId,
        metric,
        period
      }
    }
  });

  const current = usageRecord ? Number(usageRecord.value) : 0;
  const isExceeded = (current + requestedAmount) > limit;
  const remaining = Math.max(0, limit - current);

  return {
    allowed: !isExceeded,
    current,
    limit,
    remaining,
    requestedAmount,
    metric,
    period,
    planId: entitlements.planId,
    collegeName: entitlements.collegeName
  };
}

/**
 * Executes a mutation callback inside an atomic transaction guarded by quota limits.
 * Increments quota usage if and only if the callback successfully resolves.
 *
 * @param {string} collegeId - College UUID
 * @param {string} metric - Quota metric slug
 * @param {number} count - Amount to reserve/increment
 * @param {Function} callback - Async function(tx) executing the core business logic
 * @returns {Promise<any>} Result of callback
 */
async function withQuota(collegeId, metric, count, callback) {
  const prisma = getSystemClient();

  return await prisma.$transaction(async (tx) => {
    // 1. Resolve entitlements inside the transaction
    const entitlements = await getEntitlements(collegeId, tx);
    const period = resolvePeriodKey(metric, entitlements.annualQuotaCycleStart);
    const limit = resolveLimit(entitlements.effectiveLimits, metric);

    // 2. Fetch current usage with row consistency
    const usage = await tx.collegeUsage.findUnique({
      where: {
        college_id_metric_period: {
          college_id: collegeId,
          metric,
          period
        }
      }
    });

    const current = usage ? Number(usage.value) : 0;

    if (current + count > limit) {
      throw new QuotaExceededError(
        `Institutional quota for metric '${metric}' exceeded. Current: ${current}, Requested: ${count}, Limit: ${limit}.`,
        {
          collegeId,
          metric,
          current,
          limit,
          requested: count,
          period,
          planId: entitlements.planId
        }
      );
    }

    // 3. Execute business logic callback
    const result = await callback(tx);

    // 4. Atomically commit usage increment
    await tx.collegeUsage.upsert({
      where: {
        college_id_metric_period: {
          college_id: collegeId,
          metric,
          period
        }
      },
      update: {
        value: { increment: count }
      },
      create: {
        college_id: collegeId,
        metric,
        period,
        value: BigInt(current + count)
      }
    });

    return result;
  });
}

/**
 * Increments or decrements usage counter for a college metric.
 */
async function recordUsage(collegeId, metric, delta, dbClient = null) {
  const prisma = dbClient || getSystemClient();
  const entitlements = await getEntitlements(collegeId, prisma);
  const period = resolvePeriodKey(metric, entitlements.annualQuotaCycleStart);

  return await prisma.collegeUsage.upsert({
    where: {
      college_id_metric_period: {
        college_id: collegeId,
        metric,
        period
      }
    },
    update: {
      value: { increment: delta }
    },
    create: {
      college_id: collegeId,
      metric,
      period,
      value: BigInt(Math.max(0, delta))
    }
  });
}

module.exports = {
  QuotaExceededError,
  resolvePeriodKey,
  resolveLimit,
  checkQuota,
  withQuota,
  recordUsage
};

