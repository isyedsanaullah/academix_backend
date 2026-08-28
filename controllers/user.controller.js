const bcrypt = require('bcryptjs');
const { getSystemClient } = require('../config/prismaManager');

const CREATABLE_ROLES = ['registrar', 'accountant', 'principal', 'teacher', 'employee'];

exports.getUsers = async (req, res, next) => {
  try {
    const { role, status, search, page = 1, limit = 15 } = req.query;
    const prisma = getSystemClient();

    const where = {
      college_id: req.collegeId,
      role: { not: 'superAdmin' }
    };
    
    if (role) {
      where.role = role;
    }
    
    if (status !== undefined && status !== '') {
      where.isActive = status === 'true';
    }
    
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
        { cnic: { contains: search, mode: 'insensitive' } }
      ];
    }
    
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 15;
    const skipNum = (pageNum - 1) * limitNum;
    
    const totalUsers = await prisma.user.count({ where });
    const users = await prisma.user.findMany({
      where,
      orderBy: [
        { role: 'asc' },
        { createdAt: 'desc' }
      ],
      skip: skipNum,
      take: limitNum
    });

    const formattedUsers = users.map(u => ({
      ...u,
      _id: u.id
    }));
      
    res.json({
      success: true,
      data: formattedUsers,
      pagination: {
        total: totalUsers,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(totalUsers / limitNum)
      }
    });
  } catch (error) { next(error); }
};

exports.getUserById = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const user = await prisma.user.findFirst({
      where: { id: req.params.id, college_id: req.collegeId }
    });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    
    let profileData = {};
    if (user.role === 'teacher' && req.tenantClient) {
      const teacher = await req.tenantClient.teacher.findFirst({
        where: { user_id: user.id, college_id: req.collegeId }
      });
      if (teacher) {
        profileData = {
          qualification: teacher.qualification || '',
          specialization: teacher.specialization || '',
          salary: teacher.salary || 0,
          status: teacher.status || 'active',
          subjects: teacher.subjects || []
        };
      }
    } else if (user.role === 'employee' && req.tenantClient) {
      const employee = await req.tenantClient.employee.findFirst({
        where: { user_id: user.id, college_id: req.collegeId }
      });
      if (employee) {
        profileData = {
          department: employee.department || 'other',
          designation: employee.designation || '',
          salary: employee.salary || 0,
          status: employee.status || 'active'
        };
      }
    }
    
    const mergedUser = {
      ...user,
      _id: user.id,
      ...profileData
    };
    
    res.json({ success: true, data: mergedUser });
  } catch (error) { next(error); }
};

