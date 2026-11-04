/**
 * outboxWorker.js — Phase 6A
 * Drains the OutboxEvent table with FOR UPDATE SKIP LOCKED.
 * Safe for multi-instance Render deploys. Includes reaper for stuck PROCESSING rows.
 */

const { getSystemClient } = require('../config/prismaManager');

function getPrisma() {
  return getSystemClient();
}

const MAX_ATTEMPTS = 3;
const BATCH_SIZE = 10;
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
      // No cache to invalidate. tokenEpoch handles session invalidation.
      // Log for observability only.
      console.log('[outbox] ENTITLEMENT_CHANGED:', event.payload);
      break;
    case 'ANNOUNCEMENT_FANOUT':
      await handleAnnouncementFanout(event.payload);
      break;
    default:
      console.warn('[outbox] Unknown eventType:', event.eventType);
  }
}

async function handleReceiptEmail(payload) {
  const { paymentId, collegeId, receiptNumber, verifiedAmount } = payload;
  // TODO Phase 6C: generate PDF → upload to R2 → send email via email service
  // PDF generation runs here (outside settlement tx) so R2 upload latency doesn't block approval
  console.log(`[outbox] Receipt email queued: ${receiptNumber} for college ${collegeId}`);
}

async function handleInAppNotification(payload) {
  const { collegeId, type, paymentId, reason } = payload;
  // TODO: insert into Notification table or push via WebSocket
  console.log(`[outbox] In-app notification: ${type} for college ${collegeId}`);
}

async function handleAnnouncementFanout(payload) {
  const { announcementId } = payload;
  // Fan out in-app bell notifications to AnnouncementAudience recipients
  // TODO Phase 7B: implement full fanout
  console.log(`[outbox] Announcement fanout: ${announcementId}`);
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

  // Claim a batch
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
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          status: isFinal ? 'FAILED' : 'PENDING',
          lastError: err.message,
          nextAttemptAt: isFinal ? undefined : nextAttemptAt(event.attempts),
        },
      });
    }
  }
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

module.exports = { startOutboxWorker, drainOnce };

