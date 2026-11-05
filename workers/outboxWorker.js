/**
 * outboxWorker.js — Phase 6A / Hardened Phase 8.0
 * Drains the OutboxEvent table with FOR UPDATE SKIP LOCKED.
 * Safe for multi-instance Render deploys. Includes:
 * - Reaper for stuck PROCESSING rows
 * - DEAD_LETTER transition on MAX_ATTEMPTS (3)
 * - Super Admin in-app alert emission on DEAD_LETTER
 * - Batched dispatch in chunks of 200 recipients per tick
 * - Dead-letter retrieval & retry functions
 */

const { getSystemClient } = require('../config/prismaManager');

function getPrisma() {
  return getSystemClient();
}

const MAX_ATTEMPTS = 3;
const BATCH_SIZE = 10;
const FANOUT_CHUNK_SIZE = 200; // 200 recipients per dispatch tick
const STUCK_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

// ---------------------------------------------------------------------------
// Dispatch handlers
// ---------------------------------------------------------------------------
async function dispatch(event) {
  switch (event.eventType) {
    case 'RECEIPT_EMAIL':
      await handleReceiptEmail(event.payload);
      break;
    case 'IN_APP_NOTIFICATION':
      await handleInAppNotification(event.payload);
      break;
    case 'ENTITLEMENT_CHANGED':
      console.log('[outbox] ENTITLEMENT_CHANGED:', event.payload);
      break;
    case 'ANNOUNCEMENT_FANOUT':
      await handleAnnouncementFanout(event.payload);
      break;
    case 'GUARDIAN_ABSENCE_NOTIFICATION':
      await handleGuardianAbsenceNotification(event.payload);
      break;
    case 'FAILING_TEST_EVENT_THROW':
      throw new Error('Simulated dispatch failure');
    default:
      console.warn('[outbox] Unknown eventType:', event.eventType);
  }
}

async function handleReceiptEmail(payload) {
  const { paymentId, collegeId, receiptNumber, verifiedAmount } = payload;
  console.log(`[outbox] Receipt email queued: ${receiptNumber} for college ${collegeId}`);
}

async function handleInAppNotification(payload) {
  const { collegeId, type, paymentId, reason, recipient, title, message } = payload;
  const prisma = getPrisma();
  if (collegeId && recipient && (title || message)) {
    await prisma.notification.create({
      data: {
        college_id: collegeId,
        recipient: String(recipient),
        title: title || 'Notification',
        message: message || '',
        type: type || 'general'
      }
    });
  }
  console.log(`[outbox] In-app notification dispatched: ${type || 'general'} for college ${collegeId}`);
}

async function handleAnnouncementFanout(payload) {
  const { announcementId, collegeId, recipientUserIds = [] } = payload;
  const prisma = getPrisma();

  if (!recipientUserIds || recipientUserIds.length === 0) {
    console.log(`[outbox] Announcement fanout: ${announcementId} has no recipients`);
    return;
  }

  // Batched fanout in chunks of 200
  for (let i = 0; i < recipientUserIds.length; i += FANOUT_CHUNK_SIZE) {
    const chunk = recipientUserIds.slice(i, i + FANOUT_CHUNK_SIZE);
    const notifications = chunk.map(uid => ({
      college_id: collegeId,
      recipient: uid,
      title: payload.title || 'Announcement',
      message: payload.message || '',
      type: 'announcement',
      link: `/announcements/${announcementId}`
    }));

    await prisma.notification.createMany({
      data: notifications,
      skipDuplicates: true
    });
  }

  console.log(`[outbox] Announcement fanout complete for ${announcementId}: ${recipientUserIds.length} recipients in chunks of ${FANOUT_CHUNK_SIZE}`);
}

async function handleGuardianAbsenceNotification(payload) {
  console.log('[outbox] Guardian absence notification dispatched:', payload);
}

// ---------------------------------------------------------------------------
// Backoff: 2^attempts minutes
// ---------------------------------------------------------------------------
function nextAttemptAt(attempts) {
  const delayMs = Math.pow(2, attempts) * 60 * 1000;
  return new Date(Date.now() + delayMs);
}

// ---------------------------------------------------------------------------
// Reaper: reset stuck PROCESSING rows
// ---------------------------------------------------------------------------
async function reaperSweep() {
  const prisma = getPrisma();
  const stuckBefore = new Date(Date.now() - STUCK_THRESHOLD_MS);
  const reset = await prisma.outboxEvent.updateMany({
    where: { status: 'PROCESSING', updatedAt: { lt: stuckBefore } },
    data: { status: 'PENDING', nextAttemptAt: new Date() },
  });
  if (reset.count > 0) {
    console.warn(`[outbox] Reaper reset ${reset.count} stuck PROCESSING events`);
  }
}

