'use strict';

/**
 * Unified 3-plan architecture (Starter, Standard, Premium) is now permanent
 * across backend, database, and frontend without environment toggles.
 */
function isThreePlanMode() {
  return true;
}

module.exports = {
  isThreePlanMode,
};

