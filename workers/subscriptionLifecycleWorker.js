/**
 * subscriptionLifecycleWorker.js — Phase 6C
 * Daily lifecycle background worker:
 * - Runs with transaction-level advisory lock (safe with Neon/PgBouncer)
 * - Batched queries to execute in <2 seconds over remote connections
 * - Threshold-based idempotency via SubscriptionReminderLog
 * - 30, 14, 7, 1 days renewal reminders
 * - 90, 60, 30, 14 days grandfather sunset alerts (90d alert due Nov 4/5, 2026)
 * - 5-day grace period before forceReadOnly = true (SUBSCRIPTION_EXPIRED)
 * - Trial expiry transitions (TRIAL_EXPIRED)
 * - Applies pending downgrades at renewal (with overcap check)
 * - Re-pins planVersionId to latest PlanVersion at renewal
 */

const { getSystemClient } = require('../config/prismaManager');

const ADVISORY_LOCK_ID = 1234567890;
const DEFAULT_GRACE_PERIOD_DAYS = 5;
const GRANDFATHER_DEADLINE = new Date('2027-02-02T00:00:00.000Z');

// PKT calendar date string YYYY-MM-DD
function getPktDateString(d = new Date()) {
  const pktDate = new Date(d.getTime() + 5 * 3600 * 1000);
  return pktDate.toISOString().split('T')[0];
}

