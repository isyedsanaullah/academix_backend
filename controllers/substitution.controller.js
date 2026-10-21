/**
 * Substitution Controller
 * ─────────────────────────────────────────────────────────────
 * Teacher substitution management:
 * - Detects absent teachers (via approved LeaveApplication or Attendance)
 * - Identifies free and eligible substitutes with subject-matching priority
 * - Enforces server-side guardrails:
 *   1. One substitute cannot take all periods of an absent teacher (>= 2 periods) -> 409 SUBSTITUTE_LIMIT
 *   2. Max daily substitutions per teacher (default 2)
 *   3. Free conflict check (not teaching regular class or another substitution)
 * - Real-time student & teacher timetable integration and notifications
 */

const { getSystemClient } = require('../config/prismaManager');
const { getTeachersForSubject } = require('../services/timetable.service');

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Format date to YYYY-MM-DD
 */
function toDateString(d) {
  const date = new Date(d);
  return date.toISOString().slice(0, 10);
}

/**
 * GET /api/substitutions/absent-teachers
 * List teachers absent or on approved leave for a given date
 */
exports.getAbsentTeachers = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const collegeId = req.collegeId;
    const { date } = req.query;

    const targetDate = date ? new Date(date) : new Date();
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    // 1. Fetch all teachers in college
    const teachers = await tenantDb.teacher.findMany({
      where: { college_id: collegeId, status: 'active' }
    });
    const userIds = teachers.map(t => t.user_id).filter(Boolean);
    const sysDb = getSystemClient();
    const users = await sysDb.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, email: true }
    });
    const userMap = Object.fromEntries(users.map(u => [u.id, u]));

    // 2. Fetch approved staff leave applications covering this date
    const approvedLeaves = await tenantDb.leaveApplication.findMany({
      where: {
        college_id: collegeId,
        status: 'approved',
        user_id: { in: userIds },
        leaveDate: { lte: endOfDay }
      }
    });

    const onLeaveUserIds = new Set();
    const leaveReasons = new Map();
    approvedLeaves.forEach(l => {
      const end = l.leaveDateEnd ? new Date(l.leaveDateEnd) : new Date(l.leaveDate);
      end.setHours(23, 59, 59, 999);
      if (new Date(l.leaveDate) <= endOfDay && end >= startOfDay) {
        onLeaveUserIds.add(l.user_id);
        leaveReasons.set(l.user_id, l.reason || l.category || 'Approved Leave');
      }
    });

    // 3. Fetch teachers marked absent if staff attendance model is present
    let absentPersonIds = new Set();
    if (tenantDb.staffAttendance) {
      try {
        const absentStaff = await tenantDb.staffAttendance.findMany({
          where: {
            college_id: collegeId,
            date: { gte: startOfDay, lte: endOfDay },
            status: 'absent'
          }
        });
        absentPersonIds = new Set(absentStaff.map(a => a.teacher_id || a.staff_id || a.id).filter(Boolean));
      } catch (err) {
        // Fallback gracefully
      }
    }

    // Combine
    const absentList = teachers.filter(t => onLeaveUserIds.has(t.user_id) || absentPersonIds.has(t.id)).map(t => ({
      id: t.id,
      _id: t.id,
      name: userMap[t.user_id]?.name || 'Teacher',
      email: userMap[t.user_id]?.email || '',
      reason: leaveReasons.get(t.user_id) || 'Marked Absent'
    }));

    res.json({
      success: true,
      date: toDateString(targetDate),
      data: absentList
    });
  } catch (error) { next(error); }
};

/**
 * GET /api/substitutions/teacher-periods
 * Fetch all periods taught by an absent teacher on a specific date
 */
