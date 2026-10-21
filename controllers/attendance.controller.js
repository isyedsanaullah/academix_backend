// ─── Attendance Controller (Multi-DB with Prisma) ───────────────────

const getCurrentSessionId = async (tenantDb, collegeId) => {
  const session = await tenantDb.session.findFirst({
    where: { college_id: collegeId, isCurrent: true }
  });
  return session?.id || null;
};

// ─── QR Gate Scan — Auto-mark attendance ───────────────────
exports.qrGateScan = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { qrCode, college_id } = req.body;
    if (!qrCode) return res.status(400).json({ success: false, message: 'QR code is required' });

    const collegeId = college_id || req.collegeId;
    if (!collegeId) return res.status(400).json({ success: false, message: 'College ID is required' });

    const student = await tenantDb.student.findFirst({
      where: { college_id: collegeId, qrCode, status: 'active' }
    });
    if (!student) return res.status(404).json({ success: false, message: 'Student not found or inactive' });

    const sessionId = await getCurrentSessionId(tenantDb, collegeId);
    if (!sessionId) return res.status(400).json({ success: false, message: 'No active session' });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const existing = await tenantDb.attendance.findFirst({
      where: {
        college_id: collegeId,
        session_id: sessionId,
        student_id: student.id,
        date: today
      }
    });

    if (existing) {
      if (!existing.exitTime) {
        const updated = await tenantDb.attendance.update({
          where: { id: existing.id },
          data: { exitTime: new Date() }
        });
        return res.json({
          success: true,
          message: 'Exit time recorded',
          data: { ...updated, _id: updated.id },
          student: {
            name: student.name,
            rollNumber: student.rollNumber,
            class: student.class,
            section: student.section
          }
        });
      }
      return res.json({
        success: true,
        message: 'Already marked present today',
        data: { ...existing, _id: existing.id },
        student: {
          name: student.name,
          rollNumber: student.rollNumber,
          class: student.class,
          section: student.section
        }
      });
    }

    const attendance = await tenantDb.attendance.create({
      data: {
        college_id: collegeId,
        session_id: sessionId,
        student_id: student.id,
        date: today,
        status: 'present',
        method: 'qr',
        entryTime: new Date(),
        class: student.class,
        section: student.section
      }
    });

    res.status(201).json({
      success: true,
      message: `${student.name} marked present`,
      data: { ...attendance, _id: attendance.id },
      student: {
        name: student.name,
        rollNumber: student.rollNumber,
        class: student.class,
        section: student.section,
        photo: student.photo
      }
    });
  } catch (error) { next(error); }
};

// ─── Admin: Mark attendance (manual) ───────────────────
exports.markAttendance = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { student_id, date, status, method, entryTime, exitTime, remarks } = req.body;
    const sessionId = req.body.session_id || await getCurrentSessionId(tenantDb, req.collegeId);
    
    if (!student_id) return res.status(400).json({ success: false, message: 'Student ID is required' });
    if (!date) return res.status(400).json({ success: false, message: 'Date is required' });

    const student = await tenantDb.student.findFirst({
      where: { id: student_id },
      select: { class: true, section: true }
    });

    const parsedDate = new Date(date);
    parsedDate.setHours(0, 0, 0, 0);

    const userId = req.user?.id || req.user?._id || null;
    const isTeacherEdit = req.user?.role === 'teacher';

    const existing = await tenantDb.attendance.findUnique({
      where: {
        college_id_session_id_student_id_date: {
          college_id: req.collegeId,
          session_id: sessionId,
          student_id,
          date: parsedDate
        }
      }
    });

    let updateMethod = method || 'manual';
    let updateRemarks = remarks;
    let correctionReason = undefined;

    if (existing && isTeacherEdit && (existing.method === 'qr' || existing.method === 'biometric')) {
      updateMethod = 'manual';
      updateRemarks = 'correction';
      correctionReason = req.body.reason || null;
    }

    const attendance = await tenantDb.attendance.upsert({
      where: {
        college_id_session_id_student_id_date: {
          college_id: req.collegeId,
          session_id: sessionId,
          student_id,
          date: parsedDate
        }
      },
      update: {
        status,
        method: updateMethod,
        entryTime: entryTime ? new Date(entryTime) : undefined,
        exitTime: exitTime ? new Date(exitTime) : undefined,
        markedBy: userId,
        remarks: updateRemarks,
        ...(correctionReason !== undefined ? { correctionReason } : {}),
        class: student?.class,
        section: student?.section
      },
      create: {
        college_id: req.collegeId,
        session_id: sessionId,
        student_id,
        date: parsedDate,
        status,
        method: method || 'manual',
        entryTime: entryTime ? new Date(entryTime) : undefined,
        exitTime: exitTime ? new Date(exitTime) : undefined,
        markedBy: userId,
        remarks,
        correctionReason: req.body.reason || null,
        class: student?.class,
        section: student?.section
      }
    });

    res.json({ success: true, data: { ...attendance, _id: attendance.id } });
  } catch (error) { next(error); }
};

