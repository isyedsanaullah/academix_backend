// ─── Eligibility & Defaulters Controller (Multi-DB with Prisma) ───────────────
const PDFDocument = require('pdfkit');

const getCurrentSessionId = async (tenantDb, collegeId) => {
  const session = await tenantDb.session.findFirst({
    where: { college_id: collegeId, isCurrent: true }
  });
  return session?.id || null;
};

/**
 * Compute student eligibility for send-up exams or board exam registration
 * Formula & Rules:
 * - Attendance: Present or Late counts as attended; Leave is excluded from total held days so as not to penalize the student.
 * - Result: Percentage and failed subjects calculated from latest published send-up or mid Result.
 * - Snapshots computed values in EligibilityRecord.
 */
exports.computeEligibility = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { forKind = 'send_up', class: cls, group } = req.body;
    const sessionId = req.body.session_id || await getCurrentSessionId(tenantDb, req.collegeId);

    if (!sessionId) {
      return res.status(400).json({ success: false, message: 'No active academic session found' });
    }

    // 1. Fetch configured EligibilityRule for this session & kind
    let rule = await tenantDb.eligibilityRule.findFirst({
      where: {
        college_id: req.collegeId,
        session_id: sessionId,
        forKind,
        isActive: true
      }
    });

    const minAttendance = rule?.minAttendancePercent ?? 75;
    const minOverallPercent = rule?.minOverallPercent ?? null;
    const maxFailedSubjects = rule?.maxFailedSubjects ?? null;

    // 2. Fetch active students
    const studentWhere = {
      college_id: req.collegeId,
      status: 'active'
    };
    if (cls) studentWhere.class = cls;
    if (group) studentWhere.group = group;

    const students = await tenantDb.student.findMany({
      where: studentWhere,
      select: {
        id: true,
        name: true,
        rollNumber: true,
        class: true,
        section: true,
        group: true
      }
    });

    if (students.length === 0) {
      return res.json({ success: true, message: 'No students found matching criteria', records: [] });
    }

    const studentIds = students.map(s => s.id);

    // 3. Batch fetch attendance for all matching students in this session
    // NOTE: Leave records are excluded from total days held, so approved leave never reduces attendance %
    const attendanceRecords = await tenantDb.attendance.findMany({
      where: {
        college_id: req.collegeId,
        session_id: sessionId,
        student_id: { in: studentIds }
      },
      select: {
        student_id: true,
        status: true
      }
    });

    // Group attendance by student
    const attendanceByStudent = {};
    for (const att of attendanceRecords) {
      if (!attendanceByStudent[att.student_id]) {
        attendanceByStudent[att.student_id] = { attended: 0, totalHeld: 0 };
      }
      // Leave is excluded from held classes
      if (att.status !== 'leave') {
        attendanceByStudent[att.student_id].totalHeld += 1;
        // Present or Late counts as attended
        if (att.status === 'present' || att.status === 'late') {
          attendanceByStudent[att.student_id].attended += 1;
        }
      }
    }

    // 4. Batch fetch results for students in this session (prefer send_up, then mid, then any published)
    const results = await tenantDb.result.findMany({
      where: {
        college_id: req.collegeId,
        session_id: sessionId,
        student_id: { in: studentIds },
        isPublished: true
      },
      orderBy: { createdAt: 'desc' }
    });

    // Group latest result per student
    const latestResultByStudent = {};
    for (const r of results) {
      if (!latestResultByStudent[r.student_id]) {
        latestResultByStudent[r.student_id] = r;
      }
    }

    // 5. Evaluate eligibility and upsert snapshot records
    const computedRecords = [];
    const now = new Date();

    for (const st of students) {
      const attStats = attendanceByStudent[st.id];
      let attendancePercent = 100.0;
      if (attStats && attStats.totalHeld > 0) {
        attendancePercent = Number(((attStats.attended / attStats.totalHeld) * 100).toFixed(1));
      } else if (attStats && attStats.totalHeld === 0) {
        attendancePercent = 100.0;
      }

      const resRecord = latestResultByStudent[st.id];
      let resultPercent = null;
      let failedSubjects = 0;

      if (resRecord) {
        resultPercent = resRecord.percentage != null
          ? Number(resRecord.percentage.toFixed(1))
          : (resRecord.totalMarks && resRecord.totalMarks > 0
              ? Number(((resRecord.totalObtained / resRecord.totalMarks) * 100).toFixed(1))
              : null);

        if (Array.isArray(resRecord.marks)) {
          for (const m of resRecord.marks) {
            const passMarks = m.passingMarks ?? 33;
            const obtMarks = m.obtainedMarks ?? m.marks ?? 0;
            if (obtMarks < passMarks || m.grade === 'F') {
              failedSubjects += 1;
            }
          }
        }
      }

      // Check failure reasons
      const reasons = [];
      if (attendancePercent < minAttendance) {
        reasons.push(`attendance ${Math.round(attendancePercent)}% < ${minAttendance}%`);
      }
      if (minOverallPercent != null && resultPercent != null && resultPercent < minOverallPercent) {
        reasons.push(`result ${Math.round(resultPercent)}% < ${minOverallPercent}%`);
      }
      if (maxFailedSubjects != null && failedSubjects > maxFailedSubjects) {
        reasons.push(`failed ${failedSubjects} subjects > max ${maxFailedSubjects}`);
      }

      const eligible = reasons.length === 0;

      // Check existing record to preserve manual principal override
      const existing = await tenantDb.eligibilityRecord.findUnique({
        where: {
          college_id_session_id_student_id_forKind: {
            college_id: req.collegeId,
            session_id: sessionId,
            student_id: st.id,
            forKind
          }
        }
      });

      let saved;
      if (existing) {
        saved = await tenantDb.eligibilityRecord.update({
          where: { id: existing.id },
          data: {
            exam_id: resRecord?.exam_id || null,
            attendancePercent,
            resultPercent,
            failedSubjects,
            // If already overridden by principal, preserve eligible=true and overrideReason
            eligible: existing.overridden ? true : eligible,
            reasons,
            computedAt: now
          }
        });
      } else {
        saved = await tenantDb.eligibilityRecord.create({
          data: {
            college_id: req.collegeId,
            session_id: sessionId,
            student_id: st.id,
            forKind,
            exam_id: resRecord?.exam_id || null,
            attendancePercent,
            resultPercent,
            failedSubjects,
            eligible,
            reasons,
            overridden: false,
            computedAt: now
          }
        });
      }

      computedRecords.push({
        ...saved,
        student: st
      });
    }

    res.json({
      success: true,
      message: `Eligibility computed for ${computedRecords.length} student(s)`,
      forKind,
      minAttendance,
      totalStudents: computedRecords.length,
      eligibleCount: computedRecords.filter(r => r.eligible).length,
      defaulterCount: computedRecords.filter(r => !r.eligible).length,
      data: computedRecords
    });
  } catch (error) {
    next(error);
  }
};

