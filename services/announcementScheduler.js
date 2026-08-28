// ─── Scheduled Publishing & Expiration Archiving Worker ─────────────
const { getSystemClient } = require('../config/prismaManager');

/**
 * Run periodic check for scheduled announcements to publish
 * and expired announcements to archive.
 */
async function processScheduledAnnouncements() {
  try {
    const prisma = getSystemClient();
    const now = new Date();

    // 1. Publish scheduled announcements whose scheduledFor <= NOW()
    const dueScheduled = await prisma.announcement.findMany({
      where: {
        status: 'Scheduled',
        scheduledFor: { lte: now }
      }
    });

    if (dueScheduled.length > 0) {
      for (const item of dueScheduled) {
        await prisma.announcement.update({
          where: { id: item.id },
          data: { status: 'Published' }
        });
        console.log(`[Scheduler] Auto-published scheduled announcement ${item.id}: "${item.title}"`);
      }
    }

    // 2. Archive expired announcements whose expiresAt <= NOW()
    const dueExpired = await prisma.announcement.findMany({
      where: {
        status: 'Published',
        expiresAt: { lte: now }
      }
    });

    if (dueExpired.length > 0) {
      for (const item of dueExpired) {
        await prisma.announcement.update({
          where: { id: item.id },
          data: { status: 'Archived' }
        });
        console.log(`[Scheduler] Auto-archived expired announcement ${item.id}: "${item.title}"`);
      }
    }
  } catch (error) {
    console.error('[Scheduler] Announcement process error:', error.message);
  }
}

/**
 * Start background timer running every 60 seconds
 */
function initAnnouncementScheduler() {
  console.log('⏰ Announcement scheduler initialized (running every 60s)');
  // Initial run after 5s
  setTimeout(processScheduledAnnouncements, 5000);
  // Interval every 60s
  setInterval(processScheduledAnnouncements, 60000);
}

module.exports = {
  processScheduledAnnouncements,
  initAnnouncementScheduler
};
