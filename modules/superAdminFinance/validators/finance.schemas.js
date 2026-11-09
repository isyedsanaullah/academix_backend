'use strict';

const { CANONICAL_PLANS, PAYMENT_STATUSES, PAYMENT_TYPES } = require('../definitions');

function parseBoolean(val, defaultVal = false) {
  if (val === undefined || val === null || val === '') return defaultVal;
  if (typeof val === 'boolean') return val;
  const s = String(val).toLowerCase().trim();
  return s === 'true' || s === '1' || s === 'yes';
}

function parseInteger(val, defaultVal, min = 1, max = Infinity) {
  const n = parseInt(val, 10);
  if (isNaN(n)) return defaultVal;
  return Math.max(min, Math.min(max, n));
}

function parseNumber(val, defaultVal = null) {
  if (val === undefined || val === null || val === '') return defaultVal;
  const n = Number(val);
  return isNaN(n) ? defaultVal : n;
}

function validateOverviewQuery(query = {}) {
  return {
    from: query.from ? new Date(query.from) : null,
    to: query.to ? new Date(query.to) : null,
    includeTest: parseBoolean(query.includeTest, false)
  };
}

function validatePaymentsQuery(query = {}) {
  const page = parseInteger(query.page, 1, 1, 10000);
  const limit = parseInteger(query.limit, 20, 1, 100);
  const sortBy = ['createdAt', 'reviewedAt', 'amountPaid', 'receiptNumber'].includes(query.sortBy)
    ? query.sortBy
    : 'createdAt';
  const sortOrder = String(query.sortOrder).toLowerCase() === 'asc' ? 'asc' : 'desc';

  let status = null;
  if (query.status && query.status !== 'ALL') {
    status = Array.isArray(query.status) ? query.status : [query.status];
    status = status.map(s => String(s).toUpperCase()).filter(s => PAYMENT_STATUSES.includes(s));
    if (status.length === 0) status = null;
  }

  let planId = null;
  if (query.planId && query.planId !== 'ALL') {
    planId = Array.isArray(query.planId) ? query.planId : [query.planId];
    planId = planId.map(p => String(p).toLowerCase()).filter(p => CANONICAL_PLANS.includes(p));
    if (planId.length === 0) planId = null;
  }

  let type = null;
  if (query.type && query.type !== 'ALL') {
    type = Array.isArray(query.type) ? query.type : [query.type];
    type = type.map(t => String(t).toUpperCase()).filter(t => PAYMENT_TYPES.includes(t));
    if (type.length === 0) type = null;
  }

  return {
    page,
    limit,
    sortBy,
    sortOrder,
    status,
    planId,
    type,
    paymentMethod: query.paymentMethod && query.paymentMethod !== 'ALL' ? String(query.paymentMethod).trim() : null,
    collegeId: query.collegeId ? String(query.collegeId).trim() : null,
    from: query.from ? new Date(query.from) : null,
    to: query.to ? new Date(query.to) : null,
    minAmount: parseNumber(query.minAmount, null),
    maxAmount: parseNumber(query.maxAmount, null),
    duplicateOnly: parseBoolean(query.duplicateOnly, false),
    includeTest: parseBoolean(query.includeTest, false),
    q: query.q ? String(query.q).trim().slice(0, 100) : null
  };
}

function validatePlanChange(body = {}) {
  const errors = [];
  const targetPlanId = String(body.targetPlanId || '').toLowerCase().trim();
  const reason = String(body.reason || '').trim();

  if (!CANONICAL_PLANS.includes(targetPlanId)) {
    errors.push(`targetPlanId must be one of: ${CANONICAL_PLANS.join(', ')}`);
  }

  if (!reason || reason.length < 5) {
    errors.push('reason is required and must be at least 5 characters');
  }

  return {
    isValid: errors.length === 0,
    errors,
    data: { targetPlanId, reason }
  };
}

function validateApproval(body = {}) {
  const errors = [];
  let verifiedAmount = null;

  if (body.verifiedAmount !== undefined && body.verifiedAmount !== null) {
    const n = Number(body.verifiedAmount);
    if (isNaN(n) || n < 0) {
      errors.push('verifiedAmount must be a non-negative number');
    } else {
      verifiedAmount = Math.round(n);
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    data: {
      verifiedAmount,
      adminNotes: body.adminNotes ? String(body.adminNotes).trim() : null
    }
  };
}

function validateRejection(body = {}) {
  const errors = [];
  const rejectionReason = String(body.rejectionReason || '').trim();

  if (!rejectionReason || rejectionReason.length < 3) {
    errors.push('rejectionReason is required and must be at least 3 characters');
  }

  return {
    isValid: errors.length === 0,
    errors,
    data: { rejectionReason }
  };
}

module.exports = {
  validateOverviewQuery,
  validatePaymentsQuery,
  validatePlanChange,
  validateApproval,
  validateRejection,
  parseBoolean
};

