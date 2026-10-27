'use strict';

/**
 * Phase 8 — Security Headers & Log Scrubbing
 * ────────────────────────────────────────────
 * globalSecurityHeaders  → applied globally in server.js to every response
 * noReferrer             → applied to sensitive token pages (/setup, /set-password)
 * scrubSensitiveData     → strips tokens/codes/passwords/emails from log strings
 */

/**
 * Apply hardened security headers to every response.
 * HSTS: 1 year, include subdomains (use only when HTTPS is confirmed).
 */
function globalSecurityHeaders(req, res, next) {
  // Prevent MIME-type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Prevent framing / clickjacking
  res.setHeader('X-Frame-Options', 'DENY');
  // Legacy XSS filter (belt-and-suspenders for old browsers)
  res.setHeader('X-XSS-Protection', '1; mode=block');
  // CSP: only allow same-origin frames and scripts from self
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; frame-ancestors 'none';"
  );
  // HSTS — only set in production to avoid breaking local dev HTTP
  if (process.env.NODE_ENV === 'production') {
    res.setHeader(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains; preload'
    );
  }
  // Prevent browsers from caching API responses by default
  // (individual routes may override with explicit Cache-Control headers)
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  next();
}

/**
 * Applied on top of globalSecurityHeaders for token/setup pages.
 * Forces no-referrer so the raw token URL is never sent as a Referer header.
 */
function noReferrer(req, res, next) {
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
}

/**
 * Scrub sensitive data patterns from a string before it is logged.
 * Replaces:
 *   - JWT tokens (Bearer ...)
 *   - raw hex tokens (32+ hex chars)
 *   - 6-digit numeric codes (email verification codes)
 *   - password-like fields in JSON payloads
 *   - email addresses
 *
 * @param {string} str - The string to sanitise
 * @returns {string} - Sanitised string safe for logs
 */
function scrubSensitiveData(str) {
  if (typeof str !== 'string') return str;
  return str
    // Bearer JWT tokens
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]')
    // Long hex tokens (32+ chars, typical of SHA-256 derived tokens)
    .replace(/\b[a-f0-9]{32,}\b/gi, '[TOKEN_REDACTED]')
    // 6-digit verification codes in JSON ("code":"123456")
    .replace(/("code"\s*:\s*")\d{6}(")/, '$1[CODE_REDACTED]$2')
    // Password fields in JSON payloads
    .replace(/("(?:password|confirmPassword|newPassword|currentPassword)"\s*:\s*")[^"]*(")/, '$1[REDACTED]$2')
    // Email addresses (partial redaction: keep domain for debugging)
    .replace(/([a-zA-Z0-9._%+-]+)(@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g, '[EMAIL]$2');
}

module.exports = {
  globalSecurityHeaders,
  noReferrer,
  scrubSensitiveData
};
