const { getSystemClient } = require('../config/prismaManager');
const { normalizePlanId } = require('../config/planConstants');

/**
 * Super Admin Ground-Truth Data Engine
 * Queries actual PostgreSQL database tables with Prisma for authorized report metrics.
 */

async function fetchPlatformSummary() {
  const prisma = getSystemClient();
  const [
    totalColleges,
    activeColleges,
    suspendedColleges,
    totalStudents,
    totalStaff,
    collegesWithAI
  ] = await Promise.all([
    prisma.college.count(),
    prisma.college.count({
      where: {
        subscription: {
          path: ['status'],
          equals: 'active'
        }
      }
    }),
    prisma.college.count({
      where: {
        subscription: {
          path: ['status'],
          equals: 'suspended'
        }
      }
    }),
    prisma.user.count({ where: { role: 'student' } }),
    prisma.user.count({ where: { role: { in: ['admin', 'teacher', 'employee', 'principal', 'registrar', 'accountant'] } } }),
    prisma.college.count({
      where: {
        subscription: {
          path: ['plan'],
          string_contains: 'prem'
        }
      }
    })
  ]);

  return {
    totalColleges,
    activeColleges,
    suspendedColleges,
    totalStudents,
    totalStaff,
    collegesWithAI
  };
}

async function fetchCollegesList({ sortBy = 'students_count', sortOrder = 'desc', limit = 20, status, plan } = {}) {
  const prisma = getSystemClient();
  const where = {};

  if (status) {
    where.subscription = {
      path: ['status'],
      equals: status.toLowerCase()
    };
  }

  const colleges = await prisma.college.findMany({
    where,
    select: {
      id: true,
      name: true,
      code: true,
      city: true,
      subscription: true,
      createdAt: true
    },
    take: 100 // Fetch up to 100 to aggregate and sort
  });

  // Fetch student & staff counts for each college
  const collegeIds = colleges.map(c => c.id);
  const studentCounts = await prisma.user.groupBy({
    by: ['college_id'],
    where: { college_id: { in: collegeIds }, role: 'student' },
    _count: { id: true }
  });
  const staffCounts = await prisma.user.groupBy({
    by: ['college_id'],
    where: { college_id: { in: collegeIds }, role: { in: ['admin', 'teacher', 'employee', 'principal', 'registrar', 'accountant'] } },
    _count: { id: true }
  });

  const studentCountMap = {};
  studentCounts.forEach(s => { studentCountMap[s.college_id] = s._count.id; });

  const staffCountMap = {};
  staffCounts.forEach(s => { staffCountMap[s.college_id] = s._count.id; });

  const rows = colleges.map(c => {
    const sub = (typeof c.subscription === 'object' && c.subscription !== null) ? c.subscription : {};
    return {
      id: c.id,
      code: c.code || 'N/A',
      name: c.name || 'Unnamed College',
      city: c.city || 'N/A',
      plan: normalizePlanId(sub.plan || 'basic').toUpperCase(),
      status: (sub.status || 'active').toUpperCase(),
      students_count: studentCountMap[c.id] || 0,
      staff_count: staffCountMap[c.id] || 0,
      created_at: c.createdAt ? new Date(c.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A',
      expires_at: sub.expiresAt ? new Date(sub.expiresAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Perpetual'
    };
  });

  // Sort rows based on requested sort field
  rows.sort((a, b) => {
    let valA = a[sortBy];
    let valB = b[sortBy];
    if (typeof valA === 'string') valA = valA.toLowerCase();
    if (typeof valB === 'string') valB = valB.toLowerCase();
    if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
    if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
    return 0;
  });

  return rows.slice(0, limit);
}

async function fetchSubscriptionBreakdown() {
  const prisma = getSystemClient();
  const colleges = await prisma.college.findMany({
    select: { subscription: true }
  });

  const breakdown = {
    basic: 0,
    standard: 0,
    premium: 0,
    active: 0,
    suspended: 0
  };

  colleges.forEach(c => {
    const sub = (typeof c.subscription === 'object' && c.subscription !== null) ? c.subscription : {};
    const plan = normalizePlanId(sub.plan || 'basic');
    breakdown[plan] = (breakdown[plan] || 0) + 1;
    if (sub.status === 'suspended') breakdown.suspended++;
    else breakdown.active++;
  });

  return breakdown;
}

async function fetchExpiringSubscriptions({ daysAhead = 60 } = {}) {
  const prisma = getSystemClient();
  const colleges = await prisma.college.findMany({
    select: {
      id: true,
      name: true,
      code: true,
      email: true,
      subscription: true
    }
  });

  const now = new Date();
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + daysAhead);

  const expiring = [];

  colleges.forEach(c => {
    const sub = (typeof c.subscription === 'object' && c.subscription !== null) ? c.subscription : {};
    if (sub.expiresAt) {
      const expiry = new Date(sub.expiresAt);
      if (expiry >= now && expiry <= targetDate) {
        const daysRemaining = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        expiring.push({
          id: c.id,
          code: c.code || 'N/A',
          name: c.name || 'Unnamed College',
          email: c.email || 'N/A',
          plan: normalizePlanId(sub.plan || 'basic').toUpperCase(),
          status: (sub.status || 'active').toUpperCase(),
          expires_at: expiry.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
          days_remaining: `${daysRemaining} Days`
        });
      }
    }
  });

  expiring.sort((a, b) => parseInt(a.days_remaining) - parseInt(b.days_remaining));
  return expiring;
}

async function fetchActivityAudit({ limit = 15 } = {}) {
  const prisma = getSystemClient();
  const logs = await prisma.auditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      action: true,
      resource: true,
      details: true,
      createdAt: true,
      user_id: true
    }
  });

  return logs.map(l => ({
    action: l.action || 'SYSTEM_EVENT',
    actor: l.user_id ? 'Super Admin' : 'System',
    category: l.resource || 'General',
    title: l.details || l.action,
    created_at: new Date(l.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }));
}

async function fetchCollegeDetail(collegeId) {
  if (!collegeId) return null;
  const prisma = getSystemClient();
  const college = await prisma.college.findUnique({
    where: { id: collegeId }
  });
  if (!college) return null;

  const [studentsCount, staffCount] = await Promise.all([
    prisma.user.count({ where: { college_id: collegeId, role: 'student' } }),
    prisma.user.count({ where: { college_id: collegeId, role: { in: ['admin', 'teacher', 'employee', 'principal'] } } })
  ]);

  const sub = (typeof college.subscription === 'object' && college.subscription !== null) ? college.subscription : {};

  return {
    id: college.id,
    name: college.name,
    code: college.code,
    city: college.city || 'N/A',
    email: college.email || 'N/A',
    phone: college.phone || 'N/A',
    plan: normalizePlanId(sub.plan || 'basic').toUpperCase(),
    status: (sub.status || 'active').toUpperCase(),
    studentsCount,
    staffCount,
    expiresAt: sub.expiresAt ? new Date(sub.expiresAt).toLocaleDateString() : 'Perpetual'
  };
}

module.exports = {
  fetchPlatformSummary,
  fetchCollegesList,
  fetchSubscriptionBreakdown,
  fetchExpiringSubscriptions,
  fetchActivityAudit,
  fetchCollegeDetail
};
