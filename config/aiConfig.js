/**
 * backend/config/aiConfig.js
 * Centralized AI Model Registry, Token Multipliers, and Quota Configurations.
 * Follows strict zero-tenant-credential rule: LLM inference calls execute via
 * Super Admin master platform keys (GEMINI_API_KEY).
 */

const AI_CONFIG = {
  // Model Identifiers
  models: {
    lite: process.env.AI_LITE_MODEL || 'gemini-1.5-flash',
    advanced: process.env.AI_ADVANCED_MODEL || 'gemini-1.5-pro',
    embedding: process.env.AI_EMBEDDING_MODEL || 'text-embedding-004',
  },

  // Token Credit Multipliers (1 token = X credits)
  tokenMultipliers: {
    lite: 1,       // 1 Credit per Token
    advanced: 20,  // 20 Credits per Token
  },

  // Daily message limits per student for AI Tutor Chat (#99)
  tutorDailyLimits: {
    starter: 0,
    standard: 0,
    premium: 10,
    enterprise: 30,
  },

  // Monthly query limits for Ask-Your-Data (N46)
  askDataMonthlyLimits: {
    starter: 0,
    standard: 0,
    premium: 50,
    enterprise: Infinity,
  },

  // Monthly OCR document limits (#107)
  ocrMonthlyLimits: {
    starter: 0,
    standard: 0,
    premium: 150,
    enterprise: Infinity,
  },

  // Platform API Master Key
  apiKey: process.env.GEMINI_API_KEY || null,
};

module.exports = AI_CONFIG;

