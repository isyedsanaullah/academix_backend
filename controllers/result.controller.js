// ─── Result Controller (Multi-DB with Prisma) ───────────────────

const getCurrentSessionId = async (tenantDb, collegeId) => {
  const session = await tenantDb.session.findFirst({
    where: { college_id: collegeId, isCurrent: true }
  });
  return session?.id || null;
};

exports.getResults = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { exam_id, student_id, isPublished } = req.query;
    const where = { college_id: req.collegeId };

    if (exam_id) where.exam_id = exam_id;
    if (student_id) where.student_id = student_id;
    if (isPublished !== undefined) where.isPublished = isPublished === 'true';

    const results = await tenantDb.result.findMany({
      where,
      orderBy: { percentage: 'desc' }
    });

    const studentIds = results.map(r => r.student_id).filter(Boolean);
    const students = await tenantDb.student.findMany({
      where: { id: { in: studentIds } }
    });

    const studentMap = Object.fromEntries(students.map(s => [s.id, { ...s, _id: s.id }]));
    const formatted = results.map(r => ({
      ...r,
      _id: r.id,
      student_id: studentMap[r.student_id] || r.student_id
    }));

    res.json({ success: true, data: formatted });
  } catch (error) { next(error); }
};

exports.createResult = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const userId = req.user?.id || req.user?._id || null;

    // Teacher Subject Ownership Check
    if (req.user.role === 'teacher') {
      const teacher = await tenantDb.teacher.findFirst({
        where: { user_id: userId, college_id: req.collegeId }
      });
      if (!teacher) {
        return res.status(403).json({ success: false, message: 'Teacher profile not found' });
      }
      const allowedSubjects = (teacher.subjects || []).map(s => s.toString());
      
      const examId = req.body.exam_id;
      const exam = await tenantDb.exam.findFirst({
        where: { id: examId, college_id: req.collegeId }
      });
      
      let subjects = exam?.subjects || [];
      if (typeof subjects === 'string') {
        try { subjects = JSON.parse(subjects); } catch (e) {}
      }

      const marks = req.body.marks || [];
      for (const m of marks) {
        let subId = m.subject_id;
        if (!subId && m.subject && Array.isArray(subjects)) {
          const matchedSub = subjects.find(es => es.name === m.subject);
          if (matchedSub) {
            subId = matchedSub.subject_id;
            m.subject_id = subId;
          }
        }
        if (!subId) {
          return res.status(400).json({ success: false, message: `Subject ID not found or resolved for subject: ${m.subject}` });
        }
        if (!allowedSubjects.includes(subId.toString())) {
          return res.status(403).json({ success: false, message: `You are only authorized to upload results for your assigned subjects.` });
        }
      }
    }

    const sessionId = req.body.session_id || await getCurrentSessionId(tenantDb, req.collegeId);
    if (!sessionId) return res.status(400).json({ success: false, message: 'No active session' });

    const result = await tenantDb.result.create({
      data: {
        college_id: req.collegeId,
        session_id: sessionId,
        student_id: req.body.student_id,
        exam_id: req.body.exam_id,
        marks: req.body.marks !== undefined ? req.body.marks : undefined,
        totalObtained: req.body.totalObtained !== undefined ? parseFloat(req.body.totalObtained) : undefined,
        totalMarks: req.body.totalMarks !== undefined ? parseFloat(req.body.totalMarks) : undefined,
        percentage: req.body.percentage !== undefined ? parseFloat(req.body.percentage) : undefined,
        grade: req.body.grade,
        position: req.body.position !== undefined ? parseInt(req.body.position, 10) : undefined,
        remarks: req.body.remarks,
        isPublished: req.body.isPublished !== undefined ? req.body.isPublished === true || req.body.isPublished === 'true' : false,
        enteredBy: userId
      }
    });

    res.status(201).json({ success: true, data: { ...result, _id: result.id } });
  } catch (error) { next(error); }
};

exports.updateResult = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const userId = req.user?.id || req.user?._id || null;

    const result = await tenantDb.result.findFirst({
      where: { id: req.params.id, college_id: req.collegeId }
    });
    if (!result) return res.status(404).json({ success: false, message: 'Result not found' });
    
    // Teacher Subject Ownership Check
    if (req.user.role === 'teacher') {
      const teacher = await tenantDb.teacher.findFirst({
        where: { user_id: userId, college_id: req.collegeId }
      });
      if (!teacher) {
        return res.status(403).json({ success: false, message: 'Teacher profile not found' });
      }
      const allowedSubjects = (teacher.subjects || []).map(s => s.toString());
      
      const examId = result.exam_id || req.body.exam_id;
      const exam = await tenantDb.exam.findFirst({
        where: { id: examId, college_id: req.collegeId }
      });
      
      let subjects = exam?.subjects || [];
      if (typeof subjects === 'string') {
        try { subjects = JSON.parse(subjects); } catch (e) {}
      }

      const marks = req.body.marks || [];
      for (const m of marks) {
        let subId = m.subject_id;
        if (!subId && m.subject && Array.isArray(subjects)) {
          const matchedSub = subjects.find(es => es.name === m.subject);
          if (matchedSub) {
            subId = matchedSub.subject_id;
            m.subject_id = subId;
          }
        }
        if (!subId) {
          return res.status(400).json({ success: false, message: `Subject ID not found or resolved for subject: ${m.subject}` });
        }
        if (!allowedSubjects.includes(subId.toString())) {
          return res.status(403).json({ success: false, message: `You are only authorized to modify results for your assigned subjects.` });
        }
      }
    }

    const updateData = {};
    const fields = ['student_id', 'exam_id', 'marks', 'totalObtained', 'totalMarks', 'percentage', 'grade', 'position', 'remarks', 'isPublished'];
    fields.forEach(f => {
      if (req.body[f] !== undefined) {
        if (['totalObtained', 'totalMarks', 'percentage'].includes(f)) {
          updateData[f] = parseFloat(req.body[f]);
        } else if (f === 'position') {
          updateData[f] = parseInt(req.body[f], 10);
        } else if (f === 'isPublished') {
          updateData[f] = req.body[f] === true || req.body[f] === 'true';
        } else {
          updateData[f] = req.body[f];
        }
      }
    });

    const updated = await tenantDb.result.update({
      where: { id: req.params.id },
      data: updateData
    });

    res.json({ success: true, data: { ...updated, _id: updated.id } });
  } catch (error) { next(error); }
};

