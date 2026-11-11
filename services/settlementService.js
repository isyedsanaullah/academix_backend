/**
 * settlementService.js — Phase 6A
 * Atomic settlement engine for CollegeSubscriptionPayment approval.
 * All side-effects are written to OutboxEvent inside the same transaction.
 */

const { getSystemClient } = require('../config/prismaManager');
const { PLAN_LIMITS } = require('../config/planConstants');

function getPrisma() {
  return getSystemClient();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalize a transaction ID: UPPER first, then strip non-alphanumeric */
function cleanTid(raw) {
  if (!raw) return null;
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Generate the next receipt number inside an active transaction.
 * Uses INSERT … ON CONFLICT upsert-and-increment locked within the tx.
 * @param {object} tx  Prisma transaction client
 * @param {number} year Calendar year (PKT)
 * @returns {string}  "RCP-YYYY-XXXXX"
 */
async function nextReceiptNumber(tx, year) {
  const rows = await tx.$queryRaw`
    INSERT INTO "ReceiptCounter" (year, "lastSeq")
    VALUES (${year}, 1)
    ON CONFLICT (year)
    DO UPDATE SET "lastSeq" = "ReceiptCounter"."lastSeq" + 1
    RETURNING "lastSeq";
  `;
  const seq = Number(rows[0].lastSeq);
  return `RCP-${year}-${String(seq).padStart(5, '0')}`;
}

/**
 * Get effective limits for a college based on pinned PlanVersion + CollegeQuotaOverride + active addons.
 */
async function getEffectiveLimits(tx, college, targetPlanId = null) {
  const planToUse = targetPlanId || college.planId || 'starter';
  let pv = null;
  if (!targetPlanId && college.planVersionId) {
    pv = await tx.planVersion.findUnique({ where: { id: college.planVersionId } });
  }
  if (!pv) {
    pv = await tx.planVersion.findFirst({
      where: { planId: planToUse },
      orderBy: { version: 'desc' },
    });
  }

  const baseLimits = pv?.limitsJson || PLAN_LIMITS[planToUse] || PLAN_LIMITS.starter;

  // Apply CollegeQuotaOverrides
  const overrides = await tx.collegeQuotaOverride.findMany({
    where: { college_id: college.id },
  });
  const effectiveLimits = { ...baseLimits };
  for (const ov of overrides) {
    effectiveLimits[ov.metric] = Number(ov.overrideValue); // -1 = unlimited
  }

  return effectiveLimits;
}

/**
 * Hard-block cap validation for UPGRADE / ADDON_ORDER.
 * Throws with structured error on violation.
 */
async function validateCaps(tx, college, payment, effectiveLimits) {
  const usageRows = await tx.collegeUsage.findMany({
    where: { college_id: college.id, period: 'total' },
  });
  const usageMap = {};
  for (const row of usageRows) {
    usageMap[row.metric] = Number(row.value);
  }

  const checks = [
    { metric: 'students',    usage: usageMap.students || 0,    limit: effectiveLimits.maxStudents },
    { metric: 'staff',       usage: usageMap.staff || 0,       limit: effectiveLimits.maxStaff },
    { metric: 'storageBytes',usage: usageMap.storageBytes || 0, limit: effectiveLimits.maxStorageBytes },
  ];

  for (const { metric, usage, limit } of checks) {
    if (limit == null || limit === -1) continue; // unlimited
    if (Number(usage) > Number(limit)) {
      const err = new Error('CAP_EXCEEDED_AT_SETTLEMENT');
      err.code = 'CAP_EXCEEDED_AT_SETTLEMENT';
      err.detail = { metric, currentUsage: Number(usage), permittedCapacity: Number(limit) };
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Main: approve a payment
// ---------------------------------------------------------------------------
/**
 * Atomically settle a payment.
 * @param {string} paymentId
 * @param {string} adminUserId
 * @param {object} opts  { overrideNote, verifiedAmountOverride, ipAddress }
 */
async function approvePayment(paymentId, adminUserId, opts = {}) {
  const { overrideNote, verifiedAmountOverride, ipAddress } = opts;
  const prisma = getPrisma();

  return await prisma.$transaction(async (tx) => {
    // 1. Load payment
    const payment = await tx.collegeSubscriptionPayment.findUnique({
      where: { id: paymentId },
    });
    if (!payment) throw Object.assign(new Error('PAYMENT_NOT_FOUND'), { status: 404 });

    // 2. Pessimistic row lock on College
    await tx.$executeRaw`SELECT id FROM "College" WHERE id = ${payment.college_id} FOR UPDATE`;

    // 3. Idempotent state transition — only PENDING can be approved
    const updateResult = await tx.collegeSubscriptionPayment.updateMany({
      where: { id: paymentId, status: 'PENDING' },
      data: { status: 'APPROVING' }, // temp state inside tx
    });
    if (updateResult.count !== 1) {
      throw Object.assign(new Error('PAYMENT_ALREADY_SETTLED_OR_CANCELLED'), { status: 409 });
    }

    // 4. Load college
    const college = await tx.college.findUnique({ where: { id: payment.college_id } });

    // 5. Determine verified amount
    const verifiedAmount = verifiedAmountOverride ?? payment.amountPaid;
    const isUnderpayment = verifiedAmount < payment.expectedAmount;
    if (isUnderpayment && !overrideNote?.trim()) {
      throw Object.assign(new Error('OVERRIDE_NOTE_REQUIRED'), { status: 400 });
    }

    // 6. Duplicate txId check inside tx (race condition guard)
    if (payment.transactionId) {
      const dup = await tx.collegeSubscriptionPayment.findFirst({
        where: {
          id: { not: paymentId },
          paymentMethod: payment.paymentMethod,
          transactionId: payment.transactionId,
          status: { in: ['APPROVED'] },
        },
      });
      if (dup) {
        throw Object.assign(new Error('DUPLICATE_TRANSACTION'), { status: 409, existingPaymentId: dup.id });
      }
    }

    // 7. Load effective limits
    const targetPlanId = (payment.type === 'UPGRADE' || payment.type === 'DOWNGRADE') ? payment.planId : college.planId;
    const effectiveLimits = await getEffectiveLimits(tx, college, targetPlanId);

    // 8. Cap re-validation
    if (['UPGRADE', 'ADDON_ORDER'].includes(payment.type)) {
      await validateCaps(tx, college, payment, effectiveLimits);
    } else if (payment.type === 'RENEWAL') {
      // Warn-only: log audit entry but do NOT block
      const usageRow = await tx.collegeUsage.findUnique({
        where: { college_id_metric_period: { college_id: college.id, metric: 'students', period: 'total' } }
      });
      if (usageRow && Number(usageRow.value) > Number(effectiveLimits.maxStudents || Infinity)) {
        await tx.collegeEntitlementAudit.create({
          data: {
            college_id: college.id,
            actorUserId: adminUserId,
            action: 'RENEWAL_OVERCAP_WARNING',
            reason: `Renewal approved with students (${usageRow.value}) exceeding plan limit (${effectiveLimits.maxStudents})`,
            paymentId,
            ipAddress: ipAddress || null,
          },
        });
      }
    }

    // 9. Compute PKT year for receipt counter
    const nowPKT = new Date(Date.now() + 5 * 60 * 60 * 1000);
    const pktYear = nowPKT.getUTCFullYear();
    const receiptNumber = await nextReceiptNumber(tx, pktYear);

    // 10. Apply billing state changes based on payment type
    const now = new Date();
    let collegeUpdates = {};

    if (payment.type === 'RENEWAL' || payment.type === 'UPGRADE') {
      const cycleDays = payment.billingCycle === 'YEARLY' ? 365 : 30;
      const isEarlyRenewal = college.periodEnd && college.periodEnd > now;
      const isInGrace = college.periodEnd && college.periodEnd <= now;

      if (payment.type === 'UPGRADE') {
        // Upgrade: fresh cycle from approval date
        collegeUpdates.periodStart = now;
        collegeUpdates.periodEnd = new Date(now.getTime() + cycleDays * 86400000);
        collegeUpdates.planId = payment.planId || college.planId;
        collegeUpdates.billingCycle = payment.billingCycle || college.billingCycle;
      } else if (isEarlyRenewal) {
        // Early renewal: stack periodEnd, keep periodStart
        collegeUpdates.periodEnd = new Date(college.periodEnd.getTime() + cycleDays * 86400000);
      } else {
        // Expired or in-grace renewal: re-anchor to now
        collegeUpdates.periodStart = now;
        collegeUpdates.periodEnd = new Date(now.getTime() + cycleDays * 86400000);
      }

      // Conditional read-only clearing
      if (['SUBSCRIPTION_EXPIRED', 'TRIAL_EXPIRED'].includes(college.readOnlyReason)) {
        collegeUpdates.forceReadOnly = false;
        collegeUpdates.readOnlyReason = null;
        collegeUpdates.subStatus = 'ACTIVE';
      }
      // NEVER clear SUSPENDED status or bump tokenEpoch here

      // Trial-to-paid
      if (college.subStatus === 'TRIAL') {
        collegeUpdates.subStatus = 'ACTIVE';
        collegeUpdates.trialEndsAt = null;
      }

      // Re-pin to latest PlanVersion
      const latestPV = await tx.planVersion.findFirst({
        where: { planId: collegeUpdates.planId || college.planId },
        orderBy: { version: 'desc' },
      });
      if (latestPV) collegeUpdates.planVersionId = latestPV.id;
    } else if (payment.type === 'DOWNGRADE') {
      // Downgrade: defer to renewal — just set pending fields
      collegeUpdates.pendingDowngradePlanId = payment.planId;
      collegeUpdates.pendingDowngradeBillingCycle = payment.billingCycle;
    }

    // Apply college updates
    if (Object.keys(collegeUpdates).length > 0) {
      await tx.college.update({ where: { id: college.id }, data: collegeUpdates });
    }

    // 11. Process add-on activations (ADDON items in lineItems)
    const lineItems = payment.lineItems || [];
    for (const item of lineItems.filter(i => i.itemType === 'ADDON')) {
      const isAppPack = item.addonType === 'APPLICATIONS';
      const expiresAt = isAppPack
        ? new Date(now.getTime() + 365 * 86400000)
        : (collegeUpdates.periodEnd || college.periodEnd);

      await tx.collegeAddon.create({
        data: {
          college_id: college.id,
          addonType: item.addonType,
          quantity: item.quantity,
          expiresAt,
          startsAt: now,
          sourcePaymentId: paymentId,
        },
      });
    }

    // 12. Finalize payment record
    await tx.collegeSubscriptionPayment.update({
      where: { id: paymentId },
      data: {
        status: 'APPROVED',
        reviewedBy: adminUserId,
        reviewedAt: now,
        verifiedAmount,
        overrideNote: overrideNote || null,
        receiptNumber,
      },
    });

    // 13. Audit log
    await tx.collegeEntitlementAudit.create({
      data: {
        college_id: college.id,
        actorUserId: adminUserId,
        action: 'SETTLEMENT_APPROVE',
        reason: overrideNote || `Payment ${paymentId} approved`,
        paymentId,
        ipAddress: ipAddress || null,
        afterStateJson: { receiptNumber, verifiedAmount, type: payment.type },
      },
    });

    // 14. Enqueue outbox events (post-commit side-effects)
    const outboxEventsToEnqueue = [
      {
        eventType: 'RECEIPT_EMAIL',
        college_id: college.id,
        payload: { paymentId, collegeId: college.id, receiptNumber, verifiedAmount },
      },
      {
        eventType: 'ENTITLEMENT_CHANGED',
        college_id: college.id,
        payload: { collegeId: college.id, trigger: 'SETTLEMENT_APPROVE' },
      },
    ];

    // Check for AI Token Addons in lineItems
    for (const item of lineItems.filter(i => i.itemType === 'ADDON' && String(i.addonType).startsWith('AI_TOKENS'))) {
      const credits = item.addonType === 'AI_TOKENS_1M' ? 1000000 :
                      item.addonType === 'AI_TOKENS_5M' ? 5000000 :
                      item.addonType === 'AI_TOKENS_10M' ? 10000000 : 1000000;
      outboxEventsToEnqueue.push({
        eventType: 'AI_PURCHASE_APPROVED',
        college_id: college.id,
        payload: {
          purchaseRequestId: paymentId,
          collegeId: college.id,
          credits,
          packageCode: item.addonType,
          amountPkr: item.amount || verifiedAmount,
          receiptNumber,
          approvedByUserId: adminUserId,
          transactionReference: payment.transactionId,
        },
      });
    }

    // Emit AI_SUBSCRIPTION_SYNC on Renewal or Upgrade
    if (['RENEWAL', 'UPGRADE'].includes(payment.type)) {
      const targetPlan = payment.planId || college.planId || 'starter';
      const periodEnd = collegeUpdates.periodEnd || college.periodEnd || new Date(now.getTime() + 30 * 86400000);
      const nowPKT = new Date(Date.now() + 5 * 60 * 60 * 1000);
      const cycle = `${nowPKT.getUTCFullYear()}-${String(nowPKT.getUTCMonth() + 1).padStart(2, '0')}`;

      outboxEventsToEnqueue.push({
        eventType: 'AI_SUBSCRIPTION_SYNC',
        college_id: college.id,
        payload: {
          collegeId: college.id,
          planId: targetPlan,
          billingCycle: cycle,
          periodStart: collegeUpdates.periodStart || now,
          periodEnd,
          reason: `Subscription ${payment.type} approved (${receiptNumber})`,
        },
      });
    }

    await tx.outboxEvent.createMany({
      data: outboxEventsToEnqueue,
    });

    return { receiptNumber, verifiedAmount, paymentId };
  }, { maxWait: 15000, timeout: 20000 });
}

// ---------------------------------------------------------------------------
// Reject a payment
// ---------------------------------------------------------------------------
async function rejectPayment(paymentId, adminUserId, { reason, ipAddress } = {}) {
  if (!reason?.trim()) {
    throw Object.assign(new Error('REJECTION_REASON_REQUIRED'), { status: 400 });
  }

  const prisma = getPrisma();
  return await prisma.$transaction(async (tx) => {
    const updateResult = await tx.collegeSubscriptionPayment.updateMany({
      where: { id: paymentId, status: 'PENDING' },
      data: { status: 'REJECTED', rejectionReason: reason, reviewedBy: adminUserId, reviewedAt: new Date() },
    });
    if (updateResult.count !== 1) {
      throw Object.assign(new Error('PAYMENT_ALREADY_SETTLED_OR_CANCELLED'), { status: 409 });
    }

    const payment = await tx.collegeSubscriptionPayment.findUnique({ where: { id: paymentId } });

    await tx.collegeEntitlementAudit.create({
      data: {
        college_id: payment.college_id,
        actorUserId: adminUserId,
        action: 'SETTLEMENT_REJECT',
        reason,
        paymentId,
        ipAddress: ipAddress || null,
      },
    });

    // Notify college
    await tx.outboxEvent.create({
      data: {
        eventType: 'IN_APP_NOTIFICATION',
        payload: { collegeId: payment.college_id, type: 'PAYMENT_REJECTED', paymentId, reason },
      },
    });

    return { paymentId, status: 'REJECTED' };
  });
}

// ---------------------------------------------------------------------------
// Submit payment (with duplicate detection)
// ---------------------------------------------------------------------------
async function submitPayment(collegeId, submitterId, payload) {
  const {
    type, planId, billingCycle, lineItems,
    expectedAmount, amountPaid, paymentMethod,
    transactionId: rawTxId, screenshotUrl,
  } = payload;

  const prisma = getPrisma();
  const transactionId = cleanTid(rawTxId);

  // Exact duplicate check at submit time
  if (transactionId) {
    const existing = await prisma.collegeSubscriptionPayment.findFirst({
      where: {
        paymentMethod,
        transactionId,
        status: { in: ['PENDING', 'APPROVED'] },
      },
    });
    if (existing) {
      const err = new Error('DUPLICATE_TRANSACTION');
      err.status = 409;
      err.existingPaymentId = existing.id;
      err.existingStatus = existing.status;
      throw err;
    }
  }

  // Fuzzy duplicate check for isDuplicateSuspected flag
  const now = new Date();
  const yesterday = new Date(now.getTime() - 86400000);
  let isDuplicateSuspected = false;

  if (transactionId) {
    // Cross-method same txId
    const crossMethod = await prisma.collegeSubscriptionPayment.findFirst({
      where: {
        transactionId,
        paymentMethod: { not: paymentMethod },
        status: { notIn: ['REJECTED', 'CANCELLED'] },
      },
    });
    if (crossMethod) isDuplicateSuspected = true;
  }

  if (!isDuplicateSuspected) {
    // Same amount + same college in last 24h
    const sameAmountRecent = await prisma.collegeSubscriptionPayment.findFirst({
      where: {
        college_id: collegeId,
        amountPaid,
        createdAt: { gte: yesterday },
        status: { notIn: ['REJECTED', 'CANCELLED'] },
      },
    });
    if (sameAmountRecent) isDuplicateSuspected = true;
  }

  return await prisma.collegeSubscriptionPayment.create({
    data: {
      college_id: collegeId,
      type,
      planId,
      billingCycle,
      lineItems: lineItems || [],
      expectedAmount,
      amountPaid,
      paymentMethod,
      transactionId,
      screenshotUrl,
      submittedBy: submitterId,
      isDuplicateSuspected,
    },
  });
}

module.exports = { approvePayment, rejectPayment, submitPayment, cleanTid };

