'use strict';

/**
 * Firebase Authorized Domains Service
 * ─────────────────────────────────────
 * Automatically adds / syncs college subdomains to Firebase's
 * "Authorized Domains" list so Google Sign-In works on every new
 * subdomain without manual Firebase Console visits.
 *
 * API used:
 *   GET  https://identitytoolkit.googleapis.com/admin/v2/projects/{project}/config
 *   PATCH https://identitytoolkit.googleapis.com/admin/v2/projects/{project}/config
 *         ?updateMask=authorizedDomains
 *
 * Auth: Bearer token obtained from the Firebase Admin SDK credential
 *       (requires firebase-service-account.json — see README).
 *
 * If the service account is not present, every function logs a warning
 * and returns gracefully — subdomain creation still works, just without
 * the automatic Firebase domain authorization.
 */

const admin = require('firebase-admin');

const PROJECT_ID  = process.env.FIREBASE_PROJECT_ID || 'collegeshub-eed17';
const ROOT_DOMAIN = process.env.HOSTINGER_DOMAIN || process.env.ROOT_DOMAIN || 'collegeshub.org';

// Domains that must always be present regardless of colleges
const PERMANENT_DOMAINS = [
  'localhost',
  ROOT_DOMAIN,
  `www.${ROOT_DOMAIN}`,
];

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Get an OAuth2 Bearer token from the Firebase Admin credential.
 * Only works when the app was initialized with a service account (cert).
 * Throws if running with only projectId (no service account file).
 */
async function _getAccessToken() {
  let app;
  try {
    app = admin.app();
  } catch {
    throw new Error('Firebase Admin app is not initialized.');
  }

  const credential = app.options && app.options.credential;
  if (!credential || typeof credential.getAccessToken !== 'function') {
    throw new Error(
      'Firebase Admin is running without a service account. ' +
      'Place firebase-service-account.json at backend/config/ to enable automatic domain authorization.'
    );
  }

  const tokenResult = await credential.getAccessToken();
  return tokenResult.access_token;
}

/**
 * Fetch the current authorized domains list from Firebase.
 * Returns [] on any error.
 */
async function getAuthorizedDomains() {
  try {
    const token = await _getAccessToken();
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT_ID}/config`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Firebase config GET failed ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = await res.json();
    return Array.isArray(data.authorizedDomains) ? data.authorizedDomains : [];
  } catch (err) {
    console.warn('[Firebase Domains] Could not fetch authorized domains:', err.message);
    return [];
  }
}

/**
 * PATCH the full authorized domains list.
 * Firebase replaces the entire list on PATCH — so always include all existing domains.
 */
async function _patchDomains(domains) {
  const token = await _getAccessToken();
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT_ID}/config?updateMask=authorizedDomains`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ authorizedDomains: domains }),
    }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Firebase config PATCH failed ${res.status}: ${text.slice(0, 200)}`);
  }
  return await res.json();
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Add a single college subdomain to Firebase's authorized domains.
 * Called automatically when a college is approved / provisioned.
 *
 * @param {string} slug  e.g. "syed" → adds "syed.collegeshub.org"
 * @returns {Promise<{ok, added, domain, error?}>}
 */
async function addAuthorizedDomain(slug) {
  const fullDomain = `${slug}.${ROOT_DOMAIN}`;
  try {
    const current = await getAuthorizedDomains();

    if (current.includes(fullDomain)) {
      console.log(`[Firebase Domains] Already authorized: ${fullDomain}`);
      return { ok: true, added: false, domain: fullDomain };
    }

    const updated = [...new Set([...PERMANENT_DOMAINS, ...current, fullDomain])];
    await _patchDomains(updated);
    console.log(`[Firebase Domains] ✅ Added: ${fullDomain} (total: ${updated.length})`);
    return { ok: true, added: true, domain: fullDomain };
  } catch (err) {
    // Non-fatal — log and continue; subdomain still works once manually added
    console.error(`[Firebase Domains] ❌ Failed to add ${fullDomain}:`, err.message);
    return { ok: false, added: false, domain: fullDomain, error: err.message };
  }
}

/**
 * Remove a college subdomain from Firebase's authorized domains.
 * Called when a college is deleted / suspended.
 *
 * @param {string} slug  e.g. "syed"
 */
async function removeAuthorizedDomain(slug) {
  const fullDomain = `${slug}.${ROOT_DOMAIN}`;
  try {
    const current = await getAuthorizedDomains();
    if (!current.includes(fullDomain)) {
      return { ok: true, removed: false, domain: fullDomain };
    }
    const updated = current.filter(d => d !== fullDomain);
    await _patchDomains(updated);
    console.log(`[Firebase Domains] ✅ Removed: ${fullDomain}`);
    return { ok: true, removed: true, domain: fullDomain };
  } catch (err) {
    console.error(`[Firebase Domains] ❌ Failed to remove ${fullDomain}:`, err.message);
    return { ok: false, removed: false, domain: fullDomain, error: err.message };
  }
}

/**
 * Sync ALL college slugs to Firebase at once.
 * Reads current list, adds any missing slugs, and PATCHes once.
 *
 * @param {string[]} slugs  Array of college slugs to ensure are authorized
 * @returns {Promise<{ok, added: string[], already: string[], total: number, error?}>}
 */
async function syncAllDomains(slugs) {
  try {
    const current    = await getAuthorizedDomains();
    const desired    = slugs.map(s => `${s}.${ROOT_DOMAIN}`);
    const newDomains = desired.filter(d => !current.includes(d));
    const already    = desired.filter(d =>  current.includes(d));

    if (newDomains.length === 0) {
      console.log(`[Firebase Domains] All ${desired.length} domains already authorized.`);
      return { ok: true, added: [], already, total: current.length };
    }

    const updated = [...new Set([...PERMANENT_DOMAINS, ...current, ...newDomains])];
    await _patchDomains(updated);
    console.log(`[Firebase Domains] ✅ Synced — added ${newDomains.length}, total ${updated.length}`);
    return { ok: true, added: newDomains, already, total: updated.length };
  } catch (err) {
    console.error('[Firebase Domains] ❌ Sync failed:', err.message);
    return { ok: false, added: [], already: [], total: 0, error: err.message };
  }
}

module.exports = { addAuthorizedDomain, removeAuthorizedDomain, syncAllDomains, getAuthorizedDomains };

