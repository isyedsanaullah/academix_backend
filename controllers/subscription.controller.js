const { getSystemClient } = require('../config/prismaManager');
const {
  CANONICAL_PLANS,
  PLAN_PRICING,
  PLAN_LIMITS,
  ADDON_CATALOG_SEEDS,
  normalizePlanId
} = require('../config/planConstants');
const { isThreePlanMode } = require('../config/featureFlags');
const { getEntitlements } = require('../services/entitlements');

function getThreePlanSeed(addonType, planId) {
  if (!isThreePlanMode()) return null;
  return ADDON_CATALOG_SEEDS.find(s => s.addonType === addonType && s.planId === planId) || null;
}

function applyThreePlanAddonPolicy(row, planId) {
  if (!isThreePlanMode()) return row;
  const seed = getThreePlanSeed(row.addonType, planId);
  if (!seed) return null; // Retired (e.g., ADMINS) or invalid for plan in 3-plan mode
  return {
    ...row,
    name: seed.name,
    unitPriceMonthlyPkr: seed.unitPriceMonthlyPkr,
    unitPriceYearlyPkr: seed.unitPriceYearlyPkr,
    maxCapPercentOfBase: seed.maxCapPercentOfBase,
    maxUnitsStatic: seed.maxUnitsStatic,
    isAvailable: row.isAvailable !== false && seed.isAvailable !== false,
    isPurchasable: row.isPurchasable !== false && seed.isPurchasable !== false
  };
}

async function validateAddonLineItems(prisma, lineItems, resolvedPlanId, cycle) {
  let addonSubtotal = 0;
  const validated = [];

  if (!Array.isArray(lineItems) || lineItems.length === 0) {
    return { addonSubtotal, validated, error: null };
  }

  for (const item of lineItems) {
    if (!item.addonType || !item.quantity || item.quantity <= 0) continue;

    const threePlan = isThreePlanMode();
    const seed = threePlan ? getThreePlanSeed(item.addonType, resolvedPlanId) : null;
    if (threePlan && !seed) {
      return {
        error: {
          status: 400,
          code: 'INVALID_ADDON_ITEM',
          message: `Add-on '${item.addonType}' is not available for plan '${resolvedPlanId}'.`
        }
      };
    }

    const dbRow = await prisma.addonCatalog.findUnique({
      where: {
        addonType_planId: {
          addonType: item.addonType,
          planId: resolvedPlanId
        }
      }
    });

    const catalogRow = threePlan
      ? (dbRow ? applyThreePlanAddonPolicy(dbRow, resolvedPlanId) : seed)
      : dbRow;

    if (!catalogRow || !catalogRow.isAvailable) {
      return {
        error: {
          status: 400,
          code: 'INVALID_ADDON_ITEM',
          message: `Add-on '${item.addonType}' is not available for plan '${resolvedPlanId}'.`
        }
      };
    }

    if (catalogRow.isPurchasable === false) {
      return {
        error: {
          status: 422,
          code: 'ITEM_NOT_PURCHASABLE',
          message: `Item '${item.addonType}' is coming soon and is currently not purchasable.`
        }
      };
    }

    const unitPrice = cycle === 'YEARLY' ? catalogRow.unitPriceYearlyPkr : catalogRow.unitPriceMonthlyPkr;
    const subtotal = unitPrice * item.quantity;
    addonSubtotal += subtotal;

    validated.push({
      itemType: 'ADDON',
      addonType: item.addonType,
      name: catalogRow.name,
      quantity: item.quantity,
      unitPrice,
      subtotal
    });
  }

  return { addonSubtotal, validated, error: null };
}
const {
  getMessageCreditBalance,
  getAICreditBalance
} = require('../services/ledgerService');
const { resolvePeriodKey } = require('../services/quotaService');

/**
 * GET /api/subscription/current
 * Returns effective entitlements, quotas, balances, active add-ons, and payment status.
 */