exports.updateUser = async (req, res, next) => {
  try {
    const { name, email, phone, cnic, isActive,
      qualification, specialization, salary, department, designation, subjects } = req.body;
    const prisma = getSystemClient();
      
    const user = await prisma.user.findFirst({
      where: { id: req.params.id, college_id: req.collegeId }
    });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    
    // Check if email unique
    if (email && email.toLowerCase() !== user.email.toLowerCase()) {
      const exists = await prisma.user.findUnique({
        where: { email: email.toLowerCase() }
      });
      if (exists) return res.status(400).json({ success: false, message: 'Email already registered' });
    }
    
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: {
        name: name !== undefined ? name : undefined,
        email: email !== undefined ? email.toLowerCase() : undefined,
        phone: phone !== undefined ? phone : undefined,
        cnic: cnic !== undefined ? cnic : undefined,
        isActive: isActive !== undefined ? isActive : undefined
      }
    });
    
    // Update role-specific profile in TENANT DB
    if (user.role === 'teacher' && req.tenantClient) {
      const teacherUpdate = {
        qualification: qualification !== undefined ? qualification : undefined,
        specialization: specialization !== undefined ? specialization : undefined,
        salary: salary !== undefined ? salary : undefined,
        subjects: subjects !== undefined ? subjects : undefined,
        status: isActive !== undefined ? (isActive ? 'active' : 'terminated') : undefined
      };
      
      // Look up if profile exists to either create or update (upsert)
      const existingTeacher = await req.tenantClient.teacher.findUnique({
        where: { user_id: user.id }
      });

      if (existingTeacher) {
        await req.tenantClient.teacher.update({
          where: { user_id: user.id },
          data: teacherUpdate
        });
      } else {
        await req.tenantClient.teacher.create({
          data: {
            user_id: user.id,
            college_id: req.collegeId,
            qualification: qualification || '',
            specialization: specialization || '',
            salary: salary || 0,
            subjects: subjects || [],
            status: 'active'
          }
        });
      }
    } else if (user.role === 'employee' && req.tenantClient) {
      const employeeUpdate = {
        department: department !== undefined ? department : undefined,
        designation: designation !== undefined ? designation : undefined,
        salary: salary !== undefined ? salary : undefined,
        status: isActive !== undefined ? (isActive ? 'active' : 'terminated') : undefined
      };

      const existingEmployee = await req.tenantClient.employee.findUnique({
        where: { user_id: user.id }
      });

      if (existingEmployee) {
        await req.tenantClient.employee.update({
          where: { user_id: user.id },
          data: employeeUpdate
        });
      } else {
        await req.tenantClient.employee.create({
          data: {
            user_id: user.id,
            college_id: req.collegeId,
            department: department || 'other',
            designation: designation || '',
            salary: salary || 0,
            status: 'active'
          }
        });
      }
    }
    
    // Fetch and return the fully updated merged user
    let profileData = {};
    if (user.role === 'teacher' && req.tenantClient) {
      const teacher = await req.tenantClient.teacher.findFirst({
        where: { user_id: user.id, college_id: req.collegeId }
      });
      if (teacher) {
        profileData = {
          qualification: teacher.qualification || '',
          specialization: teacher.specialization || '',
          salary: teacher.salary || 0,
          status: teacher.status || 'active',
          subjects: teacher.subjects || []
        };
      }
    } else if (user.role === 'employee' && req.tenantClient) {
      const employee = await req.tenantClient.employee.findFirst({
        where: { user_id: user.id, college_id: req.collegeId }
      });
      if (employee) {
        profileData = {
          department: employee.department || 'other',
          designation: employee.designation || '',
          salary: employee.salary || 0,
          status: employee.status || 'active'
        };
      }
    }
    
    const finalUser = await prisma.user.findUnique({
      where: { id: user.id }
    });

    const mergedUser = {
      ...finalUser,
      _id: finalUser.id,
      ...profileData
    };
    delete mergedUser.password;
    
    res.json({ success: true, data: mergedUser, message: 'Account updated successfully' });
  } catch (error) { next(error); }
};

exports.createUser = async (req, res, next) => {
  try {
    const { name, email, password, role, phone, cnic,
      qualification, specialization, salary, department, designation } = req.body;
    const prisma = getSystemClient();

    if (!CREATABLE_ROLES.includes(role)) {
      return res.status(400).json({ success: false, message: `Cannot create role '${role}'. Allowed: ${CREATABLE_ROLES.join(', ')}` });
    }

    const exists = await prisma.user.findUnique({
      where: { email: email.toLowerCase() }
    });
    if (exists) return res.status(400).json({ success: false, message: 'Email already registered' });

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
        cnic,
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
          qualification: qualification || '',
          specialization: specialization || '',
          salary: salary || 0,
          status: 'active'
        }
      });
    } else if (role === 'employee' && req.tenantClient) {
      await req.tenantClient.employee.create({
        data: {
          user_id: user.id,
          college_id: req.collegeId,
          department: department || 'other',
          designation: designation || '',
          salary: salary || 0,
          status: 'active'
        }
      });
    }

    const userOut = {
      ...user,
      _id: user.id
    };
    delete userOut.password;
    res.status(201).json({ success: true, data: userOut, message: `${role} account created successfully` });
  } catch (error) { next(error); }
};

exports.toggleUserStatus = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const user = await prisma.user.findFirst({
      where: { id: req.params.id, college_id: req.collegeId }
    });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (user.role === 'superAdmin' || user.role === 'admin') return res.status(403).json({ success: false, message: 'Cannot modify admin status' });
    
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: { isActive: !user.isActive }
    });

    res.json({ success: true, message: `User ${updatedUser.isActive ? 'activated' : 'deactivated'}` });
  } catch (error) { next(error); }
};

exports.resetUserPassword = async (req, res, next) => {
  try {
    const { password } = req.body;
    const prisma = getSystemClient();
    if (!password || password.length < 6) return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    
    const user = await prisma.user.findFirst({
      where: { id: req.params.id, college_id: req.collegeId }
    });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    
    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(password, salt);

    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword }
    });

    res.json({ success: true, message: 'Password reset successfully' });
  } catch (error) { next(error); }
};

exports.deleteUser = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const user = await prisma.user.findFirst({
      where: { id: req.params.id, college_id: req.collegeId }
    });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (user.role === 'admin') return res.status(403).json({ success: false, message: 'Cannot delete admin' });
    
    await prisma.user.update({
      where: { id: user.id },
      data: { isActive: false }
    });

    res.json({ success: true, message: 'User removed' });
  } catch (error) { next(error); }
};
