'use strict';

const { isThreePlanMode } = require('../config/featureFlags');
const { PLAN_LEVEL, normalizePlanId } = require('../config/planConstants');
const { PLAN_FEATURES } = require('../config/featureRegistry');
const { getEntitlements, resolveFeatureState } = require('../services/entitlements');

/**
 * Legacy Plan & Feature Gate Middleware
 * Unified through services/entitlements.js (Stage 1 T1.2).
 * Super Admins bypass all plan & feature gates globally.
 */
const planGate = (requiredFeature) => {
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

      let ent;
      try {
        ent = req.entitlements || (req.entitlements = await getEntitlements(collegeId));
      } catch (err) {
        if (err.message && err.message.includes('not found')) {
          return res.status(404).json({ success: false, message: 'College not found' });
        }
        throw err;
      }

      if (!ent.active) {
        return res.status(403).json({
          success: false,
          message: ent.reason === 'SUSPENDED'
            ? 'College subscription is suspended. Contact administrator.'
            : 'College account is deactivated'
        });
      }

      if (ent.readOnlyReason === 'SUBSCRIPTION_EXPIRED' && process.env.ENFORCE_SUBSCRIPTION_GATES === 'true') {
        return res.status(403).json({
          success: false,
          message: 'College subscription has expired. Please renew.'
        });
      }

      const state = resolveFeatureState(ent, requiredFeature);
      if (!state?.on) {
        return res.status(403).json({
          success: false,
          message: 'This feature is disabled for your institution.',
          feature: requiredFeature,
          disabled: true,
          currentPlan: ent.planId
        });
      }

      if (state.hasWorkingImplementation === false) {
        const enforceComingSoon = process.env.ENFORCE_SUBSCRIPTION_GATES === 'true'
          && (isThreePlanMode() || process.env.ENFORCE_COMING_SOON_LOCKS === 'true');
        if (enforceComingSoon) {
          return res.status(403).json({
            success: false,
            code: 'FEATURE_COMING_SOON',
            message: 'This feature is coming soon and is not yet available.',
            feature: requiredFeature,
            disabled: true,
            currentPlan: ent.planId
          });
        } else {
          console.warn(`[PLAN GATE LOG-ONLY] Unbuilt feature '${requiredFeature}' (hasWorkingImplementation=false) on ${req.method} ${req.originalUrl} (College: ${collegeId}, Plan: ${ent.planId})`);
        }
      }

      req.collegePlan = ent.planId;
      req.effectiveFeatures = ent.effectiveFeatures;
      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Minimum plan level check (also unified through entitlements.js)
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

      let ent;
      try {
        ent = req.entitlements || (req.entitlements = await getEntitlements(collegeId));
      } catch (err) {
        if (err.message && err.message.includes('not found')) {
          return res.status(403).json({ success: false, message: 'College not found or deactivated' });
        }
        throw err;
      }

      if (!ent.active) {
        return res.status(403).json({
          success: false,
          message: 'College not found or deactivated'
        });
      }

      const normalizedMin = normalizePlanId(minPlan);
      const required = PLAN_LEVEL[normalizedMin] || 0;
      const current = PLAN_LEVEL[ent.planId] || 0;

      if (current < required) {
        return res.status(403).json({
          success: false,
          message: `This feature requires at least the ${normalizedMin.toUpperCase()} plan. Current: ${ent.planId.toUpperCase()}`,
          currentPlan: ent.planId,
          requiredPlan: normalizedMin,
          disabled: true,
          upgrade: true
        });
      }

      req.collegePlan = ent.planId;
      next();
    } catch (error) {
      next(error);
    }
  };
};

planGate.PLAN_FEATURES = PLAN_FEATURES;
planGate.PLAN_LEVEL = PLAN_LEVEL;

module.exports = planGate;
