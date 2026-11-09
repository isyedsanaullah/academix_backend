'use strict';

const { getSystemClient } = require('../../../config/prismaManager');
const {
  CANONICAL_PLANS,
  PLAN_LEVEL,
  PLAN_LIMITS,
  normalizePlanId
} = require('../../../config/planConstants');
const { derivePlanPrice } = require('./collegeBilling.service');
const { clearOverviewCache } = require('./overview.service');

/**
 * Superadmin Plan Change Engine.
 * Enforces:
 * - Payment-in-progress check (HTTP 409 with blocking payment details)
 * - Usage cap validation on downgrade (HTTP 422 with metric, usage, permitted capacity)
 * - Scheduled deferral for active downgrades vs instant application for upgrades
 * - Automatic price derivation from canonical PLAN_PRICING
 * - Entitlement audit logging and cache invalidation
 * 
 * @param {string} collegeIdOrCode 
 * @param {string} rawTargetPlanId 
 * @param {string} reason 
 * @param {Object} [adminUser={}] 
 * @returns {Promise<Object>}
 */
async function changeCollegePlan(collegeIdOrCode, rawTargetPlanId, reason, adminUser = {}) {
  const prisma = getSystemClient();
  const targetPlanId = normalizePlanId(rawTargetPlanId);

  if (!CANONICAL_PLANS.includes(targetPlanId)) {
    const err = new Error(`Invalid plan. Must be one of: ${CANONICAL_PLANS.join(', ')}`);
    err.statusCode = 400;
    err.code = 'INVALID_PLAN';
    throw err;
  }

  // 1. Resolve college
  const college = await prisma.college.findFirst({
    where: {
      OR: [
        { id: collegeIdOrCode },
        { code: collegeIdOrCode },
        { slug: collegeIdOrCode }
      ]
    }
  });

  if (!college) {
    const err = new Error('College not found');
    err.statusCode = 404;
    err.code = 'COLLEGE_NOT_FOUND';
    throw err;
  }

  const currentPlanId = normalizePlanId(college.planId);
  if (currentPlanId === targetPlanId && !college.pendingDowngradePlanId) {
    return {
      success: true,
      unchanged: true,
      collegeId: college.id,
      currentPlan: currentPlanId,
      message: `College is already on the ${targetPlanId} plan.`
    };
  }

  // 2. Blocking Payment Check (Amendment 8: HTTP 409 with blocking payment details)
  const blockingPayment = await prisma.collegeSubscriptionPayment.findFirst({
    where: {
      college_id: college.id,
      status: { in: ['PENDING', 'APPROVING'] }
    },
    select: {
      id: true,
      status: true,
      amountPaid: true,
      createdAt: true
    }
  });

  if (blockingPayment) {
    const err = new Error('Cannot change plan while payment proof is under review.');
    err.statusCode = 409;
    err.code = 'PAYMENT_IN_PROGRESS';
    err.details = {
      blockingPayment: {
        id: blockingPayment.id,
        status: blockingPayment.status,
        amountPaid: blockingPayment.amountPaid,
        createdAt: blockingPayment.createdAt
      }
    };
    throw err;
  }

  // 3. Cap Validation & Downgrade vs Upgrade Direction
  const currentLevel = PLAN_LEVEL[currentPlanId] || 0;
  const targetLevel = PLAN_LEVEL[targetPlanId] || 0;
  const isDowngrade = targetLevel < currentLevel;

  if (isDowngrade) {
    // Validate current usage against target plan limits
    const targetLimits = PLAN_LIMITS[targetPlanId] || PLAN_LIMITS.starter;
    const usageRows = await prisma.collegeUsage.findMany({
      where: { college_id: college.id, period: 'total' }
    });
    const usageMap = {};
    for (const r of usageRows) {
      usageMap[r.metric] = Number(r.value);
    }

    const checks = [
      { metric: 'students', usage: usageMap.students || 0, limit: targetLimits.maxStudents },
      { metric: 'staff', usage: usageMap.staff || 0, limit: targetLimits.maxStaff },
      { metric: 'storageBytes', usage: usageMap.storageBytes || 0, limit: targetLimits.maxStorageBytes }
    ];

    for (const { metric, usage, limit } of checks) {
      if (limit != null && limit !== -1 && usage > limit) {
        const err = new Error(`Current usage for ${metric} (${usage}) exceeds the permitted capacity for ${targetPlanId} (${limit}). Cannot downgrade.`);
        err.statusCode = 422;
        err.code = 'CAP_EXCEEDED';
        err.details = {
          metric,
          currentUsage: usage,
          permittedCapacity: limit,
          targetPlanId
        };
        throw err;
      }
    }
  }

  // 4. Execution inside Transaction with Row Lock
  const adminId = adminUser.id || adminUser.email || 'superAdmin';
  const now = new Date();
  const hasActivePeriod = college.subStatus === 'ACTIVE' && college.periodEnd && new Date(college.periodEnd) > now;

  const result = await prisma.$transaction(async (tx) => {
    // Row lock on College
    await tx.$executeRaw`SELECT id FROM "College" WHERE id = ${college.id} FOR UPDATE`;

    let updateData = {};
    let isScheduled = false;

    if (isDowngrade && hasActivePeriod) {
      // Schedule downgrade at current period end
      updateData = {
        pendingDowngradePlanId: targetPlanId
      };
      isScheduled = true;
    } else {
      // Immediate plan change
      updateData = {
        planId: targetPlanId,
        pendingDowngradePlanId: null,
        subStatus: 'ACTIVE'
      };
    }

    const updatedCollege = await tx.college.update({
      where: { id: college.id },
      data: updateData
    });

    // Write audit log
    await tx.collegeEntitlementAudit.create({
      data: {
        college_id: college.id,
        actorUserId: adminId,
        actorEmail: adminUser.email || null,
        action: isScheduled ? 'PLAN_DOWNGRADE_SCHEDULED' : 'PLAN_CHANGE',
        featureKey: null,
        previousVal: currentPlanId,
        newVal: targetPlanId,
        reason: reason || 'Superadmin plan change requested'
      }
    });

    return { updatedCollege, isScheduled };
  });

  // 5. Cache invalidation
  clearOverviewCache();

  const newDerivedPrice = derivePlanPrice(
    result.isScheduled ? currentPlanId : targetPlanId,
    college.billingCycle
  );

  return {
    success: true,
    collegeId: college.id,
    collegeCode: college.code,
    previousPlan: currentPlanId,
    effectivePlan: result.isScheduled ? currentPlanId : targetPlanId,
    scheduledPlan: result.isScheduled ? targetPlanId : null,
    isScheduled: result.isScheduled,
    effectiveDate: result.isScheduled ? college.periodEnd : now,
    derivedBillingPrice: newDerivedPrice,
    billingCycle: college.billingCycle || 'MONTHLY',
    message: result.isScheduled
      ? `Downgrade to ${targetPlanId.toUpperCase()} scheduled for period end (${college.periodEnd?.toISOString().slice(0, 10)}).`
      : `Plan successfully changed from ${currentPlanId.toUpperCase()} to ${targetPlanId.toUpperCase()}.`
  };
}

module.exports = {
  changeCollegePlan
};
