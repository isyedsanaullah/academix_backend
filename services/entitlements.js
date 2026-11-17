'use strict';

const { getSystemClient } = require('../config/prismaManager');
const { isThreePlanMode } = require('../config/featureFlags');
const {
  GB,
  getPlanConfig,
  getPlanLimits,
  normalizePlanId
} = require('../config/planConstants');
const {
  FEATURE_ALIASES,
  getFeatureRegistry,
  resolveAlias,
  resolveCollegeFeatures
} = require('../config/featureRegistry');
const { CAPABILITIES } = require('./capabilityCatalog');

const STATE_MESSAGES = {
  NOT_IN_PLAN: 'This feature is not included in your plan.',
  COLLEGE_DISABLED: 'This feature is switched off for your institution.',
  REVOKED: 'This feature is disabled for your institution.',
  DEPENDENCY_OFF: 'This feature needs another feature that is switched off.',
  CAPABILITY_UNAVAILABLE: 'This feature needs a method that is switched off (no alternative is available).',
  GROUP_NOT_OFFERED: 'Your college does not offer a group that uses this feature.',
  KILL_SWITCH: 'This feature is temporarily unavailable due to system maintenance.',
  COMING_SOON: 'This feature is coming soon and is not yet available.'
};

function normalizeOverrideEntry(val) {
  if (val === true || val === 'true' || val === 'FORCE_ON') return 'FORCE_ON';
  if (val === false || val === 'false' || val === 'FORCE_OFF') return 'FORCE_OFF';
  if (val && typeof val === 'object') {
    if (val.expiresAt && new Date(val.expiresAt).getTime() <= Date.now()) return null;
    const s = String(val.state || '').toLowerCase();
    if (s === 'on' || s === 'force_on') return 'FORCE_ON';
    if (s === 'off' || s === 'force_off') return 'FORCE_OFF';
  }
  return null;
}

function resolveCapabilitiesSnapshot(featureStates) {
  const capabilities = {};
  const degraded = {};
  for (const cap of CAPABILITIES) {
    const availableMethods = cap.methods.filter(m =>
      m.requires.every(reqKey => Boolean(featureStates[reqKey]?.on))
    );
    const chosen = availableMethods[0] || null;
    const primary = cap.methods[0] || null;
    const fallbackUsed = Boolean(chosen && primary && chosen.id !== primary.id);
    capabilities[cap.key] = {
      available: Boolean(chosen),
      method: chosen ? chosen.id : null,
      methods: availableMethods.map(m => m.id),
      fallbackUsed
    };
    if (fallbackUsed) {
      degraded[cap.key] = {
        from: primary.id,
        to: chosen.id
      };
    }
  }
  return { capabilities, degraded };
}

/**
 * Single Source of Truth Entitlement Resolver
 * Reads college subscription, unexpired ACTIVE add-ons, overrides (JSON + table),
 * computes view-only lock status, fixes STORAGE_GB (10 GB blocks) & APPLICATIONS (25/pack),
 * and resolves all canonical & alias feature states.
 */
