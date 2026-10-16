/**
 * File Cleanup Scheduler
 * ──────────────────────
 * Periodically cleans up orphaned pending uploads and retries failed deletions.
 * Runs safely within tenant isolation — never touches files from other tenants.
 */
const { getSystemClient } = require('../config/prismaManager');
const { headObject, deleteObject } = require('../services/storageService');
const { isR2Configured } = require('../config/r2');

const CLEANUP_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const PENDING_EXPIRY_MS = 2 * 60 * 60 * 1000; // 2 hours — abandon pending uploads older than this
const DELETING_RETRY_LIMIT = 3;

let cleanupTimer = null;

/**
 * Clean up abandoned pending uploads.
 * Files stuck in 'pending' for over 2 hours are marked as failed.
 */
async function cleanupPendingUploads() {
  try {
    const prisma = getSystemClient();
    const cutoff = new Date(Date.now() - PENDING_EXPIRY_MS);

    const abandoned = await prisma.storedFile.findMany({
      where: {
        status: { in: ['pending', 'uploading'] },
        createdAt: { lt: cutoff },
      },
      take: 50,
    });

    if (abandoned.length === 0) return;

    for (const file of abandoned) {
      try {
        // Check if object was actually uploaded despite DB not being finalized
        const exists = await headObject(file.objectKey);

        if (exists) {
          // Object exists but was never finalized — delete the orphan
          await deleteObject(file.objectKey);
        }

        await prisma.storedFile.update({
          where: { id: file.id },
          data: {
            status: 'failed',
            errorMessage: 'Upload abandoned — pending for over 2 hours.',
            deletedAt: new Date(),
          },
        });
      } catch (err) {
        console.error(`Cleanup error for file ${file.id}: ${err.message}`);
      }
    }

    if (abandoned.length > 0) {
      console.log(`🧹 Cleaned up ${abandoned.length} abandoned pending uploads.`);
    }
  } catch (error) {
    console.error('File cleanup scheduler error:', error.message);
  }
}

/**
 * Retry R2 deletion for files stuck in 'deleting' state.
 */
async function retryFailedDeletions() {
  try {
    const prisma = getSystemClient();

    const stuckFiles = await prisma.storedFile.findMany({
      where: {
        status: 'deleting',
      },
      take: 20,
    });

    for (const file of stuckFiles) {
      try {
        await deleteObject(file.objectKey);
        await prisma.storedFile.update({
          where: { id: file.id },
          data: {
            status: 'deleted',
            deletedAt: new Date(),
          },
        });
      } catch (err) {
        console.error(`Retry deletion failed for ${file.id}: ${err.message}`);
      }
    }

    if (stuckFiles.length > 0) {
      console.log(`🧹 Retried deletion for ${stuckFiles.length} stuck files.`);
    }
  } catch (error) {
    console.error('Retry deletion scheduler error:', error.message);
  }
}

/**
 * Run all cleanup tasks.
 */
async function runCleanup() {
  if (!isR2Configured()) return;
  await cleanupPendingUploads();
  await retryFailedDeletions();
}

/**
 * Initialize the file cleanup scheduler.
 */
function initFileCleanupScheduler() {
  if (!isR2Configured()) {
    console.log('⚠️  R2 not configured — file cleanup scheduler disabled.');
    return;
  }

  // Run first cleanup after 5 minutes
  setTimeout(() => {
    runCleanup().catch((e) => console.error('Initial file cleanup error:', e.message));
  }, 5 * 60 * 1000);

  // Then run periodically
  cleanupTimer = setInterval(() => {
    runCleanup().catch((e) => console.error('Periodic file cleanup error:', e.message));
  }, CLEANUP_INTERVAL_MS);

  console.log('🧹 File cleanup scheduler initialized (every 30 minutes).');
}

module.exports = {
  initFileCleanupScheduler,
  runCleanup,
  cleanupPendingUploads,
  retryFailedDeletions,
};
