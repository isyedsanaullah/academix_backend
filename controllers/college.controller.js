const bcrypt = require('bcryptjs');
const { getSystemClient } = require('../config/prismaManager');
const { resolveFileUrl } = require('../services/fileResolver');

exports.getCollegeInfo = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const college = await prisma.college.findUnique({
      where: { id: req.collegeId }
    });
    if (!college) return res.status(404).json({ success: false, message: 'College not found' });

    const contacts = await prisma.user.findMany({
      where: {
        college_id: req.collegeId,
        role: { in: ['admin', 'principal', 'registrar', 'accountant'] },
        isActive: true
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        phone: true
      }
    });

    const formattedContacts = contacts.map(c => ({
      ...c,
      _id: c.id
    }));

    // Resolve R2 reference for logo
    const resolvedLogo = await resolveFileUrl(college.logo, req.tenantClient || prisma, req.collegeId);

    res.json({
      success: true,
      data: {
        name: college.name,
        code: college.code,
        email: college.email,
        phone: college.phone,
        address: college.address,
        city: college.city,
        website: college.website,
        logo: resolvedLogo || college.logo,
        subscription: { plan: college.subscription?.plan },
        contacts: formattedContacts
      }
    });
  } catch (error) { next(error); }
};

const getKarachiMidnight = (date = new Date()) => {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find(p => p.type === 'year').value;
  const month = parts.find(p => p.type === 'month').value;
  const day = parts.find(p => p.type === 'day').value;
  return new Date(`${year}-${month}-${day}T00:00:00+05:00`);
};

exports.getDashboard = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const tenantClient = req.tenantClient || prisma;
    const collegeId = req.collegeId;

    const [college, totalStudents, activeStudents, totalTeachers, totalEmployees] = await Promise.all([
      prisma.college.findUnique({ where: { id: collegeId } }),
      tenantClient.student.count({ where: { college_id: collegeId } }),
      tenantClient.student.count({ where: { college_id: collegeId, status: 'active' } }),
      prisma.user.count({ where: { college_id: collegeId, role: 'teacher' } }),
      prisma.user.count({ where: { college_id: collegeId, role: 'employee' } })
    ]);
    if (!college) return res.status(404).json({ success: false, message: 'College not found' });

    const currentMonth = new Date().toISOString().slice(0, 7);
    const feeGroup = await tenantClient.fee.groupBy({
      by: ['status'],
      where: {
        college_id: collegeId,
        month: currentMonth
      },
      _count: {
        _all: true
      },
      _sum: {
        totalAmount: true,
        paidAmount: true
      }
    });

    const feeStats = feeGroup.map(g => ({
      _id: g.status,
      count: g._count._all,
      total: g._sum.totalAmount || 0,
      paid: g._sum.paidAmount || 0
    }));

    const todayKarachi = getKarachiMidnight();
    const tomorrowKarachi = new Date(todayKarachi);
    tomorrowKarachi.setDate(tomorrowKarachi.getDate() + 1);

    // Fetch all GateLogs today to compute currently inside metrics
    const gateLogsToday = await tenantClient.gateLog.findMany({
      where: { college_id: collegeId, date: todayKarachi },
      orderBy: { timestamp: 'asc' }
    });

    const latestStatePerPerson = {};
    for (const log of gateLogsToday) {
      latestStatePerPerson[log.personId] = {
        personType: log.personType,
        action: log.action
      };
    }

    const currentlyInsideStudents = Object.values(latestStatePerPerson).filter(
      p => p.personType === 'student' && p.action === 'entry'
    ).length;

    const currentlyInsideStaff = Object.values(latestStatePerPerson).filter(
      p => (p.personType === 'teacher' || p.personType === 'employee') && p.action === 'entry'
    ).length;

    const todayEntries = gateLogsToday.filter(l => l.action === 'entry').length;
    const todayExits = gateLogsToday.filter(l => l.action === 'exit').length;

    // Count external visitors logged today
    const todayVisitors = await tenantClient.visitorLog.count({
      where: {
        college_id: collegeId,
        entryTime: {
          gte: todayKarachi,
          lt: tomorrowKarachi
        }
      }
    });

    const attendanceGroup = await tenantClient.attendance.groupBy({
      by: ['status'],
      where: {
        college_id: collegeId,
        date: {
          gte: todayKarachi,
          lt: tomorrowKarachi
        }
      },
      _count: {
        _all: true
      }
    });

    const attendanceToday = attendanceGroup.map(g => ({
      _id: g.status,
      count: g._count._all
    }));

    // Resolve R2 logo reference
    const resolvedLogo = await resolveFileUrl(college.logo, tenantClient, collegeId);

    res.json({
      success: true,
      data: {
        college: {
          name: college.name,
          code: college.code,
          logo: resolvedLogo || college.logo,
          subscription: college.subscription,
          settings: college.settings
        },
        stats: { 
          totalStudents, 
          activeStudents, 
          totalTeachers, 
          totalEmployees,
          currentlyInsideStudents,
          currentlyInsideStaff,
          todayEntries,
          todayExits,
          todayVisitors
        },
        feeStats,
        attendanceToday
      }
    });
  } catch (error) { next(error); }
};

