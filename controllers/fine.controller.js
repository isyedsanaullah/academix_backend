// ─── Fine Controller (Multi-DB with Prisma) ───────────────────

const getCurrentSessionId = async (tenantDb, collegeId) => {
  const session = await tenantDb.session.findFirst({
    where: { college_id: collegeId, isCurrent: true }
  });
  return session?.id || null;
};

exports.createFine = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { student_id, amount, reason, category } = req.body;
    if (!student_id || !amount || !reason) {
      return res.status(400).json({ success: false, message: 'student_id, amount, and reason are required' });
    }
    const student = await tenantDb.student.findFirst({
      where: { id: student_id, college_id: req.collegeId }
    });
    if (!student) return res.status(404).json({ success: false, message: 'Student not found' });
    const sessionId = await getCurrentSessionId(tenantDb, req.collegeId);
    if (!sessionId) {
      return res.status(400).json({ success: false, message: 'No current session found' });
    }

    const fine = await tenantDb.fine.create({
      data: {
        college_id: req.collegeId,
        session_id: sessionId,
        student_id,
        teacher_id: req.user._id,
        amount: parseFloat(amount),
        reason,
        category: category || 'discipline',
        status: 'unpaid'
      }
    });
    res.status(201).json({ success: true, data: { ...fine, _id: fine.id } });
  } catch (error) { next(error); }
};

exports.getMyIssuedFines = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const where = { college_id: req.collegeId };
    if (req.user.role !== 'admin') {
      where.teacher_id = req.user._id;
    }
    const fines = await tenantDb.fine.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });
    res.json({ success: true, data: fines.map(f => ({ ...f, _id: f.id })) });
  } catch (error) { next(error); }
};

exports.getFines = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { student_id, status, page = 1, limit = 50 } = req.query;
    const where = { college_id: req.collegeId };
    if (student_id) where.student_id = student_id;
    if (status) where.status = status;
    
    const take = parseInt(limit) || 50;
    const skip = (parseInt(page) - 1) * take;

    const [total, fines] = await Promise.all([
      tenantDb.fine.count({ where }),
      tenantDb.fine.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take
      })
    ]);

    res.json({
      success: true,
      data: fines.map(f => ({ ...f, _id: f.id })),
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / take)
      }
    });
  } catch (error) { next(error); }
};

exports.getMyFines = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const student = await tenantDb.student.findFirst({
      where: { college_id: req.collegeId, user_id: req.user._id }
    });
    if (!student) return res.status(404).json({ success: false, message: 'Student profile not found' });
    const fines = await tenantDb.fine.findMany({
      where: { college_id: req.collegeId, student_id: student.id },
      orderBy: { createdAt: 'desc' }
    });
    const totalUnpaid = fines.filter(f => f.status === 'unpaid').reduce((s, f) => s + f.amount, 0);
    res.json({ success: true, data: fines.map(f => ({ ...f, _id: f.id })), totalUnpaid });
  } catch (error) { next(error); }
};

exports.updateFine = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const existing = await tenantDb.fine.findFirst({
      where: { id: req.params.id, college_id: req.collegeId }
    });
    if (!existing) return res.status(404).json({ success: false, message: 'Fine not found' });

    const data = {};
    if (req.body.status === 'paid') {
      data.status = 'paid';
      data.paidDate = new Date();
    }

    const fine = await tenantDb.fine.update({
      where: { id: req.params.id },
      data
    });
    res.json({ success: true, data: { ...fine, _id: fine.id } });
  } catch (error) { next(error); }
};

