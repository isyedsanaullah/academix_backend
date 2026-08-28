// ─── Fee Controller (Multi-DB with Prisma & Decimal Precision) ───────────────────
const { Prisma } = require('@prisma/client');

// Helper to convert to Prisma Decimal safely
const toDecimal = (val) => {
  if (val === null || val === undefined || val === '') return new Prisma.Decimal(0);
  try {
    return new Prisma.Decimal(val);
  } catch {
    return new Prisma.Decimal(0);
  }
};

const getCurrentSessionId = async (tenantDb, collegeId) => {
  const session = await tenantDb.session.findFirst({
    where: { college_id: collegeId, isCurrent: true }
  });
  return session?.id || null;
};

// Calculate Fee Details using Decimal arithmetic (Zero Canteen Dues)
const calculateFeeDetails = (data) => {
  const tuition = toDecimal(data.tuitionFee);
  const func = toDecimal(data.functionFee);
  const lab = toDecimal(data.labFee);
  const fine = toDecimal(data.fine);
  const other = toDecimal(data.otherCharges);
  const scholarship = toDecimal(data.scholarshipDeduction);

  // Total Amount = Tuition + Function + Lab + Fine + Other - Scholarship
  const totalAmount = tuition.plus(func).plus(lab).plus(fine).plus(other).minus(scholarship);
  const paid = toDecimal(data.paidAmount);

  let status = 'unpaid';
  if (paid.gte(totalAmount) && totalAmount.gt(0)) {
    status = 'paid';
  } else if (paid.gt(0)) {
    status = 'partial';
  } else if (data.dueDate && new Date(data.dueDate) < new Date()) {
    status = 'overdue';
  } else {
    status = 'unpaid';
  }

  return { totalAmount, status };
};

// ════════════════════════════════════════════
//  FEE STRUCTURE MANAGEMENT (Yearly & Monthly)
// ════════════════════════════════════════════

exports.getFeeStructure = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { student_id } = req.params;
    const { session_id } = req.query;

    const currentSessionId = session_id || await getCurrentSessionId(tenantDb, req.collegeId);

    const structure = await tenantDb.studentFee.findFirst({
      where: {
        college_id: req.collegeId,
        student_id,
        ...(currentSessionId ? { session_id: currentSessionId } : {})
      }
    });

    res.json({
      success: true,
      data: structure ? { ...structure, _id: structure.id } : null
    });
  } catch (error) { next(error); }
};

