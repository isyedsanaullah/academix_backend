'use strict';

/**
 * aiMicroserviceClient.js — Main Backend Client for collegeshub-ai-service
 * ─────────────────────────────────────────────────────────────────────────────
 * Provides an authenticated, resilient HTTP connection to the independently
 * deployed AI microservice.
 *
 * All internal calls automatically generate and attach short-lived S2S HMAC
 * assertions (`X-Collegeshub-Assertion`), correlation IDs (`X-Request-Id`),
 * and idempotency keys.
 */

const { generateServiceAssertion, ASSERTION_HEADER } = require('./aiServiceAssertion');

const AI_SERVICE_URL = (process.env.AI_SERVICE_URL || 'http://localhost:10001').replace(/\/+$/, '');
const DEFAULT_TIMEOUT_MS = 15000; // 15 seconds for regular RPCs

class AIMicroserviceClientError extends Error {
  constructor(message, status, code, details) {
    super(message);
    this.name = 'AIMicroserviceClientError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * Check readiness of the AI microservice.
 * @returns {Promise<{ status: string, checks: object }>}
 */
async function checkHealth() {
  const url = `${AI_SERVICE_URL}/health/readiness`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(5000),
    });

    const body = await res.json().catch(() => ({}));
    return {
      ok: res.ok,
      status: res.status,
      body,
    };
  } catch (err) {
    return {
      ok: false,
      status: 503,
      error: err.message,
    };
  }
}

/**
 * Ping the internal verified endpoint to test the S2S assertion bridge.
 *
 * @param {object} context
 * @param {string} context.userId
 * @param {string} context.collegeId
 * @param {string} context.role
 * @param {string} [context.planId]
 * @param {string} [context.requestId]
 */
async function ping(context) {
  const token = generateServiceAssertion({
    userId: context.userId,
    collegeId: context.collegeId,
    role: context.role,
    planId: context.planId || 'starter',
  });

  const url = `${AI_SERVICE_URL}/internal/v1/ping`;
  const requestId = context.requestId || crypto.randomUUID();

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      [ASSERTION_HEADER]: token,
      'X-Request-Id': requestId,
    },
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new AIMicroserviceClientError(
      body.message || `AI Microservice ping failed with status ${res.status}`,
      res.status,
      body.error || 'AI_SERVICE_ERROR',
      body
    );
  }

  return body;
}

/**
 * Deliver a transactional outbox event to the AI microservice.
 *
 * @param {object} params
 * @param {string} params.eventId
 * @param {string} params.eventType
 * @param {string} params.collegeId
 * @param {object} params.payload
 */
async function deliverOutboxEvent({ eventId, eventType, collegeId, payload }) {
  if (!eventId || !eventType) throw new Error('eventId and eventType are required for outbox dispatch');

  const token = generateServiceAssertion({
    userId: 'system-outbox-worker',
    collegeId: collegeId || 'system-college',
    role: 'superAdmin',
  });

  const url = `${AI_SERVICE_URL}/internal/v1/events/dispatch`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      [ASSERTION_HEADER]: token,
      'X-Idempotency-Key': eventId,
      'X-Request-Id': eventId,
    },
    body: JSON.stringify({
      eventId,
      eventType,
      collegeId,
      payload,
    }),
    signal: AbortSignal.timeout(10000),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new AIMicroserviceClientError(
      body.message || `Outbox event dispatch failed with status ${res.status}`,
      res.status,
      body.error || 'OUTBOX_DISPATCH_FAILED',
      body
    );
  }

  return body;
}

module.exports = {
  checkHealth,
  ping,
  deliverOutboxEvent,
  AIMicroserviceClientError,
  AI_SERVICE_URL,
};

