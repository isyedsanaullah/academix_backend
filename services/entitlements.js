const { getSystemClient } = require('../config/prismaManager');
const {
  PLAN_LIMITS,
  PLAN_LEVEL,
  CANONICAL_PLANS,
  normalizePlanId
} = require('../config/planConstants');
const {
  FEATURE_REGISTRY,
  resolveCollegeFeatures
} = require('../config/featureRegistry');

/**
 * Single Source of Truth Entitlement Resolver
 * Reads college subscription, unexpired add-on capacity, database overrides,
 * computes view-only lock status, and resolves all 162 feature states.
 *
 * @param {string} collegeId - College UUID
 * @param {object} [dbClient] - Optional prisma client instance (e.g. within transaction)
 * @returns {Promise<object>} Comprehensive entitlement snapshot
 */
async function getEntitlements(collegeId, dbClient = null) {
  const prisma = dbClient || getSystemClient();
  const now = new Date();

  // 1. Fetch College with relationships
  const college = await prisma.college.findUnique({
    where: { id: collegeId },
    select: {
      id: true,
      name: true,
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
      feature_overrides: true,
      addons: {
        where: {
          expiresAt: { gt: now }
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

  const planId = normalizePlanId(college.planId || 'starter');
  let baseLimits = PLAN_LIMITS[planId] || PLAN_LIMITS.starter;

  // Phase 6C: Read pinned PlanVersion limits if available
  if (college.planVersionId) {
    const pv = await prisma.planVersion.findUnique({
      where: { id: college.planVersionId }
    });
    if (pv && pv.limitsJson && typeof pv.limitsJson === 'object') {
      baseLimits = { ...baseLimits, ...pv.limitsJson };
    }
  }

  // Phase 6B: CollegeQuotaOverride replaces base limit
  const baseWithOverrides = { ...baseLimits };
  if (college.quotaOverrides && college.quotaOverrides.length > 0) {
    for (const qo of college.quotaOverrides) {
      const val = Number(qo.overrideValue);
      baseWithOverrides[qo.metric] = val; // -1 = unlimited
    }
  }

  // 2. Compute View-Only (Read-Only) Lock Status
  let isReadOnly = false;
  let readOnlyReason = college.readOnlyReason || null;

  if (college.forceReadOnly) {
    isReadOnly = true;
    readOnlyReason = college.readOnlyReason || 'ADMIN_FORCED';
  } else if (college.subStatus === 'SUSPENDED') {
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

  // 3. Aggregate Active Add-Ons
  const activeAddons = college.addons || [];
  const addonCapacity = {
    students: 0,
    staff: 0,
    admins: 0,
    campuses: 0,
    storageGb: 0,
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
        addonCapacity.admins += addon.quantity;
        break;
      case 'CAMPUS':
        addonCapacity.campuses += addon.quantity;
        break;
      case 'STORAGE_GB':
        addonCapacity.storageGb += addon.quantity;
        break;
      case 'APPLICATIONS':
        addonCapacity.applications += addon.quantity;
        break;
      // Module add-ons like MODULE_CANTEEN, MODULE_LIBRARY, etc.
      case 'MODULE_CANTEEN':
      case 'CANTEEN_POS':
        activeAddonTypes.push('CANTEEN_POS');
        break;
      case 'MODULE_LIBRARY':
      case 'LIBRARY_MODULE':
        activeAddonTypes.push('LIBRARY_MODULE');
        break;
      case 'MODULE_TRANSPORT':
      case 'TRANSPORT_MODULE':
        activeAddonTypes.push('TRANSPORT_MODULE');
        break;
      case 'MODULE_HOSTEL':
      case 'HOSTEL_MODULE':
        activeAddonTypes.push('HOSTEL_MODULE');
        break;
    }
  }

  // 4. Compute Effective Limits
  const calcLimit = (base, addon = 0) => {
    if (base === -1 || base === Infinity) return -1;
    return (base || 0) + addon;
  };

  const effectiveLimits = {
    maxStudents: calcLimit(baseWithOverrides.maxStudents, addonCapacity.students),
    maxStaff: calcLimit(baseWithOverrides.maxStaff, addonCapacity.staff),
    maxAdmins: calcLimit(baseWithOverrides.maxAdmins, addonCapacity.admins),
    maxCampuses: calcLimit(baseWithOverrides.maxCampuses, addonCapacity.campuses),
    maxStorageBytes: calcLimit(baseWithOverrides.maxStorageBytes, addonCapacity.storageGb * 1073741824),
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
    exportsCsvMonthly: baseWithOverrides.exportsCsvMonthly !== undefined ? baseWithOverrides.exportsCsvMonthly : (baseWithOverrides.exportsMonthly?.csv ?? (PLAN_LIMITS[planId]?.exportsCsvMonthly || 0)),
    exportsPdfMonthly: baseWithOverrides.exportsPdfMonthly !== undefined ? baseWithOverrides.exportsPdfMonthly : (baseWithOverrides.exportsMonthly?.pdf ?? (PLAN_LIMITS[planId]?.exportsPdfMonthly || 0)),
    exportMaxRows: baseWithOverrides.exportMaxRows !== undefined ? baseWithOverrides.exportMaxRows : (baseWithOverrides.exportsMonthly?.maxCsvRows ?? (PLAN_LIMITS[planId]?.exportMaxRows || 1000)),
    exportsMonthly: typeof baseWithOverrides.exportsMonthly === 'object' ? { ...baseWithOverrides.exportsMonthly } : baseWithOverrides.exportsMonthly,
    apiCallsMonthly: baseWithOverrides.apiCallsMonthly,
    backupZipMonthly: baseWithOverrides.backupZipMonthly
  };

  // 5. Build Overrides Map
  const overridesMap = {};

  // Check legacy feature_overrides JSON if present
  if (college.feature_overrides && typeof college.feature_overrides === 'object') {
    Object.assign(overridesMap, college.feature_overrides);
  }

  // Database-level CollegeFeatureOverride rows take precedence
  if (college.featureOverrides && college.featureOverrides.length > 0) {
    for (const ov of college.featureOverrides) {
      overridesMap[ov.featureKey] = ov.state; // 'FORCE_ON' | 'FORCE_OFF'
    }
  }

  // 6. Resolve all 162 features via Canonical Resolver
  const resolved = resolveCollegeFeatures(planId, overridesMap, activeAddonTypes);

  return {
    collegeId: college.id,
    collegeName: college.name,
    planId,
    billingCycle: college.billingCycle || 'MONTHLY',
    subStatus: college.subStatus,
    trialEndsAt: college.trialEndsAt,
    periodStart: college.periodStart,
    periodEnd: college.periodEnd,
    annualQuotaCycleStart: college.annualQuotaCycleStart || college.periodStart,
    isReadOnly,
    readOnlyReason,
    baseLimits,
    effectiveLimits,
    addonCapacity,
    activeAddons,
    features: resolved.effectiveKeys,
    featureMatrix: resolved.featureMatrix,
    stats: resolved.stats
  };
}

module.exports = {
  getEntitlements
};

