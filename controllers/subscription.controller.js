const { getSystemClient } = require('../config/prismaManager');
const {
  CANONICAL_PLANS,
  PLAN_PRICING,
  PLAN_LIMITS,
  normalizePlanId
} = require('../config/planConstants');
const { getEntitlements } = require('../services/entitlements');
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

    // Fetch credit balances
    const messageCredits = await getMessageCreditBalance(collegeId, prisma);
    const aiCredits = await getAICreditBalance(collegeId, prisma);

    // Fetch any pending payment requests
    const pendingPayment = await prisma.collegeSubscriptionPayment.findFirst({
      where: {
        college_id: collegeId,
        status: 'PENDING'
      },
      orderBy: { createdAt: 'desc' }
    });

    return res.status(200).json({
      success: true,
      data: {
        collegeId: entitlements.collegeId,
        collegeName: entitlements.collegeName,
        planId: entitlements.planId,
        billingCycle: entitlements.billingCycle,
        subStatus: entitlements.subStatus,
        trialEndsAt: entitlements.trialEndsAt,
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
    const catalogRows = await prisma.addonCatalog.findMany({
      where: {
        planId,
        isAvailable: true
      },
      orderBy: { addonType: 'asc' }
    });

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
        isAvailable: row.isAvailable && (remainingUnitsAllowed === null || remainingUnitsAllowed > 0)
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
    if (Array.isArray(lineItems) && lineItems.length > 0) {
      for (const item of lineItems) {
        if (!item.addonType || !item.quantity || item.quantity <= 0) continue;

        const catalogRow = await prisma.addonCatalog.findUnique({
          where: {
            addonType_planId: {
              addonType: item.addonType,
              planId: resolvedPlanId
            }
          }
        });

        if (!catalogRow || !catalogRow.isAvailable) {
          return res.status(400).json({
            success: false,
            code: 'INVALID_ADDON_ITEM',
            message: `Add-on '${item.addonType}' is not available for plan '${resolvedPlanId}'.`
          });
        }

        const unitPrice = cycle === 'YEARLY' ? catalogRow.unitPriceYearlyPkr : catalogRow.unitPriceMonthlyPkr;
        const subtotal = unitPrice * item.quantity;
        expectedAmount += subtotal;

        validatedLineItems.push({
          itemType: 'ADDON',
          addonType: item.addonType,
          name: catalogRow.name,
          quantity: item.quantity,
          unitPrice,
          subtotal
        });
      }
    }

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

      // If upgrade during active paid period, compute proration credit of current unexpired plan
      if (type === 'UPGRADE' && entitlements.subStatus === 'ACTIVE' && entitlements.periodEnd && new Date(entitlements.periodEnd) > new Date()) {
        const msRemaining = Math.max(0, new Date(entitlements.periodEnd).getTime() - Date.now());
        const daysRemaining = Math.floor(msRemaining / (1000 * 60 * 60 * 24));
        const currentCycleDays = entitlements.billingCycle === 'YEARLY' ? 365 : 30;
        const currentPlanPrice = entitlements.billingCycle === 'YEARLY'
          ? PLAN_PRICING[entitlements.planId]?.yearly || 0
          : PLAN_PRICING[entitlements.planId]?.monthly || 0;

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
    let addonSubtotal = 0;
    if (Array.isArray(lineItems) && lineItems.length > 0) {
      for (const item of lineItems) {
        if (!item.addonType || !item.quantity || item.quantity <= 0) continue;

        const catalogRow = await prisma.addonCatalog.findUnique({
          where: {
            addonType_planId: {
              addonType: item.addonType,
              planId: resolvedPlanId
            }
          }
        });

        if (!catalogRow || !catalogRow.isAvailable) {
          return res.status(400).json({
            success: false,
            code: 'INVALID_ADDON_ITEM',
            message: `Add-on '${item.addonType}' is not available for plan '${resolvedPlanId}'.`
          });
        }

        const unitPrice = cycle === 'YEARLY' ? catalogRow.unitPriceYearlyPkr : catalogRow.unitPriceMonthlyPkr;
        const subtotal = unitPrice * item.quantity;
        addonSubtotal += subtotal;

        validatedLineItems.push({
          itemType: 'ADDON',
          addonType: item.addonType,
          name: catalogRow.name,
          quantity: item.quantity,
          unitPrice,
          subtotal
        });
      }
    }

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

module.exports = {
  getCurrentSubscription,
  getAddonCatalog,
  calculateTotal,
  submitPaymentProof,
  getPaymentHistory
};

