'use strict';

/**
 * PKT (Pakistan Standard Time, UTC+5, Asia/Karachi) Timezone Utilities
 * Standardizes all financial calendar boundaries, monthly cutoffs,
 * and date filtering to strictly adhere to PKT.
 */

const PKT_TIMEZONE = 'Asia/Karachi';
const PKT_OFFSET_HOURS = 5;
const PKT_OFFSET_MS = PKT_OFFSET_HOURS * 60 * 60 * 1000;

/**
 * Returns a Date representing the start of a calendar month in PKT (00:00:00 PKT).
 * @param {number} offsetMonths - 0 for current month, -1 for last month, etc.
 * @param {Date} [anchorDate] - Optional anchor date (defaults to now)
 * @returns {Date} UTC Date corresponding to 00:00:00.000 PKT on the 1st of that month.
 */
function startOfMonthPKT(offsetMonths = 0, anchorDate = new Date()) {
  // Convert anchor to PKT wall clock
  const pktWall = new Date(anchorDate.getTime() + PKT_OFFSET_MS);
  const year = pktWall.getUTCFullYear();
  const month = pktWall.getUTCMonth() + offsetMonths;

  // The 1st of the target month at 00:00:00 PKT
  // In UTC, this is the previous calendar day at 19:00:00 (since PKT is UTC+5)
  const pktTargetEpoch = Date.UTC(year, month, 1, 0, 0, 0, 0);
  return new Date(pktTargetEpoch - PKT_OFFSET_MS);
}

/**
 * Returns a Date representing the end of a calendar month in PKT (23:59:59.999 PKT).
 * @param {number} offsetMonths - 0 for current month, -1 for last month, etc.
 * @param {Date} [anchorDate] - Optional anchor date (defaults to now)
 * @returns {Date} UTC Date corresponding to 23:59:59.999 PKT on the last day of that month.
 */
function endOfMonthPKT(offsetMonths = 0, anchorDate = new Date()) {
  // Start of the NEXT month in PKT minus 1 millisecond
  const nextMonthStart = startOfMonthPKT(offsetMonths + 1, anchorDate);
  return new Date(nextMonthStart.getTime() - 1);
}

/**
 * Parses query param strings into exact PKT boundary UTC Date objects.
 * e.g., '2026-11-01' -> 2026-11-01 00:00:00 PKT (which is 2026-10-31 19:00:00 UTC)
 * '2026-11-30' -> 2026-11-30 23:59:59.999 PKT
 * @param {string} from - e.g. 'YYYY-MM-DD'
 * @param {string} to - e.g. 'YYYY-MM-DD'
 * @returns {{ gte?: Date, lte?: Date }}
 */
function pktRangeFromQuery(from, to) {
  const range = {};

  if (from) {
    const cleanFrom = String(from).trim().slice(0, 10);
    const [y, m, d] = cleanFrom.split('-').map(Number);
    if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
      // 00:00:00 PKT
      const epoch = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
      range.gte = new Date(epoch - PKT_OFFSET_MS);
    }
  }

  if (to) {
    const cleanTo = String(to).trim().slice(0, 10);
    const [y, m, d] = cleanTo.split('-').map(Number);
    if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
      // 23:59:59.999 PKT
      const epoch = Date.UTC(y, m - 1, d, 23, 59, 59, 999);
      range.lte = new Date(epoch - PKT_OFFSET_MS);
    }
  }

  return range;
}

/**
 * Formats a Date in PKT (Asia/Karachi) timezone.
 * @param {Date|string|number} date 
 * @param {Intl.DateTimeFormatOptions} [options]
 * @returns {string}
 */
function formatPKT(date, options = {}) {
  if (!date) return '—';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '—';

  const defaultOpts = {
    timeZone: PKT_TIMEZONE,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    ...options
  };

  return new Intl.DateTimeFormat('en-PK', defaultOpts).format(d);
}

/**
 * Formats a Date into ISO date string 'YYYY-MM-DD' strictly in PKT wall time.
 * @param {Date|string|number} date 
 * @returns {string}
 */
function toPKTDateString(date = new Date()) {
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  const pktWall = new Date(d.getTime() + PKT_OFFSET_MS);
  return pktWall.toISOString().slice(0, 10);
}

module.exports = {
  PKT_TIMEZONE,
  PKT_OFFSET_HOURS,
  PKT_OFFSET_MS,
  startOfMonthPKT,
  endOfMonthPKT,
  pktRangeFromQuery,
  formatPKT,
  toPKTDateString
};

