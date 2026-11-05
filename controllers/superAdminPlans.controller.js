/**
 * superAdminPlans.controller.js — Phase 6C Plan Versioning
 * Manages plan versions, pricing, and limits without breaking existing pinned college subscriptions.
 */

const { getSystemClient } = require('../config/prismaManager');
const { PLAN_LIMITS } = require('../services/entitlements');

/**
 * GET /api/super-admin/plans
 * Returns all plans, their current active versions, history, and pinned college counts.
 */
async function getPlans(req, res) {
  try {
    const prisma = getSystemClient();

    // Fetch all plan versions sorted by version desc
    const allVersions = await prisma.planVersion.findMany({
      orderBy: [{ planId: 'asc' }, { version: 'desc' }]
    });

    // Fetch colleges count per planVersionId
    const collegeCounts = await prisma.college.groupBy({
      by: ['planVersionId'],
      _count: { id: true }
    });

    const countMap = {};
    for (const c of collegeCounts) {
      if (c.planVersionId) countMap[c.planVersionId] = c._count.id;
    }

    // Group by planId
    const plansMap = {
      starter: { id: 'starter', name: 'Starter', versions: [] },
      standard: { id: 'standard', name: 'Standard', versions: [] },
      premium: { id: 'premium', name: 'Premium', versions: [] },
      enterprise: { id: 'enterprise', name: 'Enterprise', versions: [] }
    };

    for (const pv of allVersions) {
      const planKey = pv.planId.toLowerCase();
      if (!plansMap[planKey]) {
        plansMap[planKey] = { id: pv.planId, name: pv.planId, versions: [] };
      }
      plansMap[planKey].versions.push({
        ...pv,
        activeCollegeCount: countMap[pv.id] || 0
      });
    }

    const plans = Object.values(plansMap).map(p => {
      const current = p.versions[0] || null;
      return {
        ...p,
        currentVersion: current ? current.version : 1,
        currentPrices: current ? { monthly: current.monthlyPricePkr, yearly: current.yearlyPricePkr } : null,
        currentLimits: current ? current.limitsJson : (PLAN_LIMITS[p.id.toUpperCase()] || {}),
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
 * Creates a new PlanVersion for the specified plan.
 * Existing colleges stay pinned to their current planVersionId until renewal.
 */
async function updatePlanVersion(req, res) {
  try {
    const prisma = getSystemClient();
    const { planId } = req.params;
    const { monthlyPricePkr, yearlyPricePkr, limitsJson, effectiveFrom } = req.body;

    const normalizedPlanId = planId.toLowerCase();

    // 1. Find existing versions for this plan
    const latestVersion = await prisma.planVersion.findFirst({
      where: { planId: normalizedPlanId },
      orderBy: { version: 'desc' }
    });

    const nextVersionNumber = latestVersion ? latestVersion.version + 1 : 1;

    // 2. Count colleges currently subscribed to this plan
    const affectedCollegesCount = await prisma.college.count({
      where: { planId: normalizedPlanId }
    });

    // 3. Create new PlanVersion
    const newVersion = await prisma.planVersion.create({
      data: {
        planId: normalizedPlanId,
        version: nextVersionNumber,
        monthlyPricePkr: monthlyPricePkr !== undefined ? Number(monthlyPricePkr) : (latestVersion?.monthlyPricePkr || 0),
        yearlyPricePkr: yearlyPricePkr !== undefined ? Number(yearlyPricePkr) : (latestVersion?.yearlyPricePkr || 0),
        limitsJson: limitsJson || latestVersion?.limitsJson || PLAN_LIMITS[normalizedPlanId.toUpperCase()] || {},
        effectiveFrom: effectiveFrom ? new Date(effectiveFrom) : new Date()
      }
    });

    // 4. Log outbox notification
    await prisma.outboxEvent.create({
      data: {
        eventType: 'PLAN_VERSION_PUBLISHED',
        payload: {
          planId: normalizedPlanId,
          version: newVersion.version,
          affectedCollegesCount,
          publishedBy: req.user?.id || 'SUPER_ADMIN'
        }
      }
    });

    return res.json({
      success: true,
      message: `Plan ${normalizedPlanId} upgraded to version ${newVersion.version}. Existing colleges remain pinned until renewal.`,
      planVersion: newVersion,
      preview: {
        affectedCollegesCount,
        note: `${affectedCollegesCount} colleges currently on ${normalizedPlanId} will adopt version ${newVersion.version} upon their next renewal.`
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

