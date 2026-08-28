// ─── Analytics Controller (Multi-DB with Prisma) ───────────────────
// SuperAdmin platform-wide analytics — uses SYSTEM DB only
const { getSystemClient } = require('../config/prismaManager');

exports.getOverview = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const [totalColleges, activeColleges, totalUsers] = await Promise.all([
      prisma.college.count(),
      prisma.college.count({ where: { isActive: true } }),
      prisma.user.count()
    ]);

    const roleGroups = await prisma.user.groupBy({
      by: ['role'],
      _count: { role: true }
    });
    const roleBreakdown = roleGroups.map(g => ({
      _id: g.role,
      count: g._count.role
    })).sort((a, b) => b.count - a.count);

    // Group plan breakdown in JS
    const collegesForPlans = await prisma.college.findMany({
      select: { subscription: true }
    });
    const planCounts = {};
    for (const c of collegesForPlans) {
      const plan = c.subscription?.plan || 'basic';
      planCounts[plan] = (planCounts[plan] || 0) + 1;
    }
    const planBreakdown = Object.entries(planCounts).map(([plan, count]) => ({
      _id: plan,
      count
    })).sort((a, b) => b.count - a.count);

    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

    // Monthly registrations in JS
    const usersForMonthly = await prisma.user.findMany({
      where: { createdAt: { gte: twelveMonthsAgo } },
      select: { createdAt: true }
    });
    const monthlyUsersMap = {};
    for (const u of usersForMonthly) {
      const d = new Date(u.createdAt);
      const year = d.getFullYear();
      const month = d.getMonth() + 1;
      const key = `${year}-${month}`;
      if (!monthlyUsersMap[key]) {
        monthlyUsersMap[key] = { _id: { year, month }, count: 0 };
      }
      monthlyUsersMap[key].count++;
    }
    const monthlyRegistrationsData = Object.values(monthlyUsersMap).sort(
      (a, b) => a._id.year - b._id.year || a._id.month - b._id.month
    );

    // Monthly colleges in JS
    const collegesForMonthly = await prisma.college.findMany({
      where: { createdAt: { gte: twelveMonthsAgo } },
      select: { createdAt: true }
    });
    const monthlyCollegesMap = {};
    for (const c of collegesForMonthly) {
      const d = new Date(c.createdAt);
      const year = d.getFullYear();
      const month = d.getMonth() + 1;
      const key = `${year}-${month}`;
      if (!monthlyCollegesMap[key]) {
        monthlyCollegesMap[key] = { _id: { year, month }, count: 0 };
      }
      monthlyCollegesMap[key].count++;
    }
    const monthlyCollegesData = Object.values(monthlyCollegesMap).sort(
      (a, b) => a._id.year - b._id.year || a._id.month - b._id.month
    );

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Daily logins in JS
    const usersForDailyLogins = await prisma.user.findMany({
      where: { lastLogin: { gte: thirtyDaysAgo } },
      select: { lastLogin: true }
    });
    const dailyLoginsMap = {};
    for (const u of usersForDailyLogins) {
      if (!u.lastLogin) continue;
      const d = new Date(u.lastLogin);
      const year = d.getFullYear();
      const month = d.getMonth() + 1;
      const day = d.getDate();
      const key = `${year}-${month}-${day}`;
      if (!dailyLoginsMap[key]) {
        dailyLoginsMap[key] = { _id: { year, month, day }, count: 0 };
      }
      dailyLoginsMap[key].count++;
    }
    const dailyLoginsData = Object.values(dailyLoginsMap).sort(
      (a, b) => a._id.year - b._id.year || a._id.month - b._id.month || a._id.day - b._id.day
    );

    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const formatMonthly = (data) => data.map(d => ({
      label: `${months[d._id.month - 1]} ${d._id.year}`,
      month: d._id.month,
      year: d._id.year,
      count: d.count
    }));
    const formatDaily = (data) => data.map(d => ({
      label: `${d._id.day}/${d._id.month}`,
      count: d.count
    }));

    const totalStudents = await prisma.user.count({ where: { role: 'student' } });
    const totalTeachers = await prisma.user.count({ where: { role: 'teacher' } });

    res.json({
      success: true,
      data: {
        totals: { colleges: totalColleges, activeColleges, users: totalUsers, students: totalStudents, teachers: totalTeachers },
        roleBreakdown: roleBreakdown.map(r => ({ role: r._id, count: r.count })),
        planBreakdown: planBreakdown.map(p => ({ plan: p._id || 'basic', count: p.count })),
        monthlyRegistrations: formatMonthly(monthlyRegistrationsData),
        monthlyColleges: formatMonthly(monthlyCollegesData),
        dailyLogins: formatDaily(dailyLoginsData)
      }
    });
  } catch (error) { next(error); }
};

