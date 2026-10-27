'use strict';

/**
 * Reserved slugs list for Collegeshub multi-tenancy.
 * Subdomains matching these names are reserved for system services or infrastructure.
 */
const RESERVED_SLUGS = Object.freeze([
  'www',
  'app',
  'api',
  'admin',
  'mail',
  'status',
  'support',
  'help',
  'docs',
  'blog',
  'cdn',
  'static',
  'assets',
  'dev',
  'test',
  'staging',
  'root',
  'collegeshub',
  'college',
  'login',
  'register',
  'dashboard',
  'super-admin',
  'superadmin',
  'ns1',
  'ns2',
  'ftp',
  'smtp',
  'imap',
  'pop',
  'billing',
  'account'
]);

const RESERVED_SLUGS_SET = new Set(RESERVED_SLUGS);

/**
 * Slug rule:
 * - Lowercase alphanumeric characters and hyphens
 * - Cannot start or end with a hyphen
 * - Total length between 3 and 30 characters
 * Regex: ^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$
 */
const SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/;

/**
 * Check if a slug is reserved.
 * @param {string} slug
 * @returns {boolean}
 */
function isReservedSlug(slug) {
  if (!slug || typeof slug !== 'string') return false;
  return RESERVED_SLUGS_SET.has(slug.trim().toLowerCase());
}

/**
 * Validate a slug against format rules and the reserved list.
 * @param {string} slug
 * @returns {boolean}
 */
function isValidSlug(slug) {
  if (!slug || typeof slug !== 'string') return false;
  const s = slug.trim().toLowerCase();
  if (s.length < 3 || s.length > 30) return false;
  if (!SLUG_REGEX.test(s)) return false;
  if (isReservedSlug(s)) return false;
  return true;
}

/**
 * Normalize an input string into a valid slug format (does not resolve collision).
 * @param {string} input
 * @returns {string}
 */
function normalizeSlug(input) {
  if (!input || typeof input !== 'string') return '';
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
}

module.exports = {
  RESERVED_SLUGS,
  isValidSlug,
  isReservedSlug,
  normalizeSlug,
  SLUG_REGEX
};
