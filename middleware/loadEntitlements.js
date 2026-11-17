'use strict';

// middleware/loadEntitlements.js
// Unified through services/entitlements.js while preserving legacy response shape
// ({ success:false, message, disabled:true }) and req.entitlements structure.
const { getSystemClient } = require('../config/prismaManager');
const { isThreePlanMode } = require('../config/featureFlags');
const {
  getEntitlements: resolveFullEntitlements,
  resolveFeatureState,
  STATE_MESSAGES
} = require('../services/entitlements');

const TTL_MS = 60_000;
const cache = new Map(); // collegeId -> { at, resolved }
let flagsCache = { at: 0, flags: null };

async function getFeatureFlags() {
  if (flagsCache.flags && Date.now() - flagsCache.at < TTL_MS) return flagsCache.flags;
  const db = getSystemClient();
  try {
    const rows = await db.featureFlag.findMany();
    const map = new Map();
    for (const r of rows) map.set(r.key, r);
    flagsCache = { at: Date.now(), flags: map };
    return map;
  } catch (err) {
    console.error('Error loading FeatureFlag rows:', err.message);
    return flagsCache.flags || new Map();
  }
}

const clearEntitlementCache = (id) => {
  if (id) {
    cache.delete(id);
  } else {
    cache.clear();
    flagsCache = { at: 0, flags: null };
  }
};

function toMiddlewareShape(ent) {
  if (!ent) return { active: false, reason: 'COLLEGE_NOT_FOUND' };
  return {
    ...ent,
    // Middleware consumers (`featureGate`, `/api/me/capabilities`) expect `features[key] -> { on, ... }`
    features: ent.featureStates || {},
    effectiveFeatures: ent.effectiveFeatures || ent.features || []
  };
}

async function getEntitlements(collegeId) {
  const hit = cache.get(collegeId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.resolved;

  try {
    const flags = await getFeatureFlags();
    const ent = await resolveFullEntitlements(collegeId, null, { flags });
    const shaped = toMiddlewareShape(ent);
    cache.set(collegeId, { at: Date.now(), resolved: shaped });
    return shaped;
  } catch (err) {
    if (err.message && err.message.includes('not found')) {
      return { active: false, reason: 'COLLEGE_NOT_FOUND' };
    }
    throw err;
  }
}

const MESSAGES = {
  ...STATE_MESSAGES,
  RELEASE_STAGE: 'This feature is not yet available in your release tier.'
};

/** Attach entitlements to the request without gating (for /api/me/capabilities). */
const loadEntitlements = async (req, res, next) => {
  try {
    const collegeId = req.collegeId || req.user?.college_id;
    if (!collegeId) return res.status(403).json({ success: false, message: 'No college associated with this account' });
    req.entitlements = await getEntitlements(collegeId);
    next();
  } catch (e) { next(e); }
};

const deny = (res, status, body) => res.status(status).json({ success: false, ...body });

/** featureGate('attendance') or featureGate(['gate-scanner','gate-manual-log']) = any one of them */
const featureGate = (keyOrKeys) => async (req, res, next) => {
  try {
    if (req.user?.role === 'superAdmin') return next();
    const collegeId = req.collegeId || req.user?.college_id;
    if (!collegeId) return deny(res, 403, { message: 'No college associated with this account' });
    const ent = req.entitlements || (req.entitlements = await getEntitlements(collegeId));
    if (!ent.active) {
      return deny(res, 403, {
        message: 'College account or subscription is not active',
        code: ent.reason,
        disabled: true
      });
    }

    const keys = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];
    const states = keys.map(k => resolveFeatureState({ ...ent, featureStates: ent.features }, k));
    const activeStates = states.filter(s => s?.on);

    if (activeStates.length === 0) {
      const s = states[0];
      return deny(res, 403, {
        message: MESSAGES[s?.reason] || 'This feature is disabled for your institution.',
        code: 'FEATURE_UNAVAILABLE',
        feature: keys.join(','),
        reason: s?.reason || 'UNKNOWN',
        blockedBy: s?.blockedBy || undefined,
        upgrade: s?.reason === 'NOT_IN_PLAN',
        disabled: true,
        currentPlan: ent.planId
      });
    }

    // T1.3: Block unbuilt services (`hasWorkingImplementation === false`) when strict coming-soon locking is active;
    // otherwise log for 48-hour soak audit.
    const hasWorking = activeStates.some(s => s.hasWorkingImplementation !== false);
    if (!hasWorking) {
      const enforceComingSoon = process.env.ENFORCE_SUBSCRIPTION_GATES === 'true'
        && (isThreePlanMode() || process.env.ENFORCE_COMING_SOON_LOCKS === 'true');
      if (enforceComingSoon) {
        return deny(res, 403, {
          message: MESSAGES.COMING_SOON,
          code: 'FEATURE_COMING_SOON',
          feature: keys.join(','),
          disabled: true,
          currentPlan: ent.planId
        });
      } else {
        console.warn(`[FEATURE GATE LOG-ONLY] Unbuilt feature '${keys.join(',')}' (hasWorkingImplementation=false) on ${req.method} ${req.originalUrl} (College: ${collegeId}, Plan: ${ent.planId})`);
      }
    }

    if (ent.readOnly && req.method !== 'GET') {
      return deny(res, 403, { message: 'Subscription grace period: read-only', code: 'READ_ONLY_GRACE' });
    }
    req.collegePlan = ent.planId;
    req.effectiveFeatures = ent.effectiveFeatures;
    next();
  } catch (e) { next(e); }
};

module.exports = { getEntitlements, loadEntitlements, featureGate, clearEntitlementCache, getFeatureFlags };
