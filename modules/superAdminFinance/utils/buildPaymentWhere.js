'use strict';

/**
 * Builds Prisma `where` clause for CollegeSubscriptionPayment queries.
 * Enforces test isolation, date ranges, multi-status filters, and search indexing.
 * 
 * @param {Object} filters - Validated filters from validatePaymentsQuery
 * @returns {Object} Prisma where object
 */
function buildPaymentWhere(filters = {}) {
  const where = {};
  const andConditions = [];

  // 1. Test College Isolation (Default: Exclude test colleges)
  if (!filters.includeTest) {
    andConditions.push({
      college: { isTest: false }
    });
  }

  // 2. Specific College Filter
  if (filters.collegeId) {
    andConditions.push({
      college_id: filters.collegeId
    });
  }

  // 3. Status Filter (Single or Array)
  if (filters.status) {
    if (Array.isArray(filters.status)) {
      andConditions.push({ status: { in: filters.status } });
    } else {
      andConditions.push({ status: filters.status });
    }
  }

  // 4. Plan Filter
  if (filters.planId) {
    if (Array.isArray(filters.planId)) {
      andConditions.push({ planId: { in: filters.planId } });
    } else {
      andConditions.push({ planId: filters.planId });
    }
  }

  // 5. Payment Type Filter
  if (filters.type) {
    if (Array.isArray(filters.type)) {
      andConditions.push({ type: { in: filters.type } });
    } else {
      andConditions.push({ type: filters.type });
    }
  }

  // 6. Payment Method Filter
  if (filters.paymentMethod) {
    andConditions.push({
      paymentMethod: filters.paymentMethod
    });
  }

  // 7. Duplicate Suspected Flag
  if (filters.duplicateOnly) {
    andConditions.push({
      isDuplicateSuspected: true
    });
  }

  // 8. Amount Range Filter
  if (filters.minAmount != null || filters.maxAmount != null) {
    const amountCond = {};
    if (filters.minAmount != null) amountCond.gte = filters.minAmount;
    if (filters.maxAmount != null) amountCond.lte = filters.maxAmount;
    andConditions.push({ amountPaid: amountCond });
  }

  // 9. Date Range Filter (on createdAt by default)
  if (filters.from || filters.to) {
    const dateCond = {};
    if (filters.from) dateCond.gte = filters.from;
    if (filters.to) dateCond.lte = filters.to;
    andConditions.push({ createdAt: dateCond });
  }

  // 10. Search Query 'q' (matches transactionId, receiptNumber, college name/code)
  if (filters.q) {
    const qTerm = String(filters.q).trim();
    andConditions.push({
      OR: [
        { transactionId: { contains: qTerm, mode: 'insensitive' } },
        { receiptNumber: { contains: qTerm, mode: 'insensitive' } },
        { college: { name: { contains: qTerm, mode: 'insensitive' } } },
        { college: { code: { contains: qTerm, mode: 'insensitive' } } }
      ]
    });
  }

  if (andConditions.length > 0) {
    where.AND = andConditions;
  }

  return where;
}

module.exports = {
  buildPaymentWhere
};

