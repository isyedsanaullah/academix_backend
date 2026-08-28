// ─── Accountant Controller (Multi-DB with Prisma) ───────────────────
const { getSystemClient } = require('../config/prismaManager');

// ════════════════════════════════════════════
//  TREASURY DASHBOARD
// ════════════════════════════════════════════

exports.getTreasury = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const cid = req.collegeId;
    const { sessionId } = req.query;

    const sessions = await tenantDb.session.findMany({
      where: { college_id: cid },
      orderBy: { startDate: 'desc' }
    });

    let session;
    if (sessionId) {
      session = await tenantDb.session.findFirst({ where: { id: sessionId, college_id: cid } });
    } else {
      session = sessions.find(s => s.isCurrent) || sessions[0];
    }

    const matchQuery = { college_id: cid };
    let oldRemaining = 0;

    if (session) {
      matchQuery.date = { gte: session.startDate, lte: session.endDate };

      // Calculate old remaining balance from before this session started
      const oldTotals = await tenantDb.transaction.groupBy({
        by: ['type'],
        where: {
          college_id: cid,
          date: { lt: session.startDate }
        },
        _sum: {
          amount: true
        }
      });
      const oldIncome = oldTotals.find(t => t.type === 'income')?._sum.amount || 0;
      const oldExpense = oldTotals.find(t => t.type === 'expense')?._sum.amount || 0;
      oldRemaining = oldIncome - oldExpense;
    }

    const totals = await tenantDb.transaction.groupBy({
      by: ['type'],
      where: matchQuery,
      _sum: {
        amount: true
      }
    });
    const income = totals.find(t => t.type === 'income')?._sum.amount || 0;
    const expense = totals.find(t => t.type === 'expense')?._sum.amount || 0;

    // Determine target month for monthly stats
    const monthlyQuery = { college_id: cid };
    if (session) {
      const now = new Date();
      let monthStart, monthEnd;

      if (now >= session.startDate && now <= session.endDate) {
        monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      } else {
        const sessionEnd = new Date(session.endDate);
        monthStart = new Date(sessionEnd.getFullYear(), sessionEnd.getMonth(), 1);
        monthEnd = sessionEnd;
      }
      monthlyQuery.date = { gte: monthStart, lte: monthEnd };
    } else {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      monthlyQuery.date = { gte: monthStart, lte: monthEnd };
    }

    const monthly = await tenantDb.transaction.groupBy({
      by: ['type'],
      where: monthlyQuery,
      _sum: {
        amount: true
      }
    });
    const monthIncome = monthly.find(t => t.type === 'income')?._sum.amount || 0;
    const monthExpense = monthly.find(t => t.type === 'expense')?._sum.amount || 0;

    const categoriesGroupBy = await tenantDb.transaction.groupBy({
      by: ['type', 'category'],
      where: monthlyQuery,
      _sum: {
        amount: true
      }
    });

    const categories = categoriesGroupBy.map(c => ({
      _id: { type: c.type, category: c.category },
      total: c._sum.amount
    }));

    const recent = await tenantDb.transaction.findMany({
      where: matchQuery,
      orderBy: { date: 'desc' },
      take: 15
    });

    const formattedRecent = recent.map(r => ({
      ...r,
      _id: r.id
    }));

    res.json({
      success: true,
      data: {
        balance: income - expense,
        totalIncome: income,
        totalExpense: expense,
        monthIncome,
        monthExpense,
        categories,
        recent: formattedRecent,
        oldRemaining,
        sessions: sessions.map(s => ({ _id: s.id, name: s.name, isCurrent: s.isCurrent })),
        currentSession: session ? { _id: session.id, name: session.name, isCurrent: session.isCurrent } : null
      }
    });
  } catch (error) { next(error); }
};

exports.addTransaction = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const userId = req.user?.id || req.user?._id || null;

    const txn = await tenantDb.transaction.create({
      data: {
        college_id: req.collegeId,
        type: req.body.type,
        category: req.body.category,
        amount: Number(req.body.amount),
        description: req.body.description,
        reference: req.body.reference,
        relatedTo: req.body.relatedTo !== undefined ? req.body.relatedTo : undefined,
        paymentMethod: req.body.paymentMethod || 'cash',
        date: req.body.date ? new Date(req.body.date) : new Date(),
        enteredBy: userId
      }
    });

    res.status(201).json({ success: true, data: { ...txn, _id: txn.id } });
  } catch (error) { next(error); }
};

