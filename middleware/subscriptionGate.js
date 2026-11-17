'use strict';

const { isThreePlanMode } = require('../config/featureFlags');
const { getEntitlements, resolveFeatureState } = require('../services/entitlements');

/**
 * Subscription Gate Middleware Factory
 * Unified through services/entitlements.js (supports all canonical & alias keys).
 * Super Admins bypass all gates globally for preview and platform operations.
 *
 * @param {string} [requiredFeatureKey] - Optional feature slug or legacy alias
 */
function subscriptionGate(requiredFeatureKey = null) {
  return async (req, res, next) => {
    try {
      // 1. Super Admins bypass all subscription gates globally
      if (req.user && req.user.role === 'superAdmin') {
        return next();
      }

      // 2. Resolve college context
      const collegeId = req.collegeId || req.user?.college_id;
      if (!collegeId) {
        return res.status(403).json({
          success: false,
          code: 'NO_COLLEGE_CONTEXT',
          message: 'No college associated with this request or authenticated session.'
        });
      }

      // 3. Resolve full entitlements snapshot
      const entitlements = req.entitlements || (req.entitlements = await getEntitlements(collegeId));

      // Check Suspended state - blocks everything
      if (entitlements.subStatus === 'SUSPENDED') {
        return res.status(403).json({
          success: false,
          code: 'ACCOUNT_SUSPENDED',
          message: 'Institution subscription is currently suspended.'
        });
      }

      const enforceStrict = process.env.ENFORCE_SUBSCRIPTION_GATES === 'true';

      // 4. Check View-Only (Read-Only) Lock on mutating requests
      const isMutatingMethod = !['GET', 'HEAD', 'OPTIONS'].includes(req.method.toUpperCase());
      const isWhitelistedInReadOnly = (req.baseUrl && req.baseUrl.includes('exports'))
        || (req.originalUrl && req.originalUrl.includes('/api/exports'));

      if (entitlements.isReadOnly && isMutatingMethod && !isWhitelistedInReadOnly) {
        if (enforceStrict) {
          return res.status(403).json({
            success: false,
            code: 'READ_ONLY_LOCK',
            message: 'Institution subscription is locked in view-only mode. An active subscription is required to perform changes.',
            reason: entitlements.readOnlyReason,
            subStatus: entitlements.subStatus,
            periodEnd: entitlements.periodEnd,
            trialEndsAt: entitlements.trialEndsAt
          });
        } else {
          console.warn(`[SUBSCRIPTION GATE LOG-ONLY] View-only lock ignored for ${req.method} ${req.originalUrl} (College: ${collegeId}, Reason: ${entitlements.readOnlyReason})`);
        }
      }

      // 5. Check Feature Entitlement (via alias-aware state resolution)
      if (requiredFeatureKey) {
        const state = resolveFeatureState(entitlements, requiredFeatureKey);
        const hasFeature = Boolean(state?.on);

        if (!hasFeature) {
          if (enforceStrict) {
            return res.status(403).json({
              success: false,
              code: 'FEATURE_NOT_IN_PLAN',
              message: `The feature '${requiredFeatureKey}' is not included in the ${entitlements.planId.toUpperCase()} tier or active add-ons.`,
              feature: requiredFeatureKey,
              canonicalKey: state?.canonicalKey || requiredFeatureKey,
              currentPlan: entitlements.planId
            });
          } else {
            console.warn(`[SUBSCRIPTION GATE LOG-ONLY] Missing feature '${requiredFeatureKey}' (canonical: '${state?.canonicalKey || requiredFeatureKey}') on ${req.method} ${req.originalUrl} (College: ${collegeId}, Plan: ${entitlements.planId})`);
          }
        } else if (state.hasWorkingImplementation === false) {
          const enforceComingSoon = enforceStrict && (isThreePlanMode() || process.env.ENFORCE_COMING_SOON_LOCKS === 'true');
          if (enforceComingSoon) {
            return res.status(403).json({
              success: false,
              code: 'FEATURE_COMING_SOON',
              message: `The feature '${requiredFeatureKey}' is coming soon and is not yet available.`,
              feature: requiredFeatureKey,
              canonicalKey: state.canonicalKey,
              currentPlan: entitlements.planId
            });
          } else {
            console.warn(`[SUBSCRIPTION GATE LOG-ONLY] Unbuilt feature '${requiredFeatureKey}' (hasWorkingImplementation=false) on ${req.method} ${req.originalUrl} (College: ${collegeId}, Plan: ${entitlements.planId})`);
          }
        }
      }

      return next();
    } catch (err) {
      console.error('[SubscriptionGate] Error evaluating entitlements:', err);
      return res.status(500).json({
        success: false,
        code: 'ENTITLEMENT_RESOLUTION_ERROR',
        message: 'Internal error resolving institutional subscription entitlements.'
      });
    }
  };
}

module.exports = subscriptionGate;
module.exports.subscriptionGate = subscriptionGate;
