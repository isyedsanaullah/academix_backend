// ─── Timetable Controller (Multi-DB with Prisma) ───────────────────
const {
  getTeachersForSubject,
  getSubjectsForTeacher,
  checkTimetableClashes
} = require('../services/timetable.service');

function getKarachiNow() {
  const now = new Date();
  const karachiDateStr = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });
  const karachiDay = now.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Asia/Karachi' });
  const timeStr = now.toLocaleTimeString('en-US', { timeZone: 'Asia/Karachi', hour12: false, hour: '2-digit', minute: '2-digit' });
  const [h, m] = timeStr.split(':').map(Number);
  const currentMinutes = h * 60 + m;
  return { karachiDateStr, karachiDay, currentMinutes, timeStr };
}

function parseTimeToMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i);
  if (!match) return null;
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const modifier = match[3]?.toUpperCase();
  if (modifier === 'PM' && hours < 12) hours += 12;
  if (modifier === 'AM' && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

const DEFAULT_PERIOD_TIMES = {
  1: { start: '08:30', end: '09:15' },
  2: { start: '09:15', end: '10:00' },
  3: { start: '10:00', end: '10:45' },
  4: { start: '10:45', end: '11:15' },
  5: { start: '11:15', end: '12:00' },
  6: { start: '12:00', end: '12:45' },
  7: { start: '12:45', end: '13:30' },
  8: { start: '13:30', end: '14:15' }
};

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

    const { karachiDateStr, karachiDay } = getKarachiNow();
    const targetDate = req.query.date || karachiDateStr;

    // Calculate target date's day of week
    const dateObj = new Date(targetDate + 'T00:00:00Z');
    const dayName = isNaN(dateObj.getTime())
      ? karachiDay
      : dateObj.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });

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

    // Fetch active substitutions for this student's class and section on targetDate
    const substitutions = await tenantDb.timetableSubstitution.findMany({
      where: {
        college_id: req.collegeId,
        date: targetDate,
        class: student.class,
        section: student.section,
        status: 'active'
      }
    });

    // Populate subject and teacher names
    const subjectIds = new Set();
    const teacherIds = new Set();
    timetables.forEach(t => {
      (t.periods || []).forEach(p => {
        if (p.subject_id) subjectIds.add(p.subject_id);
        if (p.teacher_id) teacherIds.add(p.teacher_id);
      });
    });
    substitutions.forEach(s => {
      if (s.subject_id) subjectIds.add(s.subject_id);
      if (s.absentTeacher_id) teacherIds.add(s.absentTeacher_id);
      if (s.substituteTeacher_id) teacherIds.add(s.substituteTeacher_id);
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

    const subByPeriod = new Map(substitutions.map(s => [s.periodNumber, s]));

    const formatted = timetables.map(t => {
      const isTargetDay = t.day === dayName;
      return {
        ...t,
        _id: t.id,
        isToday: t.day === karachiDay,
        periods: (t.periods || []).map(p => {
          const sub = isTargetDay ? subByPeriod.get(p.periodNumber) : null;
          if (sub) {
            const subTeacher = teacherMap.get(sub.substituteTeacher_id);
            const origTeacher = teacherMap.get(sub.absentTeacher_id);
            return {
              ...p,
              subject_id: p.subject_id ? { _id: p.subject_id, name: subMap.get(p.subject_id)?.name || 'Unknown' } : null,
              teacher_id: sub.substituteTeacher_id
                ? { _id: sub.substituteTeacher_id, name: subTeacher?.userName || 'Substitute Teacher' }
                : null,
              isSubstitution: true,
              substitutionId: sub.id,
              originalTeacher: origTeacher ? { _id: origTeacher.id, name: origTeacher.userName } : null,
              substituteTeacher: subTeacher ? { _id: subTeacher.id, name: subTeacher.userName } : null,
              reason: sub.reason || ''
            };
          }

          return {
            ...p,
            isSubstitution: false,
            subject_id: p.subject_id ? { _id: p.subject_id, name: subMap.get(p.subject_id)?.name || 'Unknown' } : null,
            teacher_id: p.teacher_id ? { _id: p.teacher_id, name: teacherMap.get(p.teacher_id)?.userName || '' } : null,
          };
        })
      };
    });

    res.json({
      success: true,
      data: formatted,
      meta: {
        date: targetDate,
        day: dayName,
        today: karachiDay,
        substitutionsCount: substitutions.length
      }
    });
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

    const teacherTimetables = allTimetables.filter(t =>
      (t.periods || []).some(p => p.teacher_id === teacher.id)
    );
    teacherTimetables.sort((a, b) => dayOrder.indexOf(a.day) - dayOrder.indexOf(b.day));

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

/**
 * Teacher Dashboard "Today" View
 * Large card with current period, next period, time left, and full schedule
 */
exports.getTeacherToday = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const teacher = await tenantDb.teacher.findFirst({
      where: { user_id: req.user.id, college_id: req.collegeId }
    });
    if (!teacher) return res.status(404).json({ success: false, message: 'Teacher record not found' });

    const { karachiDateStr, karachiDay, currentMinutes, timeStr } = getKarachiNow();

    const startOfToday = new Date(`${karachiDateStr}T00:00:00.000Z`);
    const endOfToday = new Date(`${karachiDateStr}T23:59:59.999Z`);
    const dateFilter = { gte: startOfToday, lte: endOfToday };

    // 1. Regular timetable for today
    const regularTimetables = await tenantDb.timetable.findMany({
      where: { college_id: req.collegeId, day: karachiDay, isActive: true }
    });

    // 2. Active substitutions for today where this teacher is substituting
    const activeSubstitutions = await tenantDb.timetableSubstitution.findMany({
      where: {
        college_id: req.collegeId,
        date: dateFilter,
        substituteTeacher_id: teacher.id,
        status: { in: ['assigned', 'active'] }
      }
    });

    // 3. Substitutions where this teacher is absent
    const absentSubstitutions = await tenantDb.timetableSubstitution.findMany({
      where: {
        college_id: req.collegeId,
        date: dateFilter,
        absentTeacher_id: teacher.id,
        status: { in: ['assigned', 'active'] }
      }
    });
    const substitutedPeriodKeys = new Set(absentSubstitutions.map(s => `${s.class}_${s.section}_P${s.periodNumber}`));

    // Fetch subjects and other teachers
    const subjectIds = new Set();
    const otherTeacherIds = new Set();

    const todaySlots = [];

    // Add regular periods (unless substituted due to absence)
    regularTimetables.forEach(t => {
      (t.periods || []).forEach(p => {
        if (p.teacher_id === teacher.id && !p.isBreak) {
          const key = `${t.class}_${t.section}_P${p.periodNumber}`;
          if (!substitutedPeriodKeys.has(key)) {
            if (p.subject_id) subjectIds.add(p.subject_id);
            todaySlots.push({
              periodNumber: p.periodNumber,
              startTime: p.startTime || DEFAULT_PERIOD_TIMES[p.periodNumber]?.start || '',
              endTime: p.endTime || DEFAULT_PERIOD_TIMES[p.periodNumber]?.end || '',
              class: t.class,
              section: t.section,
              group: t.group,
              room: p.room || 'Classroom',
              subject_id: p.subject_id,
              isSubstitution: false
            });
          }
        }
      });
    });

    // Add substitution periods
    activeSubstitutions.forEach(s => {
      if (s.subject_id) subjectIds.add(s.subject_id);
      if (s.absentTeacher_id) otherTeacherIds.add(s.absentTeacher_id);
      todaySlots.push({
        periodNumber: s.periodNumber,
        startTime: DEFAULT_PERIOD_TIMES[s.periodNumber]?.start || '',
        endTime: DEFAULT_PERIOD_TIMES[s.periodNumber]?.end || '',
        class: s.class,
        section: s.section,
        room: 'Classroom',
        subject_id: s.subject_id,
        isSubstitution: true,
        absentTeacher_id: s.absentTeacher_id,
        reason: s.reason
      });
    });

    const [subjects, otherTeachers] = await Promise.all([
      subjectIds.size > 0 ? tenantDb.subject.findMany({ where: { id: { in: [...subjectIds] } } }) : [],
      otherTeacherIds.size > 0 ? tenantDb.teacher.findMany({ where: { id: { in: [...otherTeacherIds] } } }) : []
    ]);
    const subMap = new Map(subjects.map(s => [s.id, s.name]));

    const otherUserIds = otherTeachers.map(t => t.user_id).filter(Boolean);
    const otherUsers = otherUserIds.length > 0
      ? await tenantDb.user.findMany({ where: { id: { in: otherUserIds } } })
      : [];
    const otherUserMap = new Map(otherUsers.map(u => [u.id, u.name]));
    const otherTeacherMap = new Map(otherTeachers.map(t => [t.id, otherUserMap.get(t.user_id) || 'Teacher']));

    // Sort slots chronologically
    todaySlots.sort((a, b) => {
      const startA = parseTimeToMinutes(a.startTime) || (a.periodNumber * 60);
      const startB = parseTimeToMinutes(b.startTime) || (b.periodNumber * 60);
      return startA - startB;
    });

    const populatedSlots = todaySlots.map(s => {
      const startMin = parseTimeToMinutes(s.startTime) || (s.periodNumber * 60);
      const endMin = parseTimeToMinutes(s.endTime) || (startMin + 45);
      const isCurrent = currentMinutes >= startMin && currentMinutes < endMin;
      const isPast = currentMinutes >= endMin;
      const isUpcoming = currentMinutes < startMin;
      const minutesLeft = isCurrent ? Math.max(0, endMin - currentMinutes) : null;

      return {
        ...s,
        subjectName: subMap.get(s.subject_id) || 'Subject',
        absentTeacherName: s.absentTeacher_id ? otherTeacherMap.get(s.absentTeacher_id) : null,
        label: s.isSubstitution
          ? `Substitution for ${otherTeacherMap.get(s.absentTeacher_id) || 'absent teacher'}`
          : 'Regular class',
        startMin,
        endMin,
        isCurrent,
        isPast,
        isUpcoming,
        minutesLeft
      };
    });

    const currentPeriod = populatedSlots.find(s => s.isCurrent) || null;
    const nextPeriod = populatedSlots.find(s => s.isUpcoming) || null;

    let statusMessage = '';
    if (populatedSlots.length === 0) {
      statusMessage = 'No classes scheduled for today';
    } else if (currentPeriod) {
      statusMessage = `Class in progress (${currentPeriod.minutesLeft}m left)`;
    } else if (nextPeriod) {
      statusMessage = `Next class at ${nextPeriod.startTime} (${nextPeriod.subjectName})`;
    } else {
      statusMessage = 'No more classes today';
    }

    res.json({
      success: true,
      data: {
        date: karachiDateStr,
        day: karachiDay,
        currentTime: timeStr,
        currentMinutes,
        currentPeriod,
        nextPeriod,
        statusMessage,
        periodsCount: populatedSlots.length,
        schedule: populatedSlots
      }
    });
  } catch (error) { next(error); }
};