exports.saveFeeStructure = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const {
      student_id,
      session_id,
      mode = 'yearly',
      yearlyFee = 0,
      scholarship = 0,
      monthlyFee = 0,
      installments = [],
      remarks
    } = req.body;

    if (!student_id) return res.status(400).json({ success: false, message: 'Student ID is required' });

    const activeSessionId = session_id || await getCurrentSessionId(tenantDb, req.collegeId);
    if (!activeSessionId) return res.status(400).json({ success: false, message: 'No active academic session found' });

    // Verify student belongs to this college
    const student = await tenantDb.student.findFirst({
      where: { id: student_id, college_id: req.collegeId }
    });
    if (!student) return res.status(404).json({ success: false, message: 'Student not found' });

    const decYearly = toDecimal(yearlyFee);
    const decScholarship = toDecimal(scholarship);
    const decNetYearly = decYearly.minus(decScholarship);
    const decMonthly = toDecimal(monthlyFee);

    if (decNetYearly.lt(0)) {
      return res.status(400).json({ success: false, message: 'Scholarship cannot exceed gross yearly fee' });
    }

    // Validate Installments if mode is yearly and custom installments provided
    if (mode === 'yearly' && Array.isArray(installments) && installments.length > 0) {
      let instSum = new Prisma.Decimal(0);
      for (const inst of installments) {
        if (!inst.amount || toDecimal(inst.amount).lte(0)) {
          return res.status(400).json({ success: false, message: `Installment "${inst.title || 'Untitled'}" must have a valid positive amount` });
        }
        instSum = instSum.plus(toDecimal(inst.amount));
      }

      if (!instSum.equals(decNetYearly)) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_INSTALLMENT_TOTAL',
          message: `Sum of custom installments (${instSum.toString()}) must equal Net Yearly Fee (${decNetYearly.toString()})`
        });
      }
    }

    const userId = req.user?.id || req.user?._id || null;

    // Upsert StudentFee structure configuration
    const studentFee = await tenantDb.studentFee.upsert({
      where: {
        college_id_student_id_session_id: {
          college_id: req.collegeId,
          student_id,
          session_id: activeSessionId
        }
      },
      update: {
        mode,
        yearlyFee: decYearly,
        scholarship: decScholarship,
        netYearlyFee: decNetYearly,
        monthlyFee: decMonthly,
        installmentsConfig: installments.length > 0 ? installments : null,
        decidedBy: userId,
        remarks
      },
      create: {
        college_id: req.collegeId,
        student_id,
        session_id: activeSessionId,
        mode,
        yearlyFee: decYearly,
        scholarship: decScholarship,
        netYearlyFee: decNetYearly,
        monthlyFee: decMonthly,
        installmentsConfig: installments.length > 0 ? installments : null,
        decidedBy: userId,
        remarks
      }
    });

    // Check for existing obligations with payments
    const existingFees = await tenantDb.fee.findMany({
      where: { college_id: req.collegeId, student_id, session_id: activeSessionId }
    });

    const feesWithPayments = existingFees.filter(f => toDecimal(f.paidAmount).gt(0));

    // If no payments exist yet, remove old unpaid placeholder obligations to rebuild fresh obligations
    if (feesWithPayments.length === 0) {
      await tenantDb.fee.deleteMany({
        where: { college_id: req.collegeId, student_id, session_id: activeSessionId }
      });

      // Generate new Fee obligation records based on mode
      if (mode === 'yearly') {
        if (Array.isArray(installments) && installments.length > 0) {
          // Generate distinct custom installment obligations
          for (let i = 0; i < installments.length; i++) {
            const inst = installments[i];
            const instAmount = toDecimal(inst.amount);
            const dueDate = inst.dueDate ? new Date(inst.dueDate) : null;
            const title = inst.title || `Installment ${i + 1}`;
            const challanNumber = `CH-INST-${Date.now()}-${i + 1}-${student.rollNumber}`;

            await tenantDb.fee.create({
              data: {
                college_id: req.collegeId,
                session_id: activeSessionId,
                student_id,
                title,
                type: 'installment',
                month: inst.dueDate ? new Date(inst.dueDate).toISOString().slice(0, 7) : new Date().toISOString().slice(0, 7),
                tuitionFee: instAmount,
                totalAmount: instAmount,
                paidAmount: new Prisma.Decimal(0),
                status: dueDate && dueDate < new Date() ? 'overdue' : 'unpaid',
                dueDate,
                challanNumber,
                enteredBy: userId
              }
            });
          }
        } else {
          // Single Yearly Fee Obligation
          const challanNumber = `CH-YEAR-${Date.now()}-${student.rollNumber}`;
          await tenantDb.fee.create({
            data: {
              college_id: req.collegeId,
              session_id: activeSessionId,
              student_id,
              title: `Yearly Fee (${new Date().getFullYear()})`,
              type: 'yearly',
              month: new Date().getFullYear().toString(),
              tuitionFee: decYearly,
              scholarshipDeduction: decScholarship,
              totalAmount: decNetYearly,
              paidAmount: new Prisma.Decimal(0),
              status: 'unpaid',
              challanNumber,
              enteredBy: userId
            }
          });
        }
      } else if (mode === 'monthly' && decMonthly.gt(0)) {
        // Generate initial monthly obligation for current month
        const currentMonthStr = new Date().toISOString().slice(0, 7);
        const challanNumber = `CH-MNT-${Date.now()}-${student.rollNumber}`;

        await tenantDb.fee.create({
          data: {
            college_id: req.collegeId,
            session_id: activeSessionId,
            student_id,
            title: `Monthly Fee (${currentMonthStr})`,
            type: 'monthly',
            month: currentMonthStr,
            tuitionFee: decMonthly,
            totalAmount: decMonthly,
            paidAmount: new Prisma.Decimal(0),
            status: 'unpaid',
            challanNumber,
            enteredBy: userId
          }
        });
      }
    }

    res.status(200).json({
      success: true,
      message: 'Student fee structure configured successfully',
      data: { ...studentFee, _id: studentFee.id }
    });
  } catch (error) { next(error); }
};

