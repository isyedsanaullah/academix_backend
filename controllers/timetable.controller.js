// ─── Timetable Controller (Multi-DB with Prisma) ───────────────────

exports.getTimetables = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { class: cls, section, group, day } = req.query;
    const where = { college_id: req.collegeId, isActive: true };
    if (cls) where.class = cls;
    if (section) where.section = section;
    if (group) where.group = group;
    if (day) where.day = day;

    const dayOrder = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const timetables = await tenantDb.timetable.findMany({ where });
    timetables.sort((a, b) => dayOrder.indexOf(a.day) - dayOrder.indexOf(b.day));

    // Populate subject and teacher names inside periods
    const subjectIds = new Set();
    const teacherIds = new Set();
    timetables.forEach(t => {
      (t.periods || []).forEach(p => {
        if (p.subject_id) subjectIds.add(p.subject_id);
        if (p.teacher_id) teacherIds.add(p.teacher_id);
      });
    });

    const [subjects, teachers] = await Promise.all([
      subjectIds.size > 0 ? tenantDb.subject.findMany({ where: { id: { in: [...subjectIds] } } }) : [],
      teacherIds.size > 0 ? tenantDb.teacher.findMany({ where: { id: { in: [...teacherIds] } } }) : []
    ]);
    const subMap = new Map(subjects.map(s => [s.id, s]));

    // Get user names for teachers
    const teacherUserIds = teachers.map(t => t.user_id).filter(Boolean);
    const users = teacherUserIds.length > 0
      ? await tenantDb.user.findMany({ where: { id: { in: teacherUserIds } } })
      : [];
    const userMap = new Map(users.map(u => [u.id, u]));
    const teacherMap = new Map(teachers.map(t => [t.id, { ...t, userName: userMap.get(t.user_id)?.name || '' }]));

    const formatted = timetables.map(t => ({
      ...t,
      _id: t.id,
      periods: (t.periods || []).map(p => ({
        ...p,
        subject_id: p.subject_id ? { _id: p.subject_id, name: subMap.get(p.subject_id)?.name || 'Unknown' } : null,
        teacher_id: p.teacher_id ? { _id: p.teacher_id, name: teacherMap.get(p.teacher_id)?.userName || 'Unknown' } : null,
      }))
    }));

    res.json({ success: true, data: formatted });
  } catch (error) { next(error); }
};

exports.getMyTimetable = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const student = await tenantDb.student.findFirst({
      where: { user_id: req.user.id, college_id: req.collegeId }
    });
    if (!student) return res.status(404).json({ success: false, message: 'Student record not found' });

    const dayOrder = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const timetables = await tenantDb.timetable.findMany({
      where: {
        college_id: req.collegeId,
        class: student.class,
        section: student.section,
        isActive: true
      }
    });
    timetables.sort((a, b) => dayOrder.indexOf(a.day) - dayOrder.indexOf(b.day));

    // Populate subject and teacher names
    const subjectIds = new Set();
    const teacherIds = new Set();
    timetables.forEach(t => {
      (t.periods || []).forEach(p => {
        if (p.subject_id) subjectIds.add(p.subject_id);
        if (p.teacher_id) teacherIds.add(p.teacher_id);
      });
    });

    const [subjects, teachers] = await Promise.all([
      subjectIds.size > 0 ? tenantDb.subject.findMany({ where: { id: { in: [...subjectIds] } } }) : [],
      teacherIds.size > 0 ? tenantDb.teacher.findMany({ where: { id: { in: [...teacherIds] } } }) : []
    ]);
    const subMap = new Map(subjects.map(s => [s.id, s]));
    const teacherUserIds = teachers.map(t => t.user_id).filter(Boolean);
    const users = teacherUserIds.length > 0
      ? await tenantDb.user.findMany({ where: { id: { in: teacherUserIds } } })
      : [];
    const userMap = new Map(users.map(u => [u.id, u]));
    const teacherMap = new Map(teachers.map(t => [t.id, { ...t, userName: userMap.get(t.user_id)?.name || '' }]));

    const formatted = timetables.map(t => ({
      ...t,
      _id: t.id,
      periods: (t.periods || []).map(p => ({
        ...p,
        subject_id: p.subject_id ? { _id: p.subject_id, name: subMap.get(p.subject_id)?.name || 'Unknown' } : null,
        teacher_id: p.teacher_id ? { _id: p.teacher_id, name: teacherMap.get(p.teacher_id)?.userName || '' } : null,
      }))
    }));

    res.json({ success: true, data: formatted });
  } catch (error) { next(error); }
};