exports.bulkCreateResults = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const userId = req.user?.id || req.user?._id || null;
    const { exam_id, results } = req.body;

    if (!results || !Array.isArray(results)) {
      return res.status(400).json({ success: false, message: 'Results array is required' });
    }

    // Teacher Subject Ownership Check
    if (req.user.role === 'teacher') {
      const teacher = await tenantDb.teacher.findFirst({
        where: { user_id: userId, college_id: req.collegeId }
      });
      if (!teacher) {
        return res.status(403).json({ success: false, message: 'Teacher profile not found' });
      }
      const allowedSubjects = (teacher.subjects || []).map(s => s.toString());
      
      const exam = await tenantDb.exam.findFirst({
        where: { id: exam_id, college_id: req.collegeId }
      });
      
      let subjects = exam?.subjects || [];
      if (typeof subjects === 'string') {
        try { subjects = JSON.parse(subjects); } catch (e) {}
      }

      for (const r of results) {
        const marks = r.marks || [];
        for (const m of marks) {
          let subId = m.subject_id;
          if (!subId && m.subject && Array.isArray(subjects)) {
            const matchedSub = subjects.find(es => es.name === m.subject);
            if (matchedSub) {
              subId = matchedSub.subject_id;
              m.subject_id = subId;
            }
          }
          if (!subId) {
            return res.status(400).json({ success: false, message: `Subject ID not found or resolved for subject: ${m.subject}` });
          }
          if (!allowedSubjects.includes(subId.toString())) {
            return res.status(403).json({ success: false, message: `You are only authorized to upload results for your assigned subjects.` });
          }
        }
      }
    }

    const sessionId = req.body.session_id || await getCurrentSessionId(tenantDb, req.collegeId);
    if (!sessionId) return res.status(400).json({ success: false, message: 'No active session' });

    const saved = await tenantDb.$transaction(
      results.map(r => tenantDb.result.create({
        data: {
          college_id: req.collegeId,
          session_id: sessionId,
          student_id: r.student_id,
          exam_id: exam_id,
          marks: r.marks !== undefined ? r.marks : undefined,
          totalObtained: r.totalObtained !== undefined ? parseFloat(r.totalObtained) : undefined,
          totalMarks: r.totalMarks !== undefined ? parseFloat(r.totalMarks) : undefined,
          percentage: r.percentage !== undefined ? parseFloat(r.percentage) : undefined,
          grade: r.grade,
          position: r.position !== undefined ? parseInt(r.position, 10) : undefined,
          remarks: r.remarks,
          isPublished: r.isPublished !== undefined ? r.isPublished === true || r.isPublished === 'true' : false,
          enteredBy: userId
        }
      }))
    );

    const formatted = saved.map(s => ({
      ...s,
      _id: s.id
    }));

    res.status(201).json({ success: true, data: formatted, message: `${formatted.length} results saved` });
  } catch (error) { next(error); }
};

exports.getResultById = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const result = await tenantDb.result.findFirst({
      where: { id: req.params.id, college_id: req.collegeId }
    });
    if (!result) return res.status(404).json({ success: false, message: 'Result not found' });

    let student = null;
    if (result.student_id) {
      student = await tenantDb.student.findFirst({
        where: { id: result.student_id }
      });
    }

    const formatted = {
      ...result,
      _id: result.id,
      student_id: student ? { ...student, _id: student.id } : null
    };

    res.json({ success: true, data: formatted });
  } catch (error) { next(error); }
};

exports.getMyResults = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const userId = req.user?.id || req.user?._id;

    const student = await tenantDb.student.findFirst({
      where: { college_id: req.collegeId, user_id: userId }
    });
    if (!student) return res.status(404).json({ success: false, message: 'Student profile not found' });

    const results = await tenantDb.result.findMany({
      where: { college_id: req.collegeId, student_id: student.id, isPublished: true },
      orderBy: { createdAt: 'desc' }
    });

    const formatted = results.map(r => ({
      ...r,
      _id: r.id
    }));

    res.json({ success: true, data: formatted });
  } catch (error) { next(error); }
};
