'use strict';

/**
 * apiKeyAuth.js — Phase 9E (#N06)
 * Authentication and Multi-Instance Rate Limiting Middleware for Public REST API.
 * - Authenticates via SHA-256 API key
 * - Rejects suspended institutions
 * - Allows read-only institutions to read
 * - DB-atomic quota and rate limit enforcement via ApiUsageWindow
 */

const { validateApiKey } = require('../services/apiKeyService');
const { recordAndCheckApiUsage } = require('../services/apiUsageService');
const { getSystemClient } = require('../config/prismaManager');

function getPrisma() {
  return getSystemClient();
}

async function apiKeyAuth(req, res, next) {
  try {
    // 1. Extract API Key
    let rawKey = null;
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      rawKey = authHeader.slice(7).trim();
    } else if (req.headers['x-api-key']) {
      rawKey = String(req.headers['x-api-key']).trim();
    }

    if (!rawKey) {
      return res.status(401).json({
        success: false,
        code: 'API_KEY_REQUIRED',
        message: 'API key is required via Bearer token or X-API-Key header.'
      });
    }

    // 2. Validate API Key
    const validation = await validateApiKey(rawKey);
    if (!validation) {
      return res.status(401).json({
        success: false,
        code: 'INVALID_API_KEY',
        message: 'Invalid API key provided.'
      });
    }

    if (!validation.valid && validation.reason === 'EXPIRED') {
      return res.status(401).json({
        success: false,
        code: 'API_KEY_EXPIRED',
        message: 'API key has expired.'
      });
    }

    const apiKey = validation.key;

    // 3. Check Institution status
    const prisma = getPrisma();
    const college = await prisma.college.findUnique({
      where: { id: apiKey.college_id }
    });

    if (!college) {
      return res.status(401).json({
        success: false,
        code: 'INSTITUTION_NOT_FOUND',
        message: 'Institution associated with this API key no longer exists.'
      });
    }

    if (college.subStatus === 'SUSPENDED') {
      return res.status(403).json({
        success: false,
        code: 'ACCOUNT_SUSPENDED',
        message: 'Institution subscription is currently suspended.'
      });
    }

    // 4. Rate Limiting & Quota check (DB-atomic)
    const usageCheck = await recordAndCheckApiUsage(college.id, apiKey.id);
    if (!usageCheck.allowed) {
      res.setHeader('Retry-After', String(usageCheck.retryAfterSeconds || 60));
      res.setHeader('X-RateLimit-Limit', String(usageCheck.limitMinute || 120));
      res.setHeader('X-RateLimit-Remaining', '0');

      return res.status(429).json({
        success: false,
        code: usageCheck.reason || 'TOO_MANY_REQUESTS',
        message: usageCheck.message,
        retryAfter: usageCheck.retryAfterSeconds
      });
    }

    // Attach API context to request
    req.apiKey = apiKey;
    req.collegeId = college.id;
    req.college = college;

    return next();
  } catch (err) {
    console.error('[apiKeyAuth] Error during API key authentication:', err);
    return res.status(500).json({
      success: false,
      code: 'INTERNAL_ERROR',
      message: 'Failed to authenticate API request.'
    });
  }
}

module.exports = apiKeyAuth;

