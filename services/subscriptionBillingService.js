'use strict';

const crypto = require('crypto');
const {
  CANONICAL_PLANS,
  PLAN_LEVEL,
  PLAN_PRICING,
  PLAN_LIMITS,
  ADDON_CATALOG_SEEDS,
  GB,
  MB,
  normalizePlanId,
} = require('../config/planConstants');
const { isThreePlanMode } = require('../config/featureFlags');
const { getFeatureRegistry } = require('../config/featureRegistry');
const {
  BANK_DETAILS,
  INVOICE_DUE_DAYS,
  isUpgradeProrationEnabled,
} = require('../config/billingConfig');
const { getFrontendBaseUrl } = require('../config/env');
const { generateVerifyToken } = require('./documentTemplates/shared');
const { transitionCollegeSubStatus } = require('./subscriptionStateService');
const { getEntitlements } = require('./entitlements');

const PLAN_LABELS = {
  starter: 'Starter',
  standard: 'Standard',
  premium: 'Premium',
  enterprise: 'Enterprise',
};

const PLAN_DESCRIPTIONS = {
  starter: 'Core daily operations for smaller institutions',
  standard: 'Admissions, challans, board exams, payroll & AI Lite',
  premium: 'Multi-campus, analytics, parent reach & AI Plus/Full',
  enterprise: 'Full multi-campus governance, 40M AI & API access',
};

function formatPlanName(planId) {
  return PLAN_LABELS[planId] || (planId ? planId.charAt(0).toUpperCase() + planId.slice(1) : 'Starter');
}

function getAddonUnitLabel(addonType) {
  switch (addonType) {
    case 'STUDENTS': return 'per student';
    case 'STAFF': return 'per staff account';
    case 'ADMINS': return 'per admin account';
    case 'STORAGE_GB': return 'per 10 GB block';
    case 'APPLICATIONS': return 'per 25 apps / year';
    case 'CAMPUS': return 'per extra campus';
    default: return 'per unit';
  }
}

/**
 * Build full live plans + add-ons catalog directly from planConstants, featureRegistry & AddonCatalog.
 * Never hardcodes prices.
 */
