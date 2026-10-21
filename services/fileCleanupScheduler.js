/**
 * File Cleanup Scheduler (Phase 11)
 * ─────────────────────────────────────────────────────────────
 * Idempotent daily cleanup job:
 * 1. Deletes failed/pending StoredFile records & R2 objects older than 24 hours.
 * 2. Purges verified payment proof screenshots older than 90 days.
 * 3. Never deletes active student photos, stamps, logos, or ready academic documents.
 */

const { getSystemClient, getTenantClient } = require('../config/prismaManager');
const { deleteObject } = require('./storageService');

/**
 * Run file cleanup for a single tenant database
 */
async function runTenantFileCleanup(tenantDb, collegeId) {
  const stats = {
    collegeId,
    deletedPendingOrFailed: 0,
    deletedOldPaymentProofs: 0,
    errors: [],
  };

  try {
    const now = new Date();
    const cutoff24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const cutoff90d = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    // 1. Pending or failed uploads older than 24 hours
    const staleFiles = await tenantDb.storedFile.findMany({
      where: {
        college_id: collegeId,
        status: { in: ['pending', 'failed'] },
        createdAt: { lt: cutoff24h },
      },
      take: 200,
    });

    for (const file of staleFiles) {
      try {
        if (file.objectKey) {
          await deleteObject(file.objectKey).catch(() => {});
        }
        await tenantDb.storedFile.delete({
          where: { id: file.id },
        });
        stats.deletedPendingOrFailed++;
      } catch (err) {
        stats.errors.push({ fileId: file.id, error: err.message });
      }
    }

    // 2. Verified payment proofs older than 90 days
    const oldPaymentProofs = await tenantDb.storedFile.findMany({
      where: {
        college_id: collegeId,
        category: 'payment-proofs',
        status: 'ready',
        createdAt: { lt: cutoff90d },
      },
      take: 200,
    });

    for (const proof of oldPaymentProofs) {
      try {
        if (proof.objectKey) {
          await deleteObject(proof.objectKey).catch(() => {});
        }
        await tenantDb.storedFile.delete({
          where: { id: proof.id },
        });
        stats.deletedOldPaymentProofs++;
      } catch (err) {
        stats.errors.push({ fileId: proof.id, error: err.message });
      }
    }
  } catch (err) {
    stats.errors.push({ general: err.message });
  }

  return stats;
}

/**
 * Run cleanup across all active colleges
 */
async function runAllCollegesCleanup() {
  const sysDb = getSystemClient();
  const summary = {
    totalColleges: 0,
    totalStaleDeleted: 0,
    totalProofsPurged: 0,
    results: [],
  };

  try {
    const colleges = await sysDb.college.findMany({
      where: { isActive: true },
      select: { id: true, code: true, mongoUrl: true },
    });

    summary.totalColleges = colleges.length;

    for (const college of colleges) {
      const dbUrl = college.mongoUrl || process.env.DATABASE_URL;
      const tenantDb = getTenantClient(dbUrl);
      const res = await runTenantFileCleanup(tenantDb, college.id);
      summary.totalStaleDeleted += res.deletedPendingOrFailed;
      summary.totalProofsPurged += res.deletedOldPaymentProofs;
      summary.results.push(res);
    }
  } catch (err) {
    console.error('[FileCleanupScheduler] Error running global cleanup:', err.message);
  }

  return summary;
}

let schedulerTimer = null;

/**
 * Start background timer for daily execution
 */
function startFileCleanupScheduler(intervalMs = 24 * 60 * 60 * 1000) {
  if (schedulerTimer) return;

  // Run initial pass after 1 minute of server startup
  setTimeout(() => {
    runAllCollegesCleanup().catch((err) => {
      console.warn('[FileCleanupScheduler] Initial cleanup run error:', err.message);
    });
  }, 60 * 1000);

  // Recurring 24-hour interval
  schedulerTimer = setInterval(() => {
    runAllCollegesCleanup().catch((err) => {
      console.warn('[FileCleanupScheduler] Daily cleanup run error:', err.message);
    });
  }, intervalMs);

  if (schedulerTimer.unref) {
    schedulerTimer.unref();
  }
}

function stopFileCleanupScheduler() {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}

module.exports = {
  runTenantFileCleanup,
  runAllCollegesCleanup,
  startFileCleanupScheduler,
  initFileCleanupScheduler: startFileCleanupScheduler,
  stopFileCleanupScheduler,
};
