const prismaManager = require('../config/prismaManager');
const getSystemClient = () => prismaManager.getSystemClient();
const planGate = require('../middleware/planGate');
const { resolveCollegeFeatures, FEATURE_REGISTRY } = require('../config/featureRegistry');
const { logActivity } = require('../services/activityLog.service');
const { clearEntitlementCache, getFeatureFlags } = require('../middleware/loadEntitlements');
const { FEATURES } = require('../services/capabilityCatalog');
const { fromCollege, parseOverrides, resolveCollege, legacyEffectiveKeys } = require('../services/collegeAdapter');
const { impact } = require('../services/entitlements.v2');
const { closeSelection, preview, price, getPricingConfig, updateCustomPricing, PRICING } = require('../services/customPlan');

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
        subscription: subscription || { status: 'trial', plan: 'starter' }
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

    // Resolve feature access matrix dynamically
    const subscription = (typeof college.subscription === 'object' && college.subscription !== null)
      ? college.subscription
      : {};
    const plan = subscription.plan || 'basic';
    const featureOverrides = subscription.featureOverrides || {};
    const features = resolveCollegeFeatures(plan, featureOverrides);

    res.json({
      success: true,
      data: {
        ...college,
        _id: college.id,
        stats: {
          totalStudents,
          totalStaff,
          totalFeeCollected: 0
        },
        features
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update college-specific feature overrides
// @route   PUT /api/super-admin/colleges/:id/features
// @access  Private (superAdmin)
exports.updateCollegeFeatures = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const { id } = req.params;
    const { overrides, reason } = req.body;

    const college = await prisma.college.findUnique({
      where: { id }
    });
    if (!college) {
      return res.status(404).json({ success: false, message: 'College not found' });
    }

    const currentSub = (typeof college.subscription === 'object' && college.subscription !== null)
      ? college.subscription
      : {};
    const prevOverrides = currentSub.featureOverrides || {};

    // Sanitize overrides: accept boolean OR { state: 'on'|'off', expiresAt, reason }
    const validCatalogKeys = new Set(FEATURES.map(f => f.key));
    const validRegistryKeys = new Set(FEATURE_REGISTRY.map(f => f.key));
    const cleanOverrides = {};

    if (overrides && typeof overrides === 'object') {
      for (const [key, val] of Object.entries(overrides)) {
        if (validCatalogKeys.has(key) || validRegistryKeys.has(key)) {
          if (val === true || val === false) {
            cleanOverrides[key] = val;
          } else if (val && typeof val === 'object') {
            const state = String(val.state || '').toLowerCase();
            if (state === 'on' || state === 'off') {
              cleanOverrides[key] = {
                state,
                expiresAt: val.expiresAt ? new Date(val.expiresAt).toISOString() : null,
                reason: val.reason || reason || null,
                by: req.user?.email || req.user?.id || 'superAdmin'
              };
            }
          }
        }
      }
    }

    const updatedSub = {
      ...currentSub,
      featureOverrides: cleanOverrides
    };

    const updatedCollege = await prisma.college.update({
      where: { id },
      data: {
        subscription: updatedSub
      }
    });

    // Write audit rows for each modified key
    const allKeys = new Set([...Object.keys(prevOverrides), ...Object.keys(cleanOverrides)]);
    for (const key of allKeys) {
      const prevVal = prevOverrides[key];
      const newVal = cleanOverrides[key];
      if (JSON.stringify(prevVal) !== JSON.stringify(newVal)) {
        let action = 'RESET';
        if (newVal === true || newVal?.state === 'on') action = 'OVERRIDE_ON';
        else if (newVal === false || newVal?.state === 'off') action = 'OVERRIDE_OFF';

        await prisma.collegeEntitlementAudit.create({
          data: {
            college_id: id,
            actorUserId: req.user?.id || req.user?._id || 'system',
            actorEmail: req.user?.email || null,
            action,
            featureKey: key,
            previousVal: prevVal !== undefined ? JSON.stringify(prevVal) : null,
            newVal: newVal !== undefined ? JSON.stringify(newVal) : null,
            reason: reason || (typeof newVal === 'object' ? newVal.reason : null) || null
          }
        }).catch(err => console.error('Audit logging error:', err.message));
      }
    }

    // Log Activity
    try {
      logActivity({
        college_id: college.id,
        actorUser: req.user,
        action: 'UPDATE_FEATURES',
        category: 'College',
        resourceType: 'College',
        resourceId: college.id,
        title: `Updated Feature Overrides for ${college.name}`,
        description: `Super Admin updated feature overrides for ${college.name}.`,
        metadata: {
          overrides: cleanOverrides
        }
      });
    } catch (logErr) {
      console.error('Feature update activity log error:', logErr.message);
    }

    clearEntitlementCache(id);

    // Resolve with new adapter
    const flags = await getFeatureFlags();
    const groups = await prisma.group.findMany({
      where: { college_id: id, isActive: true },
      select: { name: true },
      distinct: ['name']
    });
    const ent = resolveCollege(updatedCollege, { groupNames: groups.map(g => g.name), flags });
    const effectiveKeys = legacyEffectiveKeys(ent);

    res.json({
      success: true,
      message: 'Feature overrides updated successfully',
      data: {
        ...updatedCollege,
        _id: updatedCollege.id,
        features: {
          effectiveKeys,
          features: ent.features
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

    clearEntitlementCache(req.params.id);

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

    // Write audit record
    await prisma.collegeEntitlementAudit.create({
      data: {
        college_id: req.params.id,
        actorUserId: req.user?.id || req.user?._id || 'system',
        actorEmail: req.user?.email || null,
        action: status === 'active' ? 'RESET' : 'OVERRIDE_OFF',
        featureKey: null,
        previousVal: existingCollege.subscription?.status || (existingCollege.isActive ? 'active' : 'suspended'),
        newVal: status,
        reason: req.body.reason || null
      }
    }).catch(err => console.error('Audit logging error:', err.message));

    clearEntitlementCache(req.params.id);

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
    const { plan, reason } = req.body;
    const prisma = getSystemClient();

    if (!['starter', 'basic', 'standard', 'premium', 'enterprise'].includes(plan)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid plan. Must be: starter, standard, premium, or enterprise'
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

    // Write audit record
    await prisma.collegeEntitlementAudit.create({
      data: {
        college_id: req.params.id,
        actorUserId: req.user?.id || req.user?._id || 'system',
        actorEmail: req.user?.email || null,
        action: 'PLAN_CHANGE',
        featureKey: null,
        previousVal: oldPlan || null,
        newVal: plan,
        reason: reason || req.body.reason || null
      }
    }).catch(err => console.error('Audit logging error:', err.message));

    clearEntitlementCache(req.params.id);

    res.json({
      success: true,
      data: { ...updatedCollege, _id: updatedCollege.id },
      message: `Plan changed from ${oldPlan?.toUpperCase() || 'NONE'} to ${plan.toUpperCase()}`
    });
  } catch (error) {
    next(error);
  }
};

exports.changeCollegePlan = exports.updateCollegePlan;

// @desc    Preview impact of feature changes
// @route   POST /api/super-admin/colleges/:id/features/preview
// @access  Private (superAdmin)
exports.previewCollegeFeatures = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const { id } = req.params;
    const { overrides = {} } = req.body;

    const college = await prisma.college.findUnique({
      where: { id },
      select: { id: true, isActive: true, subscription: true, settings: true }
    });
    if (!college) {
      return res.status(404).json({ success: false, message: 'College not found' });
    }

    const groups = await prisma.group.findMany({
      where: { college_id: id, isActive: true },
      select: { name: true },
      distinct: ['name']
    });

    const flags = await getFeatureFlags();
    const baseArgs = fromCollege(college, { groupNames: groups.map(g => g.name), flags });

    // Parse proposed overrides
    const proposedOverrides = parseOverrides(overrides, new Date());
    const result = impact(baseArgs, { overrides: proposedOverrides });

    res.json({
      success: true,
      data: {
        turnedOff: result.turnedOff,
        turnedOn: result.turnedOn,
        switched: result.switched,
        nowDegraded: result.nowDegraded,
        effectiveKeys: result.after?.keys || []
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get entitlement audit history for a college
// @route   GET /api/super-admin/colleges/:id/audit
// @access  Private (superAdmin)
exports.getCollegeAudit = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const { id } = req.params;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 50;
    const skip = (page - 1) * limit;

    const total = await prisma.collegeEntitlementAudit.count({
      where: { college_id: id }
    });

    const audits = await prisma.collegeEntitlementAudit.findMany({
      where: { college_id: id },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit
    });

    res.json({
      success: true,
      data: audits,
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit)
      }
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

// -----------------------------------------------------------------------------
// Phase 9: Custom Plan Builder Endpoints
// -----------------------------------------------------------------------------

// @desc    Preview custom plan closure, dependency impact, and dynamic price
// @route   POST /api/superadmin/custom-plan/preview
// @access  Private (superAdmin)
exports.previewCustomPlan = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const { keys = [], collegeId, students = 300, storageGb = 5, methodPrefs = {} } = req.body;

    let college = null;
    let groupNames = [];
    if (collegeId) {
      college = await prisma.college.findUnique({ where: { id: collegeId } });
      if (college) {
        const groups = await prisma.group.findMany({
          where: { college_id: collegeId, isActive: true },
          select: { name: true },
          distinct: ['name']
        });
        groupNames = groups.map(g => g.name);
      }
    }

    if (!college) {
      college = {
        id: collegeId || 'preview-college',
        isActive: true,
        subscription: { plan: 'custom', status: 'active' },
        settings: {}
      };
    }

    const { keys: closedKeys, added } = closeSelection(keys);
    const prev = preview({
      keys: closedKeys,
      college: {
        id: college.id,
        isActive: true,
        groups: groupNames.length ? groupNames : (college.settings?.programs || college.settings?.groupsOffered || [])
      },
      methodPrefs
    });

    const pricingConfig = await getPricingConfig(prisma);
    const prc = price({ keys: closedKeys, students: Number(students), storageGb: Number(storageGb), pricing: pricingConfig });

    res.json({
      success: true,
      data: {
        addedAutomatically: added,
        preview: prev,
        price: prc
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Save custom plan for a college with auto-incrementing version
// @route   POST /api/superadmin/colleges/:id/custom-plan
// @access  Private (superAdmin)
exports.saveCollegeCustomPlan = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const { id } = req.params;
    const { keys = [], limits = {}, reason = 'Custom plan configured by Super Admin', methodPrefs = {} } = req.body;

    if (!Array.isArray(keys)) {
      return res.status(400).json({ success: false, message: 'keys must be an array of feature keys' });
    }

    // Reject keys whose catalog status is 'planned'
    for (const k of keys) {
      const feat = FEATURES.find(f => f.key === k);
      if (feat && feat.status === 'planned') {
        return res.status(400).json({
          success: false,
          code: 'PLANNED_FEATURE_REJECTED',
          message: `Feature '${k}' is planned and cannot be included in a custom plan.`
        });
      }
    }

    const existingCollege = await prisma.college.findUnique({ where: { id } });
    if (!existingCollege) {
      return res.status(404).json({ success: false, message: 'College not found' });
    }

    const sub = (existingCollege.subscription && typeof existingCollege.subscription === 'object')
      ? existingCollege.subscription
      : {};

    const currentVersion = Number(sub.customPlan?.version || 0);
    const newVersion = currentVersion + 1;

    const customPlan = {
      id: sub.customPlan?.id || `custom-${id}`,
      version: newVersion,
      keys,
      savedAt: new Date().toISOString()
    };

    const updatedSubscription = {
      ...sub,
      plan: 'custom',
      customPlan,
      limits: { ...(sub.limits || {}), ...limits },
      methodPrefs: { ...(sub.methodPrefs || {}), ...methodPrefs }
    };

    const updatedCollege = await prisma.college.update({
      where: { id },
      data: { subscription: updatedSubscription }
    });

    // Write audit row
    await prisma.collegeEntitlementAudit.create({
      data: {
        college_id: id,
        actorUserId: req.user?.id || req.user?._id || 'superadmin',
        actorEmail: req.user?.email || null,
        action: 'CUSTOM_PLAN_SAVE',
        featureKey: null,
        previousVal: JSON.stringify(sub.customPlan || {}),
        newVal: JSON.stringify(customPlan),
        reason
      }
    });

    clearEntitlementCache(id);

    res.json({
      success: true,
      message: 'Custom plan saved successfully',
      version: newVersion,
      data: {
        ...updatedCollege,
        customPlan
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get custom plan pricing blueprint
// @route   GET /api/superadmin/custom-plan/pricing
// @access  Private (superAdmin)
exports.getCustomPricing = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const config = await getPricingConfig(prisma);
    res.json({ success: true, data: config });
  } catch (error) {
    next(error);
  }
};

// @desc    Update custom plan pricing blueprint
// @route   PUT /api/superadmin/custom-plan/pricing
// @access  Private (superAdmin)
exports.updateCustomPricingConfig = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const updated = await updateCustomPricing(prisma, req.body);
    res.json({ success: true, message: 'Pricing blueprint updated', data: updated });
  } catch (error) {
    next(error);
  }
};

// ══════════════════════════════════════════════════════════════════════════════
// PLATFORM INVOICE & SUBSCRIPTION BILLING (Phase 12)
// ══════════════════════════════════════════════════════════════════════════════

let platformBrandingCache = null;

async function getPlatformBrandingConfig(prisma) {
  if (platformBrandingCache) return platformBrandingCache;
  try {
    const row = await prisma.subscription.findUnique({
      where: { planId: 'platform-branding' }
    });
    if (row && row.limits) {
      platformBrandingCache = row.limits;
      return platformBrandingCache;
    }
  } catch {}
  return {
    name: 'ACADEMIX ENTERPRISE CLOUD',
    primaryColor: '#0F172A',
    accentColor: '#F59E0B'
  };
}

exports.createPlatformInvoice = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const { college_id, planId, periodStart, periodEnd, amount } = req.body;

    if (!college_id || !periodStart || !periodEnd || amount === undefined) {
      return res.status(400).json({
        success: false,
        message: 'college_id, periodStart, periodEnd, and amount are required'
      });
    }

    const college = await prisma.college.findUnique({ where: { id: college_id } });
    if (!college) {
      return res.status(404).json({ success: false, message: 'College not found' });
    }

    const { generateVerifyToken } = require('../services/documentTemplates');
    const invoiceNo = `PINV-${Date.now().toString(36).toUpperCase()}-${Math.floor(100 + Math.random() * 900)}`;
    const verifyToken = generateVerifyToken();

    const invoice = await prisma.platformInvoice.create({
      data: {
        college_id,
        invoiceNo,
        planId: planId || college.subscription?.plan || 'standard',
        periodStart: new Date(periodStart),
        periodEnd: new Date(periodEnd),
        amount: Number(amount),
        status: 'unpaid',
        verifyToken
      }
    });

    const { recordVerifyToken } = require('../services/verifyToken.service');
    await recordVerifyToken({
      token: verifyToken,
      collegeId: college_id,
      kind: 'invoice',
      refId: invoice.id
    }).catch(err => console.error('Failed to record verifyToken for invoice:', err.message));

    res.status(201).json({
      success: true,
      message: 'Platform invoice created successfully',
      data: invoice
    });
  } catch (error) { next(error); }
};

exports.getPlatformInvoices = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const invoices = await prisma.platformInvoice.findMany({
      orderBy: { createdAt: 'desc' }
    });

    const collegeIds = [...new Set(invoices.map(i => i.college_id))];
    const colleges = await prisma.college.findMany({
      where: { id: { in: collegeIds } },
      select: { id: true, name: true, code: true, city: true, email: true }
    });
    const colMap = {};
    colleges.forEach(c => { colMap[c.id] = c; });

    const data = invoices.map(inv => ({
      ...inv,
      college: colMap[inv.college_id] || null
    }));

    res.json({ success: true, count: data.length, data });
  } catch (error) { next(error); }
};

exports.payPlatformInvoice = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { method, reference, proof_file_id } = req.body;
    const prisma = getSystemClient();

    const invoice = await prisma.platformInvoice.findUnique({ where: { id } });
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    const updated = await prisma.platformInvoice.update({
      where: { id },
      data: {
        status: 'paid',
        paidAt: new Date(),
        method: method || 'bank',
        reference: reference || null,
        proof_file_id: proof_file_id || null,
        verifiedBy: req.user.email || req.user.name || 'superAdmin'
      }
    });

    res.json({
      success: true,
      message: 'Platform invoice marked as paid',
      data: updated
    });
  } catch (error) { next(error); }
};

exports.downloadPlatformInvoicePDF = async (req, res, next) => {
  try {
    const { id } = req.params;
    const prisma = getSystemClient();

    const invoice = await prisma.platformInvoice.findUnique({ where: { id } });
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    const college = await prisma.college.findUnique({ where: { id: invoice.college_id } });
    const { generatePlatformInvoicePDF } = require('../services/documentTemplates');

    const branding = await getPlatformBrandingConfig(prisma);
    const baseUrl = process.env.FRONTEND_URL || `${req.protocol}://${req.get('host')}`;

    const pdfDoc = await generatePlatformInvoicePDF({
      invoice,
      college,
      isPaid: false,
      branding,
      verifyBaseUrl: baseUrl
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="invoice_${invoice.invoiceNo}.pdf"`);
    res.setHeader('Cache-Control', 'no-store');

    pdfDoc.pipe(res);
    pdfDoc.end();
  } catch (error) { next(error); }
};

exports.downloadPlatformReceiptPDF = async (req, res, next) => {
  try {
    const { id } = req.params;
    const prisma = getSystemClient();

    const invoice = await prisma.platformInvoice.findUnique({ where: { id } });
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    if (invoice.status !== 'paid') {
      return res.status(400).json({
        success: false,
        code: 'INVOICE_NOT_PAID',
        message: 'Paid receipt can only be generated for paid invoices'
      });
    }

    const college = await prisma.college.findUnique({ where: { id: invoice.college_id } });
    const { generatePlatformInvoicePDF } = require('../services/documentTemplates');

    const branding = await getPlatformBrandingConfig(prisma);
    const baseUrl = process.env.FRONTEND_URL || `${req.protocol}://${req.get('host')}`;

    const pdfDoc = await generatePlatformInvoicePDF({
      invoice,
      college,
      isPaid: true,
      branding,
      verifyBaseUrl: baseUrl
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="receipt_${invoice.invoiceNo}.pdf"`);
    res.setHeader('Cache-Control', 'no-store');

    pdfDoc.pipe(res);
    pdfDoc.end();
  } catch (error) { next(error); }
};

exports.uploadPlatformSignature = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No signature file uploaded' });
    }

    const { optimizeImage } = require('../services/mediaOptimizer');
    const opt = await optimizeImage(req.file.buffer, {
      entityType: 'Signature',
      removeBackground: true,
      bgThreshold: 240
    });

    const prisma = getSystemClient();
    const branding = await getPlatformBrandingConfig(prisma);
    const sigBase64 = `data:image/png;base64,${opt.buffer.toString('base64')}`;

    const updatedBranding = {
      ...branding,
      superAdminSignature: sigBase64
    };

    await prisma.subscription.upsert({
      where: { planId: 'platform-branding' },
      create: {
        planId: 'platform-branding',
        name: 'Platform Branding',
        limits: updatedBranding,
        features: [],
        restrictions: [],
        roles: ['superAdmin']
      },
      update: {
        limits: updatedBranding
      }
    });

    platformBrandingCache = updatedBranding;

    res.json({
      success: true,
      message: 'Super admin platform signature uploaded successfully',
      data: { format: 'png', sizeBytes: opt.sizeBytes }
    });
  } catch (error) { next(error); }
};