exports.getAbsentTeacherPeriods = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const collegeId = req.collegeId;
    const { teacherId, date } = req.query;

    if (!teacherId || !date) {
      return res.status(400).json({ success: false, message: 'teacherId and date are required' });
    }

    const targetDate = new Date(date);
    const dayName = DAY_NAMES[targetDate.getDay()];

    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    // Fetch timetable for that day
    const timetables = await tenantDb.timetable.findMany({
      where: { college_id: collegeId, day: dayName, isActive: true }
    });

    // Existing substitutions on this date
    const existingSubs = await tenantDb.timetableSubstitution.findMany({
      where: {
        college_id: collegeId,
        date: { gte: startOfDay, lte: endOfDay },
        absentTeacher_id: teacherId,
        status: 'assigned'
      }
    });
    const subMap = new Map(existingSubs.map(s => [s.slotKey, s]));

    // Fetch subjects & teachers for labels
    const subjectIds = new Set();
    timetables.forEach(t => {
      (t.periods || []).forEach(p => {
        if (p.subject_id) subjectIds.add(p.subject_id);
      });
    });
    const subjects = await tenantDb.subject.findMany({
      where: { id: { in: [...subjectIds] }, college_id: collegeId },
      select: { id: true, name: true, code: true }
    });
    const subjectMap = Object.fromEntries(subjects.map(s => [s.id, s]));

    // Build period list
    const periods = [];
    timetables.forEach(t => {
      (t.periods || []).forEach(p => {
        if (p.teacher_id === teacherId && !p.isBreak) {
          const slotKey = `${dayName}_P${p.periodNumber}_${t.class}_${t.section}`;
          const sub = subMap.get(slotKey);
          periods.push({
            slotKey,
            class: t.class,
            section: t.section,
            periodNumber: p.periodNumber,
            startTime: p.startTime,
            endTime: p.endTime,
            room: p.room || null,
            subject: subjectMap[p.subject_id] || { id: p.subject_id, name: 'Subject' },
            substitution: sub ? {
              id: sub.id,
              substituteTeacher_id: sub.substituteTeacher_id,
              reason: sub.reason,
              status: sub.status
            } : null
          });
        }
      });
    });

    periods.sort((a, b) => a.periodNumber - b.periodNumber);

    res.json({
      success: true,
      day: dayName,
      date: toDateString(targetDate),
      periods
    });
  } catch (error) { next(error); }
};

/**
 * GET /api/substitutions/eligible-substitutes
 * List teachers who are free in a specific period and not absent,
 * prioritized by whether they teach the required subject.
 */
exports.getEligibleSubstitutes = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const sysDb = getSystemClient();
    const collegeId = req.collegeId;
    const { date, periodNumber, subjectId, absentTeacherId } = req.query;

    if (!date || periodNumber === undefined) {
      return res.status(400).json({ success: false, message: 'date and periodNumber are required' });
    }

    const pNum = Number(periodNumber);
    const targetDate = new Date(date);
    const dayName = DAY_NAMES[targetDate.getDay()];

    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    // 1. College max substitutions setting
    const college = await sysDb.college.findUnique({
      where: { id: collegeId },
      select: { settings: true }
    });
    const settings = (college?.settings && typeof college.settings === 'object') ? college.settings : {};
    const maxDailyLimit = Number(settings.maxSubstitutionsPerTeacherPerDay || 2);

    // 2. Fetch all active teachers
    const teachers = await tenantDb.teacher.findMany({
      where: { college_id: collegeId, status: 'active', id: { not: absentTeacherId } }
    });
    const userIds = teachers.map(t => t.user_id).filter(Boolean);
    const users = await tenantDb.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, email: true }
    });
    const userMap = Object.fromEntries(users.map(u => [u.id, u]));

    // 3. Teachers on leave or absent on date
    const approvedLeaves = await tenantDb.leaveApplication.findMany({
      where: {
        college_id: collegeId,
        status: 'approved',
        user_id: { in: userIds },
        leaveDate: { lte: endOfDay }
      }
    });
    const busyUserIds = new Set();
    approvedLeaves.forEach(l => {
      const end = l.leaveDateEnd ? new Date(l.leaveDateEnd) : new Date(l.leaveDate);
      end.setHours(23, 59, 59, 999);
      if (new Date(l.leaveDate) <= endOfDay && end >= startOfDay) {
        busyUserIds.add(l.user_id);
      }
    });

    // 4. Teachers teaching a regular class in pNum on dayName
    const dayTimetables = await tenantDb.timetable.findMany({
      where: { college_id: collegeId, day: dayName, isActive: true }
    });
    const regularTeachingTeacherIds = new Set();
    dayTimetables.forEach(t => {
      (t.periods || []).forEach(p => {
        if (p.periodNumber === pNum && p.teacher_id && !p.isBreak) {
          regularTeachingTeacherIds.add(p.teacher_id);
        }
      });
    });

    // 5. Teachers taking another substitution on date in pNum or having reached daily limit
    const existingSubsOnDate = await tenantDb.timetableSubstitution.findMany({
      where: {
        college_id: collegeId,
        date: { gte: startOfDay, lte: endOfDay },
        status: 'assigned'
      }
    });

    const subTeachingTeacherIds = new Set();
    const dailySubCountMap = new Map();

    existingSubsOnDate.forEach(s => {
      const currentCount = dailySubCountMap.get(s.substituteTeacher_id) || 0;
      dailySubCountMap.set(s.substituteTeacher_id, currentCount + 1);

      if (s.periodNumber === pNum) {
        subTeachingTeacherIds.add(s.substituteTeacher_id);
      }
    });

    // 6. Resolve teachers who teach the required subject (priority)
    let subjectTeacherIds = new Set();
    if (subjectId) {
      const eligibleForSubj = await getTeachersForSubject(tenantDb, collegeId, subjectId);
      subjectTeacherIds = new Set(eligibleForSubj.map(t => t.id));
    }

    // Filter free candidates
    const eligible = [];
    for (const t of teachers) {
      if (busyUserIds.has(t.user_id)) continue; // on leave
      if (regularTeachingTeacherIds.has(t.id)) continue; // teaching regular class
      if (subTeachingTeacherIds.has(t.id)) continue; // taking another substitution in this period
      const subCount = dailySubCountMap.get(t.id) || 0;
      if (subCount >= maxDailyLimit) continue; // reached daily cap

      const teachesSubject = subjectTeacherIds.has(t.id);
      eligible.push({
        id: t.id,
        _id: t.id,
        name: userMap[t.user_id]?.name || 'Teacher',
        email: userMap[t.user_id]?.email || '',
        teachesSubject,
        currentSubstitutionsToday: subCount,
        maxDailyLimit
      });
    }

    // Sort: teachers who teach the subject come first
    eligible.sort((a, b) => {
      if (a.teachesSubject && !b.teachesSubject) return -1;
      if (!a.teachesSubject && b.teachesSubject) return 1;
      return a.currentSubstitutionsToday - b.currentSubstitutionsToday;
    });

    res.json({
      success: true,
      data: eligible
    });
  } catch (error) { next(error); }
};

