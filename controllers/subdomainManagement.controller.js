'use strict';

/**
 * Subdomain Management Controller
 *
 * POST /api/super-admin/colleges/:id/subdomain  — create/retry subdomain for one college
 * POST /api/super-admin/subdomains/sync-all      — create missing subdomains for ALL colleges
 * POST /api/super-admin/firebase/sync-domains    — sync ALL college slugs to Firebase authorized domains
 * GET  /api/super-admin/firebase/domains         — list current Firebase authorized domains
 */

const { getSystemClient } = require('../config/prismaManager');
const { ROOT_DOMAIN } = require('../config/env');
const {
  addAuthorizedDomain,
  syncAllDomains,
  getAuthorizedDomains,
} = require('../services/firebaseDomains.service');
const { checkAndVerifySubdomain } = require('../services/subdomainChecker.service');

// ── Shared Hostinger API caller ─────────────────────────────────────────────
async function callHostingerSubdomain(slug) {
  const username = process.env.HOSTINGER_USERNAME;
  const domain   = process.env.HOSTINGER_DOMAIN || ROOT_DOMAIN || 'collegeshub.org';
  const token    = process.env.HOSTINGER_API_TOKEN;

  if (!token || !username) {
    return { ok: false, status: 0, message: 'HOSTINGER_API_TOKEN or HOSTINGER_USERNAME not set in .env' };
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  const body = JSON.stringify({ subdomain: slug, is_using_public_directory: true });

  // Primary endpoint (correct Hostinger v1 path)
  const primaryUrl = `https://api.hostinger.com/v1/hosting/${username}/domains/${domain}/subdomains`;
  // Fallback endpoint
  const fallbackUrl = `https://api.hostinger.com/v1/hosting/websites/${domain}/domains/subdomains`;

  const tryUrl = async (url) => {
    const res  = await fetch(url, { method: 'POST', headers, body });
    const text = await res.text().catch(() => '');
    let data = {};
    try { data = JSON.parse(text); } catch {}
    // 409 = conflict, 422 = "Subdomain is already hosted" — both mean subdomain exists (treat as success)
    return { ok: res.ok || res.status === 409 || res.status === 422, status: res.status, message: data.message || text.slice(0, 200) };
  };

  try {
    const r1 = await tryUrl(primaryUrl);
    if (r1.ok) return { ...r1, url: primaryUrl };

    if ([404, 405, 422, 500, 530].includes(r1.status)) {
      const r2 = await tryUrl(fallbackUrl);
      if (r2.ok) return { ...r2, url: fallbackUrl };
      return { ok: false, status: r2.status, message: `Primary(${r1.status}): ${r1.message} | Fallback(${r2.status}): ${r2.message}` };
    }

    return r1;
  } catch (err) {
    return { ok: false, status: 0, message: `Network error: ${err.message}` };
  }
}

/**
 * POST /api/super-admin/colleges/:id/subdomain
 * Create (or retry) the Hostinger subdomain for a specific college.
 */
exports.createCollegeSubdomain = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const college = await prisma.college.findUnique({
      where: { id: req.params.id },
      select: { id: true, name: true, slug: true, status: true }
    });

    if (!college) {
      return res.status(404).json({ success: false, message: 'College not found.' });
    }
    if (!college.slug) {
      return res.status(400).json({ success: false, message: 'College has no slug — cannot create subdomain.' });
    }

    const result = await callHostingerSubdomain(college.slug);

    const domain = process.env.HOSTINGER_DOMAIN || ROOT_DOMAIN || 'collegeshub.org';
    const subdomainUrl = `https://${college.slug}.${domain}`;

    if (result.ok) {
      // Also authorize the domain in Firebase (non-blocking, best-effort)
      const fbResult = await addAuthorizedDomain(college.slug);
      return res.json({
        success: true,
        message: `Subdomain ${college.slug}.${domain} created successfully.`,
        subdomainUrl,
        hostingerStatus: result.status,
        apiMessage: result.message,
        firebase: fbResult.ok
          ? (fbResult.added ? `✅ Added to Firebase authorized domains` : `ℹ️ Already in Firebase authorized domains`)
          : `⚠️ Firebase domain not added automatically: ${fbResult.error}`
      });
    }

    return res.status(502).json({
      success: false,
      message: `Failed to create subdomain. Hostinger responded: ${result.message}`,
      hostingerStatus: result.status
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/super-admin/firebase/sync-domains
 * One-shot: read all college slugs from DB and ensure they're all in Firebase's
 * authorized domain list. Safe to run multiple times (idempotent).
 */
exports.syncFirebaseDomains = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const colleges = await prisma.college.findMany({
      where: { slug: { not: null }, isActive: true },
      select: { slug: true, name: true }
    });

    const slugs = colleges.map(c => c.slug).filter(Boolean);

    if (slugs.length === 0) {
      return res.json({ success: true, message: 'No active colleges with slugs found.', added: [], total: 0 });
    }

    const result = await syncAllDomains(slugs);

    if (!result.ok) {
      return res.status(502).json({
        success: false,
        message: `Firebase sync failed: ${result.error}`,
        hint: 'Make sure firebase-service-account.json is present in backend/config/ with Firebase Admin role.'
      });
    }

    return res.json({
      success: true,
      message: `Firebase sync complete. Added ${result.added.length} new domain(s), ${result.already.length} already existed.`,
      added: result.added,
      already: result.already,
      total: result.total
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/super-admin/firebase/domains
 * List all currently authorized domains in Firebase (read-only).
 */
exports.listFirebaseDomains = async (req, res, next) => {
  try {
    const domains = await getAuthorizedDomains();
    return res.json({ success: true, count: domains.length, domains });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/super-admin/colleges/:id/subdomain/status
 * Poll subdomain reachability. On first successful reach:
 *   - stamps subdomain_verified_at in DB
 *   - sends welcome email to the admin
 * Safe to call repeatedly — idempotent once verified.
 */
exports.checkSubdomainStatus = async (req, res, next) => {
  try {
    const result = await checkAndVerifySubdomain(req.params.id);

    if (result.error && !result.active) {
      return res.status(404).json({ success: false, message: result.error });
    }

    return res.json({
      success: true,
      active:       result.active,
      justVerified: result.justVerified,
      verifiedAt:   result.verifiedAt || null,
      slug:         result.slug || null,
      message: result.active
        ? (result.justVerified
            ? '🎉 Subdomain just went live! Welcome email sent to admin.'
            : '✅ Subdomain is active and verified.')
        : '⏳ Subdomain not reachable yet — still propagating.',
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/super-admin/subdomains/sync-all
 * Iterate all colleges with a slug and create any missing Hostinger subdomains.
 * Returns per-college results.
 */
exports.createAllMissingSubdomains = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const colleges = await prisma.college.findMany({
      where: { slug: { not: null }, isActive: true },
      select: { id: true, name: true, slug: true }
    });

    if (colleges.length === 0) {
      return res.json({ success: true, message: 'No colleges found.', results: [] });
    }

    const domain = process.env.HOSTINGER_DOMAIN || ROOT_DOMAIN || 'collegeshub.org';
    const results = [];

    for (const college of colleges) {
      if (!college.slug) continue;
      const result = await callHostingerSubdomain(college.slug);
      results.push({
        id: college.id,
        name: college.name,
        slug: college.slug,
        subdomain: `${college.slug}.${domain}`,
        success: result.ok,
        status: result.status,
        message: result.message
      });
      // Small delay between API calls to avoid rate limiting
      await new Promise(r => setTimeout(r, 400));
    }

    const succeeded = results.filter(r => r.success).length;
    const failed    = results.filter(r => !r.success).length;

    // Sync all successful slugs to Firebase authorized domains in one PATCH
    const successSlugs = results.filter(r => r.success).map(r => r.slug);
    const fbResult = successSlugs.length > 0 ? await syncAllDomains(successSlugs) : { ok: true, added: [], already: [] };

    return res.json({
      success: true,
      message: `Sync complete: ${succeeded} succeeded (or already existed), ${failed} failed.`,
      total: results.length,
      succeeded,
      failed,
      results,
      firebase: fbResult.ok
        ? { added: fbResult.added, already: fbResult.already, total: fbResult.total }
        : { error: fbResult.error }
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/super-admin/firebase/sync-domains
 * One-shot: read all college slugs from DB and ensure they're all in Firebase's
 * authorized domain list. Safe to run multiple times (idempotent).
 */
exports.syncFirebaseDomains = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const colleges = await prisma.college.findMany({
      where: { slug: { not: null }, isActive: true },
      select: { slug: true, name: true }
    });

    const slugs = colleges.map(c => c.slug).filter(Boolean);

    if (slugs.length === 0) {
      return res.json({ success: true, message: 'No active colleges with slugs found.', added: [], total: 0 });
    }

    const result = await syncAllDomains(slugs);

    if (!result.ok) {
      return res.status(502).json({
        success: false,
        message: `Firebase sync failed: ${result.error}`,
        hint: 'Make sure firebase-service-account.json is present in backend/config/ with Firebase Admin role.'
      });
    }

    return res.json({
      success: true,
      message: `Firebase sync complete. Added ${result.added.length} new domain(s), ${result.already.length} already existed.`,
      added: result.added,
      already: result.already,
      total: result.total
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/super-admin/firebase/domains
 * List all currently authorized domains in Firebase (read-only).
 */
exports.listFirebaseDomains = async (req, res, next) => {
  try {
    const domains = await getAuthorizedDomains();
    return res.json({ success: true, count: domains.length, domains });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/super-admin/colleges/:id/subdomain/status
 * Poll subdomain reachability. On first successful reach:
 *   - stamps subdomain_verified_at in DB
 *   - sends welcome email to the admin
 * Safe to call repeatedly — idempotent once verified.
 */
exports.checkSubdomainStatus = async (req, res, next) => {
  try {
    const result = await checkAndVerifySubdomain(req.params.id);

    if (result.error && !result.active) {
      return res.status(404).json({ success: false, message: result.error });
    }

    return res.json({
      success: true,
      active:       result.active,
      justVerified: result.justVerified,
      verifiedAt:   result.verifiedAt || null,
      slug:         result.slug || null,
      message: result.active
        ? (result.justVerified
            ? '🎉 Subdomain just went live! Welcome email sent to admin.'
            : '✅ Subdomain is active and verified.')
        : '⏳ Subdomain not reachable yet — still propagating.',
    });
  } catch (err) {
    next(err);
  }
};
