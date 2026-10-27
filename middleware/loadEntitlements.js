// middleware/loadEntitlements.js
// Replaces middleware/planGate.js. Same response shape ({ success:false, message, disabled:true }) so the frontend keeps working,
// plus a machine-readable `code` and `reason`.
//
// Order in routes (as today):  protect, tenantContext, featureGate('attendance')
const { getSystemClient } = require('../config/prismaManager');
const { resolveCollege, legacyEffectiveKeys } = require('../services/collegeAdapter');
const { LEGACY_KEY_MAP } = require('../services/capabilityCatalog');

const TTL_MS = 60_000;
const cache = new Map();                       // collegeId -> { at, resolved }
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

const clearEntitlementCache = id => {
  if (id) {
    cache.delete(id);
  } else {
    cache.clear();
    flagsCache = { at: 0, flags: null };
  }
};

async function getEntitlements(collegeId) {
  const hit = cache.get(collegeId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.resolved;
  const db = getSystemClient();
  const college = await db.college.findUnique({
    where: { id: collegeId },
    select: {
      id: true,
      isActive: true,
      subscription: true,
      settings: true,
      subscription_status: true,
      feature_overrides: true,
      subscriptionPeriods: {
        where: { status: 'active' },
        orderBy: { starts_at: 'desc' },
        take: 1
      }
    }
  });
  if (!college) return { active: false, reason: 'COLLEGE_NOT_FOUND' };
  // groups: prefer the Group table (live), fall back to onboarding settings
  const groups = await db.group.findMany({ where: { college_id: collegeId, isActive: true }, select: { name: true }, distinct: ['name'] });
  const flags = await getFeatureFlags();
  const resolved = resolveCollege(college, { groupNames: groups.map(g => g.name), flags });
  if (resolved.active) {
    resolved.effectiveFeatures = legacyEffectiveKeys(resolved);   // same shape the Sidebar reads today
    for (const [legacyKey, targets] of Object.entries(LEGACY_KEY_MAP)) {
      if (!resolved.features[legacyKey]) {
        const isLegacyOn = resolved.effectiveFeatures.includes(legacyKey);
        if (isLegacyOn) {
          resolved.features[legacyKey] = { on: true, source: 'PLAN' };
        } else {
          const firstTargetState = targets.map(t => resolved.features[t]).find(s => s && !s.on);
          resolved.features[legacyKey] = {
            on: false,
            reason: firstTargetState?.reason || 'NOT_IN_PLAN',
            blockedBy: firstTargetState?.blockedBy
          };
        }
      }
    }
  }
  cache.set(collegeId, { at: Date.now(), resolved });
  return resolved;
}

const MESSAGES = {
  NOT_IN_PLAN: 'This feature is not included in your plan.',
  COLLEGE_DISABLED: 'This feature is switched off for your institution.',
  REVOKED: 'This feature is disabled for your institution.',
  DEPENDENCY_OFF: 'This feature needs another feature that is switched off.',
  CAPABILITY_UNAVAILABLE: 'This feature needs a method that is switched off (no alternative is available).',
  GROUP_NOT_OFFERED: 'Your college does not offer a group that uses this feature.',
  KILL_SWITCH: 'This feature is temporarily unavailable due to system maintenance.',
  RELEASE_STAGE: 'This feature is not yet available in your release tier.',
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

/** featureGate('attendance')  or  featureGate(['gate-scanner','gate-manual-log']) = any one of them */
const featureGate = (keyOrKeys) => async (req, res, next) => {
  try {
    if (req.user?.role === 'superAdmin') return next();                       // same bypass as planGate today
    const collegeId = req.collegeId || req.user?.college_id;
    if (!collegeId) return deny(res, 403, { message: 'No college associated with this account' });
    const ent = req.entitlements || (req.entitlements = await getEntitlements(collegeId));
    if (!ent.active) return deny(res, 403, { message: 'College account or subscription is not active', code: ent.reason, disabled: true });

    const keys = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];
    const states = keys.map(k => ent.features[k]);
    if (!states.some(s => s?.on)) {
      const s = states[0];
      return deny(res, 403, {
        message: MESSAGES[s?.reason] || 'This feature is disabled for your institution.',
        code: 'FEATURE_UNAVAILABLE', feature: keys.join(','), reason: s?.reason || 'UNKNOWN',
        blockedBy: s?.blockedBy || undefined, upgrade: s?.reason === 'NOT_IN_PLAN', disabled: true, currentPlan: ent.planId,
      });
    }
    if (ent.readOnly && req.method !== 'GET') return deny(res, 403, { message: 'Subscription grace period: read-only', code: 'READ_ONLY_GRACE' });
    req.collegePlan = ent.planId;
    req.effectiveFeatures = ent.effectiveFeatures;                            // same property planGate sets today
    next();
  } catch (e) { next(e); }
};

module.exports = { getEntitlements, loadEntitlements, featureGate, clearEntitlementCache, getFeatureFlags };
