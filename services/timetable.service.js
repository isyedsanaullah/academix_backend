/**
 * Timetable & Substitution Service
 * ─────────────────────────────────────────────────────────────
 * Multi-subject teacher management and conflict/clash detection:
 * 1. Multi-subject resolution (TeacherSubject + Subject.teacher_id)
 * 2. Hard clash checking (teacher double-booking & section overlaps)
 * 3. Daily period caps (maxPeriodsPerDay)
 */

/**
 * Get all eligible teachers for a specific subject
 * Combines TeacherSubject assignments with legacy Subject.teacher_id
 *
 * @param {Object} tenantDb - Prisma tenant client
 * @param {string} collegeId
 * @param {string} subjectId
 * @param {Object} [filter]
 * @param {string} [filter.class]
 * @param {string} [filter.group]
 * @returns {Promise<Array>} List of teachers with primary flag
 */
async function getTeachersForSubject(tenantDb, collegeId, subjectId, filter = {}) {
  const [subject, teacherSubjects] = await Promise.all([
    tenantDb.subject.findFirst({
      where: { id: subjectId, college_id: collegeId }
    }),
    tenantDb.teacherSubject.findMany({
      where: {
        college_id: collegeId,
        subject_id: subjectId,
        ...(filter.class ? { OR: [{ class: filter.class }, { class: 'Both' }, { class: null }] } : {}),
        ...(filter.group ? { OR: [{ group: filter.group }, { group: null }] } : {})
      }
    })
  ]);

  const teacherIds = new Set(teacherSubjects.map(ts => ts.teacher_id));
  if (subject?.teacher_id) {
    teacherIds.add(subject.teacher_id);
  }

  if (teacherIds.size === 0) return [];

  const teachers = await tenantDb.teacher.findMany({
    where: { id: { in: [...teacherIds] }, college_id: collegeId }
  });

  const userIds = teachers.map(t => t.user_id).filter(Boolean);
  const users = await tenantDb.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true, email: true }
  });
  const userMap = Object.fromEntries(users.map(u => [u.id, u]));

  return teachers.map(t => {
    const isPrimary = subject?.teacher_id === t.id;
    const tsEntry = teacherSubjects.find(ts => ts.teacher_id === t.id);
    return {
      id: t.id,
      _id: t.id,
      name: userMap[t.user_id]?.name || 'Teacher',
      email: userMap[t.user_id]?.email || '',
      isPrimary,
      maxPeriodsPerDay: tsEntry?.maxPeriodsPerDay || null,
      class: tsEntry?.class || subject?.class || null,
      group: tsEntry?.group || subject?.group || null
    };
  });
}

/**
 * Get all subjects taught by a specific teacher
 *
 * @param {Object} tenantDb
 * @param {string} collegeId
 * @param {string} teacherId
 * @returns {Promise<Array>}
 */
async function getSubjectsForTeacher(tenantDb, collegeId, teacherId) {
  const [teacherSubjects, primarySubjects] = await Promise.all([
    tenantDb.teacherSubject.findMany({
      where: { college_id: collegeId, teacher_id: teacherId }
    }),
    tenantDb.subject.findMany({
      where: { college_id: collegeId, teacher_id: teacherId }
    })
  ]);

  const subjectIds = new Set([
    ...teacherSubjects.map(ts => ts.subject_id),
    ...primarySubjects.map(s => s.id)
  ]);

  if (subjectIds.size === 0) return [];

  const subjects = await tenantDb.subject.findMany({
    where: { id: { in: [...subjectIds] }, college_id: collegeId }
  });

  return subjects.map(s => {
    const isPrimary = s.teacher_id === teacherId;
    const ts = teacherSubjects.find(t => t.subject_id === s.id);
    return {
      ...s,
      _id: s.id,
      isPrimary,
      maxPeriodsPerDay: ts?.maxPeriodsPerDay || null
    };
  });
}

/**
 * Check for timetable clashes:
 * 1. Internal section clash: duplicate periodNumber within the section
 * 2. External teacher clash: teacher already assigned to another section in the same period
 *
 * @param {Object} params
 * @returns {Promise<{ hasClash: boolean, message?: string, code?: string }>}
 */
async function checkTimetableClashes({
  tenantDb,
  collegeId,
  day,
  targetClass,
  targetSection,
  periods = [],
  excludeTimetableId = null
}) {
  // 1. Internal check: No two periods have the same periodNumber in the same day
  const periodNumbersSeen = new Set();
  for (const p of periods) {
    if (!p.periodNumber) continue;
    if (periodNumbersSeen.has(p.periodNumber)) {
      return {
        hasClash: true,
        code: 'SECTION_PERIOD_CLASH',
        message: `Section ${targetClass} (${targetSection}) has duplicate period ${p.periodNumber} on ${day}.`
      };
    }
    periodNumbersSeen.add(p.periodNumber);
  }

  // 2. External check: Teacher double-booking across other sections
  const otherTimetables = await tenantDb.timetable.findMany({
    where: {
      college_id: collegeId,
      day,
      isActive: true,
      ...(excludeTimetableId ? { id: { not: excludeTimetableId } } : {})
    }
  });

  // Build existing teacher schedule map: teacherId -> { periodNumber -> { class, section } }
  const teacherSchedule = new Map();
  otherTimetables.forEach(t => {
    // Skip if it's the same class & section
    if (t.class === targetClass && t.section === targetSection) return;

    (t.periods || []).forEach(p => {
      if (!p.teacher_id || p.isBreak) return;
      if (!teacherSchedule.has(p.teacher_id)) {
        teacherSchedule.set(p.teacher_id, new Map());
      }
      teacherSchedule.get(p.teacher_id).set(p.periodNumber, {
        class: t.class,
        section: t.section
      });
    });
  });

  // Verify proposed periods
  for (const p of periods) {
    if (!p.teacher_id || p.isBreak) continue;

    const existingSlot = teacherSchedule.get(p.teacher_id)?.get(p.periodNumber);
    if (existingSlot) {
      // Fetch teacher name for clear error messaging
      const teacher = await tenantDb.teacher.findFirst({ where: { id: p.teacher_id } });
      const teacherUser = teacher ? await tenantDb.user.findFirst({ where: { id: teacher.user_id } }) : null;
      const teacherName = teacherUser?.name || 'Assigned Teacher';

      return {
        hasClash: true,
        code: 'TEACHER_DOUBLE_BOOKED',
        message: `Clash detected: ${teacherName} is already assigned to ${existingSlot.class} (Section ${existingSlot.section}) in Period ${p.periodNumber} on ${day}.`
      };
    }
  }

  return { hasClash: false };
}

module.exports = {
  getTeachersForSubject,
  getSubjectsForTeacher,
  checkTimetableClashes
};
