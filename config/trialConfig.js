'use strict';

/**
 * Trial Configuration — Single Source of Truth
 * Change TRIAL_ENTITLEMENT_PLAN here (or via env) to adjust which plan's
 * features & limits newly registered trial colleges receive.
 */
const TRIAL_DAYS = Math.max(1, parseInt(process.env.TRIAL_DAYS || '14', 10) || 14);
const TRIAL_ENTITLEMENT_PLAN = (process.env.TRIAL_ENTITLEMENT_PLAN || 'standard').toLowerCase().trim();

module.exports = {
  TRIAL_DAYS,
  TRIAL_ENTITLEMENT_PLAN,
};

