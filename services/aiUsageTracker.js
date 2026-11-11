'use strict';

const crypto = require('crypto');
const { getSystemClient } = require('../config/prismaManager');
const { calculateEstimatedCostUsd, normalizeModelName } = require('./aiPricingService');

/**
 * Format Date to UTC YYYY-MM-DD
 */
function getUtcDateString(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return d.toISOString().slice(0, 10);
}

/**
 * Safely extracts usage tokens from standard Gemini SDK response or metadata
 */
function extractUsageFromGeminiResponse(result, fallbackPrompt = '') {
  let promptTokens = 0;
  let outputTokens = 0;
  let cachedTokens = 0;
  let reasoningTokens = 0;
  let totalTokens = 0;

  try {
    const meta =
      result?.response?.usageMetadata ||
      result?.usageMetadata ||
      result?.usage ||
      result?.rawUsage;

    if (meta) {
      promptTokens = Number(meta.promptTokenCount || meta.promptTokens || meta.prompt_token_count || 0);
      outputTokens = Number(meta.candidatesTokenCount || meta.completionTokens || meta.output_token_count || 0);
      cachedTokens = Number(meta.cachedContentTokenCount || meta.cachedTokens || meta.cached_content_token_count || 0);
      reasoningTokens = Number(meta.reasoningTokenCount || meta.reasoningTokens || 0);
      totalTokens = Number(meta.totalTokenCount || meta.totalTokens || (promptTokens + outputTokens));
    } else {
      // Intelligent fallback approximation: 1 token ~= 4 English characters
      if (typeof fallbackPrompt === 'string' && fallbackPrompt.length > 0) {
        promptTokens = Math.ceil(fallbackPrompt.length / 4);
      }
      const responseText =
        result?.response?.text?.() ||
        (typeof result?.response?.text === 'string' ? result.response.text : '') ||
        (typeof result?.text === 'string' ? result.text : '');
      if (responseText) {
        outputTokens = Math.ceil(responseText.length / 4);
      }
      totalTokens = promptTokens + outputTokens;
    }
  } catch (err) {
    console.warn('[aiUsageTracker] Failed to extract usage metadata:', err.message);
  }

  return {
    promptTokens: Math.max(0, promptTokens),
    outputTokens: Math.max(0, outputTokens),
    cachedTokens: Math.max(0, cachedTokens),
    reasoningTokens: Math.max(0, reasoningTokens),
    totalTokens: Math.max(0, totalTokens || promptTokens + outputTokens)
  };
}

/**
 * Atomically updates daily aggregation slices for fast dashboard querying
 */
async function updateDailyAggregationSlice(prisma, {
  date,
  collegeId,
  modelName,
  featureKey,
  isSuccess,
  promptTokens,
  outputTokens,
  cachedTokens,
  reasoningTokens,
  totalTokens,
  estimatedCostUsd,
  durationMs
}) {
  try {
    const costNum = Number(estimatedCostUsd) || 0;
    const existing = await prisma.aIDailyUsageAggregation.findFirst({
      where: {
        date,
        collegeId: collegeId || null,
        modelName,
        featureKey
      }
    });

    if (existing) {
      const newReqCount = existing.requestCount + 1;
      const oldDurationTotal = existing.avgDurationMs * existing.requestCount;
      const newAvgDuration = Math.round((oldDurationTotal + durationMs) / newReqCount);

      await prisma.aIDailyUsageAggregation.update({
        where: { id: existing.id },
        data: {
          requestCount: { increment: 1 },
          successCount: isSuccess ? { increment: 1 } : undefined,
          failedCount: !isSuccess ? { increment: 1 } : undefined,
          promptTokens: { increment: BigInt(promptTokens) },
          outputTokens: { increment: BigInt(outputTokens) },
          cachedTokens: { increment: BigInt(cachedTokens) },
          reasoningTokens: { increment: BigInt(reasoningTokens) },
          totalTokens: { increment: BigInt(totalTokens) },
          estimatedCostUsd: { increment: costNum },
          avgDurationMs: newAvgDuration
        }
      });
    } else {
      await prisma.aIDailyUsageAggregation.create({
        data: {
          date,
          collegeId: collegeId || null,
          modelName,
          featureKey,
          requestCount: 1,
          successCount: isSuccess ? 1 : 0,
          failedCount: isSuccess ? 0 : 1,
          promptTokens: BigInt(promptTokens),
          outputTokens: BigInt(outputTokens),
          cachedTokens: BigInt(cachedTokens),
          reasoningTokens: BigInt(reasoningTokens),
          totalTokens: BigInt(totalTokens),
          estimatedCostUsd: costNum,
          avgDurationMs: durationMs
        }
      });
    }
  } catch (err) {
    // Aggregation failure is non-critical and should never crash request
    console.warn(`[aiUsageTracker] Failed to update aggregation slice (${modelName}/${featureKey}):`, err.message);
  }
}