async function getPlansCatalog(prisma, collegeId = null) {
  const threePlan = isThreePlanMode();
  const registry = getFeatureRegistry(threePlan);

  const [dbSubscriptions, dbAddons, planVersions] = await Promise.all([
    prisma.subscription?.findMany
      ? prisma.subscription.findMany({ where: { isActive: true, planId: { in: CANONICAL_PLANS } } }).catch(() => [])
      : [],
    prisma.addonCatalog?.findMany
      ? prisma.addonCatalog.findMany({ where: { isAvailable: true }, orderBy: [{ addonType: 'asc' }, { planId: 'asc' }] }).catch(() => [])
      : [],
    prisma.planVersion?.findMany
      ? prisma.planVersion.findMany({ orderBy: { version: 'desc' } }).catch(() => [])
      : [],
  ]);

  const latestVersionByPlan = new Map();
  for (const pv of planVersions || []) {
    if (!latestVersionByPlan.has(pv.planId)) latestVersionByPlan.set(pv.planId, pv);
  }

  const plans = CANONICAL_PLANS.map((planId) => {
    const dbRow = (dbSubscriptions || []).find((s) => s.planId === planId);
    const pv = latestVersionByPlan.get(planId);
    const canonicalPrice = PLAN_PRICING[planId] || { monthly: 0, yearly: 0 };
    const limits = { ...(PLAN_LIMITS[planId] || {}), ...(pv?.limitsJson || {}) };

    const monthlyPrice = pv?.pricesJson?.monthlyPkr ?? canonicalPrice.monthly;
    const yearlyPrice = pv?.pricesJson?.yearlyPkr ?? canonicalPrice.yearly;

    const lvl = PLAN_LEVEL[planId] ?? 0;
    const includedFeatures = registry.filter(
      (f) => !f.addonOnly && f.startsIn && (PLAN_LEVEL[f.startsIn] ?? 99) <= lvl
    );
    const liveFeatures = includedFeatures.filter((f) => f.status === 'live');

    // Collect add-ons for this plan (merge DB AddonCatalog with code seeds)
    const addonMap = new Map();
    for (const seed of ADDON_CATALOG_SEEDS) {
      if (seed.planId === planId && seed.isAvailable !== false) {
        addonMap.set(seed.addonType, { ...seed });
      }
    }
    for (const row of dbAddons || []) {
      if (row.planId !== planId) continue;
      if (threePlan && !addonMap.has(row.addonType)) continue;
      const existing = addonMap.get(row.addonType) || {};
      addonMap.set(row.addonType, {
        ...existing,
        ...row,
        unitPriceMonthlyPkr: threePlan ? (existing.unitPriceMonthlyPkr ?? row.unitPriceMonthlyPkr) : row.unitPriceMonthlyPkr,
        unitPriceYearlyPkr: threePlan ? (existing.unitPriceYearlyPkr ?? row.unitPriceYearlyPkr) : row.unitPriceYearlyPkr,
        isPurchasable: threePlan ? (existing.isPurchasable !== false && row.isPurchasable !== false) : (row.isPurchasable !== false),
      });
    }

    const addons = Array.from(addonMap.values()).map((a) => {
      let maxUnitsAllowed = a.maxUnitsStatic ?? null;
      if (a.maxCapPercentOfBase) {
        if (a.addonType === 'STUDENTS') maxUnitsAllowed = Math.floor((limits.maxStudents || 0) * (a.maxCapPercentOfBase / 100));
        else if (a.addonType === 'STAFF') maxUnitsAllowed = Math.floor((limits.maxStaff || 0) * (a.maxCapPercentOfBase / 100));
        else if (a.addonType === 'STORAGE_GB') {
          const baseGb = Math.floor((limits.maxStorageBytes || 0) / GB);
          maxUnitsAllowed = Math.floor(baseGb * (a.maxCapPercentOfBase / 100));
        } else if (a.addonType === 'APPLICATIONS') {
          maxUnitsAllowed = Math.floor((limits.maxApplications || 0) * (a.maxCapPercentOfBase / 100));
        }
      }
      return {
        addonType: a.addonType,
        planId,
        name: a.name,
        unitLabel: getAddonUnitLabel(a.addonType),
        unitPriceMonthlyPkr: a.unitPriceMonthlyPkr,
        unitPriceYearlyPkr: a.unitPriceYearlyPkr,
        maxUnitsAllowed,
        isAvailable: a.isAvailable !== false,
        isPurchasable: a.isPurchasable !== false,
      };
    });

    return {
      planId,
      name: formatPlanName(planId),
      description: dbRow?.description || PLAN_DESCRIPTIONS[planId] || '',
      recommended: planId === 'standard',
      currency: 'PKR',
      monthlyPrice,
      yearlyPrice,
      yearlySavingsPkr: Math.max(0, monthlyPrice * 12 - yearlyPrice),
      limits: {
        maxStudents: limits.maxStudents ?? 0,
        maxStaff: limits.maxStaff ?? 0,
        maxAdmins: limits.maxAdmins ?? 0,
        maxCampuses: limits.maxCampuses ?? 1,
        maxStorageGb: limits.maxStorageBytes ? Math.round(limits.maxStorageBytes / GB) : 0,
        maxUploadMb: limits.maxUploadBytes ? Math.round(limits.maxUploadBytes / MB) : 10,
        maxApplications: limits.maxApplications ?? 0,
        aiCreditsMonthly: limits.aiCreditsMonthly ?? 0,
        messageCreditsMonthly: limits.messageCreditsMonthly ?? 0,
        emailsMonthly: limits.emailsMonthly ?? 3000,
      },
      servicesCount: includedFeatures.length,
      liveServicesCount: liveFeatures.length,
      highlights: liveFeatures.slice(0, 8).map((f) => f.name),
      addons,
    };
  });

  return {
    threePlanMode: threePlan,
    currency: 'PKR',
    bankDetails: BANK_DETAILS,
    upgradeProrationEnabled: isUpgradeProrationEnabled(),
    plans,
    collegeId,
  };
}

/**
 * Validate add-ons & compute authoritative server-side pricing quote.
 * Mid-term upgrade proration uses the college's LOCKED CollegeSubscription price when active.
 */