// ════════════════════════════════════════════
//  FEE OBLIGATIONS & COLLECTIONS
// ════════════════════════════════════════════

exports.getFees = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { month, status, student_id, class: className, section, search, page = 1, limit = 50 } = req.query;
    const where = { college_id: req.collegeId };

    if (month) where.month = month;
    if (status) where.status = status;
    if (student_id) where.student_id = student_id;

    if (search || className || section) {
      const studentWhere = { college_id: req.collegeId };
      if (search) {
        studentWhere.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { rollNumber: { contains: search, mode: 'insensitive' } }
        ];
      }
      if (className) studentWhere.class = className;
      if (section) studentWhere.section = section;

      const students = await tenantDb.student.findMany({
        where: studentWhere,
        select: { id: true }
      });
      where.student_id = { in: students.map(s => s.id) };
    }

    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 50;
    const skip = (pageNum - 1) * limitNum;

    const total = await tenantDb.fee.count({ where });
    const fees = await tenantDb.fee.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limitNum
    });

    const studentIds = fees.map(f => f.student_id).filter(Boolean);
    const students = await tenantDb.student.findMany({
      where: { id: { in: studentIds } }
    });

    const studentMap = Object.fromEntries(students.map(s => [s.id, { ...s, _id: s.id }]));

    const formatted = fees.map(f => {
      const totalDec = toDecimal(f.totalAmount);
      const paidDec = toDecimal(f.paidAmount);
      const remainingDec = totalDec.minus(paidDec);

      // Server-side overdue calculation check
      let currentStatus = f.status;
      if (paidDec.gte(totalDec) && totalDec.gt(0)) {
        currentStatus = 'paid';
      } else if (paidDec.gt(0)) {
        currentStatus = 'partial';
      } else if (f.dueDate && new Date(f.dueDate) < new Date()) {
        currentStatus = 'overdue';
      }

      return {
        ...f,
        _id: f.id,
        status: currentStatus,
        totalAmount: totalDec.toNumber(),
        paidAmount: paidDec.toNumber(),
        balance: remainingDec.toNumber(),
        student_id: studentMap[f.student_id] || f.student_id
      };
    });

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

exports.getFeeById = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const fee = await tenantDb.fee.findFirst({
      where: { id: req.params.id, college_id: req.collegeId }
    });
    if (!fee) return res.status(404).json({ success: false, message: 'Fee record not found' });

    if (req.user.role === 'student') {
      const student = await tenantDb.student.findFirst({
        where: { college_id: req.collegeId, user_id: req.user.id || req.user._id }
      });
      if (!student || fee.student_id !== student.id) {
        return res.status(403).json({ success: false, message: 'Access denied to this fee record' });
      }
    }

    const [student, payments] = await Promise.all([
      tenantDb.student.findFirst({ where: { id: fee.student_id } }),
      tenantDb.payment.findMany({
        where: { fee_id: fee.id, college_id: req.collegeId },
        orderBy: { createdAt: 'desc' }
      })
    ]);

    const totalDec = toDecimal(fee.totalAmount);
    const paidDec = toDecimal(fee.paidAmount);
    const remainingDec = totalDec.minus(paidDec);

    res.json({
      success: true,
      data: {
        ...fee,
        _id: fee.id,
        totalAmount: totalDec.toNumber(),
        paidAmount: paidDec.toNumber(),
        balance: remainingDec.toNumber(),
        student_id: student ? { ...student, _id: student.id } : fee.student_id,
        payments: payments.map(p => ({ ...p, _id: p.id, amount: toDecimal(p.amount).toNumber() }))
      }
    });
  } catch (error) { next(error); }
};

