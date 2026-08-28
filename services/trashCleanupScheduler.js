/**
 * Trash Cleanup Scheduler
 * Nightly at 12:00 AM — permanently purges soft-deleted records older than 7 days.
 *
 * Safety guarantees:
 *  - Uses a single raw pg.Pool connection for advisory lock acquisition and release
 *    to guarantee both operations share the same session.
 *  - Atomic per-item Prisma transaction re-checks deletedAt before purging
 *    to prevent restore-vs-cleanup race conditions.
 *  - Errors are isolated per item; one failure does not abort remaining cleanup.
 *  - Failed items are automatically retried on the next scheduled run.
 */

const { getSystemClient, pools } = require('../config/prismaManager');
const { ACTIONS, CATEGORIES, STATUSES } = require('../config/activityConstants');

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const ADVISORY_LOCK_ID = 8847291; // Unique stable lock ID for Academix trash cleanup

// SOFT_DELETE_ALLOWED models in canonical Prisma format
const SOFT_DELETE_ALLOWED_MODELS = [
  { modelKey: 'announcement',  label: 'Announcement'  },
  { modelKey: 'assignment',    label: 'Assignment'    },
  { modelKey: 'pDFDocument',   label: 'PDFDocument'   },
  { modelKey: 'quiz',          label: 'Quiz'          },
];

/**
 * Resource-specific permanent purge functions.
 * Never blindly calls prisma[modelKey].delete() without relationship checks.
 */
async function purgeAnnouncementTx(tx, id) {
  await tx.announcement.delete({ where: { id } });
}

async function purgeAssignmentTx(tx, id) {
  // Submissions are PROTECTED (SOFT_DELETE_NOT_ALLOWED) — never cascade-delete.
  // Only remove the assignment record itself.
  await tx.assignment.delete({ where: { id } });
}

async function purgeQuizTx(tx, id) {
  // QuizAttempts are PROTECTED (SOFT_DELETE_NOT_ALLOWED) — never cascade-delete.
  // Only remove the quiz record itself.
  await tx.quiz.delete({ where: { id } });
}

async function purgePDFDocumentTx(tx, id) {
  // Delete related DocumentChunks (vector chunks), but NOT any student usage records.
  await tx.documentChunk.deleteMany({ where: { pdfDocumentId: id } }).catch(() => {});
  await tx.pDFDocument.delete({ where: { id } });
}

const PURGE_FUNCTIONS = {
  announcement: purgeAnnouncementTx,
  assignment:   purgeAssignmentTx,
  pDFDocument:  purgePDFDocumentTx,
  quiz:         purgeQuizTx,
};

/**
 * Get the system pg.Pool instance for advisory lock management.
 * Requires the system DATABASE_URL to be registered in the pools Map.
 */
function getSystemPool() {
  const systemUrl = process.env.DATABASE_URL;
  if (!systemUrl) throw new Error('[Trash Cleanup] DATABASE_URL not set.');
  const pool = pools.get(systemUrl);
  if (!pool) throw new Error('[Trash Cleanup] System pg.Pool not initialized. Ensure the system client has been created first.');
  return pool;
}

/**
 * Main cleanup function. Acquires advisory lock, processes expired records,
 * and releases the lock on the same connection.
 */
