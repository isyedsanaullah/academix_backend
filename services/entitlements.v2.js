// services/entitlements.v2.js
// Pure resolver: no database calls. Extends the v1 resolver with
//   - groups (requiresGroups)         - service-level switches
//   - capabilities with Plan B methods - hard dependencies vs capability needs vs soft use
//   - college method preference        - impact(): before/after diff for the custom plan builder
const LIVE = new Set(['TRIAL', 'ACTIVE', 'PAST_DUE', 'GRACE']);

function resolve({
  college,            // { id, isActive, groups: ['pre-medical', ...] }
  ent,                // { status, planId }
  planKeys,           // Set of feature keys the plan (or custom plan) includes
  overrides = [],     // [{ featureKey, state: 'FORCE_ON'|'FORCE_OFF', expiresAt }]
  choices = [],       // [{ featureKey, enabled }]  college's own switches (feature or service id)
  methodPrefs = {},   // { 'student.identify': ['search'] } college prefers this method first
  catalog,            // FEATURES
  capabilities,       // CAPABILITIES
  now = new Date(),
}) {
  if (!college.isActive) return { active: false, reason: 'ACCOUNT_DEACTIVATED' };
  if (!LIVE.has(ent.status)) return { active: false, reason: 'SUBSCRIPTION_' + ent.status };

  const grant = new Map(overrides.filter(o => !o.expiresAt || o.expiresAt > now).map(o => [o.featureKey, o.state]));
  const chosen = new Map(choices.map(c => [c.featureKey, c.enabled]));
  const groups = new Set(college.groups || []);
  const st = new Map();

  // 1. per-feature checks (each can only turn a feature off)
  for (const f of catalog) {
    const o = grant.get(f.key);
    let reason = null;
    if (!f.core && o === 'FORCE_OFF') reason = 'REVOKED';
    else if (!f.core && o !== 'FORCE_ON' && !planKeys.has(f.key)) reason = 'NOT_IN_PLAN';
    else if (!f.core && (chosen.get(f.key) === false || chosen.get(f.svc) === false)) reason = 'COLLEGE_DISABLED';
    // when the college's groups are unknown (onboarding not finished), do not hide anything
    else if (f.groups.length && groups.size && !f.groups.some(g => groups.has(g))) reason = 'GROUP_NOT_OFFERED';
    // release stage (HIDDEN/BETA/GA, kill switch) from the v1 resolver is applied by the caller
    // by removing unreleased keys from planKeys; catalog `status` only seeds the initial stage.
    st.set(f.key, { on: !reason, reason, source: o ? 'OVERRIDE' : 'PLAN' });
  }

  const capState = {};
  const methodOn = m => m.requires.every(k => st.get(k)?.on);

  // 2. dependencies and capabilities, repeated until nothing changes
  for (let changed = true, guard = 0; changed && guard < 50; guard++) {
    changed = false;

    for (const c of capabilities) {
      const avail = c.methods.filter(methodOn);
      const prefs = methodPrefs[c.key] || [];
      const ordered = [...avail].sort((a, b) => {
        const pa = prefs.indexOf(a.id), pb = prefs.indexOf(b.id);
        return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb);   // stable: unlisted keep catalog order
      });
      const chosenM = ordered[0] || null;
      capState[c.key] = {
        available: !!chosenM,
        method: chosenM ? chosenM.id : null,
        methods: avail.map(m => m.id),
        fallbackUsed: !!chosenM && c.methods.indexOf(c.methods.find(m => m.id === chosenM.id)) > 0,
      };
    }

    for (const f of catalog) {
      const s = st.get(f.key);
      if (!s.on || f.core) continue;
      const hardOff = f.hard.filter(k => !st.get(k)?.on);
      const capOff = f.needs.filter(k => !capState[k]?.available);
      if (hardOff.length || capOff.length) {
        Object.assign(s, hardOff.length
          ? { on: false, reason: 'DEPENDENCY_OFF', blockedBy: hardOff }
          : { on: false, reason: 'CAPABILITY_UNAVAILABLE', blockedBy: capOff });
        changed = true;
      }
    }
  }

  // 3. report degraded features: on, but a capability it uses is on a Plan B method or has none
  const degraded = {};
  for (const f of catalog) {
    if (!st.get(f.key).on) continue;
    const notes = [];
    for (const k of [...f.needs, ...f.uses]) {
      const c = capState[k];
      if (!c.available) notes.push({ capability: k, mode: 'none' });
      else if (c.fallbackUsed) notes.push({ capability: k, mode: 'fallback', method: c.method });
    }
    if (notes.length) degraded[f.key] = notes;
  }

  return {
    active: true, readOnly: ent.status === 'GRACE', planId: ent.planId,
    features: Object.fromEntries(st),
    keys: [...st].filter(([, s]) => s.on).map(([k]) => k),
    capabilities: capState,
    degraded,
  };
}

// What changes if a set of feature keys is removed from (or added to) the plan, or overrides are changed? Used by the builder & preview.
function impact(args, { remove = [], add = [], overrides = null } = {}) {
  const before = resolve(args);
  const planKeys = new Set(args.planKeys);
  remove.forEach(k => planKeys.delete(k));
  add.forEach(k => planKeys.add(k));
  let newOverrides = args.overrides;
  if (overrides !== null) {
    if (Array.isArray(overrides)) {
      newOverrides = overrides;
    } else if (typeof overrides === 'object') {
      const { parseOverrides } = require('./collegeAdapter');
      newOverrides = parseOverrides(overrides, args.now || new Date());
    }
  }
  const after = resolve({ ...args, planKeys, overrides: newOverrides });
  if (!before.active || !after.active) return { before, after };
  const b = new Set(before.keys), a = new Set(after.keys);
  const turnedOff = before.keys.filter(k => !a.has(k));
  const turnedOn = after.keys.filter(k => !b.has(k));
  const switched = Object.keys(after.capabilities)
    .filter(k => before.capabilities[k].method !== after.capabilities[k].method)
    .map(k => ({ capability: k, from: before.capabilities[k].method, to: after.capabilities[k].method }));
  return {
    turnedOff: turnedOff.map(k => ({ key: k, why: after.features[k].reason, blockedBy: after.features[k].blockedBy || null })),
    turnedOn,
    switched,                               // these are the Plan B moves
    nowDegraded: Object.keys(after.degraded).filter(k => !before.degraded[k]),
    after,
  };
}

module.exports = { resolve, impact };