/**
 * Check if usage exceeds configured alert thresholds
 */
async function checkUsageAlerts(prisma, collegeId, date) {
  try {
    const alertConfig = await prisma.aIUsageAlertConfig.findFirst({
      where: {
        isEnabled: true,
        OR: [
          { collegeId: collegeId || null },
          { collegeId: null }
        ]
      }
    });

    if (!alertConfig) return;

    // Check cooldown (alert at most once every 2 hours)
    if (alertConfig.lastAlertSentAt) {
      const hoursSinceLast = (Date.now() - new Date(alertConfig.lastAlertSentAt).getTime()) / (1000 * 60 * 60);
      if (hoursSinceLast < 2) return;
    }

    // Query today's aggregate
    const todayAgg = await prisma.aIDailyUsageAggregation.findFirst({
      where: {
        date,
        collegeId: alertConfig.collegeId || null,
        modelName: 'all',
        featureKey: 'all'
      }
    });

    if (!todayAgg) return;

    let triggered = false;
    let alertReason = '';

    if (alertConfig.dailyCostLimitUsd && Number(todayAgg.estimatedCostUsd) >= Number(alertConfig.dailyCostLimitUsd)) {
      triggered = true;
      alertReason = `Daily cost threshold of $${alertConfig.dailyCostLimitUsd} reached (current: $${Number(todayAgg.estimatedCostUsd).toFixed(4)})`;
    } else if (alertConfig.dailyTokenLimit && todayAgg.totalTokens >= alertConfig.dailyTokenLimit) {
      triggered = true;
      alertReason = `Daily token limit of ${alertConfig.dailyTokenLimit.toString()} reached (current: ${todayAgg.totalTokens.toString()})`;
    }

    if (triggered) {
      console.warn(`[aiUsageTracker ALERT] 🚨 ${alertReason} for tenant [${collegeId || 'PLATFORM_GLOBAL'}]`);
      await prisma.aIUsageAlertConfig.update({
        where: { id: alertConfig.id },
        data: { lastAlertSentAt: new Date() }
      }).catch(() => {});
    }
  } catch (err) {
    console.warn('[aiUsageTracker] Alert check error:', err.message);
  }
}

/**
 * Main recording function.
 * NEVER throws an exception to caller. Logs errors safely and guarantees non-blocking execution.
 */