/**
 * List computed eligibility records with student metadata
 */
exports.getEligibilityRecords = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { forKind = 'send_up', session_id, eligible, overridden, class: cls, group } = req.query;
    const sessionId = session_id || await getCurrentSessionId(tenantDb, req.collegeId);

    const where = { college_id: req.collegeId };
    if (sessionId) where.session_id = sessionId;
    if (forKind) where.forKind = forKind;
    if (eligible !== undefined) where.eligible = eligible === 'true';
    if (overridden !== undefined) where.overridden = overridden === 'true';

    const records = await tenantDb.eligibilityRecord.findMany({
      where,
      orderBy: [{ eligible: 'asc' }, { attendancePercent: 'asc' }]
    });

    const studentIds = [...new Set(records.map(r => r.student_id))];
    const students = await tenantDb.student.findMany({
      where: { id: { in: studentIds } },
      select: {
        id: true,
        name: true,
        rollNumber: true,
        class: true,
        section: true,
        group: true,
        fatherName: true
      }
    });

    const studentMap = Object.fromEntries(students.map(s => [s.id, s]));

    let formatted = records.map(r => ({
      ...r,
      student: studentMap[r.student_id] || null
    }));

    if (cls) {
      formatted = formatted.filter(r => r.student?.class === cls);
    }
    if (group) {
      formatted = formatted.filter(r => r.student?.group === group);
    }

    res.json({ success: true, count: formatted.length, data: formatted });
  } catch (error) {
    next(error);
  }
};

