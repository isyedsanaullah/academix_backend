// ─── Exam Analytics Controller: Weak Students & Comparisons ──────────────────
const { getSystemClient } = require('../config/prismaManager');

const getCurrentSessionId = async (tenantDb, collegeId) => {
  const session = await tenantDb.session.findFirst({
    where: { college_id: collegeId, isCurrent: true }
  });
  return session?.id || null;
};

/**
 * Weak student lists: students below a percent in a subject from Result.marks,
 * filterable per subject, class, and section.
 */
exports.getWeakStudents = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const {
      session_id,
      subject_id,
      class: cls,
      section,
      thresholdPercent = 50,
      exam_id
    } = req.query;

    const sessionId = session_id || await getCurrentSessionId(tenantDb, req.collegeId);
    const threshold = parseFloat(thresholdPercent) || 50;

    const resultWhere = {
      college_id: req.collegeId,
      isPublished: true
    };
    if (sessionId) resultWhere.session_id = sessionId;
    if (exam_id) resultWhere.exam_id = exam_id;

    const results = await tenantDb.result.findMany({
      where: resultWhere
    });

    if (results.length === 0) {
      return res.json({ success: true, count: 0, thresholdPercent: threshold, data: [] });
    }

    // Get student info
    const studentIds = [...new Set(results.map(r => r.student_id))];
    const studentWhere = { id: { in: studentIds } };
    if (cls) studentWhere.class = cls;
    if (section) studentWhere.section = section;

    const students = await tenantDb.student.findMany({
      where: studentWhere,
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

    // Fetch subjects for name mapping
    const subjects = await tenantDb.subject.findMany({
      where: { college_id: req.collegeId }
    });
    const subjectMap = Object.fromEntries(subjects.map(sub => [sub.id, sub.name]));

    const weakList = [];

    for (const r of results) {
      const student = studentMap[r.student_id];
      if (!student) continue;

      if (!Array.isArray(r.marks)) continue;

      for (const m of r.marks) {
        const subId = m.subject_id || m.id;
        if (subject_id && subId !== subject_id && m.subject !== subject_id) {
          continue;
        }

        const total = m.totalMarks || 100;
        const obtained = m.obtainedMarks != null ? m.obtainedMarks : (m.marks != null ? m.marks : 0);
        const passMarks = m.passingMarks || Math.round(total * 0.33);
        const pct = total > 0 ? Number(((obtained / total) * 100).toFixed(1)) : 0;

        if (pct < threshold || obtained < passMarks || m.grade === 'F') {
          const subName = m.subject || subjectMap[subId] || 'Subject';
          weakList.push({
            student_id: student.id,
            rollNumber: student.rollNumber,
            name: student.name,
            class: student.class,
            section: student.section,
            group: student.group,
            subject_id: subId,
            subjectName: subName,
            obtainedMarks: obtained,
            totalMarks: total,
            passingMarks: passMarks,
            percentage: pct,
            grade: m.grade || (obtained < passMarks ? 'F' : 'D'),
            exam_id: r.exam_id
          });
        }
      }
    }

    // Sort by lowest percentage first
    weakList.sort((a, b) => a.percentage - b.percentage);

    res.json({
      success: true,
      count: weakList.length,
      thresholdPercent: threshold,
      data: weakList
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Result comparison: subject-wise and teacher-wise averages and pass rates
 */
exports.getResultComparison = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { session_id, exam_id, class: cls, group } = req.query;
    const sessionId = session_id || await getCurrentSessionId(tenantDb, req.collegeId);

    const resultWhere = {
      college_id: req.collegeId,
      isPublished: true
    };
    if (sessionId) resultWhere.session_id = sessionId;
    if (exam_id) resultWhere.exam_id = exam_id;

    const results = await tenantDb.result.findMany({
      where: resultWhere
    });

    // Subjects and Teachers
    const subjects = await tenantDb.subject.findMany({
      where: { college_id: req.collegeId }
    });
    const subjectMap = Object.fromEntries(subjects.map(s => [s.id, s]));

    // System client for teacher user names
    let teacherUserMap = {};
    try {
      const systemDb = req.systemClient || getSystemClient();
      const teacherIds = [...new Set(subjects.map(s => s.teacher_id).filter(Boolean))];
      if (teacherIds.length > 0) {
        const users = await systemDb.user.findMany({
          where: { id: { in: teacherIds } },
          select: { id: true, name: true, email: true }
        });
        teacherUserMap = Object.fromEntries(users.map(u => [u.id, u.name || u.email]));
      }
    } catch (e) {
      console.warn('Teacher name resolution fallback:', e.message);
    }

    // Aggregate by Subject
    const subjectStats = {};
    for (const r of results) {
      if (!Array.isArray(r.marks)) continue;
      for (const m of r.marks) {
        const subId = m.subject_id || m.subject;
        const subObj = subjectMap[m.subject_id] || { name: m.subject || 'Unknown', teacher_id: null };
        const subName = subObj.name;

        if (!subjectStats[subId]) {
          subjectStats[subId] = {
            subject_id: subId,
            subjectName: subName,
            teacher_id: subObj.teacher_id,
            teacherName: teacherUserMap[subObj.teacher_id] || 'Unassigned',
            totalAppeared: 0,
            totalMarksSum: 0,
            obtainedMarksSum: 0,
            passedCount: 0,
            failedCount: 0,
            highestMarks: 0,
            lowestMarks: 999999
          };
        }

        const stat = subjectStats[subId];
        const obt = m.obtainedMarks != null ? m.obtainedMarks : (m.marks || 0);
        const tot = m.totalMarks || 100;
        const passMarks = m.passingMarks || Math.round(tot * 0.33);

        stat.totalAppeared += 1;
        stat.totalMarksSum += tot;
        stat.obtainedMarksSum += obt;
        if (obt >= passMarks && m.grade !== 'F') {
          stat.passedCount += 1;
        } else {
          stat.failedCount += 1;
        }
        if (obt > stat.highestMarks) stat.highestMarks = obt;
        if (obt < stat.lowestMarks) stat.lowestMarks = obt;
      }
    }

    const subjectList = Object.values(subjectStats).map(s => ({
      ...s,
      lowestMarks: s.totalAppeared > 0 && s.lowestMarks !== 999999 ? s.lowestMarks : 0,
      averagePercentage: s.totalMarksSum > 0
        ? Number(((s.obtainedMarksSum / s.totalMarksSum) * 100).toFixed(1))
        : 0,
      passRate: s.totalAppeared > 0
        ? Number(((s.passedCount / s.totalAppeared) * 100).toFixed(1))
        : 0
    }));

    // Aggregate by Teacher
    const teacherStats = {};
    for (const sub of subjectList) {
      const tId = sub.teacher_id || 'unassigned';
      const tName = sub.teacherName || 'Unassigned';

      if (!teacherStats[tId]) {
        teacherStats[tId] = {
          teacher_id: tId,
          teacherName: tName,
          subjects: [],
          totalStudents: 0,
          totalPassed: 0,
          weightedPercentageSum: 0
        };
      }
      const tStat = teacherStats[tId];
      tStat.subjects.push(sub.subjectName);
      tStat.totalStudents += sub.totalAppeared;
      tStat.totalPassed += sub.passedCount;
      tStat.weightedPercentageSum += (sub.averagePercentage * sub.totalAppeared);
    }

    const teacherList = Object.values(teacherStats).map(t => ({
      teacher_id: t.teacher_id,
      teacherName: t.teacherName,
      subjects: t.subjects,
      totalStudents: t.totalStudents,
      overallPassRate: t.totalStudents > 0
        ? Number(((t.totalPassed / t.totalStudents) * 100).toFixed(1))
        : 0,
      averageStudentScore: t.totalStudents > 0
        ? Number((t.weightedPercentageSum / t.totalStudents).toFixed(1))
        : 0
    }));

    res.json({
      success: true,
      sessionId,
      exam_id: exam_id || 'all',
      totalResultsEvaluated: results.length,
      subjects: subjectList,
      teachers: teacherList
    });
  } catch (error) {
    next(error);
  }
};