async function getEntitlements(collegeId, dbClient = null, options = {}) {
  const prisma = dbClient || getSystemClient();
  const now = new Date();
  const threePlan = options.threePlan !== undefined ? Boolean(options.threePlan) : isThreePlanMode();

  const college = await prisma.college.findUnique({
    where: { id: collegeId },
    select: {
      id: true,
      name: true,
      isActive: true,
      planId: true,
      planVersionId: true,
      billingCycle: true,
      subStatus: true,
      trialEndsAt: true,
      periodStart: true,
      periodEnd: true,
      annualQuotaCycleStart: true,
      forceReadOnly: true,
      readOnlyReason: true,
      subscription: true,
      settings: true,
      subscription_status: true,
      feature_overrides: true,
      addons: {
        where: {
          expiresAt: { gt: now },
          status: 'ACTIVE'
        }
      },
      featureOverrides: {
        where: {
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: now } }
          ]
        }
      },
      quotaOverrides: true
    }
  });

  if (!college) {
    throw new Error(`College with ID '${collegeId}' not found`);
  }

  const subJson = (college.subscription && typeof college.subscription === 'object') ? college.subscription : {};
  const rawPlanInput = college.planId || subJson.plan || subJson.planId || 'starter';
  const planId = normalizePlanId(rawPlanInput, threePlan);
  const planCfg = getPlanConfig(threePlan);
  let baseLimits = { ...(getPlanLimits(planId, threePlan) || planCfg.PLAN_LIMITS.starter) };

  // Pinned PlanVersion limits if available
  if (college.planVersionId) {
    const pv = await prisma.planVersion.findUnique({
      where: { id: college.planVersionId }
    });
    if (pv && pv.limitsJson && typeof pv.limitsJson === 'object') {
      baseLimits = { ...baseLimits, ...pv.limitsJson };
    }
  }

  // CollegeQuotaOverride replaces base limit (grandfathering overrides expire after college.grandfatheredUntil)
  const baseWithOverrides = { ...baseLimits };
  const isGrandfatherExpired = Boolean(
    college.grandfatheredUntil && new Date(college.grandfatheredUntil) < now
  );
  if (college.quotaOverrides && college.quotaOverrides.length > 0) {
    for (const qo of college.quotaOverrides) {
      if (isGrandfatherExpired && qo.reason === 'ENTERPRISE_RETIREMENT_GRANDFATHER') {
        continue;
      }
      baseWithOverrides[qo.metric] = Number(qo.overrideValue);
    }
  }

  // View-Only Lock Status
  let isReadOnly = false;
  let readOnlyReason = college.readOnlyReason || null;

  if (college.forceReadOnly) {
    isReadOnly = true;
    readOnlyReason = college.readOnlyReason || 'ADMIN_FORCED';
  } else if (college.subStatus === 'SUSPENDED' || subJson.status === 'suspended') {
    isReadOnly = true;
    readOnlyReason = 'SUSPENDED';
  } else if (college.subStatus === 'TRIAL') {
    if (college.trialEndsAt && new Date(college.trialEndsAt) < now) {
      isReadOnly = true;
      readOnlyReason = 'TRIAL_EXPIRED';
    }
  } else if (college.subStatus === 'ACTIVE') {
    if (college.periodEnd && new Date(college.periodEnd) < now) {
      isReadOnly = true;
      readOnlyReason = 'SUBSCRIPTION_EXPIRED';
    }
  }

  // Aggregate Active Add-Ons (fixing STORAGE_GB 10 GB blocks & APPLICATIONS 25/pack multipliers)
  const activeAddons = college.addons || [];
  const addonCapacity = {
    students: 0,
    staff: 0,
    admins: 0,
    campuses: 0,
    storageGbBlocks: 0,
    storageGb: 0,
    applicationPacks: 0,
    applications: 0
  };

  const activeAddonTypes = [];
  for (const addon of activeAddons) {
    activeAddonTypes.push(addon.addonType);
    switch (addon.addonType) {
      case 'STUDENTS':
        addonCapacity.students += addon.quantity;
        break;
      case 'STAFF':
        addonCapacity.staff += addon.quantity;
        break;
      case 'ADMINS':
        if (!threePlan) addonCapacity.admins += addon.quantity;
        break;
      case 'CAMPUS':
        addonCapacity.campuses += addon.quantity;
        break;
      case 'STORAGE_GB':
        addonCapacity.storageGbBlocks += addon.quantity;
        addonCapacity.storageGb += addon.quantity * 10; // Each block = 10 GB
        break;
      case 'APPLICATIONS':
        addonCapacity.applicationPacks += addon.quantity;
        addonCapacity.applications += addon.quantity * 25; // Each pack = 25/yr
        break;
      case 'MODULE_CANTEEN':
      case 'CANTEEN_POS':
        activeAddonTypes.push('MODULE_CANTEEN', 'CANTEEN_POS');
        break;
      case 'MODULE_LIBRARY':
      case 'LIBRARY_MODULE':
        activeAddonTypes.push('MODULE_LIBRARY', 'LIBRARY_MODULE');
        break;
      case 'MODULE_TRANSPORT':
      case 'TRANSPORT_MODULE':
        activeAddonTypes.push('MODULE_TRANSPORT', 'TRANSPORT_MODULE');
        break;
      case 'MODULE_HOSTEL':
      case 'HOSTEL_MODULE':
        activeAddonTypes.push('MODULE_HOSTEL', 'HOSTEL_MODULE');
        break;
      case 'MODULE_ACCOUNTING':
      case 'MODULE_STAFF_HR':
      case 'PACK_GOVERNANCE':
      case 'PACK_API':
        activeAddonTypes.push(addon.addonType);
        break;
    }
  }

  // Support legacy JSON subscription.addons if any
  if (Array.isArray(subJson.addons)) {
    for (const a of subJson.addons) activeAddonTypes.push(a);
  }

  const calcLimit = (base, addon = 0) => {
    if (base === -1 || base === Infinity) return -1;
    return (base || 0) + addon;
  };

  const apiPackBonus = activeAddonTypes.includes('PACK_API') ? 100000 : 0;

  const effectiveLimits = {
    maxStudents: calcLimit(baseWithOverrides.maxStudents, addonCapacity.students),
    maxStaff: calcLimit(baseWithOverrides.maxStaff, addonCapacity.staff),
    maxAdmins: calcLimit(baseWithOverrides.maxAdmins, addonCapacity.admins),
    maxCampuses: calcLimit(baseWithOverrides.maxCampuses, addonCapacity.campuses),
    maxStorageBytes: calcLimit(baseWithOverrides.maxStorageBytes, addonCapacity.storageGb * GB),
    maxUploadBytes: baseWithOverrides.maxUploadBytes,
    maxApplications: calcLimit(baseWithOverrides.maxApplications, addonCapacity.applications),
    messageCreditsMonthly: baseWithOverrides.messageCreditsMonthly,
    aiCreditsMonthly: baseWithOverrides.aiCreditsMonthly,
    tutorDailyPerStudent: baseWithOverrides.tutorDailyPerStudent,
    aiQuizGenerationsMonthly: baseWithOverrides.aiQuizGenerationsMonthly,
    aiNotesMonthly: baseWithOverrides.aiNotesMonthly,
    documentOcrMonthly: baseWithOverrides.documentOcrMonthly,
    noticeTranslationMonthly: baseWithOverrides.noticeTranslationMonthly,
    askYourDataMonthly: baseWithOverrides.askYourDataMonthly,
    exportsCsvMonthly: baseWithOverrides.exportsCsvMonthly !== undefined
      ? baseWithOverrides.exportsCsvMonthly
      : (planCfg.PLAN_LIMITS[planId]?.exportsCsvMonthly ?? 0),
    exportsPdfMonthly: baseWithOverrides.exportsPdfMonthly !== undefined
      ? baseWithOverrides.exportsPdfMonthly
      : (planCfg.PLAN_LIMITS[planId]?.exportsPdfMonthly ?? 0),
    exportMaxRows: baseWithOverrides.exportMaxRows !== undefined
      ? baseWithOverrides.exportMaxRows
      : (planCfg.PLAN_LIMITS[planId]?.exportMaxRows ?? 1000),
    exportsMonthly: typeof baseWithOverrides.exportsMonthly === 'object'
      ? { ...baseWithOverrides.exportsMonthly }
      : baseWithOverrides.exportsMonthly,
    apiCallsMonthly: calcLimit(baseWithOverrides.apiCallsMonthly || 0, apiPackBonus),
    backupZipMonthly: baseWithOverrides.backupZipMonthly,
    emailsMonthly: baseWithOverrides.emailsMonthly,
    auditRetentionDays: baseWithOverrides.auditRetentionDays,
    trashRetentionDays: baseWithOverrides.trashRetentionDays,
    fileRetentionMonths: baseWithOverrides.fileRetentionMonths,
    customReportTemplatesMax: baseWithOverrides.customReportTemplatesMax,
    scheduledReportsMonthly: baseWithOverrides.scheduledReportsMonthly,
    omrSheetsMonthly: baseWithOverrides.omrSheetsMonthly,
    bulkImportMaxRows: baseWithOverrides.bulkImportMaxRows
  };

  // Precedence: subscription.featureOverrides -> College.feature_overrides -> CollegeFeatureOverride table
  const overridesMap = {};
  if (subJson.featureOverrides && typeof subJson.featureOverrides === 'object') {
    for (const [k, v] of Object.entries(subJson.featureOverrides)) {
      const norm = normalizeOverrideEntry(v);
      if (norm) overridesMap[k] = norm;
    }
  }
  if (college.feature_overrides && typeof college.feature_overrides === 'object') {
    for (const [k, v] of Object.entries(college.feature_overrides)) {
      const norm = normalizeOverrideEntry(v);
      if (norm) overridesMap[k] = norm;
    }
  }
  if (college.featureOverrides && college.featureOverrides.length > 0) {
    for (const ov of college.featureOverrides) {
      overridesMap[ov.featureKey] = ov.state;
    }
  }

  const resolved = resolveCollegeFeatures(planId, overridesMap, Array.from(new Set(activeAddonTypes)), {
    threePlan,
    catalogCompat: !threePlan
  });

  // Apply global FeatureFlag kill switches if supplied via options.flags
  const flags = options.flags || null;
  const killSwitched = new Set();
  if (flags) {
    const entries = (flags instanceof Map || typeof flags.entries === 'function')
      ? flags.entries()
      : Object.entries(flags);
    for (const [flagKey, flagRow] of entries) {
      if (flagRow && flagRow.enabled === false) {
        killSwitched.add(resolveAlias(flagKey, threePlan));
      }
    }
  }

  const effectiveSet = new Set(resolved.effectiveKeys);
  const featureStates = {};

  for (const feat of resolved.featureMatrix) {
    const isKilled = killSwitched.has(feat.key);
    const on = feat.effective && !isKilled;
    if (isKilled) {
      effectiveSet.delete(feat.key);
      if (feat.aliases) feat.aliases.forEach(a => effectiveSet.delete(a));
    }
    const reason = isKilled
      ? 'KILL_SWITCH'
      : on
      ? null
      : feat.dependencyBlocked
      ? 'DEPENDENCY_OFF'
      : feat.source === 'custom_disabled'
      ? 'REVOKED'
      : 'NOT_IN_PLAN';

    const stateObj = {
      on,
      canonicalKey: feat.key,
      source: isKilled ? 'KILL_SWITCH' : (feat.source === 'plan_default' ? 'PLAN' : feat.source),
      reason,
      blockedBy: feat.blockedBy && feat.blockedBy.length ? feat.blockedBy : undefined,
      status: feat.status,
      hasWorkingImplementation: feat.hasWorkingImplementation !== false
    };
    featureStates[feat.key] = stateObj;
    if (feat.aliases) {
      for (const alias of feat.aliases) {
        if (!featureStates[alias] || on) featureStates[alias] = stateObj;
      }
    }
  }

  // Ensure every FEATURE_ALIASES entry is also represented in featureStates
  for (const [aliasKey, canonKey] of Object.entries(FEATURE_ALIASES)) {
    if (!featureStates[aliasKey] && featureStates[canonKey]) {
      featureStates[aliasKey] = featureStates[canonKey];
    }
  }

  const finalEffectiveKeys = Array.from(effectiveSet);
  const { capabilities, degraded } = resolveCapabilitiesSnapshot(featureStates);

  const isCollegeActive = college.isActive !== false && college.subStatus !== 'SUSPENDED' && subJson.status !== 'suspended';

  return {
    active: isCollegeActive,
    reason: isCollegeActive ? null : (college.subStatus === 'SUSPENDED' ? 'SUSPENDED' : 'COLLEGE_INACTIVE'),
    collegeId: college.id,
    collegeName: college.name,
    planId,
    billingCycle: college.billingCycle || 'MONTHLY',
    subStatus: college.subStatus,
    isCustomQuote: Boolean(college.isCustomQuote),
    customQuoteNotes: college.customQuoteNotes || null,
    grandfatheredUntil: college.grandfatheredUntil || null,
    grandfatherReason: college.grandfatherReason || null,
    trialEndsAt: college.trialEndsAt,
    periodStart: college.periodStart,
    periodEnd: college.periodEnd,
    annualQuotaCycleStart: college.annualQuotaCycleStart || college.periodStart,
    isReadOnly,
    readOnly: isReadOnly,
    readOnlyReason,
    baseLimits,
    effectiveLimits,
    addonCapacity,
    activeAddons,
    features: finalEffectiveKeys,
    effectiveFeatures: finalEffectiveKeys,
    featureStates,
    featureMatrix: resolved.featureMatrix,
    capabilities,
    degraded,
    stats: resolved.stats
  };
}

/**
 * Resolves the canonical feature state object for any canonical or legacy/route alias key.
 */
function resolveFeatureState(entitlements, rawKey) {
  if (!rawKey || !entitlements) return null;
  const states = entitlements.featureStates;
  if (states && states[rawKey]) return states[rawKey];
  const canon = resolveAlias(rawKey);
  if (states && states[canon]) return states[canon];
  if (Array.isArray(entitlements.features)) {
    const regItem = getFeatureRegistry().find(f => f.key === canon || (f.aliases && f.aliases.includes(rawKey)));
    const on = entitlements.features.includes(rawKey) || entitlements.features.includes(canon);
    return {
      on,
      canonicalKey: canon,
      reason: on ? null : 'NOT_IN_PLAN',
      hasWorkingImplementation: regItem ? regItem.hasWorkingImplementation !== false : true
    };
  }
  return null;
}

module.exports = {
  getEntitlements,
  resolveFeatureState,
  STATE_MESSAGES
};
