const { getSystemClient } = require('../config/prismaManager');
const { isWorkingDay } = require('../services/workingDaysService');
const { isStaffOnLeave } = require('../services/staffAttendanceService');

/**
 * Worker that runs at 14:00 PKT to mark absent staff for the day.
 * Generates status = 'ABSENT', source = 'SYSTEM' rows.
 */
async function processDailyStaffAbsentees(collegeId, date = new Date()) {
  const prisma = getSystemClient();
  const dateObj = new Date(date);
  const dateOnly = new Date(Date.UTC(dateObj.getUTCFullYear(), dateObj.getUTCMonth(), dateObj.getUTCDate()));

  // 1. Check if date is a working day for the college
  const isWorkDay = await isWorkingDay(collegeId, dateOnly);
  if (!isWorkDay) {
    return { skipped: true, reason: 'NOT_A_WORKING_DAY', count: 0 };
  }

  // 2. Fetch all active staff/teachers for the college
  const activeStaff = await prisma.user.findMany({
    where: {
      college_id: collegeId,
      role: { in: ['teacher', 'employee', 'staff'] },
      isActive: true
    },
    select: { id: true, role: true }
  });

  if (activeStaff.length === 0) {
    return { count: 0, created: 0 };
  }

  // 3. Fetch existing staff attendance rows for today
  const existingRecords = await prisma.staffAttendance.findMany({
    where: {
      college_id: collegeId,
      date: dateOnly
    },
    select: { userId: true }
  });
  const attendedUserIds = new Set(existingRecords.map(r => r.userId));

  let createdCount = 0;

  for (const staff of activeStaff) {
    if (attendedUserIds.has(staff.id)) continue;

    // Check if staff is on approved leave
    const onLeave = await isStaffOnLeave(prisma, collegeId, staff.id, dateOnly);
    if (onLeave) {
      // Leave is derived at read time, do not insert ABSENT
      continue;
    }

    try {
      await prisma.staffAttendance.create({
        data: {
          college_id: collegeId,
          userId: staff.id,
          date: dateOnly,
          status: 'ABSENT',
          minutesLate: 0,
          source: 'SYSTEM'
        }
      });
      createdCount++;
    } catch (err) {
      // Unique constraint conflict if marked concurrently
      if (err.code !== 'P2002') {
        console.error(`Error marking staff absent for user ${staff.id}:`, err.message);
      }
    }
  }

  return { totalStaff: activeStaff.length, created: createdCount };
}

module.exports = {
  processDailyStaffAbsentees
};