exports.markBulkAttendance = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { date, records } = req.body;
    const sessionId = req.body.session_id || await getCurrentSessionId(tenantDb, req.collegeId);
    
    if (!date) return res.status(400).json({ success: false, message: 'Date is required' });
    if (!records || !Array.isArray(records)) return res.status(400).json({ success: false, message: 'Records array is required' });

    const parsedDate = new Date(date);
    parsedDate.setHours(0, 0, 0, 0);

    const userId = req.user?.id || req.user?._id || null;
    const isTeacherEdit = req.user?.role === 'teacher';

    const studentIds = records.map(r => r.student_id).filter(Boolean);
    const existingList = await tenantDb.attendance.findMany({
      where: {
        college_id: req.collegeId,
        session_id: sessionId,
        date: parsedDate,
        student_id: { in: studentIds }
      }
    });
    const existingMap = new Map(existingList.map(e => [e.student_id, e]));

    await tenantDb.$transaction(
      records.map(r => {
        const existing = existingMap.get(r.student_id);
        let finalMethod = 'manual';
        let finalRemarks = r.remarks;
        let correctionReason = undefined;

        if (existing && isTeacherEdit && (existing.method === 'qr' || existing.method === 'biometric')) {
          finalMethod = 'manual';
          finalRemarks = 'correction';
          correctionReason = r.reason || req.body.reason || null;
        }

        return tenantDb.attendance.upsert({
          where: {
            college_id_session_id_student_id_date: {
              college_id: req.collegeId,
              session_id: sessionId,
              student_id: r.student_id,
              date: parsedDate
            }
          },
          update: {
            status: r.status,
            method: finalMethod,
            markedBy: userId,
            class: r.class,
            section: r.section,
            ...(finalRemarks !== undefined ? { remarks: finalRemarks } : {}),
            ...(correctionReason !== undefined ? { correctionReason } : {})
          },
          create: {
            college_id: req.collegeId,
            session_id: sessionId,
            student_id: r.student_id,
            date: parsedDate,
            status: r.status,
            method: 'manual',
            markedBy: userId,
            class: r.class,
            section: r.section,
            remarks: r.remarks,
            correctionReason: r.reason || req.body.reason || null
          }
        });
      })
    );

    res.json({ success: true, message: `${records.length} attendance records saved` });
  } catch (error) { next(error); }
};

exports.getAttendance = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { date, class: cls, section, student_id } = req.query;
    const where = { college_id: req.collegeId };

    if (date) {
      const d = new Date(date);
      d.setHours(0, 0, 0, 0);
      const d2 = new Date(d);
      d2.setDate(d2.getDate() + 1);
      where.date = {
        gte: d,
        lt: d2
      };
    }

    if (student_id) {
      where.student_id = student_id;
    } else if (cls || section) {
      const studentWhere = { college_id: req.collegeId };
      if (cls) studentWhere.class = cls;
      if (section) studentWhere.section = section;
      const students = await tenantDb.student.findMany({
        where: studentWhere,
        select: { id: true }
      });
      where.student_id = { in: students.map(s => s.id) };
    }

    const attendance = await tenantDb.attendance.findMany({
      where,
      orderBy: { date: 'desc' }
    });

    const formatted = attendance.map(a => ({
      ...a,
      _id: a.id
    }));

    res.json({ success: true, data: formatted });
  } catch (error) { next(error); }
};