/**
 * Principal override: allow an ineligible/defaulter candidate with official reason
 */
exports.overrideEligibility = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { id } = req.params;
    const { overrideReason } = req.body;

    if (!overrideReason || !overrideReason.trim()) {
      return res.status(400).json({ success: false, message: 'Override reason is required' });
    }

    const record = await tenantDb.eligibilityRecord.findFirst({
      where: { id, college_id: req.collegeId }
    });

    if (!record) {
      return res.status(404).json({ success: false, message: 'Eligibility record not found' });
    }

    const userId = req.user?.id || req.user?._id || 'unknown';
    const userName = req.user?.name || req.user?.email || 'Principal';

    const updated = await tenantDb.eligibilityRecord.update({
      where: { id },
      data: {
        eligible: true,
        overridden: true,
        overriddenBy: userName,
        overrideReason: overrideReason.trim()
      }
    });

    // Write audit log entry
    try {
      await tenantDb.auditLog.create({
        data: {
          college_id: req.collegeId,
          user_id: userId,
          action: 'ELIGIBILITY_OVERRIDE',
          resource: 'EligibilityRecord',
          resourceId: id,
          details: JSON.stringify({
            student_id: record.student_id,
            forKind: record.forKind,
            previousEligible: record.eligible,
            overrideReason: overrideReason.trim(),
            overriddenBy: userName
          })
        }
      });
    } catch (auditErr) {
      console.error('Audit log write error for eligibility override:', auditErr.message);
    }

    res.json({
      success: true,
      message: 'Eligibility overridden successfully and recorded in audit log',
      data: updated
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Eligibility Rules CRUD
 */
exports.getEligibilityRules = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const sessionId = req.query.session_id || await getCurrentSessionId(tenantDb, req.collegeId);
    const where = { college_id: req.collegeId };
    if (sessionId) where.session_id = sessionId;

    const rules = await tenantDb.eligibilityRule.findMany({ where });
    res.json({ success: true, data: rules });
  } catch (error) {
    next(error);
  }
};

exports.saveEligibilityRule = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const {
      forKind = 'send_up',
      minAttendancePercent = 75,
      minOverallPercent = null,
      maxFailedSubjects = null
    } = req.body;
    const sessionId = req.body.session_id || await getCurrentSessionId(tenantDb, req.collegeId);

    if (!sessionId) {
      return res.status(400).json({ success: false, message: 'Session ID is required' });
    }

    const rule = await tenantDb.eligibilityRule.upsert({
      where: {
        college_id_session_id_forKind: {
          college_id: req.collegeId,
          session_id: sessionId,
          forKind
        }
      },
      create: {
        college_id: req.collegeId,
        session_id: sessionId,
        forKind,
        minAttendancePercent: parseFloat(minAttendancePercent),
        minOverallPercent: minOverallPercent != null ? parseFloat(minOverallPercent) : null,
        maxFailedSubjects: maxFailedSubjects != null ? parseInt(maxFailedSubjects, 10) : null
      },
      update: {
        minAttendancePercent: parseFloat(minAttendancePercent),
        minOverallPercent: minOverallPercent != null ? parseFloat(minOverallPercent) : null,
        maxFailedSubjects: maxFailedSubjects != null ? parseInt(maxFailedSubjects, 10) : null
      }
    });

    res.json({ success: true, message: 'Eligibility rule saved successfully', data: rule });
  } catch (error) {
    next(error);
  }
};

/**
 * Generate Defaulters / Ineligible Students PDF Report
 */
