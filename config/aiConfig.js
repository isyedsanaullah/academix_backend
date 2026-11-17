/**
 * backend/config/aiConfig.js
 * Centralized AI Model Registry, Token Multipliers, and Quota Configurations.
 * Follows strict zero-tenant-credential rule: LLM inference calls execute via
 * Super Admin master platform keys (GEMINI_API_KEY).
 *
 * Dual-mode:
 * - THREE_PLAN_MODE=false: legacy { lite: 1, advanced: 20 }, tutor 10/30
 * - THREE_PLAN_MODE=true:  { lite: 1, standard: 20, advanced: 40 }, tutor 20 (Premium)
 */

const { isThreePlanMode } = require('./featureFlags');
const { getPlanLimits } = require('./planConstants');

const LEGACY_MULTIPLIERS = {
  lite: 1,       // 1 Credit per Token
  advanced: 20,  // 20 Credits per Token (Legacy Stage 13)
};

const THREE_PLAN_MULTIPLIERS = {
  lite: 1,       // 1 Credit per Token (Flash / Haiku class)
  standard: 20,  // 20 Credits per Token (Pro / Sonnet class)
  advanced: 40,  // 40 Credits per Token (Opus / Reasoning class)
};

const AI_CONFIG = {
  // Model Identifiers
  models: {
    lite: process.env.AI_LITE_MODEL || 'gemini-1.5-flash',
    standard: process.env.AI_STANDARD_MODEL || 'gemini-1.5-pro',
    advanced: process.env.AI_ADVANCED_MODEL || 'gemini-2.5-pro',
    embedding: process.env.AI_EMBEDDING_MODEL || 'text-embedding-004',
  },

  // Token Credit Multipliers (1 token = X credits)
  get tokenMultipliers() {
    return isThreePlanMode() ? THREE_PLAN_MULTIPLIERS : LEGACY_MULTIPLIERS;
  },

  getMultiplier(modelTier = 'lite') {
    const table = isThreePlanMode() ? THREE_PLAN_MULTIPLIERS : LEGACY_MULTIPLIERS;
    const key = String(modelTier || 'lite').toLowerCase();
    return table[key] ?? table.lite ?? 1;
  },

  // Daily message limits per student for AI Tutor Chat (#99)
  get tutorDailyLimits() {
    if (!isThreePlanMode()) {
      return {
        starter: 0,
        standard: 0,
        premium: 10,
        enterprise: 30,
      };
    }
    return {
      starter: getPlanLimits('starter', true).tutorDailyPerStudent ?? 0,
      standard: getPlanLimits('standard', true).tutorDailyPerStudent ?? 0,
      premium: getPlanLimits('premium', true).tutorDailyPerStudent ?? 20,
    };
  },

  // Monthly query limits for Ask-Your-Data (N46)
  get askDataMonthlyLimits() {
    if (!isThreePlanMode()) {
      return {
        starter: 0,
        standard: 0,
        premium: 50,
        enterprise: Infinity,
      };
    }
    return {
      starter: getPlanLimits('starter', true).askYourDataMonthly ?? 0,
      standard: getPlanLimits('standard', true).askYourDataMonthly ?? 0,
      premium: (getPlanLimits('premium', true).askYourDataMonthly ?? -1) < 0 ? Infinity : getPlanLimits('premium', true).askYourDataMonthly,
    };
  },

  // Monthly OCR document limits (#107)
  get ocrMonthlyLimits() {
    if (!isThreePlanMode()) {
      return {
        starter: 0,
        standard: 0,
        premium: 150,
        enterprise: Infinity,
      };
    }
    return {
      starter: getPlanLimits('starter', true).documentOcrMonthly ?? 0,
      standard: getPlanLimits('standard', true).documentOcrMonthly ?? 0,
      premium: (getPlanLimits('premium', true).documentOcrMonthly ?? -1) < 0 ? Infinity : getPlanLimits('premium', true).documentOcrMonthly,
    };
  },

  // Platform API Master Key
  apiKey: process.env.GEMINI_API_KEY || null,
};

module.exports = AI_CONFIG;
