'use strict';

const { getSystemClient } = require('../../../config/prismaManager');
const { FINANCE_SAFE_USER_SELECT } = require('../../../utils/safeUser');
const { normalizePlanId } = require('../../../config/planConstants');
const { derivePlanPrice } = require('./collegeBilling.service');

/**
 * Retrieves paginated list of accountant users with college associations and coverage metrics.
 * Uses strict FINANCE_SAFE_USER_SELECT to prevent credential/PII leakage.
 * 
 * @param {Object} filters 
 * @returns {Promise<Object>}
 */
async function getAccountantsList(filters = {}) {
  const prisma = getSystemClient();

  const page = Math.max(1, parseInt(filters.page, 10) || 1);
  const limit = Math.max(1, Math.min(100, parseInt(filters.limit, 10) || 20));
  const skip = (page - 1) * limit;

  const andConditions = [{ role: 'accountant' }];

  // 1. Test Isolation
  let testCollegeIds = [];
  if (!filters.includeTest) {
    const testColleges = await prisma.college.findMany({
      where: { isTest: true },
      select: { id: true }
    });
    testCollegeIds = testColleges.map(c => c.id);
    if (testCollegeIds.length > 0) {
      andConditions.push({
        NOT: {
          college_id: { in: testCollegeIds }
        }
      });
    }
  }

  // 2. Specific College Filter
  if (filters.collegeId) {
    andConditions.push({ college_id: filters.collegeId });
  }

  // 3. Status Filter (active / inactive)
  if (filters.status) {
    const cleanStatus = String(filters.status).toLowerCase();
    if (cleanStatus === 'active') {
      andConditions.push({ isActive: true });
    } else if (cleanStatus === 'inactive') {
      andConditions.push({ isActive: false });
    }
  }

  // 4. Search query q (name or email)
  if (filters.q) {
    const qTerm = String(filters.q).trim();
    andConditions.push({
      OR: [
        { name: { contains: qTerm, mode: 'insensitive' } },
        { email: { contains: qTerm, mode: 'insensitive' } }
      ]
    });
  }

  const where = { AND: andConditions };

  const [accountants, total, totalColleges] = await Promise.all([
    prisma.user.findMany({
      where,
      select: FINANCE_SAFE_USER_SELECT,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit
    }),
    prisma.user.count({ where }),
    prisma.college.count({
      where: filters.includeTest ? {} : { isTest: false }
    })
  ]);

  // Bulk lookup colleges for accountants
  const collegeIds = [...new Set(accountants.map(a => a.college_id).filter(Boolean))];
  const colleges = await prisma.college.findMany({
    where: { id: { in: collegeIds } },
    select: {
      id: true,
      name: true,
      code: true,
      slug: true,
      planId: true,
      billingCycle: true,
      subStatus: true,
      isTest: true
    }
  });

  const collegeMap = new Map(colleges.map(c => [c.id, c]));

  const enrichedAccountants = accountants.map(a => {
    const college = a.college_id ? collegeMap.get(a.college_id) : null;
    let collegeInfo = null;

    if (college) {
      const normPlan = normalizePlanId(college.planId);
      collegeInfo = {
        id: college.id,
        name: college.name,
        code: college.code,
        slug: college.slug,
        planId: normPlan,
        billingCycle: college.billingCycle || 'MONTHLY',
        billingPrice: derivePlanPrice(normPlan, college.billingCycle),
        subStatus: college.subStatus || 'ACTIVE',
        isTest: college.isTest
      };
    }

    return {
      ...a,
      college: collegeInfo
    };
  });

  // Calculate coverage metrics
  const assignedCount = enrichedAccountants.filter(a => a.college !== null).length;
  const unassignedCount = enrichedAccountants.length - assignedCount;

  // Global colleges with at least one accountant
  const assignedCollegesGroup = await prisma.user.groupBy({
    by: ['college_id'],
    where: {
      role: 'accountant',
      college_id: { not: null },
      ...(filters.includeTest ? {} : { NOT: { college_id: { in: testCollegeIds } } })
    }
  });
  const collegesWithAccountant = assignedCollegesGroup.length;
  const coveragePercentage = totalColleges > 0
    ? Math.round((collegesWithAccountant / totalColleges) * 1000) / 10
    : 0;

  return {
    accountants: enrichedAccountants,
    metrics: {
      totalAccountants: total,
      assignedCount,
      unassignedCount,
      totalColleges,
      collegesWithAccountant,
      coveragePercentage
    },
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  };
}

module.exports = {
  getAccountantsList
};
