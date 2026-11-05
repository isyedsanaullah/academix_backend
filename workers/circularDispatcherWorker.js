/**
 * circularDispatcherWorker.js — Phase 7B
 * Atomic claim dispatcher for scheduled circulars:
 * - Uses UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED) to claim circulars atomically
 * - Prevents duplicate dispatches across cluster workers
 * - Transitions status to 'PUBLISHED' and fans out notifications via OutboxEvent
 */

const { getSystemClient } = require('../config/prismaManager');

async function dispatchScheduledCirculars() {
  const prisma = getSystemClient();

  try {
    // Atomic claim with SKIP LOCKED
    const claimed = await prisma.$queryRaw`
      UPDATE "Announcement"
      SET "dispatchedAt" = NOW(), status = 'PUBLISHED'
      WHERE id IN (
        SELECT id FROM "Announcement"
        WHERE (status = 'SCHEDULED' OR status = 'PUBLISHED')
          AND ("scheduledFor" IS NULL OR "scheduledFor" <= NOW())
          AND "dispatchedAt" IS NULL
        FOR UPDATE SKIP LOCKED
        LIMIT 50
      )
      RETURNING id, college_id, title, audience, category;
    `;

    if (!claimed || claimed.length === 0) {
      return { dispatchedCount: 0 };
    }

    console.log(`[CircularDispatcher] Atomically claimed ${claimed.length} circulars for dispatch.`);

    const outboxEvents = claimed.map(c => ({
      eventType: 'CIRCULAR_PUSH',
      payload: {
        circularId: c.id,
        collegeId: c.college_id,
        title: c.title,
        audience: c.audience,
        category: c.category,
        dispatchedAt: new Date().toISOString()
      }
    }));

    await prisma.outboxEvent.createMany({
      data: outboxEvents
    });

    return { dispatchedCount: claimed.length };
  } catch (error) {
    console.error('[CircularDispatcher] Error dispatching circulars:', error.message);
    throw error;
  }
}

function startCircularDispatcherWorker(intervalMs = 60 * 1000) {
  console.log('[CircularDispatcher] Worker started (interval:', intervalMs, 'ms)');
  const execute = async () => {
    try {
      await dispatchScheduledCirculars();
    } catch (e) {
      console.error('[CircularDispatcher] Execution failure:', e.message);
    }
  };
  return setInterval(execute, intervalMs);
}

module.exports = {
  dispatchScheduledCirculars,
  startCircularDispatcherWorker
};

