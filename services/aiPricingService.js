'use strict';

const { getSystemClient } = require('../config/prismaManager');

// Memory cache for active pricing tiers
let pricingCache = null;
let cacheExpiresAt = 0;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Normalizes model names (removes 'models/' prefix, trims, lowercases)
 */
function normalizeModelName(name) {
  if (!name || typeof name !== 'string') return 'gemini-2.0-flash';
  return name.replace(/^models\//, '').trim().toLowerCase();
}

/**
 * Refreshes pricing cache from Neon database
 */
async function loadPricingFromDb() {
  try {
    const prisma = getSystemClient();
    const rows = await prisma.aIModelPricing.findMany({
      where: { isActive: true },
      orderBy: [{ modelName: 'asc' }, { version: 'desc' }]
    });

    pricingCache = rows.map((r) => ({
      id: r.id,
      modelName: normalizeModelName(r.modelName),
      originalModelName: r.modelName,
      provider: r.provider,
      version: r.version,
      inputPricePerMillionUsd: Number(r.inputPricePerMillionUsd),
      outputPricePerMillionUsd: Number(r.outputPricePerMillionUsd),
      cachedInputPricePerMillionUsd: Number(r.cachedInputPricePerMillionUsd || 0),
      reasoningPricePerMillionUsd: Number(r.reasoningPricePerMillionUsd || 0),
      effectiveFrom: new Date(r.effectiveFrom),
      effectiveTo: r.effectiveTo ? new Date(r.effectiveTo) : null,
      isActive: r.isActive,
      notes: r.notes
    }));

    cacheExpiresAt = Date.now() + CACHE_TTL_MS;
    return pricingCache;
  } catch (err) {
    console.error('[aiPricingService] Failed to load pricing from DB:', err.message);
    if (!pricingCache) {
      // Safe hardcoded fallback if DB is unreachable on initial cold start
      pricingCache = [
        {
          modelName: 'gemini-2.0-flash',
          originalModelName: 'gemini-2.0-flash',
          provider: 'gemini',
          version: 1,
          inputPricePerMillionUsd: 0.10,
          outputPricePerMillionUsd: 0.40,
          cachedInputPricePerMillionUsd: 0.025,
          reasoningPricePerMillionUsd: 0.40,
          effectiveFrom: new Date('2024-01-01'),
          effectiveTo: null,
          isActive: true
        }
      ];
    }
    return pricingCache;
  }
}

/**
 * Invalidates cache (called when Super Admin updates pricing)
 */
function invalidatePricingCache() {
  pricingCache = null;
  cacheExpiresAt = 0;
}

/**
 * Resolves pricing tier for a model and timestamp
 */
async function getPricingForModel(modelName, atDate = new Date()) {
  const targetDate = atDate instanceof Date ? atDate : new Date(atDate);
  const now = Date.now();

  if (!pricingCache || now > cacheExpiresAt) {
    await loadPricingFromDb();
  }

  const normalized = normalizeModelName(modelName);

  // 1. Try exact model match within effective date window
  const matches = pricingCache.filter((p) => p.modelName === normalized);

  const activeWindowMatch = matches.find((p) => {
    const afterStart = p.effectiveFrom <= targetDate;
    const beforeEnd = !p.effectiveTo || p.effectiveTo >= targetDate;
    return afterStart && beforeEnd;
  });

  if (activeWindowMatch) return activeWindowMatch;

  // 2. If no date match, take latest version of this model
  if (matches.length > 0) return matches[0];

  // 3. Prefix matching (e.g. gemini-2.0-flash-exp -> gemini-2.0-flash)
  const prefixMatch = pricingCache.find((p) => normalized.startsWith(p.modelName));
  if (prefixMatch) return prefixMatch;

  // 4. Fallback to gemini-2.0-flash or first entry
  const defaultFallback = pricingCache.find((p) => p.modelName === 'gemini-2.0-flash') || pricingCache[0];
  return defaultFallback;
}

/**
 * Computes estimated cost in USD based on model pricing and token counts.
 * Cost formula: (prompt * InPrice + output * OutPrice + cached * CachedPrice + reasoning * ReasonPrice) / 1,000,000
 */
async function calculateEstimatedCostUsd({
  modelName,
  promptTokens = 0,
  outputTokens = 0,
  cachedTokens = 0,
  reasoningTokens = 0,
  atDate = new Date()
}) {
  const tier = await getPricingForModel(modelName, atDate);
  if (!tier) return 0;

  const prompt = Math.max(0, Number(promptTokens) || 0);
  const output = Math.max(0, Number(outputTokens) || 0);
  const cached = Math.max(0, Number(cachedTokens) || 0);
  const reasoning = Math.max(0, Number(reasoningTokens) || 0);

  // Cached tokens are discounted from prompt tokens if reported separately,
  // or charged at cached rate if explicit
  const uncachedPrompt = Math.max(0, prompt - cached);

  const cost =
    (uncachedPrompt * tier.inputPricePerMillionUsd +
      cached * tier.cachedInputPricePerMillionUsd +
      output * tier.outputPricePerMillionUsd +
      reasoning * tier.reasoningPricePerMillionUsd) /
    1000000;

  // Round to 6 decimal places to prevent float precision drift
  return Math.round(cost * 1000000) / 1000000;
}

/**
 * Returns all pricing records directly for Super Admin management
 */
async function getAllPricingRecords() {
  const prisma = getSystemClient();
  return prisma.aIModelPricing.findMany({
    orderBy: [{ modelName: 'asc' }, { version: 'desc' }]
  });
}

module.exports = {
  normalizeModelName,
  getPricingForModel,
  calculateEstimatedCostUsd,
  invalidatePricingCache,
  getAllPricingRecords
};