exports.createFee = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const {
      student_id,
      month,
      title,
      type = 'monthly',
      tuitionFee = 0,
      functionFee = 0,
      labFee = 0,
      fine = 0,
      scholarshipDeduction = 0,
      otherCharges = 0,
      remarks,
      dueDate
    } = req.body;

    if (!student_id) return res.status(400).json({ success: false, message: 'Student ID is required' });
    if (!month) return res.status(400).json({ success: false, message: 'Month is required' });

    const activeSessionId = req.body.session_id || await getCurrentSessionId(tenantDb, req.collegeId);
    if (!activeSessionId) return res.status(400).json({ success: false, message: 'No active session' });

    const student = await tenantDb.student.findFirst({
      where: { id: student_id, college_id: req.collegeId }
    });
    if (!student) return res.status(404).json({ success: false, message: 'Student not found' });

    // Preventive check for duplicate monthly fee
    if (type === 'monthly') {
      const existing = await tenantDb.fee.findFirst({
        where: {
          college_id: req.collegeId,
          session_id: activeSessionId,
          student_id,
          month,
          type: 'monthly'
        }
      });
      if (existing) {
        return res.status(400).json({
          success: false,
          code: 'DUPLICATE_MONTHLY_FEE',
          message: `Monthly fee obligation already exists for student ${student.name} for period ${month}`
        });
      }
    }

    const calculated = calculateFeeDetails({
      tuitionFee, functionFee, labFee, fine, scholarshipDeduction, otherCharges, paidAmount: 0, dueDate
    });

    const challanNumber = `CH-${Date.now()}-${student.rollNumber}`;
    const userId = req.user?.id || req.user?._id || null;

    const fee = await tenantDb.fee.create({
      data: {
        college_id: req.collegeId,
        session_id: activeSessionId,
        student_id,
        title: title || `Fee (${month})`,
        type,
        month,
        tuitionFee: toDecimal(tuitionFee),
        functionFee: toDecimal(functionFee),
        labFee: toDecimal(labFee),
        fine: toDecimal(fine),
        scholarshipDeduction: toDecimal(scholarshipDeduction),
        otherCharges: toDecimal(otherCharges),
        totalAmount: calculated.totalAmount,
        paidAmount: new Prisma.Decimal(0),
        status: calculated.status,
        challanNumber,
        dueDate: dueDate ? new Date(dueDate) : null,
        enteredBy: userId,
        remarks
      }
    });

    res.status(201).json({
      success: true,
      data: {
        ...fee,
        _id: fee.id,
        totalAmount: calculated.totalAmount.toNumber(),
        paidAmount: 0
      }
    });
  } catch (error) { next(error); }
};

exports.updateFee = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const fee = await tenantDb.fee.findFirst({
      where: { id: req.params.id, college_id: req.collegeId }
    });
    if (!fee) return res.status(404).json({ success: false, message: 'Fee record not found' });

    // Historical Record Protection Rule: If payments exist, lock fee total reduction
    const existingPaid = toDecimal(fee.paidAmount);
    if (existingPaid.gt(0)) {
      if (req.body.tuitionFee !== undefined || req.body.totalAmount !== undefined) {
        return res.status(400).json({
          success: false,
          code: 'FEE_LOCKED_PAYMENTS_EXIST',
          message: 'Cannot alter obligation total amounts for a fee that has existing recorded payments.'
        });
      }
    }

    const merged = {
      tuitionFee: req.body.tuitionFee !== undefined ? req.body.tuitionFee : fee.tuitionFee,
      functionFee: req.body.functionFee !== undefined ? req.body.functionFee : fee.functionFee,
      labFee: req.body.labFee !== undefined ? req.body.labFee : fee.labFee,
      fine: req.body.fine !== undefined ? req.body.fine : fee.fine,
      scholarshipDeduction: req.body.scholarshipDeduction !== undefined ? req.body.scholarshipDeduction : fee.scholarshipDeduction,
      otherCharges: req.body.otherCharges !== undefined ? req.body.otherCharges : fee.otherCharges,
      paidAmount: fee.paidAmount,
      dueDate: req.body.dueDate !== undefined ? req.body.dueDate : fee.dueDate
    };

    const calculated = calculateFeeDetails(merged);

    const updated = await tenantDb.fee.update({
      where: { id: fee.id },
      data: {
        tuitionFee: toDecimal(merged.tuitionFee),
        functionFee: toDecimal(merged.functionFee),
        labFee: toDecimal(merged.labFee),
        fine: toDecimal(merged.fine),
        scholarshipDeduction: toDecimal(merged.scholarshipDeduction),
        otherCharges: toDecimal(merged.otherCharges),
        totalAmount: calculated.totalAmount,
        status: calculated.status,
        remarks: req.body.remarks !== undefined ? req.body.remarks : fee.remarks,
        dueDate: req.body.dueDate ? new Date(req.body.dueDate) : fee.dueDate
      }
    });

    res.json({
      success: true,
      data: {
        ...updated,
        _id: updated.id,
        totalAmount: calculated.totalAmount.toNumber(),
        paidAmount: existingPaid.toNumber()
      }
    });
  } catch (error) { next(error); }
};

