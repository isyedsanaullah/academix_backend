const { getSystemClient } = require('../config/prismaManager');
const { recordStaffAttendance } = require('../services/staffAttendanceService');

/**
 * Worker that drains unprocessed biometric punches
 */
async function processBiometricPunchesBatch(limit = 200) {
  const prisma = getSystemClient();

  // Fetch batch of unprocessed punches
  const punches = await prisma.biometricPunchLog.findMany({
    where: { processed: false },
    orderBy: { punchTime: 'asc' },
    take: limit
  });

  if (punches.length === 0) {
    return { processedCount: 0 };
  }

  let processedCount = 0;

  for (const punch of punches) {
    const { id, college_id, campus_id, deviceId, deviceUserId, punchTime } = punch;

    // Check college status
    const college = await prisma.college.findUnique({
      where: { id: college_id },
      select: { subStatus: true }
    });

    const isSuspended = college?.subStatus === 'SUSPENDED';

    // 1. Resolve identity
    const identity = await prisma.biometricIdentityMap.findUnique({
      where: {
        college_id_deviceUserId: {
          college_id,
          deviceUserId
        }
      }
    });

    if (!identity) {
      // Unmapped punch -> store in UnmappedBiometricPunch
      await prisma.unmappedBiometricPunch.create({
        data: {
          college_id,
          campus_id,
          deviceId,
          deviceUserId,
          punchTime
        }
      });
      await prisma.biometricPunchLog.update({
        where: { id },
        data: { processed: true }
      });
      processedCount++;
      continue;
    }

    const punchDate = new Date(punchTime);
    const dateOnly = new Date(Date.UTC(punchDate.getUTCFullYear(), punchDate.getUTCMonth(), punchDate.getUTCDate()));

    if (identity.subjectType === 'STAFF') {
      // Staff attendance update
      const existing = await prisma.staffAttendance.findUnique({
        where: {
          college_id_userId_date: {
            college_id,
            userId: identity.subjectId,
            date: dateOnly
          }
        }
      });

      let checkIn = punchTime;
      let checkOut = null;

      if (existing) {
        // First punch of the day is checkIn, last punch of the day is checkOut
        if (existing.checkInTime && punchTime > existing.checkInTime) {
          checkIn = existing.checkInTime;
          checkOut = punchTime;
        } else if (existing.checkInTime && punchTime <= existing.checkInTime) {
          checkIn = punchTime;
          checkOut = existing.checkOutTime;
        }
      }

      await recordStaffAttendance({
        collegeId: college_id,
        campusId: campus_id,
        userId: identity.subjectId,
        date: dateOnly,
        checkInTime: checkIn,
        checkOutTime: checkOut,
        source: 'BIOMETRIC'
      });
    } else if (identity.subjectType === 'STUDENT') {
      // Student attendance update: update or create student attendance record
      // Only update if not already marked manually
      const student = await prisma.student.findUnique({
        where: { id: identity.subjectId },
        select: { id: true, class: true, section: true, rollNumber: true, session_id: true }
      });

      if (student) {
        const existingStudentAtt = await prisma.attendance.findFirst({
          where: {
            college_id,
            student_id: student.id,
            date: dateOnly
          }
        });

        if (!existingStudentAtt) {
          await prisma.attendance.create({
            data: {
              college_id,
              session_id: student.session_id,
              student_id: student.id,
              date: dateOnly,
              status: isSuspended ? 'DEFERRED_PROCESSING' : 'present',
              method: 'biometric'
            }
          });
        } else if (existingStudentAtt.method !== 'manual') {
          // If not manual, can update
          await prisma.attendance.update({
            where: { id: existingStudentAtt.id },
            data: {
              status: isSuspended ? 'DEFERRED_PROCESSING' : 'present',
              method: 'biometric'
            }
          });
        }
      }
    }

    // Mark punch as processed
    await prisma.biometricPunchLog.update({
      where: { id },
      data: { processed: true }
    });
    processedCount++;
  }

  return { processedCount };
}

module.exports = {
  processBiometricPunchesBatch
};
