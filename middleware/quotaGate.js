const { checkQuota } = require('../services/quotaService');

/**
 * Quota Gate Middleware Factory
 * Inspects incoming request and verifies that the college has sufficient quota remaining
 * before proceeding.
 *
 * @param {string} metric - Quota metric slug (e.g. 'applications', 'aiQuizGenerations', 'exportsCsv')
 * @param {number|Function} [amount=1] - Number of units or function(req) resolving amount
 */
function quotaGate(metric, amount = 1) {
  return async (req, res, next) => {
    try {
      // Super Admins bypass quotas globally
      if (req.user && req.user.role === 'superAdmin') {
        return next();
      }

      const collegeId = req.collegeId || req.user?.college_id;
      if (!collegeId) {
        return res.status(403).json({
          success: false,
          code: 'NO_COLLEGE_CONTEXT',
          message: 'No college associated with this request.'
        });
      }

      const requestedAmount = typeof amount === 'function' ? amount(req) : amount;
      const status = await checkQuota(collegeId, metric, requestedAmount);

      if (!status.allowed) {
        const enforceStrict = process.env.ENFORCE_SUBSCRIPTION_GATES === 'true';

        if (enforceStrict) {
          return res.status(429).json({
            success: false,
            code: 'QUOTA_EXCEEDED',
            message: `Institutional limit for '${metric}' has been reached. Current usage: ${status.current}/${status.limit}.`,
            details: {
              metric: status.metric,
              current: status.current,
              limit: status.limit,
              remaining: status.remaining,
              period: status.period,
              planId: status.planId
            }
          });
        } else {
          console.warn(`[QUOTA GATE LOG-ONLY] Quota exceeded for metric '${metric}' on ${req.method} ${req.originalUrl} (College: ${collegeId}, Usage: ${status.current}/${status.limit})`);
        }
      }

      req.quotaStatus = status;
      return next();
    } catch (err) {
      console.error(`[QuotaGate] Error checking quota for metric '${metric}':`, err);
      return res.status(500).json({
        success: false,
        code: 'QUOTA_CHECK_ERROR',
        message: 'Internal error checking institutional quota availability.'
      });
    }
  };
}

module.exports = {
  quotaGate
};

