'use strict';

/**
 * Money & Financial Value Helpers (PKR Integers)
 * All monetary amounts in CollegesHub subscriptions are integer Pakistani Rupees.
 */

/**
 * Formats an integer amount to standard Pakistani Rupee representation.
 * e.g. 121458300 -> "PKR 121,458,300"
 * @param {number|string} amount
 * @returns {string}
 */
function formatPKR(amount) {
  const num = Math.round(Number(amount) || 0);
  return `PKR ${num.toLocaleString('en-PK')}`;
}

/**
 * Formats an amount into a compact readable metric (e.g. "PKR 121.5M", "PKR 351.2K").
 * @param {number|string} amount
 * @param {number} [decimals=1]
 * @returns {string}
 */
function formatPKRCompact(amount, decimals = 1) {
  const num = Number(amount) || 0;
  const abs = Math.abs(num);
  const sign = num < 0 ? '-' : '';

  if (abs >= 1000000000) {
    return `${sign}PKR ${(abs / 1000000000).toFixed(decimals)}B`;
  }
  if (abs >= 1000000) {
    return `${sign}PKR ${(abs / 1000000).toFixed(decimals)}M`;
  }
  if (abs >= 1000) {
    return `${sign}PKR ${(abs / 1000).toFixed(decimals)}K`;
  }
  return `${sign}PKR ${Math.round(abs)}`;
}

/**
 * Parses and validates an integer PKR amount, returning a non-negative integer.
 * @param {any} val
 * @param {number} [fallback=0]
 * @returns {number}
 */
function parsePKR(val, fallback = 0) {
  if (val === null || val === undefined) return fallback;
  const num = Number(val);
  if (isNaN(num)) return fallback;
  return Math.round(num);
}

/**
 * Computes variance between expected and actual verified amounts.
 * Positive = overpayment; Negative = underpayment.
 * @param {number} expectedAmount 
 * @param {number} actualAmount 
 * @returns {number}
 */
function calcVariance(expectedAmount, actualAmount) {
  return (Number(actualAmount) || 0) - (Number(expectedAmount) || 0);
}

module.exports = {
  formatPKR,
  formatPKRCompact,
  parsePKR,
  calcVariance
};

