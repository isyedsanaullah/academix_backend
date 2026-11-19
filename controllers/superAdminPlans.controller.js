/**
 * superAdminPlans.controller.js — Phase 6C Plan Versioning
 * Manages plan versions, pricing, and limits without breaking existing pinned college subscriptions.
 */

const { getSystemClient } = require('../config/prismaManager');
const { PLAN_PRICING, PLAN_LIMITS, CANONICAL_PLANS } = require('../config/planConstants');

/**
 * GET /api/super-admin/plans
 * Returns the 3 fixed plans (Starter, Standard, Premium), their active versions,
 * pricing, limits, and pinned college counts.
 */
async function getPlans(req, res) {
  try {
    const prisma = getSystemClient();

    // Fetch all plan versions sorted by version desc
    const allVersions = await prisma.planVersion.findMany({
      where: { planId: { in: ['starter', 'standard', 'premium'] } },
      orderBy: [{ planId: 'asc' }, { version: 'desc' }]
    });

    // Fetch colleges count per planVersionId & per planId
    const [collegeCounts, planCollegeCounts] = await Promise.all([
      prisma.college.groupBy({
        by: ['planVersionId'],
        _count: { id: true }
      }),
      prisma.college.groupBy({
        by: ['planId'],
        _count: { id: true }
      })
    ]);

    const countMap = {};
    for (const c of collegeCounts) {
      if (c.planVersionId) countMap[c.planVersionId] = c._count.id;
    }
    const planCountMap = {};
    for (const c of planCollegeCounts) {
      const k = String(c.planId || '').toLowerCase();
      if (k) planCountMap[k] = (planCountMap[k] || 0) + c._count.id;
    }

    const plansMap = {
      starter: { id: 'starter', name: 'Starter', versions: [] },
      standard: { id: 'standard', name: 'Standard', versions: [] },
      premium: { id: 'premium', name: 'Premium', versions: [] }
    };

    for (const pv of allVersions) {
      const planKey = String(pv.planId || '').toLowerCase();
      if (!plansMap[planKey]) continue;
      plansMap[planKey].versions.push({
        ...pv,
        monthlyPricePkr: pv.pricesJson?.monthlyPkr ?? PLAN_PRICING[planKey]?.monthly ?? 0,
        yearlyPricePkr: pv.pricesJson?.yearlyPkr ?? PLAN_PRICING[planKey]?.yearly ?? 0,
        activeCollegeCount: countMap[pv.id] || 0
      });
    }

    const plans = CANONICAL_PLANS.map(planId => {
      const p = plansMap[planId] || { id: planId, name: planId, versions: [] };
      const current = p.versions[0] || null;
      const fallbackPrice = PLAN_PRICING[planId] || { monthly: 0, yearly: 0 };
      return {
        ...p,
        totalCollegesOnPlan: planCountMap[planId] || 0,
        currentVersion: current ? current.version : 0,
        currentPrices: {
          monthly: current?.pricesJson?.monthlyPkr ?? fallbackPrice.monthly,
          yearly: current?.pricesJson?.yearlyPkr ?? fallbackPrice.yearly
        },
        currentLimits: current ? current.limitsJson : (PLAN_LIMITS[planId] || {}),
        history: p.versions
      };
    });

    return res.json({ success: true, plans });
  } catch (error) {
    console.error('[getPlans] Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve plans', error: error.message });
  }
}

/**
 * PUT /api/super-admin/plans/:planId
 * Creates a new PlanVersion for Starter, Standard, or Premium.
 * Existing active colleges stay price-locked until renewal.
 */
async function updatePlanVersion(req, res) {
  try {
    const prisma = getSystemClient();
    const { planId } = req.params;
    const { monthlyPricePkr, yearlyPricePkr, limitsJson, effectiveFrom } = req.body;

    const normalizedPlanId = String(planId || '').toLowerCase().trim();
    if (!CANONICAL_PLANS.includes(normalizedPlanId)) {
      return res.status(400).json({
        success: false,
        message: `Invalid planId '${planId}'. Only fixed plans are allowed: ${CANONICAL_PLANS.join(', ')}.`
      });
    }

    const latestVersion = await prisma.planVersion.findFirst({
      where: { planId: normalizedPlanId },
      orderBy: { version: 'desc' }
    });

    const nextVersionNumber = latestVersion ? latestVersion.version + 1 : 1;
    const fallbackPrice = PLAN_PRICING[normalizedPlanId] || { monthly: 0, yearly: 0 };
    const nextMonthly = monthlyPricePkr !== undefined ? Math.max(0, Number(monthlyPricePkr) || 0)
      : (latestVersion?.pricesJson?.monthlyPkr ?? fallbackPrice.monthly);
    const nextYearly = yearlyPricePkr !== undefined ? Math.max(0, Number(yearlyPricePkr) || 0)
      : (latestVersion?.pricesJson?.yearlyPkr ?? fallbackPrice.yearly);

    const affectedCollegesCount = await prisma.college.count({
      where: { planId: normalizedPlanId }
    });

    const newVersion = await prisma.planVersion.create({
      data: {
        planId: normalizedPlanId,
        version: nextVersionNumber,
        pricesJson: { monthlyPkr: nextMonthly, yearlyPkr: nextYearly },
        limitsJson: limitsJson || latestVersion?.limitsJson || PLAN_LIMITS[normalizedPlanId] || {},
        effectiveFrom: effectiveFrom ? new Date(effectiveFrom) : new Date(),
        createdBy: String(req.user?.id || 'superAdmin')
      }
    });

    // Keep base Subscription row price synced as well
    await prisma.subscription.updateMany({
      where: { planId: normalizedPlanId },
      data: { price: { monthly: nextMonthly, yearly: nextYearly, currency: 'PKR' } }
    }).catch(() => {});

    await prisma.outboxEvent.create({
      data: {
        eventType: 'PLAN_VERSION_PUBLISHED',
        payload: {
          planId: normalizedPlanId,
          version: newVersion.version,
          pricesJson: newVersion.pricesJson,
          affectedCollegesCount,
          publishedBy: req.user?.id || 'SUPER_ADMIN'
        }
      }
    }).catch(() => {});

    return res.json({
      success: true,
      message: `Plan ${normalizedPlanId} updated to v${newVersion.version} (PKR ${nextMonthly.toLocaleString()}/mo, PKR ${nextYearly.toLocaleString()}/yr). Existing subscribers stay price-locked until renewal.`,
      planVersion: {
        ...newVersion,
        monthlyPricePkr: nextMonthly,
        yearlyPricePkr: nextYearly
      },
      preview: {
        affectedCollegesCount,
        note: `${affectedCollegesCount} colleges currently on ${normalizedPlanId} stay price-locked until their next renewal.`
      }
    });
  } catch (error) {
    console.error('[updatePlanVersion] Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update plan version', error: error.message });
  }
}

module.exports = {
  getPlans,
  updatePlanVersion
};