exports.getAttendanceStats = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { month } = req.query;
    const collegeId = req.user?.college_id || req.collegeId;
    
    const startDate = new Date(`${month || new Date().toISOString().slice(0, 7)}-01`);
    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + 1);

    const stats = await tenantDb.attendance.groupBy({
      by: ['status'],
      where: {
        college_id: collegeId,
        date: {
          gte: startDate,
          lt: endDate
        }
      },
      _count: {
        status: true
      }
    });

    const formattedStats = stats.map(s => ({
      _id: s.status,
      count: s._count.status
    }));

    res.json({ success: true, data: formattedStats });
  } catch (error) { next(error); }
};

exports.getMyAttendance = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const userId = req.user?.id || req.user?._id;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const student = await tenantDb.student.findFirst({
      where: { college_id: req.collegeId, user_id: userId }
    });
    if (!student) return res.status(404).json({ success: false, message: 'Student profile not found' });

    const records = await tenantDb.attendance.findMany({
      where: { college_id: req.collegeId, student_id: student.id },
      orderBy: { date: 'desc' },
      take: 100
    });

    const formatted = records.map(r => ({
      ...r,
      _id: r.id
    }));

    res.json({ success: true, data: formatted });
  } catch (error) { next(error); }
};

// ─── Teacher: View today's attendance for assigned classes (read-only) ───
exports.getTeacherAttendanceView = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { date, class: cls, section } = req.query;
    const userId = req.user?.id || req.user?._id;

    const teacher = await tenantDb.teacher.findFirst({
      where: { college_id: req.collegeId, user_id: userId }
    });
    if (!teacher) return res.status(404).json({ success: false, message: 'Teacher profile not found' });

    // Populate assignedClasses manually from JSON field
    let assignedClasses = teacher.assignedClasses || [];
    if (typeof assignedClasses === 'string') {
      try { assignedClasses = JSON.parse(assignedClasses); } catch (e) {}
    }
    if (!Array.isArray(assignedClasses)) {
      assignedClasses = [];
    }

    const classIds = assignedClasses.map(ac => ac.class_id).filter(Boolean);
    const sectionIds = assignedClasses.map(ac => ac.section_id).filter(Boolean);

    const [classes, sections] = await Promise.all([
      tenantDb.class.findMany({ where: { id: { in: classIds } } }),
      tenantDb.section.findMany({ where: { id: { in: sectionIds } } })
    ]);

    const classMap = Object.fromEntries(classes.map(c => [c.id, { ...c, _id: c.id }]));
    const sectionMap = Object.fromEntries(sections.map(s => [s.id, { ...s, _id: s.id }]));

    const populatedAssignedClasses = assignedClasses.map(ac => ({
      ...ac,
      class_id: classMap[ac.class_id] || ac.class_id,
      section_id: sectionMap[ac.section_id] || ac.section_id
    }));

    const targetDate = date ? new Date(date) : new Date();
    targetDate.setHours(0, 0, 0, 0);
    const nextDay = new Date(targetDate);
    nextDay.setDate(nextDay.getDate() + 1);

    const studentQuery = { college_id: req.collegeId, status: 'active' };
    if (cls) studentQuery.class = cls;
    if (section) studentQuery.section = section;

    const allStudents = await tenantDb.student.findMany({
      where: studentQuery,
      orderBy: { rollNumber: 'asc' }
    });

    const studentIds = allStudents.map(s => s.id);

    const records = await tenantDb.attendance.findMany({
      where: {
        college_id: req.collegeId,
        date: { gte: targetDate, lt: nextDay },
        student_id: { in: studentIds }
      },
      orderBy: { createdAt: 'desc' }
    });

    const attendanceMap = {};
    records.forEach(r => {
      if (r.student_id) attendanceMap[r.student_id] = r;
    });

    const combined = allStudents.map(s => {
      const att = attendanceMap[s.id] || null;
      return {
        student: { ...s, _id: s.id },
        attendance: att ? { ...att, _id: att.id } : null,
        status: att?.status || 'absent'
      };
    });

    const summary = {
      total: allStudents.length,
      present: combined.filter(c => c.status === 'present').length,
      absent: combined.filter(c => c.status === 'absent').length,
      leave: combined.filter(c => c.status === 'leave').length,
      late: combined.filter(c => c.status === 'late').length
    };

    res.json({
      success: true,
      data: combined,
      summary,
      assignedClasses: populatedAssignedClasses
    });
  } catch (error) { next(error); }
};
