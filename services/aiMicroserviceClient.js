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
const crypto = require('crypto');

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

/**
 * Execute unary non-streaming completion through the centralized AI Gateway.
 *
 * @param {object} params
 * @param {string} params.collegeId
 * @param {string} params.userId
 * @param {string} [params.role]
 * @param {string} [params.planId]
 * @param {string} [params.featureKey]
 * @param {Array<{role: string, content: string}>} params.messages
 * @param {number} [params.temperature]
 * @param {number} [params.maxTokens]
 * @param {string} [params.requestId]
 * @returns {Promise<{ success: boolean, text: string, usage: object, creditsDebited: string, balanceAfter: string }>}
 */
async function executeCompletion({
  collegeId,
  userId,
  role = 'student',
  planId = 'standard',
  featureKey = 'ai-chat',
  messages = [],
  temperature = 0.7,
  maxTokens = 2048,
  requestId,
}) {
  const token = generateServiceAssertion({
    userId: String(userId),
    collegeId: String(collegeId),
    role,
    planId,
  });

  const correlationId = requestId || crypto.randomUUID();
  const url = `${AI_SERVICE_URL}/internal/v1/chat/completions`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      [ASSERTION_HEADER]: token,
      'X-Request-Id': correlationId,
    },
    body: JSON.stringify({
      featureKey,
      messages,
      temperature,
      maxTokens,
    }),
    signal: AbortSignal.timeout(60000), // 60s max for unary completions
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new AIMicroserviceClientError(
      body.message || `AI execution failed with status ${res.status}`,
      res.status,
      body.error || 'AI_EXECUTION_FAILED',
      body
    );
  }

  return body;
}

/**
 * Stream chat completion from AI microservice and pipe SSE directly to Express response.
 *
 * @param {object} params
 * @param {string} params.collegeId
 * @param {string} params.userId
 * @param {string} [params.role]
 * @param {string} [params.planId]
 * @param {string} [params.featureKey]
 * @param {Array<{role: string, content: string}>} params.messages
 * @param {number} [params.temperature]
 * @param {number} [params.maxTokens]
 * @param {object} params.req - Express Request
 * @param {object} params.res - Express Response
 * @param {function} [params.onChunk] - Callback receiving text deltas
 * @param {function} [params.onDone] - Callback receiving terminal completion payload
 */
async function pipeChatStreamToExpress({
  collegeId,
  userId,
  role = 'student',
  planId = 'standard',
  featureKey = 'ai-chat',
  messages = [],
  temperature = 0.7,
  maxTokens = 2048,
  req,
  res,
  onChunk,
  onDone,
}) {
  const token = generateServiceAssertion({
    userId: String(userId),
    collegeId: String(collegeId),
    role,
    planId,
  });

  const correlationId = (req && req.headers && req.headers['x-request-id']) || crypto.randomUUID();
  const url = `${AI_SERVICE_URL}/internal/v1/chat/stream`;

  const abortController = new AbortController();
  if (req && req.on) {
    req.on('close', () => {
      if (!res.writableEnded) {
        abortController.abort();
      }
    });
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
      [ASSERTION_HEADER]: token,
      'X-Request-Id': correlationId,
    },
    body: JSON.stringify({
      featureKey,
      messages,
      temperature,
      maxTokens,
    }),
    signal: abortController.signal,
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    if (response.status === 422) {
      // Insufficient credits error
      res.write(`data: ${JSON.stringify({
        text: `⚠️ Institutional AI credit balance is depleted. Please contact your college administrator to recharge AI credits.`,
        error: true,
        insufficientCredits: true,
        done: true,
      })}\n\n`);
      res.end();
      return;
    }

    res.write(`data: ${JSON.stringify({
      text: `Error connecting to AI service: ${errorBody.message || response.statusText}`,
      error: true,
      done: true,
    })}\n\n`);
    res.end();
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    while (true) {
      if (abortController.signal.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';

      for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        res.write(`${trimmed}\n\n`);

        if (trimmed.startsWith('data: ')) {
          try {
            const data = JSON.parse(trimmed.slice(6));
            if (data.text && !data.done && onChunk) {
              onChunk(data.text);
            }
            if (data.done && onDone) {
              onDone(data);
            }
          } catch {}
        }
      }
    }
  } catch (streamErr) {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ text: `Stream error: ${streamErr.message}`, done: true, error: true })}\n\n`);
      res.end();
    }
  } finally {
    reader.releaseLock();
    if (!res.writableEnded) {
      res.end();
    }
  }
}

/**
 * Query tenant-isolated semantic RAG knowledge chunks from the AI microservice.
 *
 * @param {object} params
 * @param {string} params.collegeId
 * @param {string} [params.userId]
 * @param {string} [params.role]
 * @param {string} [params.planId]
 * @param {string} params.query
 * @param {string} [params.subject]
 * @param {number} [params.topK]
 * @param {number} [params.minSimilarity]
 * @returns {Promise<Array<object>>}
 */
async function queryRagKnowledge({
  collegeId,
  userId = 'system-rag',
  role = 'student',
  planId = 'standard',
  query,
  subject,
  topK = 5,
  minSimilarity = 0.35,
}) {
  const token = generateServiceAssertion({
    userId: String(userId),
    collegeId: String(collegeId),
    role,
    planId,
  });

  const url = `${AI_SERVICE_URL}/internal/v1/rag/query`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      [ASSERTION_HEADER]: token,
      'X-Request-Id': crypto.randomUUID(),
    },
    body: JSON.stringify({
      query,
      subject,
      topK,
      minSimilarity,
    }),
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new AIMicroserviceClientError(
      body.message || `RAG query failed with status ${res.status}`,
      res.status,
      body.error || 'RAG_QUERY_FAILED',
      body
    );
  }

  const data = await res.json();
  return data.chunks || [];
}

module.exports = {
  checkHealth,
  ping,
  deliverOutboxEvent,
  executeCompletion,
  pipeChatStreamToExpress,
  queryRagKnowledge,
  AIMicroserviceClientError,
  AI_SERVICE_URL,
};

