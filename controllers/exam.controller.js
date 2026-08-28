// ─── Exam Controller (Multi-DB with Prisma) ───────────────────

const getCurrentSessionId = async (tenantDb, collegeId) => {
  const session = await tenantDb.session.findFirst({
    where: { college_id: collegeId, isCurrent: true }
  });
  return session?.id || null;
};

exports.getExams = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { class: cls, status, type, group } = req.query;
    const where = { college_id: req.collegeId };

    if (cls) where.class = cls;
    if (status) where.status = status;
    if (type) where.type = type;
    if (group) where.group = group;

    const exams = await tenantDb.exam.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });

    const formatted = exams.map(e => ({
      ...e,
      _id: e.id
    }));

    res.json({ success: true, data: formatted });
  } catch (error) { next(error); }
};

exports.getExam = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const exam = await tenantDb.exam.findFirst({
      where: { id: req.params.id, college_id: req.collegeId }
    });
    if (!exam) return res.status(404).json({ success: false, message: 'Exam not found' });
    
    res.json({ success: true, data: { ...exam, _id: exam.id } });
  } catch (error) { next(error); }
};

exports.createExam = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const sessionId = req.body.session_id || await getCurrentSessionId(tenantDb, req.collegeId);
    if (!sessionId) return res.status(400).json({ success: false, message: 'No active session' });

    const userId = req.user?.id || req.user?._id || null;

    const exam = await tenantDb.exam.create({
      data: {
        college_id: req.collegeId,
        session_id: sessionId,
        name: req.body.name,
        type: req.body.type,
        class: req.body.class,
        group: req.body.group,
        section: req.body.section,
        subjects: req.body.subjects !== undefined ? req.body.subjects : undefined,
        seatingPlan: req.body.seatingPlan !== undefined ? req.body.seatingPlan : undefined,
        invigilation: req.body.invigilation !== undefined ? req.body.invigilation : undefined,
        status: req.body.status || 'scheduled',
        createdBy: userId
      }
    });
    
    // Auto-create detailed high-priority announcement for the exam
    try {
      let subjectsList = '';
      if (Array.isArray(exam.subjects)) {
        subjectsList = exam.subjects
          .map(s => {
            const dateStr = s.date ? new Date(s.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : 'TBD';
            const timeStr = (s.startTime && s.endTime) ? `${s.startTime} - ${s.endTime}` : 'TBD';
            return `- **${s.name}**: ${dateStr} at ${timeStr} (Total Marks: ${s.totalMarks}, Passing Marks: ${s.passingMarks})`;
          })
          .join('\n');
      }

      const sectionStr = exam.section === 'all' ? 'All Sections' : `Section ${exam.section}`;
      const groupStr = exam.group === 'all' ? 'All Groups' : exam.group;

      const content = `A new examination has been scheduled in the portal:

**Exam Title**: ${exam.name}
**Class**: ${exam.class}
**Group**: ${groupStr}
**Sections**: ${sectionStr}
**Type**: ${exam.type || 'General'}
**Status**: ${exam.status}

### Subjects & Timings:
${subjectsList || 'No subjects scheduled yet.'}`;

      await tenantDb.announcement.create({
        data: {
          college_id: req.collegeId,
          title: `📢 New Exam Scheduled: ${exam.name}`,
          content,
          category: 'exam',
          audience: 'all',
          isPublic: false,
          priority: 'high',
          createdBy: userId
        }
      });
    } catch (annError) {
      console.error('Failed to create automatic exam announcement:', annError);
    }

    res.status(201).json({ success: true, data: { ...exam, _id: exam.id } });
  } catch (error) { next(error); }
};

exports.updateExam = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const existing = await tenantDb.exam.findFirst({
      where: { id: req.params.id, college_id: req.collegeId }
    });
    if (!existing) return res.status(404).json({ success: false, message: 'Exam not found' });

    // Filter update body to avoid resetting nested structures
    const updateData = {};
    const fields = ['name', 'type', 'class', 'group', 'section', 'subjects', 'seatingPlan', 'invigilation', 'status'];
    fields.forEach(f => {
      if (req.body[f] !== undefined) {
        updateData[f] = req.body[f];
      }
    });

    const exam = await tenantDb.exam.update({
      where: { id: req.params.id },
      data: updateData
    });
    
    res.json({ success: true, data: { ...exam, _id: exam.id } });
  } catch (error) { next(error); }
};

exports.deleteExam = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const existing = await tenantDb.exam.findFirst({
      where: { id: req.params.id, college_id: req.collegeId }
    });
    if (!existing) return res.status(404).json({ success: false, message: 'Exam not found' });

    await tenantDb.exam.delete({
      where: { id: req.params.id }
    });
    
    res.json({ success: true, message: 'Exam deleted' });
  } catch (error) { next(error); }
};
