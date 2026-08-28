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

    const student = await tenantDb.student.findFirst({
      where: { college_id: req.collegeId, user_id: userId }
    });
    if (!student) return res.status(404).json({ success: false, message: 'Student profile not found' });
    
    const sessionId = await getCurrentSessionId(tenantDb, req.collegeId);
    const { leaveDate, leaveDateEnd, reason, category, attachmentUrl } = req.body;

    if (!leaveDate) return res.status(400).json({ success: false, message: 'Leave date is required' });

    const targetLeaveDate = new Date(leaveDate);
    targetLeaveDate.setHours(0, 0, 0, 0);

    const existing = await tenantDb.leaveApplication.findFirst({
      where: {
        college_id: req.collegeId,
        student_id: student.id,
        leaveDate: targetLeaveDate,
        status: { not: 'rejected' }
      }
    });
    if (existing) return res.status(400).json({ success: false, message: 'Leave application already exists for this date' });

    const app = await tenantDb.leaveApplication.create({
      data: {
        college_id: req.collegeId,
        session_id: sessionId || '',
        student_id: student.id,
        user_id: userId,
        leaveDate: targetLeaveDate,
        leaveDateEnd: leaveDateEnd ? new Date(leaveDateEnd) : null,
        reason,
        category: category || 'personal',
        attachmentUrl: attachmentUrl || ''
      }
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
    const tenantDb = req.tenantClient;
    const { status, reviewRemarks } = req.body;
    const userId = req.user?.id || req.user?._id || null;

    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Status must be approved or rejected' });
    }

    const app = await tenantDb.leaveApplication.findFirst({
      where: { id: req.params.id, college_id: req.collegeId }
    });
    if (!app) return res.status(404).json({ success: false, message: 'Leave application not found' });
    if (app.status !== 'pending') return res.status(400).json({ success: false, message: 'Already reviewed' });

    const updatedApp = await tenantDb.leaveApplication.update({
      where: { id: req.params.id },
      data: {
        status,
        reviewedBy: userId,
        reviewedAt: new Date(),
        reviewRemarks: reviewRemarks || ''
      }
    });

    if (status === 'approved') {
      const student = await tenantDb.student.findFirst({
        where: { id: app.student_id },
        select: { class: true, section: true }
      });
      const sessionId = app.session_id;
      const startDate = new Date(app.leaveDate);
      const endDate = app.leaveDateEnd ? new Date(app.leaveDateEnd) : startDate;
      const current = new Date(startDate);

      while (current <= endDate) {
        const dayStart = new Date(current);
        dayStart.setHours(0, 0, 0, 0);

        await tenantDb.attendance.upsert({
          where: {
            college_id_session_id_student_id_date: {
              college_id: req.collegeId,
              session_id: sessionId,
              student_id: app.student_id,
              date: dayStart
            }
          },
          update: {
            status: 'leave',
            method: 'manual',
            markedBy: userId,
            remarks: `Leave: ${app.reason}`,
            class: student?.class,
            section: student?.section
          },
          create: {
            college_id: req.collegeId,
            session_id: sessionId,
            student_id: app.student_id,
            date: dayStart,
            status: 'leave',
            method: 'manual',
            markedBy: userId,
            remarks: `Leave: ${app.reason}`,
            class: student?.class,
            section: student?.section
          }
        });
        current.setDate(current.getDate() + 1);
      }
    }

    res.json({ success: true, data: { ...updatedApp, _id: updatedApp.id }, message: `Leave ${status}` });
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