/**
 * POST /api/substitutions/assign
 * Assign a substitute teacher to a slot with server-side guardrails
 */
exports.assignSubstitution = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const sysDb = getSystemClient();
    const collegeId = req.collegeId;
    const assignedBy = req.user.id || req.user._id;

    const absentTeacherId = req.body.absentTeacherId || req.body.absentTeacher_id;
    const substituteTeacherId = req.body.substituteTeacherId || req.body.substituteTeacher_id;
    const subject_id = req.body.subject_id || req.body.subjectId;
    const { date, slotKey, class: cls, section, periodNumber, reason } = req.body;

    if (!date || !slotKey || !absentTeacherId || !substituteTeacherId) {
      return res.status(400).json({
        success: false,
        code: 'MISSING_FIELDS',
        message: 'date, slotKey, absentTeacherId, and substituteTeacherId are required'
      });
    }

    if (absentTeacherId === substituteTeacherId) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_SUBSTITUTE',
        message: 'A teacher cannot be a substitute for themself'
      });
    }

    const targetDate = new Date(date);
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);
    const dayName = DAY_NAMES[targetDate.getDay()];

    // 1. Check if slot is already substituted
    const existingSlotSub = await tenantDb.timetableSubstitution.findFirst({
      where: {
        college_id: collegeId,
        date: { gte: startOfDay, lte: endOfDay },
        slotKey,
        status: { in: ['assigned', 'active'] }
      }
    });

    if (existingSlotSub) {
      return res.status(409).json({
        success: false,
        code: 'SLOT_ALREADY_SUBSTITUTED',
        message: 'This timetable slot already has an assigned substitute'
      });
    }

    // 2. Count total periods of the absent teacher on this day
    const timetables = await tenantDb.timetable.findMany({
      where: { college_id: collegeId, day: dayName, isActive: true }
    });

    let absentTeacherTotalPeriods = 0;
    timetables.forEach(t => {
      (t.periods || []).forEach(p => {
        if (p.teacher_id === absentTeacherId && !p.isBreak) {
          absentTeacherTotalPeriods += 1;
        }
      });
    });

    // Rule: One substitute cannot take all periods of an absent teacher when total >= 2
    if (absentTeacherTotalPeriods >= 2) {
      const subFilter = {
        where: {
          college_id: collegeId,
          date: { gte: startOfDay, lte: endOfDay },
          absentTeacher_id: absentTeacherId,
          substituteTeacher_id: substituteTeacherId,
          status: { in: ['assigned', 'active'] }
        }
      };
      const alreadyAssignedToSubstitute = typeof tenantDb.timetableSubstitution.count === 'function'
        ? await tenantDb.timetableSubstitution.count(subFilter)
        : (await tenantDb.timetableSubstitution.findMany(subFilter)).length;

      if (alreadyAssignedToSubstitute + 1 >= absentTeacherTotalPeriods) {
        return res.status(409).json({
          success: false,
          code: 'SUBSTITUTE_LIMIT',
          message: 'One substitute cannot take all of the absent teacher\'s periods on the same day'
        });
      }
    }

    // 3. Daily limit per teacher
    let maxDailyLimit = 2;
    if (sysDb?.college) {
      const college = await sysDb.college.findUnique({
        where: { id: collegeId },
        select: { settings: true }
      });
      const settings = (college?.settings && typeof college.settings === 'object') ? college.settings : {};
      maxDailyLimit = Number(settings.maxSubstitutionsPerTeacherPerDay || 2);
    }

    const dailyFilter = {
      where: {
        college_id: collegeId,
        date: { gte: startOfDay, lte: endOfDay },
        substituteTeacher_id: substituteTeacherId,
        status: { in: ['assigned', 'active'] }
      }
    };
    const substituteDailyCount = typeof tenantDb.timetableSubstitution.count === 'function'
      ? await tenantDb.timetableSubstitution.count(dailyFilter)
      : (await tenantDb.timetableSubstitution.findMany(dailyFilter)).length;

    if (substituteDailyCount >= maxDailyLimit) {
      return res.status(409).json({
        success: false,
        code: 'DAILY_SUBSTITUTION_LIMIT',
        message: `Teacher has reached the daily limit of ${maxDailyLimit} substitutions per day`
      });
    }

    // 4. Create Substitution record
    const subRecord = await tenantDb.timetableSubstitution.create({
      data: {
        college_id: collegeId,
        date: startOfDay,
        slotKey,
        class: cls || null,
        section: section || null,
        periodNumber: periodNumber ? Number(periodNumber) : null,
        subject_id: subject_id || null,
        absentTeacher_id: absentTeacherId,
        substituteTeacher_id: substituteTeacherId,
        reason: reason || 'Teacher Absence',
        status: 'assigned',
        assignedBy
      }
    });

    // 5. Notify substitute teacher
    const subTeacher = await tenantDb.teacher.findFirst({
      where: { id: substituteTeacherId },
      select: { user_id: true }
    });
    const absentTeacher = await tenantDb.teacher.findFirst({
      where: { id: absentTeacherId },
      select: { user_id: true }
    });
    const absentUser = absentTeacher ? await tenantDb.user.findFirst({ where: { id: absentTeacher.user_id } }) : null;
    const absentName = absentUser?.name || 'Faculty Member';

    if (subTeacher?.user_id) {
      await tenantDb.notification.create({
        data: {
          college_id: collegeId,
          recipient: subTeacher.user_id,
          title: 'Class Substitution Assigned',
          message: `You have been assigned as substitute for ${absentName} in ${cls || ''} ${section || ''} (Slot: ${slotKey}) on ${toDateString(targetDate)}.`,
          type: 'general',
          link: '/teacher/timetable'
        }
      }).catch(() => {});
    }

    res.status(201).json({
      success: true,
      message: 'Substitution assigned successfully',
      data: subRecord
    });
  } catch (error) { next(error); }
};

