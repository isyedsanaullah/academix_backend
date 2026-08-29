const { getSystemClient } = require('../config/prismaManager');
const { PLAN_FEATURES, PLAN_LEVEL, normalizePlanId } = require('../config/planConstants');
const { resolveCollegeFeatures } = require('../config/featureRegistry');

/**
 * Plan & Feature Gate Middleware
 * Checks if the college's effective subscription configuration includes the required feature.
 * Resolves: Plan Baseline -> College Overrides -> Deterministic Dependency Rules.
 * Super Admins bypass all plan & feature gates globally.
 */
const planGate = (requiredFeature) => {
  return async (req, res, next) => {
    try {
      // Super admins bypass all feature gates globally
      if (req.user && req.user.role === 'superAdmin') {
        return next();
      }

      // Extract college ID from tenant context or user session
      const collegeId = req.collegeId || req.user?.college_id;
      if (!collegeId) {
        return res.status(403).json({
          success: false,
          message: 'No college associated with this account'
        });
      }

      const systemDb = getSystemClient();
      const college = await systemDb.college.findUnique({
        where: { id: collegeId },
        select: { subscription: true, isActive: true }
      });

      if (!college) {
        return res.status(404).json({
          success: false,
          message: 'College not found'
        });
      }

      // Check if college account is active
      if (!college.isActive) {
        return res.status(403).json({
          success: false,
          message: 'College account is deactivated'
        });
      }

      const subscription = (typeof college.subscription === 'object' && college.subscription !== null)
        ? college.subscription
        : {};

      // Check subscription status
      if (subscription.status === 'suspended') {
        return res.status(403).json({
          success: false,
          message: 'College subscription is suspended. Contact administrator.'
        });
      }

      if (subscription.status === 'expired') {
        return res.status(403).json({
          success: false,
          message: 'College subscription has expired. Please renew.'
        });
      }

      // Resolve effective features dynamically
      const plan = normalizePlanId(subscription.plan);
      const featureOverrides = subscription.featureOverrides || {};
      const resolved = resolveCollegeFeatures(plan, featureOverrides);

      // Check if the required feature is effectively enabled
      if (!resolved.effectiveKeys.includes(requiredFeature)) {
        return res.status(403).json({
          success: false,
          message: `This feature is disabled for your institution.`,
          feature: requiredFeature,
          disabled: true,
          currentPlan: plan
        });
      }

      // Attach resolved plan & effective features to request for downstream handlers
      req.collegePlan = plan;
      req.effectiveFeatures = resolved.effectiveKeys;
      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Minimum plan level check
 * Usage: planGate.minPlan('standard')
 */
planGate.minPlan = (minPlan) => {
  return async (req, res, next) => {
    try {
      if (req.user && req.user.role === 'superAdmin') {
        return next();
      }

      const collegeId = req.collegeId || req.user?.college_id;
      if (!collegeId) {
        return res.status(403).json({
          success: false,
          message: 'No college associated with this account'
        });
      }

      const systemDb = getSystemClient();
      const college = await systemDb.college.findUnique({
        where: { id: collegeId },
        select: { subscription: true, isActive: true }
      });

      if (!college || !college.isActive) {
        return res.status(403).json({
          success: false,
          message: 'College not found or deactivated'
        });
      }

      const subscription = college.subscription || {};
      const plan = normalizePlanId(subscription.plan);
      const required = PLAN_LEVEL[minPlan] || 0;
      const current = PLAN_LEVEL[plan] || 0;

      if (current < required) {
        return res.status(403).json({
          success: false,
          message: `This feature requires at least the ${minPlan.toUpperCase()} plan. Current: ${plan.toUpperCase()}`,
          currentPlan: plan,
          requiredPlan: minPlan,
          disabled: true,
          upgrade: true
        });
      }

      req.collegePlan = plan;
      next();
    } catch (error) {
      next(error);
    }
  };
};

planGate.PLAN_FEATURES = PLAN_FEATURES;
planGate.PLAN_LEVEL = PLAN_LEVEL;

module.exports = planGate;