exports.getSettings = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const college = await prisma.college.findUnique({
      where: { id: req.collegeId }
    });
    if (!college) return res.status(404).json({ success: false, message: 'College not found' });
    
    // Combine college.settings with top-level editable fields for profile
    const responseData = {
      ...(college.settings && typeof college.settings === 'object' ? college.settings : {}),
      logo: college.logo || '',
      website: college.website || '',
      phone: college.phone || '',
      email: college.email || '',
      address: college.address || '',
      city: college.city || ''
    };
    
    res.json({ success: true, data: responseData });
  } catch (error) { next(error); }
};

exports.updateSettings = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const body = req.body || {};
    
    // Extract direct college fields
    const { logo, website, phone, email, address, city, ...settingsOnly } = body;
    
    const updateData = {
      settings: settingsOnly
    };
    
    if (logo !== undefined) updateData.logo = logo;
    if (website !== undefined) updateData.website = website;
    if (phone !== undefined) updateData.phone = phone;
    if (email !== undefined) updateData.email = email;
    if (address !== undefined) updateData.address = address;
    if (city !== undefined) updateData.city = city;

    const college = await prisma.college.update({
      where: { id: req.collegeId },
      data: updateData
    });
    if (!college) return res.status(404).json({ success: false, message: 'College not found' });
    
    const responseData = {
      ...(college.settings && typeof college.settings === 'object' ? college.settings : {}),
      logo: college.logo || '',
      website: college.website || '',
      phone: college.phone || '',
      email: college.email || '',
      address: college.address || '',
      city: college.city || ''
    };
    
    res.json({ success: true, data: responseData });
  } catch (error) { next(error); }
};

exports.getStaff = async (req, res, next) => {
  try {
    const { role, search, page = 1, limit = 20 } = req.query;
    const prisma = getSystemClient();

    const where = {
      college_id: req.collegeId,
      role: { in: ['teacher', 'employee', 'principal'] }
    };

    if (role) {
      where.role = role;
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } }
      ];
    }

    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 20;
    const skipNum = (pageNum - 1) * limitNum;

    const total = await prisma.user.count({ where });
    const staff = await prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: skipNum,
      take: limitNum
    });

    const formattedStaff = staff.map(s => {
      const { password, ...sWithoutPassword } = s;
      return {
        ...sWithoutPassword,
        _id: s.id
      };
    });

    res.json({
      success: true,
      data: formattedStaff,
      pagination: {
        total,
        page: pageNum,
        pages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) { next(error); }
};

exports.addStaff = async (req, res, next) => {
  try {
    const { name, email, password, role, phone, employeeType } = req.body;
    const prisma = getSystemClient();

    if (!['teacher', 'employee', 'principal'].includes(role)) {
      return res.status(400).json({ success: false, message: 'Invalid staff role' });
    }

    const exists = await prisma.user.findUnique({
      where: { email: email.toLowerCase() }
    });
    if (exists) {
      return res.status(400).json({ success: false, message: 'Email already registered' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(password || `${role}@academix`, salt);

    const user = await prisma.user.create({
      data: {
        name,
        email: email.toLowerCase(),
        password: hashedPassword,
        role,
        phone,
        college_id: req.collegeId,
        isActive: true,
        authProvider: 'local'
      }
    });

    // Create role-specific profile in TENANT DB
    if (role === 'teacher' && req.tenantClient) {
      await req.tenantClient.teacher.create({
        data: {
          user_id: user.id,
          college_id: req.collegeId,
          qualification: '',
          specialization: '',
          salary: 0,
          status: 'active'
        }
      });
    } else if (role === 'employee' && req.tenantClient) {
      await req.tenantClient.employee.create({
        data: {
          user_id: user.id,
          college_id: req.collegeId,
          department: employeeType || 'other',
          designation: '',
          salary: 0,
          status: 'active'
        }
      });
    }

    res.status(201).json({
      success: true,
      data: {
        _id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) { next(error); }
};
