'use strict';

/**
 * Subscription State Machine & Server-Side Trial / Lock Snapshot
 * ──────────────────────────────────────────────────────────────
 * Canonical College.subStatus values:
 *   TRIAL | PENDING_PAYMENT | ACTIVE | EXPIRED | DEACTIVATED
 *
 * Legacy 'SUSPENDED' is normalized to 'DEACTIVATED' (or 'EXPIRED' when
 * readOnlyReason indicates expiry) for backward compatibility.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;

const SUB_STATUSES = Object.freeze([
  'TRIAL',
  'PENDING_PAYMENT',
  'ACTIVE',
  'EXPIRED',
  'DEACTIVATED',
]);

const ALLOWED_TRANSITIONS = Object.freeze({
  TRIAL:           new Set(['TRIAL', 'PENDING_PAYMENT', 'ACTIVE', 'EXPIRED', 'DEACTIVATED']),
  PENDING_PAYMENT: new Set(['PENDING_PAYMENT', 'TRIAL', 'ACTIVE', 'EXPIRED', 'DEACTIVATED']),
  ACTIVE:          new Set(['ACTIVE', 'PENDING_PAYMENT', 'EXPIRED', 'DEACTIVATED']),
  EXPIRED:         new Set(['EXPIRED', 'PENDING_PAYMENT', 'ACTIVE', 'DEACTIVATED']),
  DEACTIVATED:     new Set(['DEACTIVATED', 'ACTIVE', 'TRIAL']),
});

function normalizeSubStatus(rawStatus, readOnlyReason = null) {
  const upper = String(rawStatus || 'TRIAL').trim().toUpperCase();
  if (SUB_STATUSES.includes(upper)) return upper;
  if (upper === 'SUSPENDED') {
    return readOnlyReason === 'TRIAL_EXPIRED' || readOnlyReason === 'SUBSCRIPTION_EXPIRED'
      ? 'EXPIRED'
      : 'DEACTIVATED';
  }
  return 'TRIAL';
}

function canTransitionSubStatus(fromStatus, toStatus, readOnlyReason = null) {
  const from = normalizeSubStatus(fromStatus, readOnlyReason);
  const to = normalizeSubStatus(toStatus);
  return ALLOWED_TRANSITIONS[from]?.has(to) || false;
}

function assertValidSubStatusTransition(fromStatus, toStatus, readOnlyReason = null) {
  const from = normalizeSubStatus(fromStatus, readOnlyReason);
  const to = normalizeSubStatus(toStatus);
  if (!canTransitionSubStatus(from, to, readOnlyReason)) {
    const err = new Error(`Invalid subscription status transition from '${from}' to '${to}'.`);
    err.status = 400;
    err.code = 'INVALID_SUBSCRIPTION_TRANSITION';
    err.fromStatus = from;
    err.toStatus = to;
    throw err;
  }
  return { from, to };
}

/**
 * Compute remaining days from `now` until `targetDate` using exact 24h ceiling
 * (minimum 0 when expired). Never relies on a stored decrementing counter.
 */
function calculateDaysRemaining(targetDate, now = new Date()) {
  if (!targetDate) return null;
  const endMs = new Date(targetDate).getTime();
  if (Number.isNaN(endMs)) return null;
  const diffMs = endMs - now.getTime();
  if (diffMs <= 0) return 0;
  return Math.ceil(diffMs / DAY_MS);
}

/**
 * Format a Date to PKT calendar date string YYYY-MM-DD (Asia/Karachi, UTC+5).
 */
function toPktCalendarDate(date = new Date()) {
  const pkt = new Date(new Date(date).getTime() + PKT_OFFSET_MS);
  return pkt.toISOString().slice(0, 10);
}

/**
 * Compute live subscription & lock snapshot from College dates/status.
 * Evaluates real-time expiration even before the daily cron runs.
 */