// ---------------------------------------------------------------------------
// Main drain loop
// ---------------------------------------------------------------------------
async function drainOnce() {
  const prisma = getPrisma();
  // Run reaper first
  await reaperSweep();

  // Claim a batch with FOR UPDATE SKIP LOCKED
  const events = await prisma.$queryRaw`
    UPDATE "OutboxEvent"
    SET status = 'PROCESSING', "updatedAt" = NOW(), attempts = attempts + 1
    WHERE id IN (
      SELECT id FROM "OutboxEvent"
      WHERE status = 'PENDING' AND "nextAttemptAt" <= NOW()
      ORDER BY "nextAttemptAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${BATCH_SIZE}
    )
    RETURNING *;
  `;

  if (!events || events.length === 0) return;

  for (const event of events) {
    try {
      await dispatch(event);
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: { status: 'DONE', processedAt: new Date() },
      });
    } catch (err) {
      console.error(`[outbox] Failed to process event ${event.id} (${event.eventType}):`, err.message);
      const isFinal = event.attempts >= MAX_ATTEMPTS;

      if (isFinal) {
        await prisma.outboxEvent.update({
          where: { id: event.id },
          data: {
            status: 'DEAD_LETTER',
            failedAt: new Date(),
            lastError: err.message,
          },
        });

        // Emit Super Admin in-app alert
        try {
          const colId = event.college_id || (event.payload && event.payload.collegeId) || 'SYSTEM';
          await prisma.notification.create({
            data: {
              college_id: colId,
              recipient: 'SUPER_ADMIN',
              title: `Outbox Dead Letter Alert: ${event.eventType}`,
              message: `Outbox event ${event.id} (${event.eventType}) permanently failed after ${event.attempts} attempts: ${err.message}`,
              type: 'system',
              link: '/admin/super/outbox'
            }
          });
        } catch (notifErr) {
          console.error('[outbox] Failed to emit Super Admin dead-letter alert:', notifErr.message);
        }
      } else {
        await prisma.outboxEvent.update({
          where: { id: event.id },
          data: {
            status: 'PENDING',
            lastError: err.message,
            nextAttemptAt: nextAttemptAt(event.attempts),
          },
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Dead-letter queries & manual retry
// ---------------------------------------------------------------------------
async function getDeadLetterEvents({ page = 1, limit = 20, collegeId = null }) {
  const prisma = getPrisma();
  const take = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
  const skip = (Math.max(1, parseInt(page, 10) || 1) - 1) * take;

  const where = { status: 'DEAD_LETTER' };
  if (collegeId) where.college_id = collegeId;

  const [total, events] = await Promise.all([
    prisma.outboxEvent.count({ where }),
    prisma.outboxEvent.findMany({
      where,
      orderBy: { failedAt: 'desc' },
      skip,
      take,
    })
  ]);

  return {
    total,
    page: Math.max(1, parseInt(page, 10) || 1),
    totalPages: Math.ceil(total / take) || 1,
    limit: take,
    events,
  };
}

async function retryDeadLetterEvent(id) {
  const prisma = getPrisma();
  const event = await prisma.outboxEvent.findUnique({ where: { id } });
  if (!event) {
    throw Object.assign(new Error('Outbox event not found'), { status: 404 });
  }

  if (event.status !== 'DEAD_LETTER' && event.status !== 'FAILED') {
    throw Object.assign(new Error(`Event is currently ${event.status}, only DEAD_LETTER or FAILED can be retried`), { status: 400 });
  }

  const updated = await prisma.outboxEvent.update({
    where: { id },
    data: {
      status: 'PENDING',
      attempts: 0,
      nextAttemptAt: new Date(),
      retryCount: { increment: 1 },
      lastError: null,
      failedAt: null,
    }
  });

  return updated;
}

// ---------------------------------------------------------------------------
// Worker entry point — called from server.js or a Render cron
// ---------------------------------------------------------------------------
function startOutboxWorker(intervalMs = 5000) {
  console.log('[outbox] Worker started, polling every', intervalMs, 'ms');
  const run = async () => {
    try {
      await drainOnce();
    } catch (err) {
      console.error('[outbox] Drain error:', err.message);
    }
  };
  run(); // immediate first run
  return setInterval(run, intervalMs);
}

module.exports = {
  startOutboxWorker,
  drainOnce,
  getDeadLetterEvents,
  retryDeadLetterEvent,
  MAX_ATTEMPTS,
  FANOUT_CHUNK_SIZE
};