/**
 * DELETE /api/substitutions/:id
 * Cancel an assigned substitution
 */
exports.cancelSubstitution = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const collegeId = req.collegeId;
    const { id } = req.params;

    const sub = await tenantDb.timetableSubstitution.findFirst({
      where: { id, college_id: collegeId }
    });

    if (!sub) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Substitution record not found' });
    }

    await tenantDb.timetableSubstitution.update({
      where: { id: sub.id },
      data: { status: 'cancelled' }
    });

    res.json({
      success: true,
      message: 'Substitution cancelled successfully'
    });
  } catch (error) { next(error); }
};

/**
 * GET /api/substitutions/weekly-report
 * Weekly substitution report per teacher
 */
exports.getWeeklySubstitutionReport = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const collegeId = req.collegeId;
    const { startDate, endDate } = req.query;

    const start = startDate ? new Date(startDate) : new Date(Date.now() - 7 * 86400000);
    start.setHours(0, 0, 0, 0);
    const end = endDate ? new Date(endDate) : new Date();
    end.setHours(23, 59, 59, 999);

    const substitutions = await tenantDb.timetableSubstitution.findMany({
      where: {
        college_id: collegeId,
        date: { gte: start, lte: end },
        status: 'assigned'
      },
      orderBy: { date: 'asc' }
    });

    // Populate teacher and subject details
    const teacherIds = [...new Set([
      ...substitutions.map(s => s.absentTeacher_id),
      ...substitutions.map(s => s.substituteTeacher_id)
    ])];

    const teachers = await tenantDb.teacher.findMany({
      where: { id: { in: teacherIds } },
      select: { id: true, user_id: true }
    });
    const users = await tenantDb.user.findMany({
      where: { id: { in: teachers.map(t => t.user_id) } },
      select: { id: true, name: true }
    });
    const userMap = Object.fromEntries(users.map(u => [u.id, u.name]));
    const teacherNameMap = Object.fromEntries(teachers.map(t => [t.id, userMap[t.user_id] || 'Teacher']));

    const report = substitutions.map(s => ({
      ...s,
      dateFormatted: toDateString(s.date),
      absentTeacherName: teacherNameMap[s.absentTeacher_id] || 'Absent Teacher',
      substituteTeacherName: teacherNameMap[s.substituteTeacher_id] || 'Substitute Teacher'
    }));

    res.json({
      success: true,
      period: { start: toDateString(start), end: toDateString(end) },
      totalSubstitutions: report.length,
      data: report
    });
  } catch (error) { next(error); }
};