function computeSubscriptionSnapshot(college, now = new Date()) {
  if (!college) {
    return {
      subStatus: 'EXPIRED',
      effectiveSubStatus: 'EXPIRED',
      isTrial: false,
      isPendingPayment: false,
      isActive: false,
      isExpired: true,
      isDeactivated: false,
      isLocked: true,
      lockReason: 'NO_COLLEGE',
      daysRemaining: 0,
      trialDaysRemaining: 0,
      periodDaysRemaining: null,
      trialStartedAt: null,
      trialEndsAt: null,
      periodStart: null,
      periodEnd: null,
    };
  }

  const storedStatus = normalizeSubStatus(college.subStatus, college.readOnlyReason);
  const trialStartedAt = college.trialStartedAt || null;
  const trialEndsAt = college.trialEndsAt || null;
  const periodStart = college.periodStart || null;
  const periodEnd = college.periodEnd || null;

  const trialDaysRemaining = calculateDaysRemaining(trialEndsAt, now);
  const periodDaysRemaining = calculateDaysRemaining(periodEnd, now);

  const hasValidPaidPeriod = Boolean(periodEnd && new Date(periodEnd).getTime() > now.getTime());
  const hasValidTrial = Boolean(trialEndsAt && new Date(trialEndsAt).getTime() > now.getTime());

  let effectiveSubStatus = storedStatus;
  let isLocked = false;
  let lockReason = null;

  if (storedStatus === 'DEACTIVATED' || college.isActive === false) {
    effectiveSubStatus = 'DEACTIVATED';
    isLocked = true;
    lockReason = 'DEACTIVATED';
  } else if (storedStatus === 'EXPIRED') {
    effectiveSubStatus = 'EXPIRED';
    isLocked = true;
    lockReason = college.readOnlyReason || 'SUBSCRIPTION_EXPIRED';
  } else if (storedStatus === 'ACTIVE') {
    if (periodEnd && !hasValidPaidPeriod) {
      effectiveSubStatus = 'EXPIRED';
      isLocked = true;
      lockReason = 'SUBSCRIPTION_EXPIRED';
    } else if (college.forceReadOnly) {
      isLocked = true;
      lockReason = college.readOnlyReason || 'ADMIN_FORCED';
    }
  } else if (storedStatus === 'PENDING_PAYMENT') {
    if (!hasValidPaidPeriod && trialEndsAt && !hasValidTrial) {
      effectiveSubStatus = 'EXPIRED';
      isLocked = true;
      lockReason = 'TRIAL_EXPIRED';
    } else if (!hasValidPaidPeriod && !trialEndsAt) {
      isLocked = true;
      lockReason = college.readOnlyReason || 'PAYMENT_REQUIRED';
    } else if (college.forceReadOnly) {
      isLocked = true;
      lockReason = college.readOnlyReason || 'SUBSCRIPTION_EXPIRED';
    }
  } else if (storedStatus === 'TRIAL') {
    if (trialEndsAt && !hasValidTrial) {
      effectiveSubStatus = 'EXPIRED';
      isLocked = true;
      lockReason = 'TRIAL_EXPIRED';
    } else if (college.forceReadOnly) {
      isLocked = true;
      lockReason = college.readOnlyReason || 'TRIAL_EXPIRED';
    }
  }

  const daysRemaining =
    effectiveSubStatus === 'ACTIVE'
      ? periodDaysRemaining
      : (effectiveSubStatus === 'TRIAL' || effectiveSubStatus === 'PENDING_PAYMENT')
      ? (hasValidPaidPeriod ? periodDaysRemaining : trialDaysRemaining)
      : 0;

  return {
    subStatus: storedStatus,
    effectiveSubStatus,
    isTrial: effectiveSubStatus === 'TRIAL',
    isPendingPayment: effectiveSubStatus === 'PENDING_PAYMENT',
    isActive: effectiveSubStatus === 'ACTIVE',
    isExpired: effectiveSubStatus === 'EXPIRED',
    isDeactivated: effectiveSubStatus === 'DEACTIVATED',
    isLocked,
    lockReason,
    daysRemaining,
    trialDaysRemaining,
    periodDaysRemaining,
    trialStartedAt,
    trialEndsAt,
    periodStart,
    periodEnd,
  };
}