exports.checkClashes = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { class: cls, section, day, periods, timetableId } = req.body;

    const clash = await checkTimetableClashes({
      tenantDb,
      collegeId: req.collegeId,
      day,
      targetClass: cls,
      targetSection: section,
      periods: periods || [],
      excludeTimetableId: timetableId || null
    });

    res.json({ success: true, ...clash });
  } catch (error) { next(error); }
};

exports.createTimetable = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { class: cls, section, group, day, periods, isActive, session_id, universal_timetable_id } = req.body;

    // Hard clash check
    const clash = await checkTimetableClashes({
      tenantDb,
      collegeId: req.collegeId,
      day,
      targetClass: cls,
      targetSection: section,
      periods: periods || []
    });

    if (clash.hasClash) {
      return res.status(409).json({
        success: false,
        code: clash.code || 'TIMETABLE_CLASH',
        message: clash.message
      });
    }

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

    // Pre-validate all entries for clashes
    for (const e of entries) {
      const clash = await checkTimetableClashes({
        tenantDb,
        collegeId: req.collegeId,
        day: e.day,
        targetClass: className,
        targetSection: sectionCode,
        periods: e.periods || []
      });

      if (clash.hasClash) {
        return res.status(409).json({
          success: false,
          code: clash.code || 'TIMETABLE_CLASH',
          message: clash.message
        });
      }
    }

    // Remove old entries for this class/section using strings
    await tenantDb.timetable.deleteMany({
      where: {
        college_id: req.collegeId,
        class: className,
        section: sectionCode
      }
    });

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
    const targetClass = data.class !== undefined ? data.class : existing.class;
    const targetSection = data.section !== undefined ? data.section : existing.section;
    const targetDay = data.day !== undefined ? data.day : existing.day;
    const targetPeriods = data.periods !== undefined ? data.periods : existing.periods;

    const clash = await checkTimetableClashes({
      tenantDb,
      collegeId: req.collegeId,
      day: targetDay,
      targetClass,
      targetSection,
      periods: targetPeriods || [],
      excludeTimetableId: existing.id
    });

    if (clash.hasClash) {
      return res.status(409).json({
        success: false,
        code: clash.code || 'TIMETABLE_CLASH',
        message: clash.message
      });
    }

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

