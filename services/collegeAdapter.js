// services/collegeAdapter.js
// Turns today's data (College.subscription JSON, College.settings, Group rows) into the input of resolve().
// No schema change is needed to start using the new resolver.
//
// College.subscription (existing JSON) keeps working:
//   { plan: 'basic'|'standard'|'premium'|'enterprise', status: 'trial'|'active'|'suspended'|'expired',
//     featureOverrides: { 'fees': false, 'ai-chat': true }            // old boolean form still accepted
//                    or { 'fees': { state:'off', expiresAt, reason, by } }, // new form with expiry
//     customPlan: { keys: [...], version: 3 },                         // optional: replaces the plan's keys
//     periodEnd, graceEnds, methodPrefs: { 'student.identify': ['search'] } }
// College.settings.programs: [{ name: 'Pre-Medical' }, ...] (saved by onboarding step 2)
const { FEATURES, CAPABILITIES, PLAN_ORDER, LEGACY_KEY_MAP, PLAN_ALIASES, GROUP_ALIASES } = require('./capabilityCatalog');
const { resolve } = require('./entitlements.v2');

const catalogKeys = new Set(FEATURES.map(f => f.key));

function normalizePlan(raw) {
  const s = String(raw || '').toLowerCase().trim();
  if (s.startsWith('cust')) return 'custom';
  if (s.startsWith('ent')) return 'enterprise';
  if (s.startsWith('prem')) return 'premium';
  if (s.startsWith('stand')) return 'standard';
  return PLAN_ALIASES[s] || 'starter';
}

function normalizeGroup(name) {
  const k = String(name || '').toLowerCase().trim().replace(/\s+/g, ' ');
  return GROUP_ALIASES[k] || (k ? 'custom:' + k.replace(/[^a-z0-9]+/g, '-') : null);
}

/** Feature keys a ready-made plan includes. Planned (unbuilt) features are never sold. */
function planKeysFor(planId, { includePlanned = false } = {}) {
  const level = PLAN_ORDER.indexOf(planId);
  return new Set(FEATURES
    .filter(f => !f.addon && PLAN_ORDER.indexOf(f.plan) <= level && (includePlanned || f.status !== 'planned'))
    .map(f => f.key));
}

function expandKey(k) { return LEGACY_KEY_MAP[k] || (catalogKeys.has(k) ? [k] : []); }

function parseOverrides(map, now) {
  const out = [];
  for (const [rawKey, v] of Object.entries(map || {})) {
    let state = null, expiresAt = null, reason = null;
    if (v === true || v === 'true') state = 'FORCE_ON';
    else if (v === false || v === 'false') state = 'FORCE_OFF';
    else if (v && typeof v === 'object') {
      state = String(v.state).toLowerCase() === 'on' ? 'FORCE_ON' : String(v.state).toLowerCase() === 'off' ? 'FORCE_OFF' : null;
      expiresAt = v.expiresAt ? new Date(v.expiresAt) : null; reason = v.reason || null;
    }
    if (!state) continue;
    for (const key of expandKey(rawKey)) out.push({ featureKey: key, state, expiresAt, reason });
  }
  return out;
}

/**
 * college: row from College (id, isActive, subscription, settings)
 * groupNames: optional names from the Group table; falls back to settings.programs
 */