/**
 * Enforce and apply a College.subStatus transition inside a Prisma transaction (or client).
 */
async function transitionCollegeSubStatus(
  db,
  {
    collegeId,
    toStatus,
    actorUserId = 'SYSTEM',
    actorEmail = null,
    reason = null,
    readOnlyReason = null,
    extraUpdates = {},
    ipAddress = null,
    paymentId = null,
    auditAction = null,
  }
) {
  const college = await db.college.findUnique({
    where: { id: collegeId },
    select: {
      id: true,
      subStatus: true,
      forceReadOnly: true,
      readOnlyReason: true,
      isActive: true,
      planId: true,
      trialEndsAt: true,
      periodEnd: true,
    },
  });

  if (!college) {
    const err = new Error(`College '${collegeId}' not found`);
    err.status = 404;
    err.code = 'COLLEGE_NOT_FOUND';
    throw err;
  }

  const { from, to } = assertValidSubStatusTransition(college.subStatus, toStatus, college.readOnlyReason);
  const now = new Date();

  const data = {
    subStatus: to,
    ...extraUpdates,
  };

  if (to === 'TRIAL') {
    data.forceReadOnly = false;
    data.readOnlyReason = null;
    data.isActive = true;
  } else if (to === 'ACTIVE') {
    data.forceReadOnly = false;
    data.readOnlyReason = null;
    data.isActive = true;
  } else if (to === 'PENDING_PAYMENT') {
    const hasValidTrial = Boolean(
      (extraUpdates.trialEndsAt ?? college.trialEndsAt) &&
        new Date(extraUpdates.trialEndsAt ?? college.trialEndsAt) > now
    );
    const hasValidPaid = Boolean(
      (extraUpdates.periodEnd ?? college.periodEnd) &&
        new Date(extraUpdates.periodEnd ?? college.periodEnd) > now
    );
    if (!hasValidTrial && !hasValidPaid) {
      data.forceReadOnly = true;
      data.readOnlyReason = readOnlyReason || college.readOnlyReason || 'PAYMENT_REQUIRED';
    }
  } else if (to === 'EXPIRED') {
    data.forceReadOnly = true;
    data.readOnlyReason = readOnlyReason || 'SUBSCRIPTION_EXPIRED';
  } else if (to === 'DEACTIVATED') {
    data.forceReadOnly = true;
    data.readOnlyReason = readOnlyReason || 'DEACTIVATED_BY_ADMIN';
    data.tokenEpoch = { increment: 1 };
  }

  const updated = await db.college.update({
    where: { id: collegeId },
    data,
  });

  if (db.collegeEntitlementAudit?.create) {
    await db.collegeEntitlementAudit.create({
      data: {
        college_id: collegeId,
        actorUserId: String(actorUserId || 'SYSTEM'),
        actorEmail: actorEmail || null,
        action: auditAction || `STATUS_${from}_TO_${to}`,
        beforeStateJson: {
          subStatus: college.subStatus,
          forceReadOnly: college.forceReadOnly,
          readOnlyReason: college.readOnlyReason,
        },
        afterStateJson: {
          subStatus: updated.subStatus,
          forceReadOnly: updated.forceReadOnly,
          readOnlyReason: updated.readOnlyReason,
        },
        reason: reason || `Subscription transitioned from ${from} to ${to}`,
        paymentId: paymentId || null,
        ipAddress: ipAddress || null,
      },
    });
  }

  return updated;
}

module.exports = {
  DAY_MS,
  SUB_STATUSES,
  ALLOWED_TRANSITIONS,
  normalizeSubStatus,
  canTransitionSubStatus,
  assertValidSubStatusTransition,
  calculateDaysRemaining,
  toPktCalendarDate,
  computeSubscriptionSnapshot,
  transitionCollegeSubStatus,
};

