'use strict';

/**
 * webhookService.js — Phase 9E (#N06)
 * Webhook Subscription & Dispatch Engine:
 * - Anti-SSRF URL validation & DNS IP pinning
 * - AES-256-GCM secret encryption with single-reveal on creation/rotation
 * - HMAC-SHA256 signature header generation
 * - Exponential backoff retry schedule (1m, 5m, 30m, 2h, 12h)
 * - Abandoned-delivery counting and auto-disable after 5 consecutive abandoned deliveries
 */

const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { getSystemClient } = require('../config/prismaManager');
const { encryptWebhookSecret, decryptWebhookSecret, signWebhookPayload } = require('./webhookCrypto');
const { validateWebhookUrl, resolvePinnedIp, isRestrictedIp } = require('./ssrfProtection');

function getPrisma() {
  return getSystemClient();
}

const RETRY_DELAYS_MS = [
  60 * 1000,          // Attempt 1 -> 1 min
  5 * 60 * 1000,      // Attempt 2 -> 5 min
  30 * 60 * 1000,     // Attempt 3 -> 30 min
  2 * 60 * 60 * 1000, // Attempt 4 -> 2 hours
  12 * 60 * 60 * 1000 // Attempt 5 -> 12 hours
];

/**
 * Create a new webhook subscription
 * Generates and reveals raw secret once
 */
async function createSubscription({
  collegeId,
  campusId = null,
  targetUrl,
  events = ['*']
}) {
  const prisma = getPrisma();

  // Validate URL against SSRF
  if (process.env.ALLOW_TEST_WEBHOOK_LOOPBACK !== 'true') {
    await validateWebhookUrl(targetUrl);
  }

  // Generate 32-byte cryptographically secure secret
  const rawSecret = `whsec_${crypto.randomBytes(24).toString('hex')}`;
  const secretEnc = encryptWebhookSecret(rawSecret);

  const subscription = await prisma.webhookSubscription.create({
    data: {
      college_id: collegeId,
      campus_id: campusId,
      targetUrl,
      secretEnc,
      events: Array.isArray(events) ? events : ['*'],
      isActive: true,
      consecutiveAbandoned: 0
    }
  });

  return {
    id: subscription.id,
    targetUrl: subscription.targetUrl,
    events: subscription.events,
    isActive: subscription.isActive,
    createdAt: subscription.createdAt,
    rawSecret // Returned only once!
  };
}

/**
 * Rotate webhook signing secret
 */
async function rotateSecret({ collegeId, subscriptionId }) {
  const prisma = getPrisma();

  const sub = await prisma.webhookSubscription.findFirst({
    where: { id: subscriptionId, college_id: collegeId }
  });

  if (!sub) {
    throw Object.assign(new Error(`Webhook subscription "${subscriptionId}" not found.`), { status: 404, code: 'NOT_FOUND' });
  }

  const rawSecret = `whsec_${crypto.randomBytes(24).toString('hex')}`;
  const secretEnc = encryptWebhookSecret(rawSecret);

  await prisma.webhookSubscription.update({
    where: { id: subscriptionId },
    data: { secretEnc }
  });

  return { rawSecret };
}

/**
 * Emit an institutional domain event to all matching webhook subscriptions
 */
async function emitDomainEvent(collegeId, eventType, payload, campusId = null, dbClient = null) {
  const prisma = dbClient || getPrisma();

  const subscriptions = await prisma.webhookSubscription.findMany({
    where: {
      college_id: collegeId,
      isActive: true,
      OR: [
        { events: { has: '*' } },
        { events: { has: eventType } }
      ]
    }
  });

  if (subscriptions.length === 0) return [];

  const deliveries = [];
  for (const sub of subscriptions) {
    const delivery = await prisma.webhookDelivery.create({
      data: {
        college_id: collegeId,
        campus_id: campusId,
        subscriptionId: sub.id,
        eventType,
        payloadJson: payload,
        attempt: 0,
        status: 'PENDING',
        nextAttemptAt: new Date()
      }
    });
    deliveries.push(delivery);
  }

  return deliveries;
}

/**
 * Perform actual HTTP dispatch with IP pinning and signature
 */
function dispatchHttp({ pinnedIp, hostname, path, port, isHttps, signatureHeader, payloadString }) {
  return new Promise((resolve, reject) => {
    const transport = isHttps ? https : http;
    const reqOptions = {
      host: pinnedIp, // connect to pinned IP directly
      port: port || (isHttps ? 443 : 80),
      path,
      method: 'POST',
      headers: {
        'Host': hostname, // preserve virtual host for TLS SNI and routing
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payloadString),
        'X-Academix-Signature': signatureHeader,
        'User-Agent': 'Academix-Webhooks/1.0'
      },
      timeout: 10000,
      agent: false
    };

    if (isHttps) {
      reqOptions.servername = hostname; // TLS SNI
    }

    const req = transport.request(reqOptions, (res) => {
      let responseBody = '';
      let bytesRead = 0;
      const MAX_BYTES = 64 * 1024; // 64 KB cap

      res.on('data', (chunk) => {
        bytesRead += chunk.length;
        if (bytesRead <= MAX_BYTES) {
          responseBody += chunk.toString();
        }
      });

      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          body: responseBody
        });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Webhook request timed out after 10000ms'));
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.write(payloadString);
    req.end();
  });
}