exports.getTransactions = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { type, category, from, to, page = 1, limit = 30 } = req.query;
    const where = { college_id: req.collegeId };

    if (type) where.type = type;
    if (category) where.category = category;
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = new Date(from);
      if (to) where.date.lte = new Date(to);
    }

    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 30;
    const skip = (pageNum - 1) * limitNum;

    const [data, total] = await Promise.all([
      tenantDb.transaction.findMany({
        where,
        orderBy: { date: 'desc' },
        skip,
        take: limitNum
      }),
      tenantDb.transaction.count({ where })
    ]);

    const formatted = data.map(d => ({
      ...d,
      _id: d.id
    }));

    res.json({
      success: true,
      data: formatted,
      pagination: {
        total,
        page: pageNum,
        pages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) { next(error); }
};

// ════════════════════════════════════════════
//  FEE CHALLAN
// ════════════════════════════════════════════

exports.generateChallan = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { student_id, month, tuitionFee, functionFee, labFee, fine, dueDate } = req.body;
    
    if (!student_id) return res.status(400).json({ success: false, message: 'Student ID is required' });
    if (!month) return res.status(400).json({ success: false, message: 'Month is required' });

    const student = await tenantDb.student.findFirst({
      where: { id: student_id, college_id: req.collegeId }
    });
    if (!student) return res.status(404).json({ success: false, message: 'Student not found' });

    const totalAmount = (Number(tuitionFee) || 0) + (Number(functionFee) || 0) + (Number(labFee) || 0) + (Number(fine) || 0);

    const existing = await tenantDb.fee.findFirst({
      where: { college_id: req.collegeId, student_id, month }
    });
    if (existing) return res.status(400).json({ success: false, message: 'Fee record already exists for this month' });

    const session = await tenantDb.session.findFirst({
      where: { college_id: req.collegeId, isCurrent: true }
    });

    const userId = req.user?.id || req.user?._id || null;

    const fee = await tenantDb.fee.create({
      data: {
        college_id: req.collegeId,
        session_id: session?.id || '',
        student_id,
        month,
        tuitionFee: Number(tuitionFee) || 0,
        functionFee: Number(functionFee) || 0,
        labFee: Number(labFee) || 0,
        fine: Number(fine) || 0,
        totalAmount,
        paidAmount: 0,
        status: 'unpaid',
        dueDate: dueDate ? new Date(dueDate) : new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
        challanNumber: `CH-${Date.now()}-${student.rollNumber}`,
        enteredBy: userId
      }
    });

    res.status(201).json({
      success: true,
      data: {
        fee: { ...fee, _id: fee.id },
        student: {
          name: student.name,
          rollNumber: student.rollNumber,
          class: student.class,
          section: student.section
        }
      }
    });
  } catch (error) { next(error); }
};

exports.recordPayment = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { fee_id, amount, paymentMethod } = req.body;
    
    if (!fee_id) return res.status(400).json({ success: false, message: 'Fee ID is required' });

    const fee = await tenantDb.fee.findFirst({
      where: { id: fee_id, college_id: req.collegeId }
    });
    if (!fee) return res.status(404).json({ success: false, message: 'Fee record not found' });

    const payAmt = Number(amount) || 0;
    const newPaidAmount = (fee.paidAmount || 0) + payAmt;
    const newStatus = newPaidAmount >= (fee.totalAmount || 0) ? 'paid' : 'partial';
    const receiptNumber = fee.receiptNumber || `REC-${Date.now()}`;
    const userId = req.user?.id || req.user?._id || null;

    const updated = await tenantDb.fee.update({
      where: { id: fee.id },
      data: {
        paidAmount: newPaidAmount,
        status: newStatus,
        paidDate: new Date(),
        receiptNumber,
        enteredBy: userId
      }
    });

    await tenantDb.transaction.create({
      data: {
        college_id: req.collegeId,
        type: 'income',
        category: 'fee_collection',
        amount: payAmt,
        description: `Fee payment from ${fee.student_id}`,
        reference: receiptNumber,
        relatedTo: { model: 'Fee', id: fee.id },
        paymentMethod: paymentMethod || 'cash',
        enteredBy: userId
      }
    });

    res.json({ success: true, message: 'Payment recorded', data: { ...updated, _id: updated.id } });
  } catch (error) { next(error); }
};

exports.getDuesReport = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { month } = req.query;
    const where = {
      college_id: req.collegeId,
      status: { in: ['unpaid', 'partial'] }
    };
    if (month) where.month = month;

    const fees = await tenantDb.fee.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });

    const totalDues = fees.reduce((s, f) => s + ((f.totalAmount || 0) - (f.paidAmount || 0)), 0);
    const formatted = fees.map(f => ({
      ...f,
      _id: f.id
    }));

    res.json({
      success: true,
      data: formatted,
      summary: { count: fees.length, totalDues }
    });
  } catch (error) { next(error); }
};

