// ─── Teacher Controller (Multi-DB with Prisma) ───────────────────
const { getSystemClient } = require('../config/prismaManager');
const { generateCardId } = require('../utils/cardIdGenerator');

// @desc    Get all teachers
// @route   GET /api/teachers
exports.getTeachers = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const tenantDb = req.tenantClient;
    const { status, search } = req.query;
    
    const where = { college_id: req.collegeId };
    if (status) where.status = status;

    const teachers = await tenantDb.teacher.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });
    
    // Enrich with user data from system DB
    const userIds = teachers.map(t => t.user_id).filter(Boolean);
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        avatar: true,
        isActive: true,
        lastLogin: true
      }
    });

    const userMap = new Map(users.map(u => [u.id, { ...u, _id: u.id }]));

    // Fetch and map subjects
    const allSubjectIds = [...new Set(teachers.flatMap(t => t.subjects || []).filter(Boolean))];
    const dbSubjects = await tenantDb.subject.findMany({
      where: { id: { in: allSubjectIds } }
    });
    const subjectMap = new Map(dbSubjects.map(s => [s.id, { ...s, _id: s.id }]));

    let result = teachers.map(t => {
      const populatedSubs = (t.subjects || []).map(sid => subjectMap.get(sid) || sid);
      return {
        ...t,
        _id: t.id,
        subjects: populatedSubs,
        user: userMap.get(t.user_id) || null
      };
    });

    if (search) {
      const s = search.toLowerCase();
      result = result.filter(t => 
        t.user?.name?.toLowerCase().includes(s) ||
        t.user?.email?.toLowerCase().includes(s) ||
        t.employeeCode?.toLowerCase().includes(s)
      );
    }
    
    res.json({ success: true, data: result });
  } catch (error) { next(error); }
};

// @desc    Get single teacher
// @route   GET /api/teachers/:id
exports.getTeacher = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const tenantDb = req.tenantClient;
    const teacher = await tenantDb.teacher.findFirst({
      where: { id: req.params.id, college_id: req.collegeId }
    });
    if (!teacher) return res.status(404).json({ success: false, message: 'Teacher not found' });

    let userData = null;
    if (teacher.user_id) {
      const user = await prisma.user.findUnique({
        where: { id: teacher.user_id },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          avatar: true,
          isActive: true,
          lastLogin: true
        }
      });
      if (user) {
        userData = { ...user, _id: user.id };
      }
    }

    // Populate subjects
    const dbSubjects = await tenantDb.subject.findMany({
      where: { id: { in: teacher.subjects || [] } }
    });
    const subjectMap = new Map(dbSubjects.map(s => [s.id, { ...s, _id: s.id }]));
    const populatedSubs = (teacher.subjects || []).map(sid => subjectMap.get(sid) || sid);

    res.json({
      success: true,
      data: {
        ...teacher,
        _id: teacher.id,
        subjects: populatedSubs,
        user: userData
      }
    });
  } catch (error) { next(error); }
};

// @desc    Create teacher (creates User in system DB + Teacher profile in tenant DB)
// @route   POST /api/teachers
exports.createTeacher = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const tenantDb = req.tenantClient;
    const { name, email, password, phone, cnic, address, qualification, specialization, subjects, salary } = req.body;
    
    // Hash password
    const bcrypt = require('bcryptjs');
    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(password || 'teacher123', salt);

    // Auto-generate Card ID / QR code
    const cardId = await generateCardId(tenantDb, req.collegeId, 'teacher');

    // Create user account in SYSTEM DB
    const user = await prisma.user.create({
      data: {
        name,
        email: email.toLowerCase(),
        password: hashedPassword,
        role: 'teacher',
        college_id: req.collegeId,
        phone,
        qrCode: cardId,
        authProvider: 'local',
        isActive: true
      }
    });

    // Create teacher profile in TENANT DB
    const teacher = await tenantDb.teacher.create({
      data: {
        college_id: req.collegeId,
        user_id: user.id,
        cnic,
        phone,
        address,
        qualification,
        specialization,
        subjects: subjects || [],
        salary: salary ? parseFloat(salary) : 0,
        qrCode: cardId,
        status: 'active'
      }
    });

    res.status(201).json({ success: true, data: { ...teacher, _id: teacher.id } });
  } catch (error) { next(error); }
};

// @desc    Update teacher
// @route   PUT /api/teachers/:id
exports.updateTeacher = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const tenantDb = req.tenantClient;
    
    const existing = await tenantDb.teacher.findFirst({
      where: { id: req.params.id, college_id: req.collegeId }
    });
    if (!existing) return res.status(404).json({ success: false, message: 'Teacher not found' });

    const data = { ...req.body };
    if (data.salary !== undefined) data.salary = data.salary ? parseFloat(data.salary) : 0;
    
    // Strip user fields from teacher update data
    const userFields = ['name', 'email', 'phone', 'password'];
    const filteredBody = {};
    Object.keys(data).forEach(key => {
      if (!userFields.includes(key)) {
        filteredBody[key] = data[key];
      }
    });

    const teacher = await tenantDb.teacher.update({
      where: { id: req.params.id },
      data: filteredBody
    });

    if (req.body.name || req.body.phone) {
      const updates = {};
      if (req.body.name) updates.name = req.body.name;
      if (req.body.phone) updates.phone = req.body.phone;
      
      await prisma.user.update({
        where: { id: teacher.user_id },
        data: updates
      });
    }

    res.json({ success: true, data: { ...teacher, _id: teacher.id } });
  } catch (error) { next(error); }
};

// @desc    Assign classes to teacher
// @route   PUT /api/teachers/:id/assign
exports.assignClasses = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { assignedClasses } = req.body;
    
    const existing = await tenantDb.teacher.findFirst({
      where: { id: req.params.id, college_id: req.collegeId }
    });
    if (!existing) return res.status(404).json({ success: false, message: 'Teacher not found' });

    const teacher = await tenantDb.teacher.update({
      where: { id: req.params.id },
      data: { assignedClasses }
    });

    res.json({ success: true, data: { ...teacher, _id: teacher.id } });
  } catch (error) { next(error); }
};
