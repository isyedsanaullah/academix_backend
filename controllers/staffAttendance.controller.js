const { getSystemClient } = require('../config/prismaManager');
const {
  recordStaffAttendance,
  getStaffAttendance,
  isStaffOnLeave
} = require('../services/staffAttendanceService');

exports.getAttendance = async (req, res, next) => {
  try {
    const { date, userId, campusId } = req.query;
    const targetDate = date ? new Date(date) : new Date();

    const data = await getStaffAttendance({
      collegeId: req.collegeId,
      date: targetDate,
      userId,
      campusId
    });

    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

exports.markAttendance = async (req, res, next) => {
  try {
    const { userId, date, checkInTime, checkOutTime, status, minutesLate, source, campusId } = req.body;
    if (!userId || !date) {
      return res.status(400).json({ success: false, message: 'userId and date are required' });
    }

    const record = await recordStaffAttendance({
      collegeId: req.collegeId,
      campusId,
      userId,
      date,
      checkInTime,
      checkOutTime,
      status,
      minutesLate,
      source: source || 'MANUAL',
      markedById: req.user?.id || req.user?._id || null
    });

    res.status(201).json({ success: true, data: record });
  } catch (error) {
    if (error.code === 'TENANT_IN_READ_ONLY_MODE' || error.code === 'TENANT_SUSPENDED') {
      return res.status(error.status || 403).json({ success: false, code: error.code, message: error.message });
    }
    next(error);
  }
};

exports.updateAttendance = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const { id } = req.params;
    const { checkInTime, checkOutTime, status, minutesLate } = req.body;

    // Cross-tenant protection
    const existing = await prisma.staffAttendance.findFirst({
      where: { id, college_id: req.collegeId }
    });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Staff attendance record not found' });
    }

    // Check read-only / suspended
    const college = await prisma.college.findUnique({
      where: { id: req.collegeId },
      select: { subStatus: true }
    });
    if (college?.subStatus === 'READ_ONLY') {
      return res.status(403).json({ success: false, code: 'TENANT_IN_READ_ONLY_MODE', message: 'Tenant in read-only mode' });
    }
    if (college?.subStatus === 'SUSPENDED') {
      return res.status(403).json({ success: false, code: 'TENANT_SUSPENDED', message: 'Tenant is suspended' });
    }

    const updated = await recordStaffAttendance({
      collegeId: req.collegeId,
      campusId: existing.campus_id,
      userId: existing.userId,
      date: existing.date,
      checkInTime,
      checkOutTime,
      status,
      minutesLate,
      source: 'MANUAL',
      markedById: req.user?.id || req.user?._id || null
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
};

exports.getSummary = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const { from, to, campusId } = req.query;
    const fromDate = from ? new Date(from) : new Date();
    const toDate = to ? new Date(to) : new Date();

    const where = {
      college_id: req.collegeId,
      date: { gte: fromDate, lte: toDate }
    };
    if (campusId) where.campus_id = campusId;

    const records = await prisma.staffAttendance.findMany({ where });

    const summary = {
      total: records.length,
      present: records.filter(r => r.status === 'PRESENT').length,
      late: records.filter(r => r.status === 'LATE').length,
      halfDay: records.filter(r => r.status === 'HALF_DAY').length,
      absent: records.filter(r => r.status === 'ABSENT').length
    };

    res.json({ success: true, data: summary });
  } catch (error) {
    next(error);
  }
};