// ════════════════════════════════════════════
//  EMPLOYEE PAYROLL
// ════════════════════════════════════════════

exports.getPayroll = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const systemDb = getSystemClient();
    const { month } = req.query;
    const currentMonth = month || new Date().toISOString().slice(0, 7);

    // Get all staff (from system DB)
    const staff = await systemDb.user.findMany({
      where: {
        college_id: req.collegeId,
        role: { in: ['teacher', 'employee', 'principal', 'registrar', 'accountant'] }
      },
      select: { id: true, name: true, email: true, role: true, phone: true }
    });

    // Get salary info from tenant DB
    const teacherSalaries = await tenantDb.teacher.findMany({
      where: { college_id: req.collegeId },
      select: { user_id: true, salary: true }
    });
    const employeeSalaries = await tenantDb.employee.findMany({
      where: { college_id: req.collegeId },
      select: { user_id: true, salary: true }
    });
    const salaryMap = {};
    teacherSalaries.forEach(t => { salaryMap[t.user_id] = t.salary; });
    employeeSalaries.forEach(e => { salaryMap[e.user_id] = e.salary; });

    const payslips = await tenantDb.paySlip.findMany({
      where: { college_id: req.collegeId, month: currentMonth }
    });
    const payslipMap = {};
    payslips.forEach(p => { payslipMap[p.employee_id] = p; });

    const result = staff.map(s => ({
      ...s,
      _id: s.id,
      salary: salaryMap[s.id] || 0,
      payslip: payslipMap[s.id] ? { ...payslipMap[s.id], _id: payslipMap[s.id].id } : null
    }));

    const totalPending = result.filter(r => !r.payslip || r.payslip.status === 'pending').reduce((s, r) => s + (r.salary || 0), 0);
    const totalPaid = result.filter(r => r.payslip?.status === 'paid').reduce((s, r) => s + (r.payslip?.netAmount || 0), 0);

    res.json({ success: true, data: result, summary: { totalPending, totalPaid, month: currentMonth } });
  } catch (error) { next(error); }
};

exports.paySalary = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const systemDb = getSystemClient();
    const { employee_id, month, allowances, deductions, bonus, paymentMethod, remarks } = req.body;
    
    if (!employee_id) return res.status(400).json({ success: false, message: 'Employee ID is required' });
    if (!month) return res.status(400).json({ success: false, message: 'Month is required' });

    const user = await systemDb.user.findFirst({
      where: { id: employee_id, college_id: req.collegeId }
    });
    if (!user) return res.status(404).json({ success: false, message: 'Employee not found' });

    let baseSalary = 0;
    const teacher = await tenantDb.teacher.findFirst({
      where: { user_id: employee_id, college_id: req.collegeId }
    });
    const employee = await tenantDb.employee.findFirst({
      where: { user_id: employee_id, college_id: req.collegeId }
    });

    if (teacher) baseSalary = teacher.salary || 0;
    else if (employee) baseSalary = employee.salary || 0;

    const netAmount = baseSalary + (Number(allowances) || 0) - (Number(deductions) || 0) + (Number(bonus) || 0);
    const userId = req.user?.id || req.user?._id || null;

    const payslip = await tenantDb.paySlip.upsert({
      where: {
        college_id_employee_id_month: {
          college_id: req.collegeId,
          employee_id,
          month
        }
      },
      update: {
        baseSalary,
        allowances: Number(allowances) || 0,
        deductions: Number(deductions) || 0,
        bonus: Number(bonus) || 0,
        netAmount,
        paymentMethod: paymentMethod || 'cash',
        status: 'paid',
        paidDate: new Date(),
        paidBy: userId,
        remarks
      },
      create: {
        college_id: req.collegeId,
        employee_id,
        month,
        baseSalary,
        allowances: Number(allowances) || 0,
        deductions: Number(deductions) || 0,
        bonus: Number(bonus) || 0,
        netAmount,
        paymentMethod: paymentMethod || 'cash',
        status: 'paid',
        paidDate: new Date(),
        paidBy: userId,
        remarks
      }
    });

    await tenantDb.transaction.create({
      data: {
        college_id: req.collegeId,
        type: 'expense',
        category: 'salary_payment',
        amount: netAmount,
        description: `Salary payment to ${user.name} for ${month}`,
        reference: payslip.id,
        relatedTo: { model: 'Employee', id: employee_id },
        paymentMethod: paymentMethod || 'cash',
        enteredBy: userId
      }
    });

    res.json({ success: true, message: 'Salary paid', data: { ...payslip, _id: payslip.id } });
  } catch (error) { next(error); }
};
