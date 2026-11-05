const { getSystemClient } = require('../config/prismaManager');
const { isWorkingDay } = require('../services/workingDaysService');
const { getEntitlements } = require('../services/entitlements');

function parseTimeToMinutes(timeStr) {
  if (!timeStr) return 9 * 60; // 09:00 default
  const [h, m] = timeStr.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function isTimeEligible(now, alertTimeStr, cutoffTimeStr) {
  // Convert now to PKT (UTC+5)
  const pktDate = new Date(now.getTime() + 5 * 60 * 60 * 1000);
  const nowMinutes = pktDate.getUTCHours() * 60 + pktDate.getUTCMinutes();
  const alertMin = parseTimeToMinutes(alertTimeStr);
  const cutoffMin = parseTimeToMinutes(cutoffTimeStr);
  return nowMinutes >= alertMin && nowMinutes < cutoffMin;
}

/**
 * Dispatch absence alerts for a college on a given date
 */
async function dispatchAbsenceAlertsForCollege(collegeId, { date = new Date(), forceTime = false, campusId = null } = {}) {
  const prisma = getSystemClient();
  const dateObj = new Date(date);
  const dateOnly = new Date(Date.UTC(dateObj.getUTCFullYear(), dateObj.getUTCMonth(), dateObj.getUTCDate()));

  // 1. Status & Entitlement check
  const college = await prisma.college.findUnique({
    where: { id: collegeId },
    select: { id: true, subStatus: true, settings: true }
  });

  if (!college) throw new Error(`College ${collegeId} not found`);
  if (college.subStatus === 'SUSPENDED') {
    return { skipped: true, reason: 'COLLEGE_SUSPENDED' };
  }

  const entitlements = await getEntitlements(collegeId, prisma);
  const hasFeature = entitlements.features?.includes('absence-alerts-parents');
  if (!hasFeature) {
    return { skipped: true, reason: 'FEATURE_NOT_IN_PLAN' };
  }

  // 2. Working Day check
  const isWorkDay = await isWorkingDay(collegeId, dateOnly);
  if (!isWorkDay) {
    return { skipped: true, reason: 'NOT_A_WORKING_DAY' };
  }

  // 3. Time Window check
  const settings = (college.settings && typeof college.settings === 'object') ? college.settings : {};
  const alertTimeStr = settings['absence.alertTime'] || '09:00';
  const cutoffTimeStr = settings['absence.cutoffTime'] || '14:00';

  if (!forceTime && !isTimeEligible(new Date(), alertTimeStr, cutoffTimeStr)) {
    return { skipped: true, reason: 'OUTSIDE_ALERT_WINDOW' };
  }

  // 4. Query students marked absent today
  const absentRecords = await prisma.attendance.findMany({
    where: {
      college_id: collegeId,
      date: dateOnly,
      status: 'absent'
    }
  });

  let dispatchedCount = 0;
  let skippedCount = 0;

  for (const record of absentRecords) {
    const studentId = record.student_id;

    // Check if already alerted for this student on this date
    const existingAlert = await prisma.absenceAlertLog.findUnique({
      where: {
        college_id_studentId_alertDate: {
          college_id: collegeId,
          studentId,
          alertDate: dateOnly
        }
      }
    });

    if (existingAlert) {
      skippedCount++;
      continue;
    }

    // Check if student has approved leave covering today
    const approvedLeave = await prisma.leaveApplication.findFirst({
      where: {
        college_id: collegeId,
        student_id: studentId,
        status: { in: ['approved', 'APPROVED'] },
        leaveDate: { lte: dateOnly },
        OR: [
          { leaveDateEnd: null, leaveDate: dateOnly },
          { leaveDateEnd: { gte: dateOnly } }
        ]
      }
    });

    if (approvedLeave) {
      skippedCount++;
      continue;
    }

    // Check if student has an active guardian session
    const guardianSession = await prisma.guardianSession.findUnique({
      where: {
        college_id_studentId: {
          college_id: collegeId,
          studentId
        }
      }
    });

    if (!guardianSession || !guardianSession.isActive) {
      // Unreachable guardian (no mobile app enrolled)
      skippedCount++;
      continue;
    }

    // Atomic Absence Alert Dispatch (Zero Alert Loss)
    try {
      await prisma.$transaction(async (tx) => {
        await tx.absenceAlertLog.create({
          data: {
            college_id: collegeId,
            campus_id: campusId,
            studentId,
            alertDate: dateOnly
          }
        });

        await tx.guardianNotification.create({
          data: {
            college_id: collegeId,
            campus_id: campusId,
            student_id: studentId,
            kind: 'ABSENCE',
            title: 'Notice: Student Marked Absent',
            body: `Your child was marked absent today (${dateOnly.toISOString().slice(0, 10)}).`,
            refType: 'ATTENDANCE',
            refId: record.id
          }
        });
      });
      dispatchedCount++;
    } catch (err) {
      if (err.code !== 'P2002') {
        console.error(`Failed to dispatch absence alert for student ${studentId}:`, err.message);
      }
    }
  }

  return {
    success: true,
    totalAbsentMarked: absentRecords.length,
    dispatchedCount,
    skippedCount
  };
}

module.exports = {
  parseTimeToMinutes,
  isTimeEligible,
  dispatchAbsenceAlertsForCollege
};