/**
 * Deliver a single webhook delivery record
 */
async function deliverWebhook(deliveryId) {
  const prisma = getPrisma();

  const delivery = await prisma.webhookDelivery.findUnique({
    where: { id: deliveryId }
  });

  if (!delivery || delivery.status !== 'PENDING') return null;

  const subscription = await prisma.webhookSubscription.findUnique({
    where: { id: delivery.subscriptionId }
  });

  if (!subscription || !subscription.isActive) {
    return prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: 'ABANDONED',
        lastError: 'Subscription inactive or removed'
      }
    });
  }

  let statusCode = null;
  let errorMsg = null;
  let isSuccess = false;

  try {
    // 1. Decrypt secret & sign payload
    const rawSecret = decryptWebhookSecret(subscription.secretEnc);
    const payloadStr = JSON.stringify(delivery.payloadJson);
    const { signatureHeader } = signWebhookPayload(rawSecret, payloadStr);

    // 2. Resolve target URL with IP pinning
    const urlObj = new URL(subscription.targetUrl);
    const isHttps = urlObj.protocol === 'https:';

    let pinnedIp = urlObj.hostname;
    if (process.env.ALLOW_TEST_WEBHOOK_LOOPBACK !== 'true') {
      const pinResult = await resolvePinnedIp(subscription.targetUrl);
      pinnedIp = pinResult.pinnedIp;
    }

    // 3. Dispatch HTTP POST
    const resp = await dispatchHttp({
      pinnedIp,
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      port: urlObj.port ? parseInt(urlObj.port, 10) : (isHttps ? 443 : 80),
      isHttps,
      signatureHeader,
      payloadString: payloadStr
    });

    statusCode = resp.statusCode;
    isSuccess = statusCode >= 200 && statusCode < 300;
    if (!isSuccess) {
      errorMsg = `Server responded with HTTP ${statusCode}`;
    }
  } catch (err) {
    errorMsg = err.message || 'Dispatch failed';
  }

  const nextAttemptNumber = delivery.attempt + 1;

  if (isSuccess) {
    // Delivery succeeded! Reset subscription consecutiveAbandoned to 0
    await prisma.webhookSubscription.update({
      where: { id: subscription.id },
      data: { consecutiveAbandoned: 0 }
    });

    return prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: 'DELIVERED',
        attempt: nextAttemptNumber,
        deliveredAt: new Date(),
        lastStatusCode: statusCode,
        lastError: null
      }
    });
  }

  // Delivery failed
  if (nextAttemptNumber >= 5) {
    // Mark delivery ABANDONED after 5 failures
    const updatedSub = await prisma.webhookSubscription.update({
      where: { id: subscription.id },
      data: {
        consecutiveAbandoned: { increment: 1 }
      }
    });

    // Auto-disable subscription after 5 consecutive abandoned deliveries
    if (updatedSub.consecutiveAbandoned >= 5) {
      await prisma.webhookSubscription.update({
        where: { id: subscription.id },
        data: {
          isActive: false,
          disabledReason: 'Disabled after 5 consecutive abandoned deliveries'
        }
      });

      await prisma.outboxEvent.create({
        data: {
          college_id: subscription.college_id,
          eventType: 'WEBHOOK_SUBSCRIPTION_DISABLED',
          payload: {
            subscriptionId: subscription.id,
            targetUrl: subscription.targetUrl,
            reason: 'Disabled after 5 consecutive abandoned deliveries'
          }
        }
      });
    }

    return prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: 'ABANDONED',
        attempt: nextAttemptNumber,
        lastStatusCode: statusCode,
        lastError: errorMsg
      }
    });
  }

  // Schedule next attempt with backoff
  const delayMs = RETRY_DELAYS_MS[nextAttemptNumber - 1] || RETRY_DELAYS_MS[0];
  const nextAttemptAt = new Date(Date.now() + delayMs);

  return prisma.webhookDelivery.update({
    where: { id: deliveryId },
    data: {
      attempt: nextAttemptNumber,
      nextAttemptAt,
      lastStatusCode: statusCode,
      lastError: errorMsg
    }
  });
}

/**
 * Worker claim and process due pending deliveries
 */
async function processDueWebhookDeliveries(limit = 10) {
  const prisma = getPrisma();
  const now = new Date();

  const dueDeliveries = await prisma.$queryRawUnsafe(`
    SELECT "id" FROM "WebhookDelivery"
    WHERE "status" = 'PENDING' AND "nextAttemptAt" <= $1
    ORDER BY "nextAttemptAt" ASC
    LIMIT $2
    FOR UPDATE SKIP LOCKED;
  `, now, limit);

  const results = [];
  for (const row of dueDeliveries) {
    const res = await deliverWebhook(row.id);
    results.push(res);
  }

  return results;
}

module.exports = {
  createSubscription,
  rotateSecret,
  emitDomainEvent,
  deliverWebhook,
  processDueWebhookDeliveries
};