function fromCollege(college, { groupNames = [], includePlanned = false, now = new Date(), flags = null } = {}) {
  const sub = (college.subscription && typeof college.subscription === 'object') ? college.subscription : {};
  const settings = (college.settings && typeof college.settings === 'object') ? college.settings : {};
  const planId = normalizePlan(sub.plan);

  let planKeys;
  if (planId === 'custom' && sub.customPlan?.keys) {
    planKeys = new Set(sub.customPlan.keys.filter(k => catalogKeys.has(k) && (includePlanned || FEATURES.find(f => f.key === k).status !== 'planned')));
  } else {
    planKeys = planKeysFor(planId === 'custom' ? 'starter' : planId, { includePlanned });
  }

  // Include active addons from subscription.addons (e.g. ['mcq-bank', 'srv-entrytest'])
  const rawAddons = sub.addons || [];
  const addonList = Array.isArray(rawAddons) ? rawAddons : (typeof rawAddons === 'object' ? Object.keys(rawAddons).filter(k => rawAddons[k]) : []);
  for (const a of addonList) {
    for (const key of expandKey(a)) {
      if (catalogKeys.has(key) && (includePlanned || FEATURES.find(f => f.key === key).status !== 'planned')) {
        planKeys.add(key);
      }
    }
  }

  const overrides = parseOverrides(sub.featureOverrides, now);

  if (flags) {
    const flagEntries = (flags instanceof Map || typeof flags.entries === 'function')
      ? flags.entries()
      : Object.entries(flags);
    for (const [key, flag] of flagEntries) {
      const hasForceOn = overrides.some(o => o.featureKey === key && o.state === 'FORCE_ON');
      if (flag.killSwitch) {
        planKeys.delete(key);
        for (let i = overrides.length - 1; i >= 0; i--) {
          if (overrides[i].featureKey === key && overrides[i].state === 'FORCE_ON') {
            overrides.splice(i, 1);
          }
        }
        overrides.push({ featureKey: key, state: 'FORCE_OFF', reason: 'KILL_SWITCH' });
      } else if (flag.release === 'HIDDEN') {
        if (!hasForceOn) {
          planKeys.delete(key);
        }
      } else if (flag.release === 'BETA') {
        const isBeta = Array.isArray(flag.betaColleges) && flag.betaColleges.includes(college.id);
        if (!isBeta && !hasForceOn) {
          planKeys.delete(key);
        }
      }
    }
  }

  const names = groupNames.length
    ? groupNames
    : (settings.programs || settings.groupsOffered || []).map(p => (typeof p === 'string' ? p : p?.name));
  const groups = [...new Set(names.map(normalizeGroup).filter(Boolean))];

  const status = String(sub.status || 'active').toUpperCase();
  const known = ['TRIAL', 'ACTIVE', 'PAST_DUE', 'GRACE', 'SUSPENDED', 'EXPIRED'];

  return {
    college: { id: college.id, isActive: college.isActive !== false, groups },
    ent: { status: known.includes(status) ? status : 'ACTIVE', planId },
    planKeys,
    overrides,
    choices: Object.entries(settings.serviceChoices || {}).map(([featureKey, enabled]) => ({ featureKey, enabled: !!enabled })),
    methodPrefs: sub.methodPrefs || settings.methodPrefs || {},
    catalog: FEATURES, capabilities: CAPABILITIES, now,
  };
}

function resolveCollege(college, opts) { return resolve(fromCollege(college, opts)); }

/**
 * Keys in today's format, so Sidebar.jsx and authStore keep working unchanged:
 * a legacy key is on when every catalog key it maps to is on (planned keys are ignored).
 */
function legacyEffectiveKeys(resolved) {
  if (!resolved.active) return [];
  const on = new Set(resolved.keys);
  const out = new Set(resolved.keys);
  for (const [legacy, targets] of Object.entries(LEGACY_KEY_MAP)) {
    const live = targets.filter(k => FEATURES.find(f => f.key === k)?.status !== 'planned');
    if (live.length && live.every(k => on.has(k))) out.add(legacy);
    else out.delete(legacy);
  }
  return [...out];
}

/**
 * Moving existing colleges to the new plan table without taking anything away:
 * pass the keys the OLD resolver gave the college (resolveCollegeFeatures(...).effectiveKeys);
 * returns the featureOverrides to merge into College.subscription so nothing they use today disappears.
 */
function grandfatherOverrides(college, oldEffectiveKeys) {
  const r = resolveCollege(college);
  if (!r.active) return {};
  const now = new Set(legacyEffectiveKeys(r));
  const out = {};
  for (const k of oldEffectiveKeys) if (LEGACY_KEY_MAP[k] && !now.has(k)) out[k] = true;
  return out;
}

module.exports = { grandfatherOverrides, normalizePlan, normalizeGroup, planKeysFor, parseOverrides, fromCollege, resolveCollege, legacyEffectiveKeys };