// ─── TeacherSubject Management Endpoints (feature: teacher-subjects) ───

exports.getTeacherSubjects = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { teacher_id, subject_id, class: cls } = req.query;

    const where = { college_id: req.collegeId };
    if (teacher_id) where.teacher_id = teacher_id;
    if (subject_id) where.subject_id = subject_id;
    if (cls) where.class = cls;

    const records = await tenantDb.teacherSubject.findMany({ where });

    // Populate teacher and subject details
    const teacherIds = [...new Set(records.map(r => r.teacher_id))];
    const subjectIds = [...new Set(records.map(r => r.subject_id))];

    const [teachers, subjects] = await Promise.all([
      teacherIds.length > 0 ? tenantDb.teacher.findMany({ where: { id: { in: teacherIds } } }) : [],
      subjectIds.length > 0 ? tenantDb.subject.findMany({ where: { id: { in: subjectIds } } }) : []
    ]);

    const userIds = teachers.map(t => t.user_id).filter(Boolean);
    const users = userIds.length > 0
      ? await tenantDb.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } })
      : [];
    const userMap = Object.fromEntries(users.map(u => [u.id, u]));
    const teacherMap = Object.fromEntries(teachers.map(t => [t.id, { id: t.id, name: userMap[t.user_id]?.name || 'Teacher' }]));
    const subMap = Object.fromEntries(subjects.map(s => [s.id, { id: s.id, name: s.name, code: s.code }]));

    const formatted = records.map(r => ({
      ...r,
      _id: r.id,
      teacher: teacherMap[r.teacher_id] || null,
      subject: subMap[r.subject_id] || null
    }));

    res.json({ success: true, data: formatted });
  } catch (error) { next(error); }
};