async function runLifecycleWorker() {
  const prisma = getSystemClient();
  const graceDays = parseInt(process.env.SUBSCRIPTION_GRACE_PERIOD_DAYS || String(DEFAULT_GRACE_PERIOD_DAYS), 10);
  const now = new Date();
  const todayDate = new Date(getPktDateString(now));

  console.log(`[LifecycleWorker] Starting run at ${now.toISOString()} (PKT: ${getPktDateString(now)})...`);

  return await prisma.$transaction(async (tx) => {
    // 1. Transaction-level advisory lock
    const lockResult = await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(${ADVISORY_LOCK_ID}) as locked;`;
    const isLocked = lockResult[0]?.locked;
    if (!isLocked) {
      console.log('[LifecycleWorker] Another instance is currently executing. Exiting.');
      return { skipped: true, reason: 'LOCK_UNAVAILABLE' };
    }

    // 2. Fetch all active/trial colleges
    const colleges = await tx.college.findMany({
      where: {
        subStatus: { in: ['ACTIVE', 'TRIAL'] }
      }
    });

    if (colleges.length === 0) {
      console.log('[LifecycleWorker] No active or trial colleges found.');
      return { processedCount: 0, remindersSent: 0, readOnlyTransitions: 0, downgradesApplied: 0 };
    }

    const collegeIds = colleges.map(c => c.id);

    // 3. Batch fetch all existing reminder logs for these colleges
    const existingLogs = await tx.subscriptionReminderLog.findMany({
      where: {
        college_id: { in: collegeIds }
      }
    });

    // Group logs by college_id -> array of logs
    const logsByCollege = new Map();
    for (const log of existingLogs) {
      if (!logsByCollege.has(log.college_id)) {
        logsByCollege.set(log.college_id, []);
      }
      logsByCollege.get(log.college_id).push(log);
    }

    // 4. Batch fetch latest plan versions
    const allPlanVersions = await tx.planVersion.findMany({
      orderBy: { version: 'desc' }
    });
    const latestPlanVersionByPlan = new Map();
    for (const pv of allPlanVersions) {
      if (!latestPlanVersionByPlan.has(pv.planId)) {
        latestPlanVersionByPlan.set(pv.planId, pv);
      }
    }

    // 5. Pre-fetch usages for colleges that have a pending downgrade and are due
    const collegesDueForDowngrade = colleges.filter(c =>
      c.subStatus === 'ACTIVE' && c.periodEnd && now >= new Date(c.periodEnd) && c.pendingDowngradePlanId
    );
    const usagesByCollege = new Map();
    if (collegesDueForDowngrade.length > 0) {
      const usageRows = await tx.collegeUsage.findMany({
        where: {
          college_id: { in: collegesDueForDowngrade.map(c => c.id) },
          period: 'total'
        }
      });
      for (const u of usageRows) {
        if (!usagesByCollege.has(u.college_id)) {
          usagesByCollege.set(u.college_id, {});
        }
        usagesByCollege.get(u.college_id)[u.metric] = Number(u.value);
      }
    }

    const reminderLogsToCreate = [];
    const outboxEventsToCreate = [];
    let readOnlyTransitions = 0;
    let downgradesApplied = 0;

    // Helper to check existing log in memory
    function hasLog(collegeId, eventType, targetPeriodEnd = null) {
      const logs = logsByCollege.get(collegeId) || [];
      return logs.some(l => {
        if (l.eventType !== eventType) return false;
        if (targetPeriodEnd && l.periodEndDate) {
          const lDate = new Date(l.periodEndDate).toISOString().split('T')[0];
          const tDate = new Date(targetPeriodEnd).toISOString().split('T')[0];
          if (lDate !== tDate) return false;
        }
        return true;
      });
    }

    function recordReminder(collegeId, eventType, outboxPayload, periodEndDate = todayDate) {
      const normalizedPeriodEndDate = periodEndDate instanceof Date ? periodEndDate : new Date(periodEndDate);
      reminderLogsToCreate.push({
        college_id: collegeId,
        eventType,
        sentDate: todayDate,
        periodEndDate: normalizedPeriodEndDate
      });
      outboxEventsToCreate.push({
        eventType: 'IN_APP_NOTIFICATION',
        payload: outboxPayload
      });
      // Update memory cache so duplicates aren't added in same loop
      if (!logsByCollege.has(collegeId)) logsByCollege.set(collegeId, []);
      logsByCollege.get(collegeId).push({ eventType, periodEndDate: normalizedPeriodEndDate, createdAt: now });
    }

    // 6. Process each college in memory
    for (const college of colleges) {
      // -----------------------------------------------------------------------
      // A. Grandfather Sunset Alerts (Target: 2027-02-02)
      // -----------------------------------------------------------------------
      const daysToGrandfather = Math.ceil((GRANDFATHER_DEADLINE.getTime() - now.getTime()) / 86400000);
      const gfThresholds = [
        { days: 90, event: 'GRANDFATHER_90D' },
        { days: 60, event: 'GRANDFATHER_60D' },
        { days: 30, event: 'GRANDFATHER_30D' },
        { days: 14, event: 'GRANDFATHER_14D' },
      ];

      for (const { days, event } of gfThresholds) {
        if (daysToGrandfather <= days) {
          if (!hasLog(college.id, event, GRANDFATHER_DEADLINE)) {
            recordReminder(college.id, event, {
              collegeId: college.id,
              type: event,
              message: `Grandfathered plan sunset alert: Your current terms expire on February 2, 2027 (${daysToGrandfather} days remaining).`
            }, GRANDFATHER_DEADLINE);
          }
        }
      }

      // -----------------------------------------------------------------------
      // B. Trial Expiry Check
      // -----------------------------------------------------------------------
      if (college.subStatus === 'TRIAL' && college.trialEndsAt) {
        const trialEnd = new Date(college.trialEndsAt);
        const daysToTrialEnd = Math.ceil((trialEnd.getTime() - now.getTime()) / 86400000);

        if (now > trialEnd) {
          // Transition to Read-Only TRIAL_EXPIRED
          if (!college.forceReadOnly) {
            await tx.college.update({
              where: { id: college.id },
              data: {
                forceReadOnly: true,
                readOnlyReason: 'TRIAL_EXPIRED'
              }
            });
            recordReminder(college.id, 'EXPIRY_TRANSITION', {
              collegeId: college.id,
              type: 'TRIAL_EXPIRED',
              message: 'Trial has expired. Workspace locked to read-only.'
            }, trialEnd);
            readOnlyTransitions++;
          }
        } else {
          // Trial Warnings: 3d, 1d
          for (const d of [3, 1]) {
            if (daysToTrialEnd <= d) {
              const eventType = `TRIAL_${d}D`;
              if (!hasLog(college.id, eventType, trialEnd)) {
                recordReminder(college.id, eventType, {
                  collegeId: college.id,
                  type: eventType,
                  daysRemaining: daysToTrialEnd
                }, trialEnd);
              }
            }
          }
        }
      }

      // -----------------------------------------------------------------------
      // C. Paid Subscription Renewal Reminders & Grace Expiry
      // -----------------------------------------------------------------------
      if (college.subStatus === 'ACTIVE' && college.periodEnd) {
        const periodEnd = new Date(college.periodEnd);
        const daysToExpiry = Math.ceil((periodEnd.getTime() - now.getTime()) / 86400000);

        // Renewal Reminders: 30, 14, 7, 1 days
        const renewalThresholds = [
          { days: 30, event: 'RENEWAL_30D' },
          { days: 14, event: 'RENEWAL_14D' },
          { days: 7,  event: 'RENEWAL_7D'  },
          { days: 1,  event: 'RENEWAL_1D'  },
        ];

        for (const { days, event } of renewalThresholds) {
          if (daysToExpiry <= days && daysToExpiry > 0) {
            if (!hasLog(college.id, event, periodEnd)) {
              recordReminder(college.id, event, {
                collegeId: college.id,
                type: event,
                daysRemaining: daysToExpiry
              }, periodEnd);
            }
          }
        }

        // Expiry Transitions: Grace Period Check (periodEnd + graceDays < now)
        const graceEnd = new Date(periodEnd.getTime() + graceDays * 86400000);
        if (now > graceEnd && !college.forceReadOnly) {
          await tx.college.update({
            where: { id: college.id },
            data: {
              forceReadOnly: true,
              readOnlyReason: 'SUBSCRIPTION_EXPIRED'
            }
          });
          recordReminder(college.id, 'EXPIRY_TRANSITION', {
            collegeId: college.id,
            type: 'SUBSCRIPTION_EXPIRED',
            message: 'Subscription grace period has elapsed. Workspace locked to read-only.'
          }, periodEnd);
          readOnlyTransitions++;
        }

        // Downgrade Application at Renewal
        if (now >= periodEnd && college.pendingDowngradePlanId) {
          const targetPlan = college.pendingDowngradePlanId;
          const targetCycle = college.pendingDowngradeBillingCycle || 'MONTHLY';
          const pv = latestPlanVersionByPlan.get(targetPlan);
          const usageMap = usagesByCollege.get(college.id) || {};
          const studentLimit = pv?.limitsJson?.maxStudents || 300;

          if ((usageMap.students || 0) > studentLimit) {
            await tx.collegeEntitlementAudit.create({
              data: {
                college_id: college.id,
                actorUserId: 'LIFECYCLE_WORKER',
                action: 'DOWNGRADE_BLOCKED_OVERCAP',
                reason: `Downgrade to ${targetPlan} blocked: usage (${usageMap.students}) exceeds limit (${studentLimit})`
              }
            });
          } else {
            await tx.college.update({
              where: { id: college.id },
              data: {
                planId: targetPlan,
                billingCycle: targetCycle,
                planVersionId: pv?.id || college.planVersionId,
                pendingDowngradePlanId: null,
                pendingDowngradeBillingCycle: null
              }
            });
            downgradesApplied++;
          }
        }
      }
    }

    // 7. Write reminder logs and outbox events in batch
    if (reminderLogsToCreate.length > 0) {
      await tx.subscriptionReminderLog.createMany({
        data: reminderLogsToCreate,
        skipDuplicates: true
      });
    }

    if (outboxEventsToCreate.length > 0) {
      await tx.outboxEvent.createMany({
        data: outboxEventsToCreate
      });
    }

    console.log(`[LifecycleWorker] Complete. Processed: ${colleges.length}, Reminders: ${reminderLogsToCreate.length}, ReadOnly Transitions: ${readOnlyTransitions}, Downgrades Applied: ${downgradesApplied}`);

    return {
      processedCount: colleges.length,
      remindersSent: reminderLogsToCreate.length,
      readOnlyTransitions,
      downgradesApplied
    };
  }, {
    maxWait: 15000,
    timeout: 30000
  });
}

function startSubscriptionLifecycleWorker(intervalMs = 24 * 60 * 60 * 1000) {
  console.log('[LifecycleWorker] Background scheduler initialized (interval:', intervalMs, 'ms)');
  const execute = async () => {
    try {
      await runLifecycleWorker();
    } catch (e) {
      console.error('[LifecycleWorker] Error executing cycle:', e);
    }
  };
  execute(); // immediate first execution (sends 90d grandfather alerts)
  return setInterval(execute, intervalMs);
}

module.exports = {
  runLifecycleWorker,
  startSubscriptionLifecycleWorker,
  getPktDateString
};
