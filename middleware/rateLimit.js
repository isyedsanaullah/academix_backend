'use strict';

const rateLimit = require('express-rate-limit');

/**
 * Factory for creating custom rate limiters per IP, per custom key (e.g., email or slug),
 * or combined.
 *
 * @param {object} options
 * @param {number} [options.windowMs=60000] - Time window in milliseconds (default: 1 min)
 * @param {number} [options.max=60] - Maximum requests per window
 * @param {string} [options.message='Too many requests, please try again later.'] - Error message
 * @param {function(req): string} [options.keyGenerator] - Custom key extraction function
 * @param {boolean} [options.skipSuccessfulRequests=false]
 * @returns {import('express').RequestHandler}
 */
function createRateLimiter({
  windowMs = 60 * 1000,
  max = 60,
  message = 'Too many requests, please try again later.',
  keyGenerator = null,
  skipSuccessfulRequests = false
} = {}) {
  const limiterConfig = {
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    statusCode: 429,
    message: {
      success: false,
      error: message
    },
    skipSuccessfulRequests
  };

  if (typeof keyGenerator === 'function') {
    limiterConfig.keyGenerator = (req) => {
      // Combine client IP with custom key to prevent cross-network key exhaustion
      const clientIp = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
      const customKey = keyGenerator(req);
      return `${clientIp}:${customKey || 'global'}`;
    };
  }

  return rateLimit(limiterConfig);
}

// Pre-configured rate limiters for common sensitive workflows
const sensitiveActionLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 mins
  max: 10,
  message: 'Too many attempts on this sensitive operation. Please try again in 15 minutes.'
});

const resolveCodeLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 min
  max: 10, // strict 10/min/IP for tenant/code resolution
  message: 'Too many code resolution attempts. Please wait a minute and try again.'
});

const authLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: 'Too many login attempts. Please try again in 15 minutes.'
});

module.exports = {
  createRateLimiter,
  sensitiveActionLimiter,
  resolveCodeLimiter,
  authLimiter
};
