const { getEntitlements } = require('../services/entitlements');

/**
 * Subscription Gate Middleware Factory
 * Protects endpoints by verifying:
 * 1. Read-only lock enforcement on non-safe HTTP methods (POST, PUT, PATCH, DELETE)
 * 2. Feature entitlement based on plan tier, active add-ons, and overrides.
 *
 * Runs in log-only mode when ENFORCE_SUBSCRIPTION_GATES !== 'true' to allow safe validation.
 * Super Admins bypass all gates globally.
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
      const entitlements = await getEntitlements(collegeId);
      req.entitlements = entitlements;

      const enforceStrict = process.env.ENFORCE_SUBSCRIPTION_GATES === 'true';

      // 4. Check View-Only (Read-Only) Lock on mutating requests
      const isMutatingMethod = !['GET', 'HEAD', 'OPTIONS'].includes(req.method.toUpperCase());
      if (entitlements.isReadOnly && isMutatingMethod) {
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

      // 5. Check Feature Entitlement if a specific feature is requested
      if (requiredFeatureKey) {
        const hasFeature = entitlements.features.includes(requiredFeatureKey);

        if (!hasFeature) {
          if (enforceStrict) {
            return res.status(403).json({
              success: false,
              code: 'FEATURE_NOT_IN_PLAN',
              message: `The feature '${requiredFeatureKey}' is not included in the ${entitlements.planId.toUpperCase()} tier or active add-ons.`,
              feature: requiredFeatureKey,
              currentPlan: entitlements.planId
            });
          } else {
            console.warn(`[SUBSCRIPTION GATE LOG-ONLY] Missing feature '${requiredFeatureKey}' on ${req.method} ${req.originalUrl} (College: ${collegeId}, Plan: ${entitlements.planId})`);
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

module.exports = {
  subscriptionGate
};

