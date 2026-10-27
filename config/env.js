'use strict';

/**
 * System configuration and environment variables for Collegeshub multi-tenancy.
 */
const ROOT_DOMAIN = process.env.ROOT_DOMAIN || 'collegeshub.org';
const APP_URL = process.env.APP_URL || (process.env.NODE_ENV === 'production' ? `https://${ROOT_DOMAIN}` : 'http://localhost:3000');
const MAIL_FROM = process.env.MAIL_FROM || process.env.EMAIL_USER || `no-reply@${ROOT_DOMAIN}`;
const MAIL_API_KEY = process.env.MAIL_API_KEY || process.env.EMAIL_PASS || '';
const SUPER_ADMIN_ROUTING_CODE = process.env.SUPER_ADMIN_ROUTING_CODE || 'superadmin-secure-routing-2026';
const CRON_SECRET = process.env.CRON_SECRET || 'collegeshub-cron-internal-secret-token';

module.exports = {
  ROOT_DOMAIN,
  APP_URL,
  MAIL_FROM,
  MAIL_API_KEY,
  SUPER_ADMIN_ROUTING_CODE,
  CRON_SECRET
};