async function recordAIUsage({
  requestId,
  collegeId = null,
  userId = null,
  userRole = null,
  featureKey = 'ai-general',
  provider = 'gemini',
  modelName = 'gemini-2.0-flash',
  promptTokens = 0,
  outputTokens = 0,
  cachedTokens = 0,
  reasoningTokens = 0,
  totalTokens = 0,
  durationMs = 0,
  status = 'SUCCESS',
  statusCode = 200,
  errorMessage = null,
  createdAt = new Date()
} = {}) {
  try {
    const finalRequestId = requestId || crypto.randomUUID();
    const finalModelName = normalizeModelName(modelName);
    const dateStr = getUtcDateString(createdAt);

    const safePromptTokens = Math.max(0, Math.floor(Number(promptTokens) || 0));
    const safeOutputTokens = Math.max(0, Math.floor(Number(outputTokens) || 0));
    const safeCachedTokens = Math.max(0, Math.floor(Number(cachedTokens) || 0));
    const safeReasoningTokens = Math.max(0, Math.floor(Number(reasoningTokens) || 0));
    const safeTotalTokens = Math.max(
      0,
      Math.floor(Number(totalTokens) || safePromptTokens + safeOutputTokens)
    );

    // Calculate historical estimated cost in USD
    const estimatedCostUsd = await calculateEstimatedCostUsd({
      modelName: finalModelName,
      promptTokens: safePromptTokens,
      outputTokens: safeOutputTokens,
      cachedTokens: safeCachedTokens,
      reasoningTokens: safeReasoningTokens,
      atDate: createdAt
    });

    const isSuccess = status === 'SUCCESS';
    const prisma = getSystemClient();

    // 1. Write immutable granular request telemetry record
    const record = await prisma.aIRequestRecord.upsert({
      where: { requestId: finalRequestId },
      update: {
        promptTokens: safePromptTokens,
        outputTokens: safeOutputTokens,
        cachedTokens: safeCachedTokens,
        reasoningTokens: safeReasoningTokens,
        totalTokens: safeTotalTokens,
        estimatedCostUsd,
        durationMs: Math.max(0, Math.floor(Number(durationMs) || 0)),
        status,
        statusCode: statusCode || 200,
        errorMessage: errorMessage ? String(errorMessage).slice(0, 500) : null
      },
      create: {
        requestId: finalRequestId,
        collegeId: collegeId || null,
        userId: userId || null,
        userRole: userRole || null,
        featureKey: featureKey || 'ai-general',
        provider: provider || 'gemini',
        modelName: finalModelName,
        promptTokens: safePromptTokens,
        outputTokens: safeOutputTokens,
        cachedTokens: safeCachedTokens,
        reasoningTokens: safeReasoningTokens,
        totalTokens: safeTotalTokens,
        estimatedCostUsd,
        durationMs: Math.max(0, Math.floor(Number(durationMs) || 0)),
        status,
        statusCode: statusCode || 200,
        errorMessage: errorMessage ? String(errorMessage).slice(0, 500) : null,
        createdAt
      }
    });

    // 2. Increment Daily Aggregations in parallel:
    // a. Specific slice: (date, collegeId, modelName, featureKey)
    // b. Global slice: (date, null, 'all', 'all')
    const aggPayload = {
      date: dateStr,
      collegeId: collegeId || null,
      modelName: finalModelName,
      featureKey,
      isSuccess,
      promptTokens: safePromptTokens,
      outputTokens: safeOutputTokens,
      cachedTokens: safeCachedTokens,
      reasoningTokens: safeReasoningTokens,
      totalTokens: safeTotalTokens,
      estimatedCostUsd,
      durationMs: Math.max(0, Math.floor(Number(durationMs) || 0))
    };

    Promise.all([
      updateDailyAggregationSlice(prisma, aggPayload),
      updateDailyAggregationSlice(prisma, {
        ...aggPayload,
        collegeId: null,
        modelName: 'all',
        featureKey: 'all'
      }),
      checkUsageAlerts(prisma, collegeId, dateStr)
    ]).catch((aggErr) => {
      console.warn('[aiUsageTracker] Background aggregation warning:', aggErr.message);
    });

    return record;
  } catch (err) {
    console.error('[aiUsageTracker] Critical error recording AI usage (fail-safe caught):', err.message);
    return null;
  }
}

/**
 * Universal Wrapper for Direct Gemini SDK or microservice calls
 * Automatically records telemetry without interfering with application logic.
 */
async function trackGeminiCall(metadata, executeCallFn) {
  const startTime = Date.now();
  const requestId = metadata.requestId || crypto.randomUUID();
  let result = null;
  let error = null;

  try {
    result = await executeCallFn();
    return result;
  } catch (err) {
    error = err;
    throw err;
  } finally {
    const durationMs = Date.now() - startTime;
    const isError = !!error;

    // Determine status & status code
    let status = 'SUCCESS';
    let statusCode = 200;
    let errorMessage = null;

    if (isError) {
      status = 'FAILED';
      statusCode = error.status || error.statusCode || 500;
      errorMessage = error.message || 'Unknown Gemini error';

      if (statusCode === 429 || /RESOURCE_EXHAUSTED|rate limit|quota/i.test(errorMessage)) {
        status = 'RATE_LIMITED';
        statusCode = 429;
      }
    }

    const usage = isError
      ? { promptTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0, totalTokens: 0 }
      : extractUsageFromGeminiResponse(result, metadata.promptEstimate || '');

    // Record usage safely (guaranteed fail-safe)
    await recordAIUsage({
      requestId,
      collegeId: metadata.collegeId || null,
      userId: metadata.userId || null,
      userRole: metadata.userRole || null,
      featureKey: metadata.featureKey || 'ai-general',
      provider: metadata.provider || 'gemini',
      modelName: metadata.modelName || 'gemini-2.0-flash',
      promptTokens: usage.promptTokens,
      outputTokens: usage.outputTokens,
      cachedTokens: usage.cachedTokens,
      reasoningTokens: usage.reasoningTokens,
      totalTokens: usage.totalTokens,
      durationMs,
      status,
      statusCode,
      errorMessage
    }).catch(() => {});
  }
}

module.exports = {
  recordAIUsage,
  trackGeminiCall,
  extractUsageFromGeminiResponse,
  getUtcDateString
};