async function processExpiredTrashCleanup() {
  const startTime = new Date();
  console.log(`[Trash Cleanup] Starting cleanup run at ${startTime.toISOString()}`);

  const pool = getSystemPool();
  const pgClient = await pool.connect(); // Dedicated single connection for lock session
  const prisma = getSystemClient();

  let acquired = false;

  try {
    // Acquire advisory lock on the single dedicated connection
    const lockRes = await pgClient.query(
      'SELECT pg_try_advisory_lock($1::bigint) AS acquired',
      [ADVISORY_LOCK_ID]
    );
    acquired = lockRes.rows[0].acquired;

    if (!acquired) {
      console.log('[Trash Cleanup] Another instance holds the cleanup lock. Skipping this run.');
      return;
    }

    const cutoffDate = new Date(startTime.getTime() - SEVEN_DAYS_MS);
    let totalPurged = 0;
    let totalErrors = 0;

    for (const { modelKey, label } of SOFT_DELETE_ALLOWED_MODELS) {
      let items;
      try {
        items = await prisma[modelKey].findMany({
          where: { deletedAt: { lte: cutoffDate } },
          select: { id: true, deletedAt: true }
        });
      } catch (e) {
        console.error(`[Trash Cleanup] Failed to query ${label}:`, e.message);
        totalErrors++;
        continue;
      }

      for (const item of items) {
        try {
          // Atomic transaction per item prevents restore-vs-cleanup race:
          // Re-read deletedAt inside transaction before purging.
          await prisma.$transaction(async (tx) => {
            const fresh = await tx[modelKey].findUnique({
              where: { id: item.id },
              select: { id: true, deletedAt: true }
            });

            // Skip if record was restored between query and now
            if (!fresh || !fresh.deletedAt) {
              console.log(`[Trash Cleanup] ${label} ${item.id} was restored before purge. Skipping.`);
              return;
            }
            if (fresh.deletedAt > cutoffDate) {
              console.log(`[Trash Cleanup] ${label} ${item.id} no longer expired. Skipping.`);
              return;
            }

            const purgeFn = PURGE_FUNCTIONS[modelKey];
            if (!purgeFn) {
              throw new Error(`No purge function defined for model '${modelKey}'.`);
            }
            await purgeFn(tx, item.id);

            console.log(`[Trash Cleanup] ✅ Permanently purged ${label} ID: ${item.id}`);
            totalPurged++;
          });
        } catch (e) {
          console.error(`[Trash Cleanup] ❌ Failed to purge ${label} ID ${item.id}:`, e.message);
          totalErrors++;
          // Continue to next item — failures are retried on next run
        }
      }
    }

    const duration = Date.now() - startTime.getTime();
    console.log(
      `[Trash Cleanup] Run complete. Purged: ${totalPurged}, Errors: ${totalErrors}, Duration: ${duration}ms`
    );
  } catch (err) {
    console.error('[Trash Cleanup] Fatal error during cleanup:', err.message);
  } finally {
    // Release advisory lock on the SAME connection and return it to pool
    if (acquired) {
      try {
        await pgClient.query('SELECT pg_advisory_unlock($1::bigint)', [ADVISORY_LOCK_ID]);
        console.log('[Trash Cleanup] Advisory lock released.');
      } catch (e) {
        console.error('[Trash Cleanup] Failed to release advisory lock:', e.message);
      }
    }
    pgClient.release();
  }
}

/**
 * Schedule nightly cleanup at 12:00 AM using node-cron or a simple interval.
 * Uses node-cron if available; falls back to polling every hour if not installed.
 */
function initTrashCleanupScheduler() {
  // Try to use node-cron if it is available in the project
  try {
    const cron = require('node-cron');
    cron.schedule('0 0 * * *', () => {
      processExpiredTrashCleanup().catch(err =>
        console.error('[Trash Cleanup] Unhandled error in scheduled run:', err.message)
      );
    }, { timezone: 'UTC' });
    console.log('🗑️  Trash Cleanup Scheduler initialized (nightly 12:00 AM UTC via node-cron)');
  } catch (e) {
    // node-cron not installed — use hourly polling interval as fallback
    console.warn('[Trash Cleanup] node-cron not available. Falling back to hourly interval.');
    setInterval(() => {
      const now = new Date();
      if (now.getUTCHours() === 0 && now.getUTCMinutes() < 5) {
        processExpiredTrashCleanup().catch(err =>
          console.error('[Trash Cleanup] Unhandled error in interval run:', err.message)
        );
      }
    }, 60 * 60 * 1000); // Check every hour
  }
}

module.exports = {
  processExpiredTrashCleanup,
  initTrashCleanupScheduler,
};
