/**
 * backend/services/aiLedgerService.js
 * AI Credit Debiting and Cost Instrumentation.
 * Handles dual-bucket deduction (PLAN allowance first, non-expiring PURCHASED credits second)
 * and active cost logging via TokenCostSample.
 */

const { getSystemClient } = require('../config/prismaManager');
const AI_CONFIG = require('../config/aiConfig');
const {
  getAICreditBalance,
  debitAICredits,
  InsufficientCreditsError,
} = require('./ledgerService');

class InsufficientAICreditsError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'InsufficientAICreditsError';
    this.code = 'INSUFFICIENT_AI_CREDITS';
    this.statusCode = 422;
    this.details = details;
  }
}

/**
 * Checks if a college has sufficient AI credits for an estimated token usage.
 */
async function assertAICreditsAvailable(collegeId, estimatedTokens = 100, modelTier = 'lite') {
  const multiplier = AI_CONFIG.tokenMultipliers[modelTier] || 1;
  const creditsRequired = estimatedTokens * multiplier;
  const balances = await getAICreditBalance(collegeId);

  if (balances.totalBalance < creditsRequired) {
    throw new InsufficientAICreditsError(
      `Insufficient AI credits. Required: ${creditsRequired} (${estimatedTokens} tokens x ${multiplier}), Available: ${balances.totalBalance}.`,
      {
        required: creditsRequired,
        available: balances.totalBalance,
        planBalance: balances.planBalance,
        purchasedBalance: balances.purchasedBalance,
      }
    );
  }
  return balances;
}

/**
 * Debits AI credits atomically and writes a TokenCostSample audit row.
 */
async function recordAndDebitUsage({
  collegeId,
  featureKey,
  modelTier = 'lite',
  promptTokens = 0,
  outputTokens = 0,
  latencyMs = 0,
}) {
  const prisma = getSystemClient();
  const totalTokens = (promptTokens || 0) + (outputTokens || 0);
  const multiplier = AI_CONFIG.tokenMultipliers[modelTier] || 1;
  const creditsDebited = totalTokens * multiplier;
  const modelName = AI_CONFIG.models[modelTier] || modelTier;

  let debitResult;
  try {
    debitResult = await debitAICredits(collegeId, totalTokens, modelTier, featureKey);
  } catch (err) {
    if (err instanceof InsufficientCreditsError || err.name === 'InsufficientCreditsError') {
      throw new InsufficientAICreditsError(err.message, err.details);
    }
    throw err;
  }

  // Record active cost instrumentation sample
  const sample = await prisma.tokenCostSample.create({
    data: {
      college_id: collegeId,
      featureKey,
      modelName,
      promptTokens: promptTokens || 0,
      outputTokens: outputTokens || 0,
      creditsDebited,
      latencyMs: latencyMs || 0,
    },
  });

  return {
    debited: creditsDebited,
    totalTokens,
    modelTier,
    modelName,
    balances: debitResult.balances,
    sampleId: sample.id,
  };
}

/**
 * Retrieves aggregate AI credit balance and recent token sample telemetry.
 */
async function getAISummary(collegeId) {
  const prisma = getSystemClient();
  const balances = await getAICreditBalance(collegeId);

  const recentSamples = await prisma.tokenCostSample.findMany({
    where: { college_id: collegeId },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  return {
    balances,
    recentSamples,
  };
}

module.exports = {
  InsufficientAICreditsError,
  assertAICreditsAvailable,
  recordAndDebitUsage,
  getAISummary,
};
