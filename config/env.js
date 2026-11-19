'use strict';

/**
 * System configuration and environment variables for Collegeshub multi-tenancy.
 */
const ROOT_DOMAIN = process.env.ROOT_DOMAIN || 'collegeshub.org';
const APP_URL = process.env.APP_URL || (process.env.NODE_ENV === 'production' ? `https://www.${ROOT_DOMAIN}` : 'http://localhost:3000');
const MAIL_FROM = process.env.MAIL_FROM || process.env.EMAIL_USER || `no-reply@${ROOT_DOMAIN}`;
const MAIL_API_KEY = process.env.MAIL_API_KEY || process.env.EMAIL_PASS || '';
const SUPER_ADMIN_ROUTING_CODE = process.env.SUPER_ADMIN_ROUTING_CODE || 'superadmin-secure-routing-2026';
const CRON_SECRET = process.env.CRON_SECRET || 'collegeshub-cron-internal-secret-token';

/**
 * Resolve a single canonical frontend base URL for outbound email links.
 * Never returns a comma-separated CORS list.
 */
function getFrontendBaseUrl() {
  const candidates = [
    process.env.FRONTEND_URL,
    process.env.APP_URL,
    process.env.NEXT_PUBLIC_APP_URL,
  ].filter(Boolean);

  for (const raw of candidates) {
    const clean = String(raw).split(',')[0].trim().replace(/\/+$/, '');
    if (/^https?:\/\/[^,\s]+$/i.test(clean)) {
      return clean;
    }
  }

  // If CLIENT_URL is configured (often a comma-separated CORS list), prefer www.<ROOT_DOMAIN> if present
  if (process.env.CLIENT_URL) {
    const parts = String(process.env.CLIENT_URL)
      .split(',')
      .map(s => s.trim().replace(/\/+$/, ''))
      .filter(s => /^https?:\/\/[^,\s]+$/i.test(s));
    const preferred =
      parts.find(u => u.toLowerCase().includes(`www.${ROOT_DOMAIN.toLowerCase()}`)) ||
      parts.find(u => u.toLowerCase().includes(ROOT_DOMAIN.toLowerCase())) ||
      parts[0];
    if (preferred) return preferred;
  }

  return process.env.NODE_ENV === 'production'
    ? `https://www.${ROOT_DOMAIN}`
    : 'http://localhost:3000';
}

module.exports = {
  ROOT_DOMAIN,
  APP_URL,
  MAIL_FROM,
  MAIL_API_KEY,
  SUPER_ADMIN_ROUTING_CODE,
  CRON_SECRET,
  getFrontendBaseUrl
};
