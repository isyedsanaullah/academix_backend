// ─── Employee Controller (Multi-DB with Prisma) ───────────────────
const { getSystemClient } = require('../config/prismaManager');
const { generateCardId } = require('../utils/cardIdGenerator');

exports.getEmployees = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const tenantDb = req.tenantClient;
    const { department, status, search } = req.query;

    const where = { college_id: req.collegeId };
    if (department) where.department = department;
    if (status) where.status = status;

    const employees = await tenantDb.employee.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });

    const userIds = employees.map(e => e.user_id).filter(Boolean);
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        avatar: true,
        isActive: true
      }
    });

    const userMap = {};
    users.forEach(u => {
      userMap[u.id] = { ...u, _id: u.id };
    });

    let result = employees.map(e => ({
      ...e,
      _id: e.id,
      user: userMap[e.user_id] || null
    }));

    if (search) {
      const s = search.toLowerCase();
      result = result.filter(e =>
        e.user?.name?.toLowerCase().includes(s) ||
        e.employeeCode?.toLowerCase().includes(s)
      );
    }

    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

exports.getEmployee = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const tenantDb = req.tenantClient;

    const emp = await tenantDb.employee.findFirst({
      where: { id: req.params.id, college_id: req.collegeId }
    });
    if (!emp) return res.status(404).json({ success: false, message: 'Employee not found' });

    let userData = null;
    if (emp.user_id) {
      const user = await prisma.user.findUnique({
        where: { id: emp.user_id },
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

    res.json({
      success: true,
      data: {
        ...emp,
        _id: emp.id,
        user: userData
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.createEmployee = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const tenantDb = req.tenantClient;
    const { name, email, password, phone, cnic, address, department, designation, salary } = req.body;
    
    // Hash password
    const bcrypt = require('bcryptjs');
    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(password || 'employee123', salt);

    // Auto-generate Card ID / QR code
    const cardId = await generateCardId(tenantDb, req.collegeId, 'employee');

    // Create user account in SYSTEM DB
    const user = await prisma.user.create({
      data: {
        name,
        email: email.toLowerCase(),
        password: hashedPassword,
        role: 'employee',
        college_id: req.collegeId,
        phone,
        qrCode: cardId,
        authProvider: 'local',
        isActive: true
      }
    });

    // Default leave balance
    const defaultLeaveBalance = {
      casual: 12,
      medical: 8,
      annual: 15
    };

    // Create employee profile in TENANT DB
    const emp = await tenantDb.employee.create({
      data: {
        college_id: req.collegeId,
        user_id: user.id,
        cnic,
        phone,
        address,
        department,
        designation,
        salary: salary ? parseFloat(salary) : 0,
        salaryHistory: [],
        leaveBalance: defaultLeaveBalance,
        leaveRecords: [],
        status: 'active'
      }
    });

    res.status(201).json({
      success: true,
      data: {
        ...emp,
        _id: emp.id
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.updateEmployee = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const tenantDb = req.tenantClient;

    const existing = await tenantDb.employee.findFirst({
      where: { id: req.params.id, college_id: req.collegeId }
    });
    if (!existing) return res.status(404).json({ success: false, message: 'Employee not found' });

    const data = { ...req.body };
    if (data.salary !== undefined) data.salary = data.salary ? parseFloat(data.salary) : 0;
    if (data.joiningDate) data.joiningDate = new Date(data.joiningDate);

    // Strip user fields from update data
    const userFields = ['name', 'email', 'phone', 'password'];
    const filteredBody = {};
    Object.keys(data).forEach(key => {
      if (!userFields.includes(key) && key !== 'id' && key !== '_id' && key !== 'user') {
        filteredBody[key] = data[key];
      }
    });

    const emp = await tenantDb.employee.update({
      where: { id: req.params.id },
      data: filteredBody
    });

    if (req.body.name || req.body.phone) {
      const updates = {};
      if (req.body.name) updates.name = req.body.name;
      if (req.body.phone) updates.phone = req.body.phone;

      await prisma.user.update({
        where: { id: emp.user_id },
        data: updates
      });
    }

    res.json({
      success: true,
      data: {
        ...emp,
        _id: emp.id
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.recordSalary = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { month, amount } = req.body;

    const emp = await tenantDb.employee.findFirst({
      where: { id: req.params.id, college_id: req.collegeId }
    });
    if (!emp) return res.status(404).json({ success: false, message: 'Employee not found' });

    let history = emp.salaryHistory;
    if (!Array.isArray(history)) history = [];
    history.push({
      month,
      amount: parseFloat(amount) || 0,
      paidDate: new Date().toISOString(),
      status: 'paid'
    });

    const updated = await tenantDb.employee.update({
      where: { id: emp.id },
      data: { salaryHistory: history }
    });

    res.json({
      success: true,
      data: {
        ...updated,
        _id: updated.id
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.applyLeave = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { type, startDate, endDate, reason } = req.body;

    const emp = await tenantDb.employee.findFirst({
      where: { id: req.params.id, college_id: req.collegeId }
    });
    if (!emp) return res.status(404).json({ success: false, message: 'Employee not found' });

    let records = emp.leaveRecords;
    if (!Array.isArray(records)) records = [];

    const leaveId = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    records.push({
      id: leaveId,
      type,
      startDate,
      endDate,
      reason,
      status: 'pending'
    });

    const updated = await tenantDb.employee.update({
      where: { id: emp.id },
      data: { leaveRecords: records }
    });

    res.json({
      success: true,
      data: {
        ...updated,
        _id: updated.id
      },
      message: 'Leave request submitted'
    });
  } catch (error) {
    next(error);
  }
};

exports.handleLeave = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { status } = req.body;

    const emp = await tenantDb.employee.findFirst({
      where: { id: req.params.id, college_id: req.collegeId }
    });
    if (!emp) return res.status(404).json({ success: false, message: 'Employee not found' });

    let records = emp.leaveRecords;
    if (!Array.isArray(records)) records = [];

    const leaveIndex = records.findIndex(r => r.id === req.params.leaveId);
    if (leaveIndex === -1) return res.status(404).json({ success: false, message: 'Leave not found' });

    const leave = records[leaveIndex];
    leave.status = status;
    leave.approvedBy = req.user._id;

    let balance = emp.leaveBalance || {};
    if (status === 'approved' && balance[leave.type] !== undefined) {
      const days = Math.ceil((new Date(leave.endDate) - new Date(leave.startDate)) / (1000 * 60 * 60 * 24)) + 1;
      balance[leave.type] = Math.max(0, (parseInt(balance[leave.type]) || 0) - days);
    }

    const updated = await tenantDb.employee.update({
      where: { id: emp.id },
      data: {
        leaveRecords: records,
        leaveBalance: balance
      }
    });

    res.json({
      success: true,
      data: {
        ...updated,
        _id: updated.id
      }
    });
  } catch (error) {
    next(error);
  }
};

