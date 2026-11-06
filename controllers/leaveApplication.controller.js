const studentLeaveService = require('../services/studentLeaveService');

const getCurrentSessionId = async (tenantDb, collegeId) => {
  const session = await tenantDb.session.findFirst({
    where: { college_id: collegeId, isCurrent: true }
  });
  return session?.id || null;
};

exports.applyLeave = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const userId = req.user?.id || req.user?._id;

    // Student can apply for themselves, or parent/teacher specifies studentId
    let studentId = req.body.studentId;
    if (!studentId) {
      const student = await tenantDb.student.findFirst({
        where: { college_id: req.collegeId, user_id: userId }
      });
      if (!student) return res.status(404).json({ success: false, message: 'Student profile not found' });
      studentId = student.id;
    }

    const sessionId = req.body.sessionId || await getCurrentSessionId(tenantDb, req.collegeId);
    const {
      leaveDate,
      leaveDateEnd,
      reason,
      category,
      attachmentUrl,
      isEmergency,
      medicalCertificate,
      appliedByRole
    } = req.body;

    if (!leaveDate) return res.status(400).json({ success: false, message: 'Leave date is required' });

    const app = await studentLeaveService.applyStudentLeave({
      collegeId: req.collegeId,
      campusId: req.campusId || null,
      sessionId: sessionId || '',
      studentId,
      userId,
      leaveDate,
      leaveDateEnd,
      reason,
      category: category || 'personal',
      isEmergency: Boolean(isEmergency),
      medicalCertificate: medicalCertificate || attachmentUrl || null,
      appliedByRole: appliedByRole || (req.user?.role === 'student' ? 'STUDENT' : 'GUARDIAN'),
    });

    res.status(201).json({ success: true, data: { ...app, _id: app.id } });
  } catch (error) { next(error); }
};

exports.getMyLeaves = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const userId = req.user?.id || req.user?._id;

    const student = await tenantDb.student.findFirst({
      where: { college_id: req.collegeId, user_id: userId }
    });
    if (!student) return res.status(404).json({ success: false, message: 'Student profile not found' });

    const apps = await tenantDb.leaveApplication.findMany({
      where: { college_id: req.collegeId, student_id: student.id },
      orderBy: { createdAt: 'desc' }
    });

    const formatted = apps.map(a => ({
      ...a,
      _id: a.id
    }));

    res.json({ success: true, data: formatted });
  } catch (error) { next(error); }
};

exports.getLeaveApplications = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { status, class: cls, section, page = 1, limit = 50 } = req.query;
    const where = { college_id: req.collegeId };

    if (status) where.status = status;

    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 50;
    const skip = (pageNum - 1) * limitNum;

    const apps = await tenantDb.leaveApplication.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limitNum
    });

    const total = await tenantDb.leaveApplication.count({ where });

    const formatted = apps.map(a => ({
      ...a,
      _id: a.id
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

exports.reviewLeave = async (req, res, next) => {
  try {
    const { status, reviewRemarks } = req.body;
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Status must be approved or rejected' });
    }

    const result = await studentLeaveService.reviewStudentLeave({
      collegeId: req.collegeId,
      campusId: req.campusId || null,
      leaveId: req.params.id,
      reviewerUser: req.user,
      status,
      reviewRemarks,
    });

    if (result.requiresApproval) {
      return res.status(202).json({
        success: true,
        data: { approvalRequestId: result.approvalRequestId, status: result.status },
        message: result.message,
      });
    }

    res.json({
      success: true,
      data: { ...result.leave, _id: result.leave.id },
      message: result.message,
    });
  } catch (error) { next(error); }
};

exports.getLeaveStats = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const collegeId = req.user?.college_id || req.collegeId;

    const stats = await tenantDb.leaveApplication.groupBy({
      by: ['status'],
      where: { college_id: collegeId },
      _count: {
        status: true
      }
    });

    const pending = stats.find(s => s.status === 'pending')?._count.status || 0;
    const approved = stats.find(s => s.status === 'approved')?._count.status || 0;
    const rejected = stats.find(s => s.status === 'rejected')?._count.status || 0;

    res.json({
      success: true,
      data: {
        pending,
        approved,
        rejected,
        total: pending + approved + rejected
      }
    });
  } catch (error) { next(error); }
};