async function getCurrentSubscription(req, res) {
  try {
    const collegeId = req.collegeId || req.user?.college_id;
    if (!collegeId) {
      return res.status(403).json({
        success: false,
        code: 'NO_COLLEGE_CONTEXT',
        message: 'No college associated with this user session.'
      });
    }

    const prisma = getSystemClient();
    const entitlements = await getEntitlements(collegeId, prisma);

    // Fetch live usage metrics
    const annualPeriod = resolvePeriodKey('applications', entitlements.annualQuotaCycleStart);
    const monthlyPeriod = resolvePeriodKey('aiQuizGenerations', null);

    const usageRows = await prisma.collegeUsage.findMany({
      where: {
        college_id: collegeId,
        period: { in: ['total', annualPeriod, monthlyPeriod] }
      }
    });

    const usageMap = {};
    for (const row of usageRows) {
      usageMap[row.metric] = Number(row.value);
    }

    // Live DB counts safeguard so trial/subscription meters are always accurate
    const [liveStudents, liveStaff, liveAdmins, liveApps] = await Promise.all([
      prisma.student?.count ? prisma.student.count({ where: { college_id: collegeId } }).catch(() => 0) : 0,
      prisma.user?.count
        ? prisma.user.count({ where: { college_id: collegeId, role: { in: ['principal', 'registrar', 'accountant', 'teacher', 'employee'] }, isActive: true } }).catch(() => 0)
        : 0,
      prisma.user?.count
        ? prisma.user.count({ where: { college_id: collegeId, role: 'admin', isActive: true } }).catch(() => 0)
        : 0,
      prisma.application?.count ? prisma.application.count({ where: { college_id: collegeId } }).catch(() => 0) : 0,
    ]);
    usageMap.students = Math.max(usageMap.students || 0, liveStudents || 0);
    usageMap.staff = Math.max(usageMap.staff || 0, liveStaff || 0);
    usageMap.admins = Math.max(usageMap.admins || 0, liveAdmins || 0);
    usageMap.applications = Math.max(usageMap.applications || 0, liveApps || 0);

    // Fetch credit balances
    const messageCredits = await getMessageCreditBalance(collegeId, prisma);
    const aiCredits = await getAICreditBalance(collegeId, prisma);

    // Fetch any pending payment requests, active locked subscription, and latest invoice
    const [pendingPayment, activeSubscription, latestInvoice] = await Promise.all([
      prisma.collegeSubscriptionPayment.findFirst({
        where: {
          college_id: collegeId,
          status: 'PENDING'
        },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.collegeSubscription?.findFirst
        ? prisma.collegeSubscription.findFirst({
            where: { college_id: collegeId, status: 'ACTIVE' },
            orderBy: { createdAt: 'desc' }
          }).catch(() => null)
        : null,
      prisma.platformInvoice?.findFirst
        ? prisma.platformInvoice.findFirst({
            where: { college_id: collegeId, status: { notIn: ['VOID', 'void'] } },
            orderBy: { createdAt: 'desc' }
          }).catch(() => null)
        : null
    ]);

    const { BANK_DETAILS } = require('../config/billingConfig');
    let priceChangedOnRenewal = null;
    if (activeSubscription) {
      const latestPv = prisma.planVersion?.findFirst
        ? await prisma.planVersion.findFirst({
            where: { planId: activeSubscription.planId },
            orderBy: { version: 'desc' }
          }).catch(() => null)
        : null;
      const livePlanPricing = PLAN_PRICING[activeSubscription.planId];
      const livePrice = activeSubscription.billingCycle === 'YEARLY'
        ? (latestPv?.pricesJson?.yearlyPkr ?? livePlanPricing?.yearly ?? null)
        : (latestPv?.pricesJson?.monthlyPkr ?? livePlanPricing?.monthly ?? null);
      if (livePrice !== null && livePrice !== activeSubscription.planPricePkr) {
        priceChangedOnRenewal = {
          lockedPlanPricePkr: activeSubscription.planPricePkr,
          currentListPlanPricePkr: livePrice,
          billingCycle: activeSubscription.billingCycle,
          planId: activeSubscription.planId
        };
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        collegeId: entitlements.collegeId,
        collegeName: entitlements.collegeName,
        planId: entitlements.planId,
        billingCycle: entitlements.billingCycle,
        subStatus: entitlements.subStatus,
        effectiveSubStatus: entitlements.effectiveSubStatus,
        isCustomQuote: Boolean(entitlements.isCustomQuote),
        customQuoteNotes: entitlements.customQuoteNotes || null,
        grandfatheredUntil: entitlements.grandfatheredUntil || null,
        grandfatherReason: entitlements.grandfatherReason || null,
        trialStartedAt: entitlements.trialStartedAt,
        trialEndsAt: entitlements.trialEndsAt,
        daysRemaining: entitlements.daysRemaining,
        isLocked: entitlements.isLocked,
        lockReason: entitlements.lockReason,
        isTrialLimits: Boolean(entitlements.isTrialLimits),
        periodStart: entitlements.periodStart,
        periodEnd: entitlements.periodEnd,
        annualQuotaCycleStart: entitlements.annualQuotaCycleStart,
        isReadOnly: entitlements.isReadOnly,
        readOnlyReason: entitlements.readOnlyReason,
        effectiveLimits: entitlements.effectiveLimits,
        usage: {
          students: usageMap.students || 0,
          staff: usageMap.staff || 0,
          admins: usageMap.admins || 0,
          campuses: usageMap.campuses || 0,
          storageBytes: usageMap.storageBytes || 0,
          applications: usageMap.applications || 0,
          emailsSent: usageMap.emailsSent || 0,
          scheduledReports: usageMap.scheduledReports || 0,
          omrSheets: usageMap.omrSheets || 0,
          aiQuizGenerations: usageMap.aiQuizGenerations || 0,
          aiNotesGenerations: usageMap.aiNotesGenerations || 0,
          documentOcr: usageMap.documentOcr || 0,
          noticeTranslation: usageMap.noticeTranslation || 0,
          askYourData: usageMap.askYourData || 0,
          exportsCsv: usageMap.exportsCsv || 0,
          exportsPdf: usageMap.exportsPdf || 0
        },
        credits: {
          messages: messageCredits,
          ai: aiCredits
        },
        activeAddons: entitlements.activeAddons,
        addonCapacity: entitlements.addonCapacity,
        activeSubscription,
        latestInvoice,
        bankDetails: BANK_DETAILS,
        priceChangedOnRenewal,
        pendingPayment,
        stats: entitlements.stats
      }
    });
  } catch (err) {
    console.error('[SubscriptionController.getCurrentSubscription] Error:', err);
    return res.status(500).json({
      success: false,
      code: 'SUBSCRIPTION_FETCH_ERROR',
      message: 'Failed to retrieve subscription and entitlement details.'
    });
  }
}

/**
 * GET /api/subscription/addon-catalog
 * Returns catalog of available add-ons for the college's plan with dynamic caps.
 */
async function getAddonCatalog(req, res) {
  try {
    const collegeId = req.collegeId || req.user?.college_id;
    if (!collegeId) {
      return res.status(403).json({
        success: false,
        code: 'NO_COLLEGE_CONTEXT',
        message: 'No college associated with this user session.'
      });
    }

    const prisma = getSystemClient();
    const entitlements = await getEntitlements(collegeId, prisma);
    const planId = entitlements.planId;
    const baseLimits = entitlements.baseLimits;

    // Fetch catalog rows for current plan tier
    const dbCatalogRows = await prisma.addonCatalog.findMany({
      where: {
        planId,
        isAvailable: true
      },
      orderBy: { addonType: 'asc' }
    });

    let catalogRows = dbCatalogRows;
    if (isThreePlanMode()) {
      const merged = new Map();
      for (const dbRow of dbCatalogRows) {
        const effective = applyThreePlanAddonPolicy(dbRow, planId);
        if (effective) merged.set(effective.addonType, effective);
      }
      for (const seed of ADDON_CATALOG_SEEDS) {
        if (seed.planId === planId && seed.isAvailable !== false && !merged.has(seed.addonType)) {
          merged.set(seed.addonType, {
            id: `seed:${seed.addonType}:${seed.planId}`,
            ...seed
          });
        }
      }
      catalogRows = Array.from(merged.values()).sort((a, b) => a.addonType.localeCompare(b.addonType));
    }

    // Compute remaining cap capacity per add-on
    const activeAddons = entitlements.activeAddons || [];
    const utilizedMap = {};
    for (const addon of activeAddons) {
      utilizedMap[addon.addonType] = (utilizedMap[addon.addonType] || 0) + addon.quantity;
    }

    const items = catalogRows.map(row => {
      let maxUnitsAllowed = row.maxUnitsStatic;

      // If percent-of-base cap is specified
      if (row.maxCapPercentOfBase) {
        if (row.addonType === 'STUDENTS') {
          maxUnitsAllowed = Math.floor(baseLimits.maxStudents * (row.maxCapPercentOfBase / 100));
        } else if (row.addonType === 'STAFF') {
          maxUnitsAllowed = Math.floor(baseLimits.maxStaff * (row.maxCapPercentOfBase / 100));
        } else if (row.addonType === 'ADMINS') {
          maxUnitsAllowed = Math.floor(baseLimits.maxAdmins * (row.maxCapPercentOfBase / 100));
        } else if (row.addonType === 'STORAGE_GB') {
          const baseGb = Math.floor(baseLimits.maxStorageBytes / 1073741824);
          maxUnitsAllowed = Math.floor(baseGb * (row.maxCapPercentOfBase / 100));
        } else if (row.addonType === 'APPLICATIONS') {
          maxUnitsAllowed = Math.floor(baseLimits.maxApplications * (row.maxCapPercentOfBase / 100));
        }
      }

      const currentUtilized = utilizedMap[row.addonType] || 0;
      const remainingUnitsAllowed = maxUnitsAllowed !== null ? Math.max(0, maxUnitsAllowed - currentUtilized) : null;

      return {
        id: row.id,
        addonType: row.addonType,
        planId: row.planId,
        name: row.name,
        unitPriceMonthlyPkr: row.unitPriceMonthlyPkr,
        unitPriceYearlyPkr: row.unitPriceYearlyPkr,
        maxUnitsAllowed,
        currentUtilized,
        remainingUnitsAllowed,
        isAvailable: row.isAvailable && (remainingUnitsAllowed === null || remainingUnitsAllowed > 0),
        isPurchasable: row.isPurchasable !== false
      };
    });

    return res.status(200).json({
      success: true,
      data: {
        planId,
        items
      }
    });
  } catch (err) {
    console.error('[SubscriptionController.getAddonCatalog] Error:', err);
    return res.status(500).json({
      success: false,
      code: 'ADDON_CATALOG_FETCH_ERROR',
      message: 'Failed to retrieve add-on catalog.'
    });
  }
}

/**
 * POST /api/subscription/submit-payment
 * Accepts manual payment proof submission for renewal, upgrade, or add-ons.
 */
async function submitPaymentProof(req, res) {
  try {
    const collegeId = req.collegeId || req.user?.college_id;
    if (!collegeId) {
      return res.status(403).json({
        success: false,
        code: 'NO_COLLEGE_CONTEXT',
        message: 'No college associated with this user session.'
      });
    }

    const {
      type = 'RENEWAL', // RENEWAL, UPGRADE, ADDON_ORDER
      planId: targetPlanId,
      billingCycle: targetCycle = 'MONTHLY',
      lineItems = [],
      amountPaid,
      paymentMethod,
      transactionId,
      screenshotUrl
    } = req.body;

    // 1. Validation of required receipt fields
    if (!paymentMethod || !paymentMethod.trim()) {
      return res.status(400).json({
        success: false,
        code: 'MISSING_PAYMENT_METHOD',
        message: 'Payment method is required (e.g. Bank Transfer, EasyPaisa, JazzCash).'
      });
    }

    if (!transactionId || !transactionId.trim()) {
      return res.status(400).json({
        success: false,
        code: 'MISSING_TRANSACTION_ID',
        message: 'Bank transaction ID / Reference number is required.'
      });
    }

    if (!screenshotUrl || !screenshotUrl.trim()) {
      return res.status(400).json({
        success: false,
        code: 'MISSING_SCREENSHOT',
        message: 'Payment proof screenshot URL is required.'
      });
    }

    const cleanTid = transactionId.trim();
    const cleanMethod = paymentMethod.trim();
    const prisma = getSystemClient();

    // 2. Prevent duplicate pending/approved transaction IDs for same method
    const existingPayment = await prisma.collegeSubscriptionPayment.findFirst({
      where: {
        paymentMethod: cleanMethod,
        transactionId: cleanTid,
        status: { in: ['PENDING', 'APPROVED'] }
      }
    });

    if (existingPayment) {
      return res.status(409).json({
        success: false,
        code: 'TRANSACTION_ALREADY_EXISTS',
        message: `A payment with transaction ID '${cleanTid}' under method '${cleanMethod}' has already been submitted and is currently ${existingPayment.status}.`
      });
    }

    // 3. Compute expected amount dynamically from plans and catalog
    if (isThreePlanMode() && String(targetPlanId || '').toLowerCase() === 'enterprise') {
      return res.status(400).json({
        success: false,
        code: 'PLAN_RETIRED',
        message: 'The Enterprise plan is retired under Three-Plan Mode. Select Starter, Standard, or Premium.'
      });
    }
    const entitlements = await getEntitlements(collegeId, prisma);
    const resolvedPlanId = normalizePlanId(targetPlanId || entitlements.planId);
    const cycle = targetCycle.toUpperCase() === 'YEARLY' ? 'YEARLY' : 'MONTHLY';

    let expectedAmount = 0;
    const validatedLineItems = [];

    // If RENEWAL or UPGRADE, base subscription is part of expected amount
    if (type === 'RENEWAL' || type === 'UPGRADE') {
      const planPrice = cycle === 'YEARLY'
        ? PLAN_PRICING[resolvedPlanId].yearly
        : PLAN_PRICING[resolvedPlanId].monthly;

      let netPlanPrice = planPrice;
      if (type === 'UPGRADE' && entitlements.subStatus === 'ACTIVE' && entitlements.periodEnd && new Date(entitlements.periodEnd) > new Date()) {
        const msRemaining = Math.max(0, new Date(entitlements.periodEnd).getTime() - Date.now());
        const daysRemaining = Math.floor(msRemaining / (1000 * 60 * 60 * 24));
        const currentCycleDays = entitlements.billingCycle === 'YEARLY' ? 365 : 30;
        const currentPlanPrice = entitlements.billingCycle === 'YEARLY'
          ? PLAN_PRICING[entitlements.planId]?.yearly || 0
          : PLAN_PRICING[entitlements.planId]?.monthly || 0;

        if (daysRemaining > 0 && currentPlanPrice > 0) {
          const rawCredit = Math.round((currentPlanPrice * daysRemaining) / currentCycleDays);
          const prorationCredit = Math.min(rawCredit, planPrice);
          netPlanPrice = Math.max(0, planPrice - prorationCredit);
        }
      }

      expectedAmount += netPlanPrice;
      validatedLineItems.push({
        itemType: type === 'UPGRADE' ? 'PLAN_UPGRADE' : 'PLAN_SUBSCRIPTION',
        planId: resolvedPlanId,
        billingCycle: cycle,
        quantity: 1,
        unitPrice: planPrice,
        subtotal: netPlanPrice
      });
    }

    // Process line items for Add-Ons and Credit Packs
    const addonCheck = await validateAddonLineItems(prisma, lineItems, resolvedPlanId, cycle);
    if (addonCheck.error) {
      return res.status(addonCheck.error.status).json({
        success: false,
        code: addonCheck.error.code,
        message: addonCheck.error.message
      });
    }
    expectedAmount += addonCheck.addonSubtotal;
    validatedLineItems.push(...addonCheck.validated);

    const actualPaid = typeof amountPaid === 'number' ? Math.round(amountPaid) : expectedAmount;
    const submittedBy = req.user?.email || req.user?.id || 'college-admin';

    // 4. Create pending payment record
    const payment = await prisma.collegeSubscriptionPayment.create({
      data: {
        college_id: collegeId,
        type,
        planId: resolvedPlanId,
        billingCycle: cycle,
        lineItems: validatedLineItems,
        expectedAmount,
        amountPaid: actualPaid,
        paymentMethod: cleanMethod,
        transactionId: cleanTid,
        screenshotUrl: screenshotUrl.trim(),
        status: 'PENDING',
        submittedBy
      }
    });

    return res.status(201).json({
      success: true,
      message: 'Payment proof submitted successfully. Awaiting Super Admin verification.',
      data: payment
    });
  } catch (err) {
    console.error('[SubscriptionController.submitPaymentProof] Error:', err);
    return res.status(500).json({
      success: false,
      code: 'PAYMENT_SUBMIT_ERROR',
      message: 'Failed to submit payment proof.'
    });
  }
}

/**
 * POST /api/subscription/calculate-total
 * Computes exact expected integer PKR amount server-side for renewals, upgrades, and add-ons.
 * Includes proration credit calculation for plan upgrades.
 */
async function calculateTotal(req, res) {
  try {
    const collegeId = req.collegeId || req.user?.college_id;
    if (!collegeId) {
      return res.status(403).json({
        success: false,
        code: 'NO_COLLEGE_CONTEXT',
        message: 'No college associated with this user session.'
      });
    }

    const {
      type = 'RENEWAL', // RENEWAL, UPGRADE, ADDON_ORDER
      planId: targetPlanId,
      billingCycle: targetCycle = 'MONTHLY',
      lineItems = []
    } = req.body;

    if (isThreePlanMode() && String(targetPlanId || '').toLowerCase() === 'enterprise') {
      return res.status(400).json({
        success: false,
        code: 'PLAN_RETIRED',
        message: 'The Enterprise plan is retired under Three-Plan Mode. Select Starter, Standard, or Premium.'
      });
    }
    const prisma = getSystemClient();
    const entitlements = await getEntitlements(collegeId, prisma);
    const resolvedPlanId = normalizePlanId(targetPlanId || entitlements.planId);
    const cycle = targetCycle.toUpperCase() === 'YEARLY' ? 'YEARLY' : 'MONTHLY';

    let basePlanAmount = 0;
    let prorationCredit = 0;
    const validatedLineItems = [];

    // Calculate Base Plan Amount if Renewal or Upgrade
    if (type === 'RENEWAL' || type === 'UPGRADE') {
      const planPrice = cycle === 'YEARLY'
        ? PLAN_PRICING[resolvedPlanId].yearly
        : PLAN_PRICING[resolvedPlanId].monthly;
      basePlanAmount = planPrice;

      // If upgrade during active paid period, compute proration credit from LOCKED subscription price (if enabled)
      const { isUpgradeProrationEnabled } = require('../config/billingConfig');
      if (
        isUpgradeProrationEnabled() &&
        type === 'UPGRADE' &&
        entitlements.subStatus === 'ACTIVE' &&
        entitlements.periodEnd &&
        new Date(entitlements.periodEnd) > new Date()
      ) {
        const msRemaining = Math.max(0, new Date(entitlements.periodEnd).getTime() - Date.now());
        const daysRemaining = Math.floor(msRemaining / (1000 * 60 * 60 * 24));
        const lockedSub = prisma.collegeSubscription?.findFirst
          ? await prisma.collegeSubscription.findFirst({
              where: { college_id: collegeId, status: 'ACTIVE' },
              orderBy: { createdAt: 'desc' }
            }).catch(() => null)
          : null;
        const currentCycle = (lockedSub?.billingCycle || entitlements.billingCycle || 'MONTHLY').toUpperCase();
        const currentCycleDays = currentCycle === 'YEARLY' ? 365 : 30;
        const currentPlanPrice = lockedSub?.planPricePkr ?? (
          currentCycle === 'YEARLY'
            ? PLAN_PRICING[entitlements.planId]?.yearly || 0
            : PLAN_PRICING[entitlements.planId]?.monthly || 0
        );

        if (daysRemaining > 0 && currentPlanPrice > 0) {
          const rawCredit = Math.round((currentPlanPrice * daysRemaining) / currentCycleDays);
          prorationCredit = Math.min(rawCredit, basePlanAmount);
        }
      }

      validatedLineItems.push({
        itemType: type === 'UPGRADE' ? 'PLAN_UPGRADE' : 'PLAN_SUBSCRIPTION',
        planId: resolvedPlanId,
        billingCycle: cycle,
        unitPrice: planPrice,
        subtotal: Math.max(0, planPrice - prorationCredit)
      });
    }

    // Process line items for Add-Ons and Credit Packs
    const addonCheck = await validateAddonLineItems(prisma, lineItems, resolvedPlanId, cycle);
    if (addonCheck.error) {
      return res.status(addonCheck.error.status).json({
        success: false,
        code: addonCheck.error.code,
        message: addonCheck.error.message
      });
    }
    const addonSubtotal = addonCheck.addonSubtotal;
    validatedLineItems.push(...addonCheck.validated);

    const netBaseAmount = Math.max(0, basePlanAmount - prorationCredit);
    const expectedAmount = netBaseAmount + addonSubtotal;

    return res.status(200).json({
      success: true,
      data: {
        type,
        planId: resolvedPlanId,
        billingCycle: cycle,
        basePlanAmount,
        prorationCredit,
        netBaseAmount,
        addonSubtotal,
        expectedAmount,
        lineItems: validatedLineItems
      }
    });
  } catch (err) {
    console.error('[SubscriptionController.calculateTotal] Error:', err);
    return res.status(500).json({
      success: false,
      code: 'CALCULATE_TOTAL_ERROR',
      message: 'Failed to calculate subscription order total.'
    });
  }
}

/**
 * GET /api/subscription/payment-history
 * Returns the history of subscription payment submissions.
 */
async function getPaymentHistory(req, res) {
  try {
    const collegeId = req.collegeId || req.user?.college_id;
    if (!collegeId) {
      return res.status(403).json({
        success: false,
        code: 'NO_COLLEGE_CONTEXT',
        message: 'No college associated with this user session.'
      });
    }

    const prisma = getSystemClient();
    const payments = await prisma.collegeSubscriptionPayment.findMany({
      where: { college_id: collegeId },
      orderBy: { createdAt: 'desc' }
    });

    return res.status(200).json({
      success: true,
      data: payments
    });
  } catch (err) {
    console.error('[SubscriptionController.getPaymentHistory] Error:', err);
    return res.status(500).json({
      success: false,
      code: 'PAYMENT_HISTORY_FETCH_ERROR',
      message: 'Failed to retrieve payment history.'
    });
  }
}

/**
 * GET /api/subscription/plans-catalog
 * Returns live canonical plans, limits, services, add-ons, and UBL bank config.
 */
async function getPlansCatalogHandler(req, res) {
  try {
    const collegeId = req.collegeId || req.user?.college_id || null;
    const prisma = getSystemClient();
    const { getPlansCatalog } = require('../services/subscriptionBillingService');
    const catalog = await getPlansCatalog(prisma, collegeId);
    return res.status(200).json({ success: true, data: catalog });
  } catch (err) {
    console.error('[SubscriptionController.getPlansCatalogHandler] Error:', err);
    return res.status(500).json({
      success: false,
      code: 'PLANS_CATALOG_ERROR',
      message: 'Failed to retrieve plans catalog.'
    });
  }
}

/**
 * POST /api/subscription/checkout
 * Confirms plan + billing cycle + add-ons, creates locked CollegeSubscription & UNPAID PlatformInvoice.
 */
async function checkoutSubscriptionHandler(req, res) {
  try {
    const collegeId = req.collegeId || req.user?.college_id;
    if (!collegeId) {
      return res.status(403).json({ success: false, code: 'NO_COLLEGE_CONTEXT', message: 'No college associated with this user session.' });
    }

    const { planId, billingCycle = 'MONTHLY', lineItems = [] } = req.body || {};
    const prisma = getSystemClient();
    const { createSubscriptionCheckout } = require('../services/subscriptionBillingService');

    const result = await createSubscriptionCheckout(prisma, {
      collegeId,
      userId: req.user?.id || req.user?._id,
      planId,
      billingCycle,
      lineItems,
      ipAddress: req.ip || null
    });

    return res.status(201).json({
      success: true,
      message: `Invoice ${result.invoice.invoiceNo} generated. Please download the 3-copy bank voucher and upload your payment proof.`,
      data: result
    });
  } catch (err) {
    if (err.status && err.status < 500) {
      return res.status(err.status).json({
        success: false,
        code: err.code || 'CHECKOUT_VALIDATION_ERROR',
        message: err.message,
        ...(err.invoice ? { invoice: err.invoice } : {})
      });
    }
    console.error('[SubscriptionController.checkoutSubscriptionHandler] Error:', err);
    return res.status(500).json({
      success: false,
      code: 'CHECKOUT_ERROR',
      message: 'Failed to create subscription checkout invoice.'
    });
  }
}

/**
 * GET /api/subscription/invoices
 * Lists college's subscription invoices with proof submissions & locked subscription snapshot.
 */
async function getCollegeInvoicesHandler(req, res) {
  try {
    const collegeId = req.collegeId || req.user?.college_id;
    if (!collegeId) {
      return res.status(403).json({ success: false, code: 'NO_COLLEGE_CONTEXT', message: 'No college associated with this user session.' });
    }

    const prisma = getSystemClient();
    const invoices = await prisma.platformInvoice.findMany({
      where: { college_id: collegeId },
      orderBy: { createdAt: 'desc' },
      take: 50
    });

    const invoiceIds = invoices.map((i) => i.id);
    const subIds = invoices.map((i) => i.subscriptionId).filter(Boolean);

    const [submissions, subscriptions] = await Promise.all([
      invoiceIds.length > 0 && prisma.invoiceProofSubmission?.findMany
        ? prisma.invoiceProofSubmission.findMany({
            where: { invoiceId: { in: invoiceIds }, college_id: collegeId },
            orderBy: { createdAt: 'desc' }
          })
        : [],
      subIds.length > 0 && prisma.collegeSubscription?.findMany
        ? prisma.collegeSubscription.findMany({
            where: { id: { in: subIds }, college_id: collegeId }
          })
        : []
    ]);

    const subMap = new Map((subscriptions || []).map((s) => [s.id, s]));
    const subsByInvoice = new Map();
    for (const s of submissions || []) {
      if (!subsByInvoice.has(s.invoiceId)) subsByInvoice.set(s.invoiceId, []);
      subsByInvoice.get(s.invoiceId).push(s);
    }

    const enriched = invoices.map((inv) => ({
      ...inv,
      amountPkr: Number(inv.amount || 0),
      subscription: inv.subscriptionId ? subMap.get(inv.subscriptionId) || null : null,
      submissions: subsByInvoice.get(inv.id) || []
    }));

    return res.status(200).json({ success: true, data: enriched });
  } catch (err) {
    console.error('[SubscriptionController.getCollegeInvoicesHandler] Error:', err);
    return res.status(500).json({
      success: false,
      code: 'INVOICES_FETCH_ERROR',
      message: 'Failed to retrieve billing invoices.'
    });
  }
}

/**
 * GET /api/subscription/invoices/:id/voucher.pdf
 * Streams the 3-copy UBL Bank Payment Voucher PDF (Bank Copy, College Copy, Accounts/Office Copy).
 */
async function downloadInvoiceVoucherPdfHandler(req, res, next) {
  try {
    const collegeId = req.collegeId || req.user?.college_id;
    const { id } = req.params;
    const prisma = getSystemClient();

    const invoice = await prisma.platformInvoice.findFirst({
      where: { id, college_id: collegeId }
    });
    if (!invoice) {
      return res.status(404).json({ success: false, code: 'INVOICE_NOT_FOUND', message: 'Invoice not found.' });
    }

    const college = await prisma.college.findUnique({
      where: { id: collegeId },
      select: { id: true, name: true, code: true, email: true, city: true }
    });

    const { generateSubscriptionVoucherPDF } = require('../services/documentTemplates/subscriptionVoucher');
    const { getFrontendBaseUrl } = require('../config/env');

    const pdfDoc = await generateSubscriptionVoucherPDF({
      invoice,
      college,
      verifyBaseUrl: getFrontendBaseUrl()
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="voucher_${invoice.invoiceNo}.pdf"`);
    res.setHeader('Cache-Control', 'no-store');

    pdfDoc.pipe(res);
    pdfDoc.end();
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/subscription/invoices/:id/proof
 * Uploads screenshot/PDF to Cloudflare R2 (max 5 MB, JPG/PNG/PDF) + optional referenceNumber & note.
 */
async function uploadInvoiceProofHandler(req, res) {
  try {
    const collegeId = req.collegeId || req.user?.college_id;
    if (!collegeId) {
      return res.status(403).json({ success: false, code: 'NO_COLLEGE_CONTEXT', message: 'No college associated with this user session.' });
    }

    const { id } = req.params;
    const { referenceNumber, note } = req.body || {};
    const prisma = getSystemClient();

    const invoice = await prisma.platformInvoice.findFirst({
      where: { id, college_id: collegeId }
    });
    if (!invoice) {
      return res.status(404).json({ success: false, code: 'INVOICE_NOT_FOUND', message: 'Invoice not found.' });
    }

    const currentStatus = String(invoice.status || '').toUpperCase();
    if (currentStatus === 'PENDING_REVIEW') {
      return res.status(409).json({
        success: false,
        code: 'ALREADY_PENDING_REVIEW',
        message: 'Payment proof for this invoice is already awaiting Super Admin review.'
      });
    }
    if (currentStatus === 'APPROVED' || currentStatus === 'PAID') {
      return res.status(400).json({
        success: false,
        code: 'INVOICE_ALREADY_APPROVED',
        message: 'This invoice has already been approved.'
      });
    }
    if (currentStatus === 'VOID') {
      return res.status(400).json({
        success: false,
        code: 'INVOICE_VOID',
        message: 'This invoice has been voided. Please generate a new voucher.'
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        code: 'MISSING_PROOF_FILE',
        message: 'Please attach a payment screenshot or PDF receipt (JPG, PNG, or PDF, max 5 MB).'
      });
    }

    const { PROOF_ALLOWED_MIMES, PROOF_UPLOAD_MAX_BYTES } = require('../config/billingConfig');
    if (!PROOF_ALLOWED_MIMES.includes(req.file.mimetype)) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_FILE_TYPE',
        message: 'Only JPG, PNG, or PDF files are allowed.'
      });
    }
    if (req.file.size > PROOF_UPLOAD_MAX_BYTES) {
      return res.status(400).json({
        success: false,
        code: 'FILE_TOO_LARGE',
        message: 'Payment proof file must be 5 MB or smaller.'
      });
    }

    const {
      uploadObject,
      generateObjectKey,
      validateFileSignature
    } = require('../services/storageService');

    const sigCheck = validateFileSignature(req.file.buffer, req.file.mimetype);
    if (!sigCheck.valid) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_FILE_SIGNATURE',
        message: sigCheck.error || 'File contents do not match its file extension/MIME type.'
      });
    }

    const cleanRef = typeof referenceNumber === 'string' && referenceNumber.trim()
      ? referenceNumber.trim().slice(0, 80)
      : null;
    const cleanNote = typeof note === 'string' && note.trim()
      ? note.trim().slice(0, 500)
      : null;

    if (cleanRef) {
      const dup = await prisma.platformInvoice.findFirst({
        where: {
          id: { not: invoice.id },
          referenceNumber: cleanRef,
          status: { in: ['PENDING_REVIEW', 'APPROVED'] }
        }
      });
      if (dup) {
        return res.status(409).json({
          success: false,
          code: 'DUPLICATE_REFERENCE',
          message: `Reference number '${cleanRef}' has already been submitted on another invoice.`
        });
      }
    }

    const objectKey = generateObjectKey(collegeId, 'billing-proofs', invoice.id, req.file.originalname || 'proof.png');
    await uploadObject({
      objectKey,
      body: req.file.buffer,
      contentType: req.file.mimetype,
      metadata: {
        collegeId,
        invoiceId: invoice.id,
        invoiceNo: invoice.invoiceNo
      }
    });

    const now = new Date();
    const submittedBy = req.user?.email || req.user?.id || 'college-admin';

    const updated = await prisma.$transaction(async (tx) => {
      await tx.invoiceProofSubmission.create({
        data: {
          invoiceId: invoice.id,
          college_id: collegeId,
          objectKey,
          mimeType: req.file.mimetype,
          sizeBytes: req.file.size,
          referenceNumber: cleanRef,
          note: cleanNote,
          status: 'PENDING_REVIEW',
          submittedBy
        }
      });

      const inv = await tx.platformInvoice.update({
        where: { id: invoice.id },
        data: {
          status: 'PENDING_REVIEW',
          method: 'bank',
          reference: cleanRef,
          referenceNumber: cleanRef,
          submissionNote: cleanNote,
          rejectionReason: null,
          proofObjectKey: objectKey,
          proofMimeType: req.file.mimetype,
          proofSizeBytes: req.file.size,
          submittedAt: now,
          submittedBy
        }
      });

      if (tx.collegeEntitlementAudit?.create) {
        await tx.collegeEntitlementAudit.create({
          data: {
            college_id: collegeId,
            actorUserId: String(req.user?.id || 'college-admin'),
            actorEmail: req.user?.email || null,
            action: 'INVOICE_PROOF_SUBMITTED',
            beforeStateJson: { status: invoice.status },
            afterStateJson: { status: 'PENDING_REVIEW', invoiceNo: invoice.invoiceNo, referenceNumber: cleanRef },
            reason: cleanNote || `Payment proof uploaded for ${invoice.invoiceNo}`,
            ipAddress: req.ip || null
          }
        });
      }

      return inv;
    });

    // Post-commit Super Admin notifications (in-app + email)
    try {
      const [college, superAdmins] = await Promise.all([
        prisma.college.findUnique({ where: { id: collegeId }, select: { name: true } }),
        prisma.user.findMany({ where: { role: 'superAdmin', isActive: true }, select: { id: true, email: true } })
      ]);

      if (superAdmins.length > 0) {
        await prisma.notification.createMany({
          data: superAdmins.map((sa) => ({
            college_id: collegeId,
            recipient: sa.id,
            title: `Payment Proof Submitted: ${invoice.invoiceNo}`,
            message: `${college?.name || 'A college'} uploaded bank transfer proof for PKR ${Number(invoice.amount || 0).toLocaleString('en-PK')}.`,
            type: 'system',
            link: '/super-admin/billing'
          }))
        }).catch(() => {});
      }

      const { getFrontendBaseUrl } = require('../config/env');
      const { sendBillingProofSubmittedEmail } = require('../services/mailService');
      const notifyEmail = process.env.SUPER_ADMIN_EMAIL || superAdmins[0]?.email;
      if (notifyEmail) {
        await sendBillingProofSubmittedEmail(notifyEmail, {
          collegeName: college?.name || 'College',
          invoiceNo: invoice.invoiceNo,
          amountPkr: Number(invoice.amount || 0),
          referenceNumber: cleanRef,
          note: cleanNote,
          reviewUrl: `${getFrontendBaseUrl()}/super-admin/billing`
        }).catch((e) => console.error('[BillingProof] Email notify failed:', e.message));
      }
    } catch (notifyErr) {
      console.error('[BillingProof] Super admin notification error:', notifyErr.message);
    }

    return res.status(200).json({
      success: true,
      message: 'Payment proof sent to Super Admin for verification.',
      data: updated
    });
  } catch (err) {
    console.error('[SubscriptionController.uploadInvoiceProofHandler] Error:', err);
    return res.status(500).json({
      success: false,
      code: 'PROOF_UPLOAD_ERROR',
      message: 'Failed to upload payment proof.'
    });
  }
}

/**
 * GET /api/subscription/invoices/:id/proof-url
 * Returns a short-lived presigned R2 URL for the college admin to preview their uploaded proof.
 */
async function getInvoiceProofUrlHandler(req, res) {
  try {
    const collegeId = req.collegeId || req.user?.college_id;
    const { id } = req.params;
    const prisma = getSystemClient();

    const invoice = await prisma.platformInvoice.findFirst({
      where: { id, college_id: collegeId }
    });
    if (!invoice || !invoice.proofObjectKey) {
      return res.status(404).json({ success: false, message: 'Payment proof not found.' });
    }

    const { getPresignedDownloadUrl } = require('../services/storageService');
    const url = await getPresignedDownloadUrl({ objectKey: invoice.proofObjectKey, expiresIn: 900 });
    return res.status(200).json({
      success: true,
      url,
      mimeType: invoice.proofMimeType || null,
      expiresIn: 900
    });
  } catch (err) {
    console.error('[SubscriptionController.getInvoiceProofUrlHandler] Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to generate proof preview URL.' });
  }
}

module.exports = {
  getCurrentSubscription,
  getAddonCatalog,
  getPlansCatalogHandler,
  calculateTotal,
  checkoutSubscriptionHandler,
  getCollegeInvoicesHandler,
  downloadInvoiceVoucherPdfHandler,
  uploadInvoiceProofHandler,
  getInvoiceProofUrlHandler,
  submitPaymentProof,
  getPaymentHistory
};