// ════════════════════════════════════════════
//  RECORD PAYMENT (Idempotent & Transactionally Safe)
// ════════════════════════════════════════════

exports.recordPayment = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const feeId = req.params.id || req.body.fee_id;
    const { amount, paymentMethod = 'cash', referenceNumber, remarks, idempotencyKey } = req.body;

    if (!feeId) return res.status(400).json({ success: false, message: 'Fee ID is required' });
    const payAmt = toDecimal(amount);
    if (payAmt.lte(0)) return res.status(400).json({ success: false, message: 'Payment amount must be greater than zero' });

    // Idempotency Check: Return existing payment if idempotencyKey retried
    if (idempotencyKey) {
      const existingPayment = await tenantDb.payment.findFirst({
        where: { idempotencyKey, college_id: req.collegeId }
      });
      if (existingPayment) {
        const feeRecord = await tenantDb.fee.findFirst({ where: { id: existingPayment.fee_id } });
        return res.status(200).json({
          success: true,
          message: 'Payment retrieved (Idempotent response)',
          data: {
            payment: { ...existingPayment, _id: existingPayment.id, amount: toDecimal(existingPayment.amount).toNumber() },
            fee: feeRecord ? { ...feeRecord, _id: feeRecord.id } : null
          }
        });
      }
    }

    const userId = req.user?.id || req.user?._id || null;

    // Run atomic Prisma transaction with invariant enforcement
    const result = await tenantDb.$transaction(async (tx) => {
      const fee = await tx.fee.findFirst({
        where: { id: feeId, college_id: req.collegeId }
      });
      if (!fee) throw new Error('FEE_NOT_FOUND');

      const feeTotal = toDecimal(fee.totalAmount);

      // Authoritative Ledger Calculation: Sum of all valid payments for this fee
      const existingPayments = await tx.payment.findMany({
        where: { fee_id: fee.id, college_id: req.collegeId }
      });

      let currentSum = new Prisma.Decimal(0);
      existingPayments.forEach(p => {
        currentSum = currentSum.plus(toDecimal(p.amount));
      });

      const newPaidSum = currentSum.plus(payAmt);

      // Non-Overpayment Invariant Check: SUM(Payment.amount) <= Fee.totalAmount
      if (newPaidSum.gt(feeTotal)) {
        const remaining = feeTotal.minus(currentSum);
        const err = new Error(`PAYMENT_EXCEEDS_BALANCE: Maximum payable amount is Rs. ${remaining.toString()}`);
        err.code = 'PAYMENT_EXCEEDS_BALANCE';
        err.remaining = remaining.toNumber();
        throw err;
      }

      // Generate Receipt Number
      const receiptNumber = `RCP-${Date.now().toString(36).toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`;

      // 1. Create Authoritative Payment Record
      const payment = await tx.payment.create({
        data: {
          college_id: req.collegeId,
          fee_id: fee.id,
          student_id: fee.student_id,
          idempotencyKey: idempotencyKey || null,
          amount: payAmt,
          paymentMethod,
          receiptNumber,
          referenceNumber: referenceNumber || null,
          receivedBy: userId,
          remarks: remarks || null
        }
      });

      // 2. Create Treasury Transaction Ledger Entry
      const student = await tx.student.findFirst({ where: { id: fee.student_id } });
      const studentInfo = student ? `${student.name} (${student.rollNumber})` : fee.student_id;

      await tx.transaction.create({
        data: {
          college_id: req.collegeId,
          type: 'income',
          category: 'fee_collection',
          amount: payAmt,
          description: `Fee payment for ${fee.title || fee.month} - Student ${studentInfo}`,
          reference: receiptNumber,
          relatedTo: { model: 'Payment', id: payment.id, fee_id: fee.id },
          paymentMethod,
          enteredBy: userId || 'system'
        }
      });

      // 3. Update Cached Balance & Status on Fee record
      let newStatus = 'unpaid';
      if (newPaidSum.gte(feeTotal) && feeTotal.gt(0)) {
        newStatus = 'paid';
      } else if (newPaidSum.gt(0)) {
        newStatus = 'partial';
      }

      const updatedFee = await tx.fee.update({
        where: { id: fee.id },
        data: {
          paidAmount: newPaidSum,
          status: newStatus,
          paidDate: new Date(),
          receiptNumber,
          enteredBy: userId
        }
      });

      return { payment, fee: updatedFee };
    });

    res.status(201).json({
      success: true,
      message: 'Payment recorded successfully',
      data: {
        payment: { ...result.payment, _id: result.payment.id, amount: payAmt.toNumber() },
        fee: {
          ...result.fee,
          _id: result.fee.id,
          totalAmount: toDecimal(result.fee.totalAmount).toNumber(),
          paidAmount: toDecimal(result.fee.paidAmount).toNumber()
        }
      }
    });
  } catch (error) {
    if (error.code === 'PAYMENT_EXCEEDS_BALANCE' || error.message?.includes('PAYMENT_EXCEEDS_BALANCE')) {
      return res.status(400).json({
        success: false,
        code: 'PAYMENT_EXCEEDS_BALANCE',
        message: error.message || 'Payment amount exceeds remaining balance'
      });
    }
    if (error.message === 'FEE_NOT_FOUND') {
      return res.status(404).json({ success: false, message: 'Fee obligation not found' });
    }
    next(error);
  }
};

