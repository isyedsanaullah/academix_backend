const { getSystemClient } = require('../config/prismaManager');
const planGate = require('../middleware/planGate');

// @desc    Get global dashboard stats
// @route   GET /api/super-admin/dashboard
// @access  Private (superAdmin)
exports.getDashboard = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const [
      totalColleges,
      activeColleges,
      suspendedColleges,
      totalUsers,
      totalStudents
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
      prisma.user.count({
        where: {
          role: { not: 'superAdmin' }
        }
      }),
      prisma.user.count({
        where: {
          role: 'student'
        }
      })
    ]);

    // Recent colleges
    const recentColleges = await prisma.college.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        name: true,
        code: true,
        subscription: true,
        totalStudents: true,
        createdAt: true
      }
    });

    const formattedRecentColleges = recentColleges.map(c => ({
      ...c,
      _id: c.id
    }));

    // Colleges by plan
    const [basic, standard, premium] = await Promise.all([
      prisma.college.count({
        where: {
          subscription: {
            path: ['plan'],
            equals: 'basic'
          }
        }
      }),
      prisma.college.count({
        where: {
          subscription: {
            path: ['plan'],
            equals: 'standard'
          }
        }
      }),
      prisma.college.count({
        where: {
          subscription: {
            path: ['plan'],
            equals: 'premium'
          }
        }
      })
    ]);

    res.json({
      success: true,
      data: {
        stats: {
          totalColleges,
          activeColleges,
          suspendedColleges,
          expiredColleges: totalColleges - activeColleges - suspendedColleges,
          totalUsers,
          totalStudents
        },
        planDistribution: { basic, standard, premium },
        recentColleges: formattedRecentColleges
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get all colleges
// @route   GET /api/super-admin/colleges
// @access  Private (superAdmin)
exports.getColleges = async (req, res, next) => {
  try {
    const { status, plan, search, page = 1, limit = 10 } = req.query;
    const prisma = getSystemClient();
    const where = {};
    const andFilters = [];

    if (status) {
      andFilters.push({
        subscription: {
          path: ['status'],
          equals: status
        }
      });
    }

    if (plan) {
      andFilters.push({
        subscription: {
          path: ['plan'],
          equals: plan
        }
      });
    }

    if (search) {
      andFilters.push({
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { code: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } }
        ]
      });
    }

    if (andFilters.length > 0) {
      where.AND = andFilters;
    }

    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 10;
    const skipNum = (pageNum - 1) * limitNum;

    const total = await prisma.college.count({ where });
    const colleges = await prisma.college.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: skipNum,
      take: limitNum
    });

    const formattedColleges = colleges.map(c => ({
      ...c,
      _id: c.id
    }));

    res.json({
      success: true,
      data: formattedColleges,
      pagination: {
        total,
        page: pageNum,
        pages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Create a new college
// @route   POST /api/super-admin/colleges
// @access  Private (superAdmin)
exports.createCollege = async (req, res, next) => {
  try {
    const { name, code, email, phone, address, city, subscription, adminName, adminEmail, adminPassword, mongoUrl } = req.body;
    const prisma = getSystemClient();

    // Auto-generate local PostgreSQL URL if not provided
    const finalMongoUrl = mongoUrl || process.env.DATABASE_URL || `postgresql://postgres:Sana%40346@localhost:5432/academix?schema=public`;

    // Test the connection before saving
    const { Pool } = require('pg');
    try {
      const pool = new Pool({
        connectionString: finalMongoUrl,
        connectionTimeoutMillis: 2000
      });
      await pool.query('SELECT 1');
      await pool.end();
    } catch (connErr) {
      return res.status(400).json({
        success: false,
        message: `Cannot connect to database: ${connErr.message}`
      });
    }

    // Create college
    const college = await prisma.college.create({
      data: {
        name,
        code,
        email,
        phone,
        address,
        city,
        mongoUrl: finalMongoUrl,
        subscription: subscription || { status: 'trial', plan: 'basic' }
      }
    });

    // Create admin user for this college (in system DB)
    if (adminEmail && adminPassword) {
      const bcrypt = require('bcryptjs');
      const salt = await bcrypt.genSalt(12);
      const hashedPassword = await bcrypt.hash(adminPassword, salt);

      await prisma.user.create({
        data: {
          name: adminName || `${name} Admin`,
          email: adminEmail.toLowerCase(),
          password: hashedPassword,
          role: 'admin',
          college_id: college.id,
          authProvider: 'local'
        }
      });
    }

    res.status(201).json({
      success: true,
      data: { ...college, _id: college.id },
      message: 'College created successfully'
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single college details
// @route   GET /api/super-admin/colleges/:id
// @access  Private (superAdmin)
exports.getCollege = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const college = await prisma.college.findUnique({
      where: { id: req.params.id }
    });
    if (!college) {
      return res.status(404).json({ success: false, message: 'College not found' });
    }

    // Get college stats from system DB (User model)
    const [totalStudents, totalStaff] = await Promise.all([
      prisma.user.count({
        where: { college_id: college.id, role: 'student' }
      }),
      prisma.user.count({
        where: { college_id: college.id, role: { in: ['admin', 'teacher', 'employee'] } }
      })
    ]);

    res.json({
      success: true,
      data: {
        ...college,
        _id: college.id,
        stats: {
          totalStudents,
          totalStaff,
          totalFeeCollected: 0
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update college
// @route   PUT /api/super-admin/colleges/:id
// @access  Private (superAdmin)
exports.updateCollege = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const college = await prisma.college.update({
      where: { id: req.params.id },
      data: req.body
    });

    if (!college) {
      return res.status(404).json({ success: false, message: 'College not found' });
    }

    res.json({ success: true, data: { ...college, _id: college.id } });
  } catch (error) {
    next(error);
  }
};

// @desc    Suspend/Activate college
// @route   PUT /api/super-admin/colleges/:id/status
// @access  Private (superAdmin)
exports.toggleCollegeStatus = async (req, res, next) => {
  try {
    const { status } = req.body; // 'active' | 'suspended'
    const prisma = getSystemClient();

    const existingCollege = await prisma.college.findUnique({
      where: { id: req.params.id }
    });
    if (!existingCollege) {
      return res.status(404).json({ success: false, message: 'College not found' });
    }

    const updatedSubscription = {
      ...(typeof existingCollege.subscription === 'object' ? existingCollege.subscription : {}),
      status
    };

    const college = await prisma.college.update({
      where: { id: req.params.id },
      data: {
        subscription: updatedSubscription,
        isActive: status === 'active'
      }
    });

    res.json({ success: true, data: { ...college, _id: college.id }, message: `College ${status}` });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete college (soft delete)
// @route   DELETE /api/super-admin/colleges/:id
// @access  Private (superAdmin)
exports.deleteCollege = async (req, res, next) => {
  try {
    const prisma = getSystemClient();

    const existingCollege = await prisma.college.findUnique({
      where: { id: req.params.id }
    });
    if (!existingCollege) {
      return res.status(404).json({ success: false, message: 'College not found' });
    }

    const updatedSubscription = {
      ...(typeof existingCollege.subscription === 'object' ? existingCollege.subscription : {}),
      status: 'expired'
    };

    const college = await prisma.college.update({
      where: { id: req.params.id },
      data: {
        isActive: false,
        subscription: updatedSubscription
      }
    });

    // Deactivate all users of this college
    await prisma.user.updateMany({
      where: { college_id: college.id },
      data: { isActive: false }
    });

    res.json({ success: true, message: 'College deactivated successfully' });
  } catch (error) {
    next(error);
  }
};

// @desc    Upgrade/downgrade college plan
// @route   PUT /api/super-admin/colleges/:id/plan
// @access  Private (superAdmin)
exports.updateCollegePlan = async (req, res, next) => {
  try {
    const { plan } = req.body;
    const prisma = getSystemClient();

    if (!['basic', 'standard', 'premium'].includes(plan)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid plan. Must be: basic, standard, or premium'
      });
    }

    const college = await prisma.college.findUnique({
      where: { id: req.params.id }
    });
    if (!college) {
      return res.status(404).json({ success: false, message: 'College not found' });
    }

    const sub = { ...(typeof college.subscription === 'object' ? college.subscription : {}) };
    const oldPlan = sub.plan;
    sub.plan = plan;
    sub.features = planGate.PLAN_FEATURES[plan] || [];
    sub.startedAt = new Date();

    let isActiveUpdate = college.isActive;
    if (['expired', 'trial'].includes(sub.status)) {
      sub.status = 'active';
      isActiveUpdate = true;
    }

    // Extend expiry by 365 days on plan change
    sub.expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

    const updatedCollege = await prisma.college.update({
      where: { id: req.params.id },
      data: {
        subscription: sub,
        isActive: isActiveUpdate
      }
    });

    res.json({
      success: true,
      data: { ...updatedCollege, _id: updatedCollege.id },
      message: `Plan changed from ${oldPlan?.toUpperCase() || 'NONE'} to ${plan.toUpperCase()}`
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get subscription overview
// @route   GET /api/super-admin/subscriptions
// @access  Private (superAdmin)
exports.getSubscriptionOverview = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const colleges = await prisma.college.findMany({
      select: {
        id: true,
        name: true,
        code: true,
        subscription: true,
        createdAt: true
      }
    });

    const planDist = {};
    const statusDist = {};

    colleges.forEach(c => {
      const sub = c.subscription || {};
      const plan = sub.plan || 'basic';
      const status = sub.status || 'trial';
      planDist[plan] = (planDist[plan] || 0) + 1;
      statusDist[status] = (statusDist[status] || 0) + 1;
    });

    // Expiring soon (within 30 days)
    const thirtyDaysFromNow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const expiringSoon = colleges
      .filter(c => {
        const sub = c.subscription || {};
        if (!sub.expiresAt || !['active', 'trial'].includes(sub.status)) return false;
        const expiresDate = new Date(sub.expiresAt);
        return expiresDate <= thirtyDaysFromNow;
      })
      .sort((a, b) => new Date(a.subscription.expiresAt) - new Date(b.subscription.expiresAt))
      .slice(0, 20)
      .map(c => ({ ...c, _id: c.id }));

    // Recent plan changes
    const recentChanges = colleges
      .filter(c => {
        const sub = c.subscription || {};
        if (!sub.startedAt) return false;
        const startedDate = new Date(sub.startedAt);
        return startedDate >= thirtyDaysAgo;
      })
      .sort((a, b) => new Date(b.subscription.startedAt) - new Date(a.subscription.startedAt))
      .slice(0, 10)
      .map(c => ({ ...c, _id: c.id }));

    res.json({
      success: true,
      data: {
        planDistribution: planDist,
        statusDistribution: statusDist,
        expiringSoon,
        recentChanges
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get platform analytics
// @route   GET /api/super-admin/analytics
// @access  Private (superAdmin)
exports.getPlatformAnalytics = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const roleGroup = await prisma.user.groupBy({
      by: ['role'],
      where: {
        role: { not: 'superAdmin' }
      },
      _count: {
        _all: true
      }
    });

    const roleDistribution = roleGroup.reduce((acc, r) => {
      acc[r.role] = r._count._all;
      return acc;
    }, {});

    // Monthly college registrations (last 6 months)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const collegesLast6Months = await prisma.college.findMany({
      where: {
        createdAt: { gte: sixMonthsAgo }
      },
      select: { createdAt: true }
    });

    const monthlyCounts = {};
    collegesLast6Months.forEach(c => {
      const monthStr = c.createdAt.toISOString().slice(0, 7);
      monthlyCounts[monthStr] = (monthlyCounts[monthStr] || 0) + 1;
    });

    const monthlyRegistrations = Object.entries(monthlyCounts)
      .map(([_id, count]) => ({ _id, count }))
      .sort((a, b) => a._id.localeCompare(b._id));

    // Top colleges by student count
    const topColleges = await prisma.college.findMany({
      where: { isActive: true },
      orderBy: { totalStudents: 'desc' },
      take: 10,
      select: {
        id: true,
        name: true,
        code: true,
        totalStudents: true,
        totalStaff: true,
        subscription: true
      }
    });

    const formattedTopColleges = topColleges.map(c => ({
      ...c,
      _id: c.id
    }));

    // Total fee collected across platform
    const totalRevenueSum = await prisma.fee.aggregate({
      where: { status: 'paid' },
      _sum: { paidAmount: true }
    });

    const totalPlatformRevenue = totalRevenueSum._sum.paidAmount || 0;

    res.json({
      success: true,
      data: {
        roleDistribution,
        monthlyRegistrations,
        topColleges: formattedTopColleges,
        totalPlatformRevenue
      }
    });
  } catch (error) {
    next(error);
  }
};