exports.getCollegeAnalytics = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const colleges = await prisma.college.findMany({
      select: {
        id: true,
        name: true,
        code: true,
        isActive: true,
        subscription: true,
        createdAt: true
      }
    });

    const collegeData = await Promise.all(colleges.map(async (c) => {
      const users = await prisma.user.count({ where: { college_id: c.id } });
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const activeUsers = await prisma.user.count({
        where: { college_id: c.id, lastLogin: { gte: thirtyDaysAgo } }
      });
      
      const rolesGroups = await prisma.user.groupBy({
        by: ['role'],
        where: { college_id: c.id },
        _count: { role: true }
      });

      const roles = rolesGroups.reduce((acc, rg) => {
        acc[rg.role] = rg._count.role;
        return acc;
      }, {});

      return {
        _id: c.id,
        name: c.name,
        code: c.code,
        isActive: c.isActive,
        plan: c.subscription?.plan || 'basic',
        createdAt: c.createdAt,
        users,
        activeUsers,
        students: roles.student || 0,
        teachers: roles.teacher || 0,
        roles
      };
    }));

    res.json({ success: true, data: collegeData });
  } catch (error) { next(error); }
};

exports.getLoginTrends = async (req, res, next) => {
  try {
    const { days = 30 } = req.query;
    const prisma = getSystemClient();
    const since = new Date();
    since.setDate(since.getDate() - parseInt(days));

    // Logins by role: group by date and role in JS
    const users = await prisma.user.findMany({
      where: { lastLogin: { gte: since } },
      select: { lastLogin: true, role: true }
    });

    const loginsByRoleMap = {};
    for (const u of users) {
      if (!u.lastLogin) continue;
      const dateStr = new Date(u.lastLogin).toISOString().split('T')[0];
      const key = `${dateStr}_${u.role}`;
      if (!loginsByRoleMap[key]) {
        loginsByRoleMap[key] = {
          _id: { day: dateStr, role: u.role },
          count: 0
        };
      }
      loginsByRoleMap[key].count++;
    }
    const loginsByRole = Object.values(loginsByRoleMap).sort((a, b) => a._id.day.localeCompare(b._id.day));

    // Top colleges by login count in JS
    const usersWithCollege = await prisma.user.findMany({
      where: {
        lastLogin: { gte: since },
        college_id: { not: null }
      },
      select: { college_id: true }
    });

    const collegeLoginCounts = {};
    for (const u of usersWithCollege) {
      collegeLoginCounts[u.college_id] = (collegeLoginCounts[u.college_id] || 0) + 1;
    }

    const sortedColleges = Object.entries(collegeLoginCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    const topColleges = await Promise.all(sortedColleges.map(async ([collegeId, logins]) => {
      const college = await prisma.college.findUnique({
        where: { id: collegeId },
        select: { name: true, code: true }
      });
      return {
        _id: collegeId,
        name: college?.name || 'Unknown',
        code: college?.code || 'N/A',
        logins
      };
    }));

    res.json({ success: true, data: { loginsByRole, topColleges } });
  } catch (error) { next(error); }
};