// ════════════════════════════════════════════
//  PAYMENT HISTORY & RECEIPT DETAILS
// ════════════════════════════════════════════

exports.getPaymentHistory = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { id: fee_id } = req.params;

    const fee = await tenantDb.fee.findFirst({
      where: { id: fee_id, college_id: req.collegeId }
    });
    if (!fee) return res.status(404).json({ success: false, message: 'Fee record not found' });

    const payments = await tenantDb.payment.findMany({
      where: { fee_id, college_id: req.collegeId },
      orderBy: { createdAt: 'desc' }
    });

    const formatted = payments.map(p => ({
      ...p,
      _id: p.id,
      amount: toDecimal(p.amount).toNumber()
    }));

    res.json({ success: true, data: formatted });
  } catch (error) { next(error); }
};

exports.getReceiptDetails = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { payment_id } = req.params;

    const payment = await tenantDb.payment.findFirst({
      where: {
        college_id: req.collegeId,
        OR: [{ id: payment_id }, { receiptNumber: payment_id }]
      }
    });
    if (!payment) return res.status(404).json({ success: false, message: 'Payment receipt record not found' });

    const [fee, student] = await Promise.all([
      tenantDb.fee.findFirst({ where: { id: payment.fee_id } }),
      tenantDb.student.findFirst({ where: { id: payment.student_id } })
    ]);

    res.json({
      success: true,
      data: {
        payment: { ...payment, _id: payment.id, amount: toDecimal(payment.amount).toNumber() },
        fee: fee ? { ...fee, _id: fee.id, totalAmount: toDecimal(fee.totalAmount).toNumber(), paidAmount: toDecimal(fee.paidAmount).toNumber() } : null,
        student: student ? { ...student, _id: student.id } : null
      }
    });
  } catch (error) { next(error); }
};

