/**
 * fileCleanupWorker.js — Phase 7A
 * Background worker to clean up expired/abandoned upload reservations
 * and remove orphaned files from R2 storage.
 */

const { getSystemClient } = require('../config/prismaManager');
const { deleteObject } = require('../services/storageService');

async function cleanupAbandonedReservations() {
  const prisma = getSystemClient();
  const now = new Date();

  console.log('[FileCleanupWorker] Checking for expired upload reservations...');

  const expiredReservations = await prisma.uploadReservation.findMany({
    where: {
      status: 'PENDING',
      expiresAt: { lt: now }
    },
    take: 100
  });

  if (expiredReservations.length === 0) {
    console.log('[FileCleanupWorker] No expired upload reservations found.');
    return { cleanedCount: 0 };
  }

  let cleaned = 0;
  for (const res of expiredReservations) {
    try {
      // 1. Delete orphaned R2 object if client pushed bytes
      await deleteObject(res.storageKey);
    } catch (err) {
      // Silently ignore if object didn't exist in R2
    }

    // 2. Mark reservation ABANDONED
    await prisma.uploadReservation.update({
      where: { id: res.id },
      data: { status: 'ABANDONED' }
    });
    cleaned++;
  }

  console.log(`[FileCleanupWorker] Successfully cleaned up ${cleaned} abandoned reservations.`);
  return { cleanedCount: cleaned };
}

function startFileCleanupWorker(intervalMs = 60 * 60 * 1000) {
  console.log('[FileCleanupWorker] Hourly file cleanup worker registered.');
  return setInterval(() => {
    cleanupAbandonedReservations().catch(err => {
      console.error('[FileCleanupWorker] Error during cleanup run:', err.message);
    });
  }, intervalMs);
}

module.exports = {
  cleanupAbandonedReservations,
  startFileCleanupWorker
};

