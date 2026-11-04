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
      billingCycle: true,
      subStatus: true,
      trialEndsAt: true,
      periodStart: true,
      periodEnd: true,
      annualQuotaCycleStart: true,
      forceReadOnly: true,
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
      }
    }
  });

  if (!college) {
    throw new Error(`College with ID '${collegeId}' not found`);
  }

  const planId = normalizePlanId(college.planId || 'starter');
  const baseLimits = PLAN_LIMITS[planId] || PLAN_LIMITS.starter;

  // 2. Compute View-Only (Read-Only) Lock Status
  let isReadOnly = false;
  let readOnlyReason = null;

  if (college.forceReadOnly) {
    isReadOnly = true;
    readOnlyReason = 'ADMIN_FORCED';
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
  const effectiveLimits = {
    maxStudents: baseLimits.maxStudents + addonCapacity.students,
    maxStaff: baseLimits.maxStaff + addonCapacity.staff,
    maxAdmins: baseLimits.maxAdmins + addonCapacity.admins,
    maxCampuses: baseLimits.maxCampuses + addonCapacity.campuses,
    maxStorageBytes: baseLimits.maxStorageBytes + (addonCapacity.storageGb * 1073741824),
    maxUploadBytes: baseLimits.maxUploadBytes,
    maxApplications: baseLimits.maxApplications + addonCapacity.applications,
    messageCreditsMonthly: baseLimits.messageCreditsMonthly,
    aiCreditsMonthly: baseLimits.aiCreditsMonthly,
    tutorDailyPerStudent: baseLimits.tutorDailyPerStudent,
    aiQuizGenerationsMonthly: baseLimits.aiQuizGenerationsMonthly,
    aiNotesMonthly: baseLimits.aiNotesMonthly,
    documentOcrMonthly: baseLimits.documentOcrMonthly,
    noticeTranslationMonthly: baseLimits.noticeTranslationMonthly,
    askYourDataMonthly: baseLimits.askYourDataMonthly,
    exportsMonthly: { ...baseLimits.exportsMonthly },
    apiCallsMonthly: baseLimits.apiCallsMonthly,
    backupZipMonthly: baseLimits.backupZipMonthly
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

