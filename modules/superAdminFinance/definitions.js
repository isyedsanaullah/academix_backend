'use strict';

/**
 * Superadmin Finance Metrics Contract & Canonical Definitions
 * Single source of truth for finance rules, revenue contracts, timezones, and formulas.
 */

const CANONICAL_PLANS = Object.freeze(['starter', 'standard', 'premium', 'enterprise']);

const PAYMENT_STATUSES = Object.freeze(['PENDING', 'APPROVING', 'APPROVED', 'REJECTED']);

const PAYMENT_TYPES = Object.freeze([
  'RENEWAL',
  'UPGRADE',
  'DOWNGRADE',
  'ADDON_ORDER',
  'CREDIT_ORDER',
  'MIXED'
]);

const BILLING_CYCLES = Object.freeze(['MONTHLY', 'YEARLY']);

const TIMEZONE = 'Asia/Karachi';

/**
 * Calculates Month-over-Month percentage change according to contract.
 * - If previous > 0: round((current - previous) / previous * 100, 1)
 * - If previous = 0 and current > 0: isNewBaseline = true, percentage = null (UI renders "New")
 * - If previous = 0 and current = 0: isNewBaseline = false, percentage = 0
 * 
 * @param {number} current 
 * @param {number} previous 
 * @returns {{ percentage: number|null, isNewBaseline: boolean, diff: number }}
 */
function calcMoM(current, previous) {
  const cur = Number(current) || 0;
  const prev = Number(previous) || 0;
  const diff = cur - prev;

  if (prev > 0) {
    const percentage = Math.round(((cur - prev) / prev) * 1000) / 10;
    return { percentage, isNewBaseline: false, diff };
  }

  if (cur > 0) {
    return { percentage: null, isNewBaseline: true, diff };
  }

  return { percentage: 0, isNewBaseline: false, diff: 0 };
}

/**
 * Computes settled revenue amount for a payment record.
 * Contract: COALESCE(verifiedAmount, amountPaid) when status === 'APPROVED', else 0.
 * 
 * @param {Object} payment 
 * @returns {number}
 */
function getSettledAmount(payment) {
  if (!payment || payment.status !== 'APPROVED') return 0;
  const amount = payment.verifiedAmount != null ? payment.verifiedAmount : payment.amountPaid;
  return Number(amount) || 0;
}

/**
 * Resolves the plan bucket for a payment row.
 * Types 'ADDON_ORDER', 'CREDIT_ORDER', 'MIXED' go to bucket 'ADDONS_CREDITS'.
 * Types 'RENEWAL', 'UPGRADE', 'DOWNGRADE' map to canonical plan tier.
 * 
 * @param {Object} payment 
 * @param {Object} [college] 
 * @returns {'starter'|'standard'|'premium'|'enterprise'|'ADDONS_CREDITS'}
 */
function resolvePlanBucket(payment, college) {
  if (!payment) return 'starter';
  const type = String(payment.type || '').toUpperCase();
  if (['ADDON_ORDER', 'CREDIT_ORDER', 'MIXED'].includes(type)) {
    return 'ADDONS_CREDITS';
  }

  const rawPlan = payment.planId || (college && college.planId) || 'starter';
  const clean = String(rawPlan).toLowerCase().trim();
  if (clean.startsWith('ent')) return 'enterprise';
  if (clean.startsWith('prem')) return 'premium';
  if (clean.startsWith('stand')) return 'standard';
  return 'starter';
}

/**
 * Generates zero-filled plan breakdown object.
 * Always includes starter, standard, premium, enterprise, and addons_credits.
 */
function createZeroFilledPlanBreakdown() {
  return {
    starter: { amount: 0, count: 0, percentage: 0 },
    standard: { amount: 0, count: 0, percentage: 0 },
    premium: { amount: 0, count: 0, percentage: 0 },
    enterprise: { amount: 0, count: 0, percentage: 0 },
    addons_credits: { amount: 0, count: 0, percentage: 0 }
  };
}

module.exports = {
  CANONICAL_PLANS,
  PAYMENT_STATUSES,
  PAYMENT_TYPES,
  BILLING_CYCLES,
  TIMEZONE,
  calcMoM,
  getSettledAmount,
  resolvePlanBucket,
  createZeroFilledPlanBreakdown
};