exports.assignTeacherSubject = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { teacher_id, subject_id, class: cls, group, isPrimary, maxPeriodsPerDay } = req.body;

    if (!teacher_id || !subject_id) {
      return res.status(400).json({ success: false, message: 'teacher_id and subject_id are required' });
    }

    // Verify teacher and subject exist in this college
    const [teacher, subject] = await Promise.all([
      tenantDb.teacher.findFirst({ where: { id: teacher_id, college_id: req.collegeId } }),
      tenantDb.subject.findFirst({ where: { id: subject_id, college_id: req.collegeId } })
    ]);
    if (!teacher) return res.status(404).json({ success: false, message: 'Teacher not found' });
    if (!subject) return res.status(404).json({ success: false, message: 'Subject not found' });

    // Upsert or create mapping
    const existing = await tenantDb.teacherSubject.findFirst({
      where: {
        college_id: req.collegeId,
        teacher_id,
        subject_id,
        class: cls || null,
        group: group || null
      }
    });

    let result;
    if (existing) {
      result = await tenantDb.teacherSubject.update({
        where: { id: existing.id },
        data: {
          isPrimary: isPrimary !== undefined ? isPrimary : existing.isPrimary,
          maxPeriodsPerDay: maxPeriodsPerDay !== undefined ? maxPeriodsPerDay : existing.maxPeriodsPerDay
        }
      });
    } else {
      result = await tenantDb.teacherSubject.create({
        data: {
          college_id: req.collegeId,
          teacher_id,
          subject_id,
          class: cls || null,
          group: group || null,
          isPrimary: isPrimary !== undefined ? isPrimary : false,
          maxPeriodsPerDay: maxPeriodsPerDay !== undefined ? maxPeriodsPerDay : null
        }
      });
    }

    res.status(201).json({ success: true, data: { ...result, _id: result.id } });
  } catch (error) { next(error); }
};

exports.deleteTeacherSubject = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const existing = await tenantDb.teacherSubject.findFirst({
      where: { id: req.params.id, college_id: req.collegeId }
    });
    if (!existing) return res.status(404).json({ success: false, message: 'Record not found' });

    await tenantDb.teacherSubject.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: 'Teacher subject assignment deleted' });
  } catch (error) { next(error); }
};

exports.getEligibleTeachersForSubject = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const teachers = await getTeachersForSubject(tenantDb, req.collegeId, req.params.subjectId, req.query);
    res.json({ success: true, data: teachers });
  } catch (error) { next(error); }
};

exports.getEligibleSubjectsForTeacher = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const subjects = await getSubjectsForTeacher(tenantDb, req.collegeId, req.params.teacherId);
    res.json({ success: true, data: subjects });
  } catch (error) { next(error); }
};
