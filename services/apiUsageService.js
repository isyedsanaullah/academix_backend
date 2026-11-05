'use strict';

/**
 * apiUsageService.js — Phase 9E (#N06)
 * Multi-Instance Safe Database-Atomic Rate Limiting for Public REST API.
 * Uses atomic upserts into ApiUsageWindow without requiring Redis.
 * Supports:
 * - Monthly institutional API quota (calendar month, OD-13)
 * - Per-minute burst protection window (e.g. 120 calls/min)
 */

const { getSystemClient } = require('../config/prismaManager');
const { getEntitlements } = require('./entitlements');

function getPrisma() {
  return getSystemClient();
}

/**
 * Format window keys:
 * Monthly: 'M:2026-11'
 * Minute: 'm:2026-11-06T03:15'
 */
function getWindowKeys(date = new Date()) {
  const iso = date.toISOString();
  const monthlyKey = `M:${iso.slice(0, 7)}`;
  const minuteKey = `m:${iso.slice(0, 16)}`;
  return { monthlyKey, minuteKey };
}

/**
 * Atomically increment and check usage for both monthly and per-minute windows
 * @param {string} collegeId
 * @param {string} apiKeyId
 * @param {number} [perMinuteLimit=120]
 * @returns {Promise<{ allowed: boolean, monthlyCount: number, minuteCount: number, limitMonthly: number, retryAfterSeconds: number }>}
 */
async function recordAndCheckApiUsage(collegeId, apiKeyId, perMinuteLimit = 120) {
  const prisma = getPrisma();
  const entitlements = await getEntitlements(collegeId, prisma);

  const limitMonthly = entitlements.effectiveLimits?.apiCallsMonthly ?? 0;
  const { monthlyKey, minuteKey } = getWindowKeys();

  // 1. Check if monthly limit is explicitly 0 (not entitled / plan excluded)
  if (limitMonthly === 0) {
    return {
      allowed: false,
      reason: 'FEATURE_NOT_IN_PLAN',
      message: 'Public REST API calls are not included in your current subscription tier.',
      limitMonthly: 0,
      monthlyCount: 0,
      minuteCount: 0,
      retryAfterSeconds: 86400
    };
  }

  // 2. Atomic Upsert for Minute Window
  const minuteRows = await prisma.$queryRawUnsafe(`
    INSERT INTO "ApiUsageWindow" ("college_id", "apiKeyId", "windowKey", "count")
    VALUES ($1, $2, $3, 1)
    ON CONFLICT ("college_id", "apiKeyId", "windowKey")
    DO UPDATE SET "count" = "ApiUsageWindow"."count" + 1
    RETURNING "count";
  `, collegeId, apiKeyId, minuteKey);

  const minuteCount = minuteRows[0]?.count ? Number(minuteRows[0].count) : 1;

  if (perMinuteLimit > 0 && minuteCount > perMinuteLimit) {
    return {
      allowed: false,
      reason: 'RATE_LIMIT_EXCEEDED',
      window: 'minute',
      message: `Rate limit of ${perMinuteLimit} requests per minute exceeded.`,
      limitMinute: perMinuteLimit,
      minuteCount,
      limitMonthly,
      retryAfterSeconds: 60
    };
  }

  // 3. Atomic Upsert for Monthly Window
  const monthlyRows = await prisma.$queryRawUnsafe(`
    INSERT INTO "ApiUsageWindow" ("college_id", "apiKeyId", "windowKey", "count")
    VALUES ($1, $2, $3, 1)
    ON CONFLICT ("college_id", "apiKeyId", "windowKey")
    DO UPDATE SET "count" = "ApiUsageWindow"."count" + 1
    RETURNING "count";
  `, collegeId, apiKeyId, monthlyKey);

  const monthlyCount = monthlyRows[0]?.count ? Number(monthlyRows[0].count) : 1;

  if (limitMonthly !== -1 && monthlyCount > limitMonthly) {
    return {
      allowed: false,
      reason: 'MONTHLY_QUOTA_EXCEEDED',
      window: 'monthly',
      message: `Monthly quota of ${limitMonthly} API requests reached for this billing period.`,
      limitMonthly,
      monthlyCount,
      minuteCount,
      retryAfterSeconds: 3600
    };
  }

  return {
    allowed: true,
    monthlyCount,
    minuteCount,
    limitMonthly,
    limitMinute: perMinuteLimit,
    retryAfterSeconds: 0
  };
}

module.exports = {
  getWindowKeys,
  recordAndCheckApiUsage
};

