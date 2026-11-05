'use strict';

/**
 * executiveDigestWorker.js — Phase 9H (#N03)
 * Hourly Background Worker for Scheduled Executive Digest:
 * - Checks PKT time window (UTC + 5)
 * - Catch-up scheduling: triggers if scheduled time passed and not yet sent
 * - Idempotent via JobRunLog (jobKey: 'weekly-digest', runKey: 'YYYY-Wxx')
 * - Skips disabled and suspended institutions
 * - Strictly emits aggregates-only summary
 */

const { getSystemClient } = require('../config/prismaManager');
const { getEntitlements } = require('../services/entitlements');
const { generateDigestSummary } = require('../services/digestService');

function getPrisma() {
  return getSystemClient();
}

/**
 * Calculate ISO week string (e.g. "2026-W45")
 */
function getIsoWeekKey(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/**
 * Run one tick of the executive digest dispatcher
 * @param {Date} [simulatedDate] Optional date override for testing catch-up logic
 */
async function processExecutiveDigestTick(simulatedDate = null) {
  const prisma = getPrisma();
  const baseDate = simulatedDate || new Date();

  // Convert to PKT (UTC + 5 hours)
  const pktDate = new Date(baseDate.getTime() + 5 * 60 * 60 * 1000);

  const isoWeekKey = getIsoWeekKey(pktDate);
  const currentWeekday = pktDate.getUTCDay() === 0 ? 7 : pktDate.getUTCDay(); // 1=Mon .. 7=Sun
  const currentHour = pktDate.getUTCHours(); // 0..23

  // 1. Fetch all enabled digest configurations
  const configs = await prisma.digestConfig.findMany({
    where: { isEnabled: true }
  });

  const results = [];

  for (const config of configs) {
    const collegeId = config.college_id;

    // 2. Check College status (skip suspended)
    const college = await prisma.college.findUnique({
      where: { id: collegeId },
      select: { id: true, subStatus: true }
    });
    if (!college || college.subStatus === 'SUSPENDED') {
      continue;
    }

    // 3. Check Entitlement (N03 Premium+)
    const entitlements = await getEntitlements(collegeId, prisma);
    if (!entitlements.features.includes('scheduled-reports-email')) {
      continue;
    }

    // 4. Catch-up Schedule check:
    // Due if current PKT day is past scheduled day, OR on the scheduled day and current PKT hour >= sendHour
    const isDue = (currentWeekday > config.weekday) ||
      (currentWeekday === config.weekday && currentHour >= config.sendHour);

    if (!isDue) {
      continue;
    }

    // 5. JobRunLog Idempotency Check
    const jobKey = 'weekly-digest';
    const runKey = isoWeekKey;

    const existingRun = await prisma.jobRunLog.findUnique({
      where: {
        college_id_jobKey_runKey: {
          college_id: collegeId,
          jobKey,
          runKey
        }
      }
    });

    if (existingRun && existingRun.status === 'DONE') {
      continue; // Already successfully delivered for this ISO week
    }

    // 6. Claim job run
    await prisma.jobRunLog.upsert({
      where: {
        college_id_jobKey_runKey: {
          college_id: collegeId,
          jobKey,
          runKey
        }
      },
      update: {
        status: 'RUNNING',
        startedAt: new Date()
      },
      create: {
        college_id: collegeId,
        jobKey,
        runKey,
        status: 'RUNNING'
      }
    });

    try {
      // 7. Generate aggregates-only digest
      const summary = await generateDigestSummary(collegeId, config.campus_id);

      // 8. Enqueue Email Outbox Event
      await prisma.outboxEvent.create({
        data: {
          college_id: collegeId,
          eventType: 'DIGEST_EMAIL',
          payload: {
            collegeId,
            recipients: config.recipients,
            week: runKey,
            summary
          }
        }
      });

      // 9. Mark JobRunLog DONE
      await prisma.jobRunLog.update({
        where: {
          college_id_jobKey_runKey: {
            college_id: collegeId,
            jobKey,
            runKey
          }
        },
        data: {
          status: 'DONE',
          finishedAt: new Date()
        }
      });

      results.push({
        collegeId,
        week: runKey,
        status: 'SENT',
        recipientCount: config.recipients.length
      });
    } catch (err) {
      console.error(`[executiveDigestWorker] Error dispatching digest for college ${collegeId}:`, err);
      await prisma.jobRunLog.update({
        where: {
          college_id_jobKey_runKey: {
            college_id: collegeId,
            jobKey,
            runKey
          }
        },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          metaJson: { error: err.message }
        }
      });
    }
  }

  return results;
}

module.exports = {
  getIsoWeekKey,
  processExecutiveDigestTick
};