exports.getDefaultersPdf = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { forKind = 'send_up', session_id, class: cls, group } = req.query;
    const sessionId = session_id || await getCurrentSessionId(tenantDb, req.collegeId);

    const where = {
      college_id: req.collegeId,
      forKind,
      eligible: false
    };
    if (sessionId) where.session_id = sessionId;

    const defaulters = await tenantDb.eligibilityRecord.findMany({
      where,
      orderBy: { attendancePercent: 'asc' }
    });

    const studentIds = defaulters.map(d => d.student_id);
    const students = await tenantDb.student.findMany({
      where: { id: { in: studentIds } },
      select: {
        id: true,
        name: true,
        rollNumber: true,
        class: true,
        section: true,
        group: true,
        fatherName: true
      }
    });
    const studentMap = Object.fromEntries(students.map(s => [s.id, s]));

    let list = defaulters.map(d => ({
      ...d,
      student: studentMap[d.student_id] || {}
    }));

    if (cls) list = list.filter(d => d.student?.class === cls);
    if (group) list = list.filter(d => d.student?.group === group);

    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=Defaulter_List_${forKind}.pdf`);
    doc.pipe(res);

    // Header
    doc.fontSize(18).font('Helvetica-Bold').text('STUDENT DEFAULTER & INELIGIBILITY REPORT', { align: 'center' });
    doc.fontSize(11).font('Helvetica').text(`Examination Target: ${forKind === 'send_up' ? 'Send-up (Pre-Board) Exams' : 'Board Exam Registration'}`, { align: 'center' });
    doc.text(`Generated on: ${new Date().toLocaleDateString('en-PK', { dateStyle: 'long' })} | Total Defaulters: ${list.length}`, { align: 'center' });
    doc.moveDown(1.5);

    // Table Headers
    const startX = 40;
    let y = doc.y;
    doc.rect(startX, y, 515, 24).fill('#fee2e2');
    doc.fillColor('#991b1b').fontSize(10).font('Helvetica-Bold');
    doc.text('Roll #', startX + 5, y + 7, { width: 50 });
    doc.text('Student Name', startX + 60, y + 7, { width: 130 });
    doc.text('Class / Group', startX + 195, y + 7, { width: 100 });
    doc.text('Att. %', startX + 300, y + 7, { width: 50 });
    doc.text('Exam %', startX + 355, y + 7, { width: 50 });
    doc.text('Ineligibility Reason(s)', startX + 410, y + 7, { width: 100 });
    doc.fillColor('#000000');
    y += 26;

    if (list.length === 0) {
      doc.fontSize(11).font('Helvetica-Oblique').text('No defaulters found. All candidates meet eligibility requirements!', startX + 10, y + 10);
    } else {
      doc.font('Helvetica').fontSize(9);
      for (const d of list) {
        if (y > 720) {
          doc.addPage();
          y = 40;
        }

        const reasonsStr = Array.isArray(d.reasons) ? d.reasons.join(', ') : 'Criteria not met';
        doc.rect(startX, y, 515, 20).strokeColor('#e5e7eb').stroke();
        doc.text(d.student?.rollNumber || '-', startX + 5, y + 5, { width: 50 });
        doc.text(d.student?.name || 'Unknown', startX + 60, y + 5, { width: 130 });
        doc.text(`${d.student?.class || ''} (${d.student?.group || ''})`, startX + 195, y + 5, { width: 100 });
        doc.text(`${d.attendancePercent != null ? d.attendancePercent + '%' : '-'}`, startX + 300, y + 5, { width: 50 });
        doc.text(`${d.resultPercent != null ? d.resultPercent + '%' : '-'}`, startX + 355, y + 5, { width: 50 });
        doc.fillColor('#b91c1c').text(reasonsStr, startX + 410, y + 5, { width: 100 });
        doc.fillColor('#000000');
        y += 22;
      }
    }

    doc.moveDown(3);
    const signY = Math.max(doc.y, 720);
    doc.fontSize(9).font('Helvetica');
    doc.text('__________________________', startX + 40, signY);
    doc.text('Controller of Examinations', startX + 45, signY + 14);

    doc.text('__________________________', startX + 340, signY);
    doc.text('Principal Signature & Stamp', startX + 345, signY + 14);

    doc.end();
  } catch (error) {
    next(error);
  }
};
