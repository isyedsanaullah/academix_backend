const { getSystemClient } = require('../config/prismaManager');

const SOURCE_PRIORITY = {
  SYSTEM: 1,
  GATE_QR: 2,
  BIOMETRIC: 3,
  MANUAL: 4
};

/**
 * Parse time string "HH:MM" into minutes from midnight
 */
function parseTimeToMinutes(timeStr) {
  if (!timeStr) return 8 * 60; // 08:00 default
  const [h, m] = timeStr.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Determine check-in status and minutesLate based on shift settings
 */
function calculateCheckInStatus(checkInDate, settings = {}) {
  const shiftStartTime = settings['staff.shiftStartTime'] || '08:00';
  const graceMinutes = parseInt(settings['staff.graceMinutes'], 10) ?? 15;
  const halfDayAfterMinutes = parseInt(settings['staff.halfDayAfterMinutes'], 10) ?? 120;

  // Convert checkInDate to PKT (Asia/Karachi: UTC+5)
  const utcMs = checkInDate.getTime();
  const pktDate = new Date(utcMs + 5 * 60 * 60 * 1000);
  const checkInMinutes = pktDate.getUTCHours() * 60 + pktDate.getUTCMinutes();
  const shiftMinutes = parseTimeToMinutes(shiftStartTime);

  const d = checkInMinutes - shiftMinutes;

  if (d <= 0) {
    return { status: 'PRESENT', minutesLate: 0 };
  } else if (d <= graceMinutes) {
    return { status: 'PRESENT', minutesLate: 0 };
  } else if (d <= halfDayAfterMinutes) {
    return { status: 'LATE', minutesLate: d };
  } else {
    return { status: 'HALF_DAY', minutesLate: d };
  }
}

/**
 * Check if a staff user is on approved leave for a given date
 */
async function isStaffOnLeave(prisma, collegeId, userId, dateObj) {
  const targetDate = new Date(dateObj);
  const targetDateStr = targetDate.toISOString().slice(0, 10);

  // 1. Check dedicated StaffLeave table
  const staffLeave = await prisma.staffLeave.findFirst({
    where: {
      college_id: collegeId,
      user_id: userId,
      status: { in: ['APPROVED', 'approved'] },
      startDate: { lte: targetDate },
      endDate: { gte: targetDate }
    }
  });
  if (staffLeave) return true;

  // 2. Check Employee.leaveRecords JSON (#63 model)
  const employee = await prisma.employee.findFirst({
    where: { college_id: collegeId, user_id: userId }
  });
  if (employee && Array.isArray(employee.leaveRecords)) {
    for (const record of employee.leaveRecords) {
      if (record && (record.status === 'approved' || record.status === 'APPROVED')) {
        const start = (record.startDate || '').slice(0, 10);
        const end = (record.endDate || '').slice(0, 10);
        if (start && end && targetDateStr >= start && targetDateStr <= end) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Get college staff attendance settings
 */
async function getStaffSettings(prisma, collegeId) {
  const college = await prisma.college.findUnique({
    where: { id: collegeId },
    select: { settings: true }
  });
  const settings = (college && typeof college.settings === 'object' && college.settings !== null) 
    ? college.settings 
    : {};

  return {
    'staff.shiftStartTime': settings['staff.shiftStartTime'] || '08:00',
    'staff.graceMinutes': settings['staff.graceMinutes'] !== undefined ? Number(settings['staff.graceMinutes']) : 15,
    'staff.halfDayAfterMinutes': settings['staff.halfDayAfterMinutes'] !== undefined ? Number(settings['staff.halfDayAfterMinutes']) : 120
  };
}

/**
 * Record or update staff attendance with priority and state rules
 */
async function recordStaffAttendance({
  collegeId,
  campusId = null,
  userId,
  date,
  checkInTime = null,
  checkOutTime = null,
  status = null,
  minutesLate = null,
  source = 'MANUAL',
  markedById = null
}) {
  const prisma = getSystemClient();
  const dateObj = new Date(date);
  const dateOnly = new Date(Date.UTC(dateObj.getUTCFullYear(), dateObj.getUTCMonth(), dateObj.getUTCDate()));

  // Check college status
  const college = await prisma.college.findUnique({
    where: { id: collegeId },
    select: { subStatus: true }
  });

  const subStatus = college?.subStatus || 'ACTIVE';
  if (subStatus === 'READ_ONLY' && source === 'MANUAL') {
    const err = new Error('Tenant is in read-only mode');
    err.code = 'TENANT_IN_READ_ONLY_MODE';
    err.status = 403;
    throw err;
  }
  if (subStatus === 'SUSPENDED' && source === 'MANUAL') {
    const err = new Error('Tenant is suspended');
    err.code = 'TENANT_SUSPENDED';
    err.status = 403;
    throw err;
  }

  const existing = await prisma.staffAttendance.findUnique({
    where: {
      college_id_userId_date: {
        college_id: collegeId,
        userId,
        date: dateOnly
      }
    }
  });

  const newPriority = SOURCE_PRIORITY[source] || 1;
  const existingPriority = existing ? (SOURCE_PRIORITY[existing.source] || 1) : 0;

  // Lower priority write never overwrites higher priority
  if (existing && newPriority < existingPriority) {
    return existing;
  }

  // Determine status & minutesLate if checkInTime provided and status not explicitly forced
  let effectiveStatus = status;
  let effectiveMinutesLate = minutesLate !== null ? minutesLate : 0;

  if (subStatus === 'SUSPENDED' && source === 'BIOMETRIC') {
    effectiveStatus = 'DEFERRED_PROCESSING';
  } else if (!effectiveStatus) {
    if (checkInTime) {
      const settings = await getStaffSettings(prisma, collegeId);
      const calc = calculateCheckInStatus(new Date(checkInTime), settings);
      effectiveStatus = calc.status;
      effectiveMinutesLate = calc.minutesLate;
    } else {
      effectiveStatus = 'PRESENT';
    }
  }

  let result;
  if (!existing) {
    result = await prisma.staffAttendance.create({
      data: {
        college_id: collegeId,
        campus_id: campusId,
        userId,
        date: dateOnly,
        checkInTime: checkInTime ? new Date(checkInTime) : null,
        checkOutTime: checkOutTime ? new Date(checkOutTime) : null,
        status: effectiveStatus,
        minutesLate: effectiveMinutesLate,
        source,
        markedById
      }
    });

    if (source === 'MANUAL' && markedById) {
      try {
        await prisma.auditLog.create({
          data: {
            college_id: collegeId,
            user_id: markedById,
            action: 'STAFF_ATTENDANCE_EDIT',
            details: JSON.stringify({ before: null, after: result })
          }
        });
      } catch (e) {
        console.warn('AuditLog error:', e.message);
      }
    }
  } else {
    // Higher or equal priority overwrites
    const before = { ...existing };
    result = await prisma.staffAttendance.update({
      where: { id: existing.id },
      data: {
        campus_id: campusId || existing.campus_id,
        checkInTime: checkInTime ? new Date(checkInTime) : existing.checkInTime,
        checkOutTime: checkOutTime ? new Date(checkOutTime) : existing.checkOutTime,
        status: effectiveStatus,
        minutesLate: effectiveMinutesLate,
        source,
        markedById: markedById || existing.markedById
      }
    });

    if (source === 'MANUAL' && markedById) {
      try {
        await prisma.auditLog.create({
          data: {
            college_id: collegeId,
            user_id: markedById,
            action: 'STAFF_ATTENDANCE_EDIT',
            details: JSON.stringify({ before, after: result })
          }
        });
      } catch (e) {
        console.warn('AuditLog error:', e.message);
      }
    }
  }

  return result;
}

/**
 * Get staff attendance for a given date with live ON_LEAVE derivation
 */
async function getStaffAttendance({ collegeId, date, userId = null, campusId = null }) {
  const prisma = getSystemClient();
  const dateObj = new Date(date);
  const dateOnly = new Date(Date.UTC(dateObj.getUTCFullYear(), dateObj.getUTCMonth(), dateObj.getUTCDate()));

  const where = {
    college_id: collegeId,
    date: dateOnly
  };
  if (userId) where.userId = userId;
  if (campusId) where.campus_id = campusId;

  const records = await prisma.staffAttendance.findMany({
    where,
    orderBy: { createdAt: 'desc' }
  });

  // Derive ON_LEAVE live for each user
  const enriched = await Promise.all(
    records.map(async r => {
      const onLeave = await isStaffOnLeave(prisma, collegeId, r.userId, dateOnly);
      if (onLeave) {
        return { ...r, status: 'ON_LEAVE' };
      }
      return r;
    })
  );

  return enriched;
}

module.exports = {
  SOURCE_PRIORITY,
  parseTimeToMinutes,
  calculateCheckInStatus,
  isStaffOnLeave,
  getStaffSettings,
  recordStaffAttendance,
  getStaffAttendance
};