async function calculateCheckoutQuote(prisma, { collegeId, planId, billingCycle = 'MONTHLY', lineItems = [] }) {
  const threePlan = isThreePlanMode();
  const rawPlan = String(planId || '').trim().toLowerCase();

  if (!rawPlan || (threePlan && rawPlan === 'enterprise')) {
    const err = new Error(
      threePlan && rawPlan === 'enterprise'
        ? 'The Enterprise plan is retired. Please select Starter, Standard, or Premium.'
        : 'Please select a valid subscription plan.'
    );
    err.status = 400;
    err.code = rawPlan === 'enterprise' ? 'PLAN_RETIRED' : 'INVALID_PLAN';
    throw err;
  }

  if (!CANONICAL_PLANS.includes(rawPlan)) {
    const err = new Error(`Unknown plan '${planId}'. Valid plans: ${CANONICAL_PLANS.join(', ')}.`);
    err.status = 400;
    err.code = 'INVALID_PLAN';
    throw err;
  }

  const resolvedPlanId = normalizePlanId(rawPlan, threePlan);
  const cycle = String(billingCycle || 'MONTHLY').toUpperCase() === 'YEARLY' ? 'YEARLY' : 'MONTHLY';

  const catalog = await getPlansCatalog(prisma, collegeId);
  const planMeta = catalog.plans.find((p) => p.planId === resolvedPlanId);
  if (!planMeta) {
    const err = new Error(`Plan '${resolvedPlanId}' is not available.`);
    err.status = 400;
    err.code = 'INVALID_PLAN';
    throw err;
  }

  const basePlanPricePkr = cycle === 'YEARLY' ? planMeta.yearlyPrice : planMeta.monthlyPrice;

  // Validate add-on line items against catalog for this plan
  const normalizedItems = new Map();
  for (const item of Array.isArray(lineItems) ? lineItems : []) {
    if (!item || !item.addonType) continue;
    const qty = parseInt(item.quantity, 10);
    if (!Number.isInteger(qty) || qty <= 0) {
      const err = new Error(`Invalid quantity for add-on '${item.addonType}'.`);
      err.status = 400;
      err.code = 'INVALID_ADDON_QUANTITY';
      throw err;
    }
    normalizedItems.set(item.addonType, (normalizedItems.get(item.addonType) || 0) + qty);
  }

  const validatedAddons = [];
  let addonsSubtotalPkr = 0;

  for (const [addonType, quantity] of normalizedItems.entries()) {
    const addonMeta = planMeta.addons.find((a) => a.addonType === addonType);
    if (!addonMeta || !addonMeta.isAvailable) {
      const err = new Error(`Add-on '${addonType}' is not available for the ${planMeta.name} plan.`);
      err.status = 400;
      err.code = 'INVALID_ADDON_ITEM';
      throw err;
    }
    if (!addonMeta.isPurchasable) {
      const err = new Error(`Add-on '${addonMeta.name}' is coming soon and cannot be purchased yet.`);
      err.status = 422;
      err.code = 'ITEM_NOT_PURCHASABLE';
      throw err;
    }
    if (addonMeta.maxUnitsAllowed !== null && addonMeta.maxUnitsAllowed !== undefined && quantity > addonMeta.maxUnitsAllowed) {
      const err = new Error(`Maximum allowed units for '${addonMeta.name}' on ${planMeta.name} is ${addonMeta.maxUnitsAllowed}.`);
      err.status = 400;
      err.code = 'ADDON_CAP_EXCEEDED';
      throw err;
    }

    const unitPricePkr = cycle === 'YEARLY' ? addonMeta.unitPriceYearlyPkr : addonMeta.unitPriceMonthlyPkr;
    const subtotalPkr = unitPricePkr * quantity;
    addonsSubtotalPkr += subtotalPkr;

    validatedAddons.push({
      itemType: 'ADDON',
      addonType,
      name: addonMeta.name,
      unitLabel: addonMeta.unitLabel,
      quantity,
      unitPricePkr,
      subtotalPkr,
    });
  }

  // Mid-term upgrade proration (using LOCKED CollegeSubscription price)
  let prorationCreditPkr = 0;
  let isUpgrade = false;
  const college = await prisma.college.findUnique({
    where: { id: collegeId },
    select: {
      id: true,
      name: true,
      code: true,
      planId: true,
      billingCycle: true,
      subStatus: true,
      periodEnd: true,
      activeSubscriptionId: true,
    },
  });

  const now = new Date();
  if (
    isUpgradeProrationEnabled() &&
    college &&
    college.subStatus === 'ACTIVE' &&
    college.periodEnd &&
    new Date(college.periodEnd) > now &&
    (PLAN_LEVEL[resolvedPlanId] ?? 0) > (PLAN_LEVEL[normalizePlanId(college.planId, threePlan)] ?? 0)
  ) {
    isUpgrade = true;
    let lockedSub = null;
    if (college.activeSubscriptionId && prisma.collegeSubscription?.findUnique) {
      lockedSub = await prisma.collegeSubscription.findUnique({ where: { id: college.activeSubscriptionId } }).catch(() => null);
    }
    if (!lockedSub && prisma.collegeSubscription?.findFirst) {
      lockedSub = await prisma.collegeSubscription.findFirst({
        where: { college_id: collegeId, status: 'ACTIVE' },
        orderBy: { createdAt: 'desc' },
      }).catch(() => null);
    }

    const currentPlanId = normalizePlanId(lockedSub?.planId || college.planId, threePlan);
    const currentCycle = (lockedSub?.billingCycle || college.billingCycle || 'MONTHLY').toUpperCase();
    const lockedPrice = lockedSub?.planPricePkr ?? (
      currentCycle === 'YEARLY'
        ? (PLAN_PRICING[currentPlanId]?.yearly || 0)
        : (PLAN_PRICING[currentPlanId]?.monthly || 0)
    );
    const cycleDays = currentCycle === 'YEARLY' ? 365 : 30;
    const daysRemaining = Math.max(0, Math.floor((new Date(college.periodEnd).getTime() - now.getTime()) / 86400000));

    if (daysRemaining > 0 && lockedPrice > 0) {
      const rawCredit = Math.round((lockedPrice * daysRemaining) / cycleDays);
      prorationCreditPkr = Math.min(rawCredit, basePlanPricePkr);
    }
  }

  const netPlanPkr = Math.max(0, basePlanPricePkr - prorationCreditPkr);
  const subtotalPkr = basePlanPricePkr + addonsSubtotalPkr;
  const totalPkr = netPlanPkr + addonsSubtotalPkr;

  const termLabel = cycle === 'YEARLY' ? 'Yearly' : 'Monthly';
  const addonSummary = validatedAddons.length > 0
    ? ' + ' + validatedAddons.map((a) => `${a.name} x${a.quantity}`).join(', ')
    : '';
  const purpose = `Academix subscription - ${planMeta.name} - ${termLabel}${addonSummary}`;

  const invoiceLineItems = [
    {
      itemType: isUpgrade ? 'PLAN_UPGRADE' : 'PLAN_SUBSCRIPTION',
      planId: resolvedPlanId,
      name: `${planMeta.name} Plan (${termLabel})`,
      billingCycle: cycle,
      quantity: 1,
      unitPricePkr: basePlanPricePkr,
      subtotalPkr: basePlanPricePkr,
      status: 'UNPAID',
    },
    ...validatedAddons.map((a) => ({
      ...a,
      status: 'UNPAID',
    })),
  ];

  if (prorationCreditPkr > 0) {
    invoiceLineItems.push({
      itemType: 'PRORATION_CREDIT',
      name: 'Mid-Term Upgrade Credit (Locked Term Balance)',
      quantity: 1,
      unitPricePkr: -prorationCreditPkr,
      subtotalPkr: -prorationCreditPkr,
      status: 'APPLIED',
    });
  }

  return {
    planId: resolvedPlanId,
    planName: planMeta.name,
    billingCycle: cycle,
    currency: 'PKR',
    planPricePkr: basePlanPricePkr,
    addons: validatedAddons,
    addonsSubtotalPkr,
    subtotalPkr,
    prorationCreditPkr,
    totalPkr,
    isUpgrade,
    purpose,
    lineItems: invoiceLineItems,
    bankDetails: BANK_DETAILS,
  };
}

