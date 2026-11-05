const { getSystemClient } = require('../config/prismaManager');

/**
 * Calculates student attendance percentage over marked days
 * Shared by #41 (board eligibility check) and #81 (shortage warnings)
 */
async function calculateStudentAttendance(collegeId, studentId, { sessionId = null, startDate = null, endDate = null } = {}) {
  const prisma = getSystemClient();
  const where = {
    college_id: collegeId,
    student_id: studentId
  };
  if (sessionId) where.session_id = sessionId;
  if (startDate || endDate) {
    where.date = {};
    if (startDate) where.date.gte = new Date(startDate);
    if (endDate) where.date.lte = new Date(endDate);
  }

  const records = await prisma.attendance.findMany({ where });

  // Exclude days where status is 'leave'
  const markedRecords = records.filter(r => r.status !== 'leave');
  const markedDays = markedRecords.length;

  if (markedDays === 0) {
    return {
      markedDays: 0,
      attendedDays: 0,
      attendancePercent: 100.00
    };
  }

  const presentCount = markedRecords.filter(a => a.status === 'present').length;
  const lateCount = markedRecords.filter(a => a.status === 'late').length;
  const attendedDays = presentCount + (0.5 * lateCount);
  const rawPercent = (attendedDays / markedDays) * 100;
  const attendancePercent = parseFloat(rawPercent.toFixed(2));

  return {
    markedDays,
    attendedDays: Math.round(attendedDays),
    attendancePercent
  };
}

module.exports = {
  calculateStudentAttendance
};

