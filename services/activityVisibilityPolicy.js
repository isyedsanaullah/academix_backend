/**
 * Activity Visibility Policy Service
 * Constructs role-scoped Prisma query conditions for ActivityLog.
 */

const { CATEGORIES } = require('../config/activityConstants');

function buildVisibilityQuery(viewerUser, options = {}) {
  const role = viewerUser.role;
  const userId = viewerUser.id || viewerUser._id;
  const collegeId = viewerUser.college_id || options.college_id;

  const baseFilters = {};

  // Category filter if specified
  if (options.category && options.category !== 'All') {
    baseFilters.category = options.category;
  }

  // Status filter if specified
  if (options.status && options.status !== 'All') {
    baseFilters.status = options.status;
  }

  // Date range filter
  if (options.dateRange && options.dateRange !== 'all') {
    const dateClause = buildDateRangeClause(options.dateRange, options.startDate, options.endDate);
    if (dateClause) {
      baseFilters.createdAt = dateClause;
    }
  }

  // Keyword search
  if (options.search && options.search.trim() !== '') {
    const term = options.search.trim();
    baseFilters.OR = [
      { action: { contains: term, mode: 'insensitive' } },
      { actorNameSnapshot: { contains: term, mode: 'insensitive' } },
      { title: { contains: term, mode: 'insensitive' } },
      { description: { contains: term, mode: 'insensitive' } },
    ];
  }

  // Route to role-specific policy
  switch (role) {
    case 'superAdmin':
      return getSuperAdminQuery(options.college_id, baseFilters);

    case 'admin':
      return getAdminQuery(collegeId, baseFilters);

    case 'principal':
      return getPrincipalQuery(collegeId, baseFilters);

    case 'registrar':
      return getRegistrarQuery(collegeId, baseFilters);

    case 'accountant':
      return getAccountantQuery(collegeId, baseFilters);

    case 'teacher':
      return getTeacherQuery(userId, collegeId, baseFilters);

    case 'student':
      return getStudentQuery(userId, collegeId, baseFilters);

    default:
      return { AND: [{ college_id: collegeId }, { targetUserId: userId }, baseFilters] };
  }
}

// ── Role Specific Policy Generators ──

function getSuperAdminQuery(selectedCollegeId, baseFilters) {
  const where = { ...baseFilters };
  if (selectedCollegeId) {
    where.college_id = selectedCollegeId;
  }
  // Super Admin can view system-wide (college_id: null) and college-specific logs
  return where;
}

function getAdminQuery(collegeId, baseFilters) {
  if (!collegeId) return { id: 'impossible-no-college' };
  return {
    ...baseFilters,
    college_id: collegeId,
    category: {
      in: [
        CATEGORIES.ADMINISTRATION,
        CATEGORIES.COLLEGE,
        CATEGORIES.STUDENT,
        CATEGORIES.TEACHER,
        CATEGORIES.ACADEMIC,
        CATEGORIES.ATTENDANCE,
        CATEGORIES.EXAMINATION,
        CATEGORIES.FINANCE,
        CATEGORIES.ANNOUNCEMENT,
        CATEGORIES.SYSTEM,
        CATEGORIES.PROFILE,
        CATEGORIES.AUTHENTICATION,
      ]
    }
  };
}

function getPrincipalQuery(collegeId, baseFilters) {
  if (!collegeId) return { id: 'impossible-no-college' };
  return {
    ...baseFilters,
    college_id: collegeId,
    category: {
      in: [
        CATEGORIES.ADMINISTRATION,
        CATEGORIES.COLLEGE,
        CATEGORIES.TEACHER,
        CATEGORIES.STUDENT,
        CATEGORIES.ACADEMIC,
        CATEGORIES.EXAMINATION,
        CATEGORIES.ANNOUNCEMENT,
        CATEGORIES.ATTENDANCE,
        CATEGORIES.PROFILE,
        CATEGORIES.AUTHENTICATION,
      ]
    }
  };
}

function getRegistrarQuery(collegeId, baseFilters) {
  if (!collegeId) return { id: 'impossible-no-college' };
  return {
    ...baseFilters,
    college_id: collegeId,
    category: {
      in: [
        CATEGORIES.STUDENT,
        CATEGORIES.ACADEMIC,
        CATEGORIES.EXAMINATION,
        CATEGORIES.ANNOUNCEMENT,
        CATEGORIES.PROFILE,
        CATEGORIES.AUTHENTICATION,
      ]
    }
  };
}

function getAccountantQuery(collegeId, baseFilters) {
  if (!collegeId) return { id: 'impossible-no-college' };
  return {
    ...baseFilters,
    college_id: collegeId,
    category: {
      in: [
        CATEGORIES.FINANCE,
        CATEGORIES.ANNOUNCEMENT,
        CATEGORIES.PROFILE,
        CATEGORIES.AUTHENTICATION,
      ]
    }
  };
}

function getTeacherQuery(userId, collegeId, baseFilters) {
  if (!collegeId) return { id: 'impossible-no-college' };
  return {
    ...baseFilters,
    college_id: collegeId,
    OR: [
      { actorUserId: userId },
      { category: { in: [CATEGORIES.ACADEMIC, CATEGORIES.ASSIGNMENT, CATEGORIES.EXAMINATION, CATEGORIES.ANNOUNCEMENT, CATEGORIES.ATTENDANCE] } }
    ]
  };
}

function getStudentQuery(userId, collegeId, baseFilters) {
  if (!collegeId) return { id: 'impossible-no-college' };
  return {
    ...baseFilters,
    college_id: collegeId,
    OR: [
      { targetUserId: userId },
      { actorUserId: userId },
      {
        category: {
          in: [
            CATEGORIES.ACADEMIC,
            CATEGORIES.ASSIGNMENT,
            CATEGORIES.EXAMINATION,
            CATEGORIES.ATTENDANCE,
            CATEGORIES.ANNOUNCEMENT
          ]
        },
        targetUserId: null
      }
    ]
  };
}

function buildDateRangeClause(range, startDate, endDate) {
  const now = new Date();
  if (range === 'today') {
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return { gte: startOfDay };
  }
  if (range === 'yesterday') {
    const startOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const endOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return { gte: startOfYesterday, lt: endOfYesterday };
  }
  if (range === '7days') {
    const sevenDaysAgo = new Date(now.valueOf() - 7 * 24 * 60 * 60 * 1000);
    return { gte: sevenDaysAgo };
  }
  if (range === '30days') {
    const thirtyDaysAgo = new Date(now.valueOf() - 30 * 24 * 60 * 60 * 1000);
    return { gte: thirtyDaysAgo };
  }
  if (range === 'custom' && startDate) {
    const start = new Date(startDate);
    const end = endDate ? new Date(endDate) : new Date();
    return { gte: start, lte: end };
  }
  return null;
}

module.exports = {
  buildVisibilityQuery,
};
