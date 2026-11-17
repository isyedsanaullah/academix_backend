'use strict';

/**
 * Runtime feature flags for safe staged rollouts.
 */
function isThreePlanMode() {
  return String(process.env.THREE_PLAN_MODE || '').trim().toLowerCase() === 'true';
}

module.exports = {
  isThreePlanMode,
};