exports.getDefaulters = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { month = new Date().toISOString().slice(0, 7), class: className, section, search, page = 1, limit = 50 } = req.query;
    const where = {
      college_id: req.collegeId,
      status: { in: ['unpaid', 'partial', 'overdue'] }
    };
    if (month) where.month = month;

    if (search || className || section) {
      const studentWhere = { college_id: req.collegeId };
      if (search) {
        studentWhere.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { rollNumber: { contains: search, mode: 'insensitive' } }
        ];
      }
      if (className) studentWhere.class = className;
      if (section) studentWhere.section = section;

      const students = await tenantDb.student.findMany({
        where: studentWhere,
        select: { id: true }
      });
      where.student_id = { in: students.map(s => s.id) };
    }

    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 50;
    const skip = (pageNum - 1) * limitNum;

    const total = await tenantDb.fee.count({ where });
    const defaulters = await tenantDb.fee.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limitNum
    });

    const studentIds = defaulters.map(f => f.student_id).filter(Boolean);
    const students = await tenantDb.student.findMany({
      where: { id: { in: studentIds } }
    });

    const studentMap = Object.fromEntries(students.map(s => [s.id, { ...s, _id: s.id }]));
    const formatted = defaulters.map(f => {
      const tot = toDecimal(f.totalAmount);
      const pd = toDecimal(f.paidAmount);
      return {
        ...f,
        _id: f.id,
        totalAmount: tot.toNumber(),
        paidAmount: pd.toNumber(),
        balance: tot.minus(pd).toNumber(),
        student_id: studentMap[f.student_id] || f.student_id
      };
    });

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

exports.getFeeStats = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const collegeId = req.user?.college_id || req.collegeId;

    const allFees = await tenantDb.fee.findMany({
      where: { college_id: collegeId },
      select: {
        month: true,
        totalAmount: true,
        paidAmount: true,
        status: true
      }
    });

    const monthlyStats = {};
    allFees.forEach(f => {
      const m = f.month;
      if (!monthlyStats[m]) {
        monthlyStats[m] = {
          _id: m,
          totalAmount: new Prisma.Decimal(0),
          totalPaid: new Prisma.Decimal(0),
          count: 0,
          paid: 0,
          unpaid: 0
        };
      }
      monthlyStats[m].totalAmount = monthlyStats[m].totalAmount.plus(toDecimal(f.totalAmount));
      monthlyStats[m].totalPaid = monthlyStats[m].totalPaid.plus(toDecimal(f.paidAmount));
      monthlyStats[m].count += 1;
      if (f.status === 'paid') monthlyStats[m].paid += 1;
      if (f.status === 'unpaid' || f.status === 'overdue') monthlyStats[m].unpaid += 1;
    });

    const stats = Object.values(monthlyStats)
      .map(s => ({
        ...s,
        totalAmount: s.totalAmount.toNumber(),
        totalPaid: s.totalPaid.toNumber()
      }))
      .sort((a, b) => b._id.localeCompare(a._id))
      .slice(0, 12);

    res.json({ success: true, data: stats });
  } catch (error) { next(error); }
};

exports.getMyFees = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const userId = req.user?.id || req.user?._id;

    const student = await tenantDb.student.findFirst({
      where: { college_id: req.collegeId, user_id: userId }
    });
    if (!student) return res.status(404).json({ success: false, message: 'Student profile not found' });

    const fees = await tenantDb.fee.findMany({
      where: { college_id: req.collegeId, student_id: student.id },
      orderBy: { createdAt: 'desc' }
    });

    const formatted = fees.map(f => {
      const tot = toDecimal(f.totalAmount);
      const pd = toDecimal(f.paidAmount);
      return {
        ...f,
        _id: f.id,
        totalAmount: tot.toNumber(),
        paidAmount: pd.toNumber(),
        balance: tot.minus(pd).toNumber()
      };
    });

    res.json({ success: true, data: formatted });
  } catch (error) { next(error); }
};