function generateInvoiceNumber(now = new Date()) {
  const pktWall = new Date(now.getTime() + 5 * 3600 * 1000);
  const year = pktWall.getUTCFullYear();
  const suffix = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `INV-${year}-${suffix}`;
}

/**
 * Create a locked CollegeSubscription (PENDING_PAYMENT) + UNPAID PlatformInvoice.
 * Prevents double-submissions while an invoice is PENDING_REVIEW, and voids stale UNPAID drafts.
 */
async function createSubscriptionCheckout(prisma, { collegeId, userId, planId, billingCycle, lineItems, ipAddress = null }) {
  const quote = await calculateCheckoutQuote(prisma, { collegeId, planId, billingCycle, lineItems });

  // Prevent conflicting checkout while a payment proof is awaiting Super Admin review
  const pendingReviewInvoice = await prisma.platformInvoice.findFirst({
    where: { college_id: collegeId, status: 'PENDING_REVIEW' },
    orderBy: { createdAt: 'desc' },
  });
  if (pendingReviewInvoice) {
    const err = new Error(
      `Invoice ${pendingReviewInvoice.invoiceNo} is already pending Super Admin review. Please wait for review before creating a new invoice.`
    );
    err.status = 409;
    err.code = 'INVOICE_PENDING_REVIEW';
    err.invoice = pendingReviewInvoice;
    throw err;
  }

  const now = new Date();
  const dueDate = new Date(now.getTime() + INVOICE_DUE_DAYS * 86400000);
  const cycleDays = quote.billingCycle === 'YEARLY' ? 365 : 30;
  const intendedEnd = new Date(now.getTime() + cycleDays * 86400000);
  const invoiceNo = generateInvoiceNumber(now);
  const verifyToken = generateVerifyToken();

  return await prisma.$transaction(async (tx) => {
    // Void any earlier UNPAID draft invoices & pending subscriptions for this college
    await tx.platformInvoice.updateMany({
      where: { college_id: collegeId, status: { in: ['UNPAID', 'unpaid'] } },
      data: { status: 'VOID' },
    });
    await tx.collegeSubscription.updateMany({
      where: { college_id: collegeId, status: 'PENDING_PAYMENT' },
      data: { status: 'SUPERSEDED' },
    });

    const subscription = await tx.collegeSubscription.create({
      data: {
        college_id: collegeId,
        status: 'PENDING_PAYMENT',
        planId: quote.planId,
        planName: quote.planName,
        planPricePkr: quote.planPricePkr,
        addonsSnapshot: quote.addons,
        subtotalPkr: quote.subtotalPkr,
        prorationCreditPkr: quote.prorationCreditPkr,
        totalPkr: quote.totalPkr,
        currency: 'PKR',
        billingCycle: quote.billingCycle,
        startsAt: null,
        endsAt: null,
        createdBy: userId || null,
      },
    });

    const invoice = await tx.platformInvoice.create({
      data: {
        college_id: collegeId,
        subscriptionId: subscription.id,
        invoiceNo,
        planId: quote.planId,
        billingCycle: quote.billingCycle,
        purpose: quote.purpose,
        lineItems: quote.lineItems,
        currency: 'PKR',
        bankDetailsSnapshot: BANK_DETAILS,
        periodStart: now,
        periodEnd: intendedEnd,
        dueDate,
        amount: quote.totalPkr,
        status: 'UNPAID',
        verifyToken,
      },
    });

    if (tx.verifyToken?.create) {
      await tx.verifyToken.create({
        data: {
          token: verifyToken,
          college_id: collegeId,
          kind: 'invoice',
          ref_id: invoice.id,
        },
      }).catch(() => {});
    }

    await transitionCollegeSubStatus(tx, {
      collegeId,
      toStatus: 'PENDING_PAYMENT',
      actorUserId: userId || 'COLLEGE_ADMIN',
      reason: `Created subscription invoice ${invoiceNo} (${quote.planName} - ${quote.billingCycle})`,
      auditAction: 'SUBSCRIPTION_CHECKOUT_CREATED',
      ipAddress,
    });

    return { subscription, invoice, quote };
  });
}

module.exports = {
  getPlansCatalog,
  calculateCheckoutQuote,
  createSubscriptionCheckout,
  formatPlanName,
};