exports.getTeacherTimetable = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const teacher = await tenantDb.teacher.findFirst({
      where: { user_id: req.user.id, college_id: req.collegeId }
    });
    if (!teacher) return res.status(404).json({ success: false, message: 'Teacher record not found' });

    const dayOrder = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const allTimetables = await tenantDb.timetable.findMany({
      where: { college_id: req.collegeId, isActive: true }
    });

    // Filter to only entries where teacher is assigned to at least one period
    const teacherTimetables = allTimetables.filter(t =>
      (t.periods || []).some(p => p.teacher_id === teacher.id)
    );
    teacherTimetables.sort((a, b) => dayOrder.indexOf(a.day) - dayOrder.indexOf(b.day));

    // Populate subject names
    const subjectIds = new Set();
    teacherTimetables.forEach(t => {
      (t.periods || []).forEach(p => {
        if (p.subject_id) subjectIds.add(p.subject_id);
      });
    });
    const subjects = subjectIds.size > 0
      ? await tenantDb.subject.findMany({ where: { id: { in: [...subjectIds] } } })
      : [];
    const subMap = new Map(subjects.map(s => [s.id, s]));

    // Get teacher user name
    const teacherUser = await tenantDb.user.findFirst({ where: { id: teacher.user_id } });
    const teacherName = teacherUser?.name || '';

    const formatted = teacherTimetables.map(t => ({
      ...t,
      _id: t.id,
      periods: (t.periods || []).filter(p => p.teacher_id === teacher.id).map(p => ({
        ...p,
        subject_id: p.subject_id ? { _id: p.subject_id, name: subMap.get(p.subject_id)?.name || 'Unknown' } : null,
        teacher_id: { _id: teacher.id, name: teacherName },
      }))
    }));

    res.json({ success: true, data: formatted });
  } catch (error) { next(error); }
};

exports.createTimetable = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { class: cls, section, group, day, periods, isActive, session_id, universal_timetable_id } = req.body;

    const tt = await tenantDb.timetable.create({
      data: {
        class: cls,
        section,
        group,
        day,
        periods: periods || [],
        isActive: isActive !== undefined ? isActive : true,
        session_id,
        universal_timetable_id: universal_timetable_id || null,
        college_id: req.collegeId,
        createdBy: req.user.id
      }
    });

    res.status(201).json({ success: true, data: { ...tt, _id: tt.id } });
  } catch (error) { next(error); }
};

exports.bulkCreateTimetable = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { entries } = req.body;

    if (!entries || !entries.length) {
      return res.status(400).json({ success: false, message: 'No entries provided' });
    }

    // Determine target class and section (using strings or resolving IDs)
    let className = entries[0].class;
    let sectionCode = entries[0].section;

    if (!className || !sectionCode) {
      const { class_id, section_id } = entries[0];
      if (!class_id || !section_id) {
        return res.status(400).json({ 
          success: false, 
          message: 'Either (class and section names) or (class_id and section_id) must be provided' 
        });
      }
      const classDoc = await tenantDb.class.findUnique({ where: { id: class_id } });
      const sectionDoc = await tenantDb.section.findUnique({ where: { id: section_id } });
      if (!classDoc || !sectionDoc) {
        return res.status(404).json({ success: false, message: 'Class or Section not found' });
      }
      className = classDoc.name;
      sectionCode = sectionDoc.code || sectionDoc.name;
    }

    // Remove old entries for this class/section using strings
    await tenantDb.timetable.deleteMany({
      where: {
        college_id: req.collegeId,
        class: className,
        section: sectionCode
      }
    });

    // Map new documents ensuring all required fields are set
    const createdList = [];
    for (const e of entries) {
      const periods = (e.periods || []).map((p, idx) => ({
        ...p,
        periodNumber: p.periodNumber || (idx + 1),
        isBreak: !!p.isBreak,
        startTime: p.startTime || "",
        endTime: p.endTime || ""
      }));

      const item = await tenantDb.timetable.create({
        data: {
          class: className,
          section: sectionCode,
          group: e.group || null,
          day: e.day,
          periods,
          universal_timetable_id: e.universal_timetable_id || null,
          college_id: req.collegeId,
          createdBy: req.user.id,
          isActive: true
        }
      });
      createdList.push({ ...item, _id: item.id });
    }

    res.status(201).json({ success: true, data: createdList, message: `${createdList.length} timetable entries saved` });
  } catch (error) { next(error); }
};

exports.updateTimetable = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const existing = await tenantDb.timetable.findFirst({
      where: { id: req.params.id, college_id: req.collegeId }
    });
    if (!existing) return res.status(404).json({ success: false, message: 'Timetable not found' });

    const data = { ...req.body };
    if (data.class !== undefined) data.class = data.class;

    const tt = await tenantDb.timetable.update({
      where: { id: req.params.id },
      data
    });

    res.json({ success: true, data: { ...tt, _id: tt.id } });
  } catch (error) { next(error); }
};

exports.deleteTimetable = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const existing = await tenantDb.timetable.findFirst({
      where: { id: req.params.id, college_id: req.collegeId }
    });
    if (!existing) return res.status(404).json({ success: false, message: 'Timetable not found' });

    await tenantDb.timetable.delete({
      where: { id: req.params.id }
    });

    res.json({ success: true, message: 'Timetable deleted' });
  } catch (error) { next(error); }
};
