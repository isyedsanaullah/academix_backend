const crypto = require('crypto');
const { getSystemClient } = require('../config/prismaManager');
const {
  generateGuardianPin,
  hashGuardianPin,
  compareGuardianPin
} = require('../utils/guardianPinGenerator');
const { hashToken } = require('../middleware/guardianAuth.middleware');

function hashIp(ip) {
  return crypto.createHash('sha256').update(ip || '127.0.0.1').digest('hex');
}

/**
 * Parent Portal Login
 * POST /api/parent/auth/login
 * Body: { collegeId, rollNumber, pin, sessionId? }
 */
exports.login = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const { collegeId, rollNumber, pin, sessionId } = req.body;
    const clientIp = req.ip || req.connection?.remoteAddress || '127.0.0.1';
    const ipHash = hashIp(clientIp);

    if (!collegeId || !rollNumber || !pin) {
      return res.status(401).json({
        success: false,
        message: 'Invalid roll number or PIN'
      });
    }

    // 1. IP Throttle Check: max 20 failures in 15 minutes
    const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000);
    const recentIpFailures = await prisma.guardianLoginAttempt.count({
      where: {
        college_id: collegeId,
        ipHash,
        success: false,
        createdAt: { gte: fifteenMinsAgo }
      }
    });

    if (recentIpFailures >= 20) {
      return res.status(429).json({
        success: false,
        code: 'IP_RATE_LIMITED',
        message: 'Too many failed login attempts from this network. Please try again in 15 minutes.'
      });
    }

    // 2. Disambiguated Roll Number Lookup
    const studentQuery = {
      college_id: collegeId,
      rollNumber: String(rollNumber).trim().toUpperCase(),
      status: 'active'
    };
    if (sessionId) studentQuery.session_id = sessionId;

    const matchingStudents = await prisma.student.findMany({
      where: studentQuery,
      orderBy: { createdAt: 'desc' }
    });

    if (matchingStudents.length === 0) {
      await prisma.guardianLoginAttempt.create({
        data: { college_id: collegeId, ipHash, success: false }
      });
      return res.status(401).json({ success: false, message: 'Invalid roll number or PIN' });
    }

    if (matchingStudents.length > 1 && !sessionId) {
      // Disambiguation required
      return res.status(300).json({
        success: false,
        code: 'DISAMBIGUATION_REQUIRED',
        message: 'Multiple active students found with this roll number. Please select your session or class.',
        candidates: matchingStudents.map(s => ({
          studentId: s.id,
          sessionId: s.session_id,
          class: s.class,
          section: s.section
        }))
      });
    }

    const student = matchingStudents[0];

    // 3. Find GuardianSession
    const session = await prisma.guardianSession.findUnique({
      where: {
        college_id_studentId: {
          college_id: collegeId,
          studentId: student.id
        }
      }
    });

    if (!session || !session.isActive) {
      await prisma.guardianLoginAttempt.create({
        data: { college_id: collegeId, ipHash, success: false }
      });
      return res.status(401).json({ success: false, message: 'Invalid roll number or PIN' });
    }

    // 4. Lockout check
    if (session.lockedUntil && new Date(session.lockedUntil) > new Date()) {
      await prisma.guardianLoginAttempt.create({
        data: { college_id: collegeId, ipHash, success: false }
      });
      return res.status(401).json({ success: false, message: 'Invalid roll number or PIN' });
    }

    // 5. Verify PIN
    const isMatch = await compareGuardianPin(pin, session.pinHash);
    if (!isMatch) {
      const newFailures = session.failedAttempts + 1;
      const updates = { failedAttempts: newFailures };
      if (newFailures >= 5) {
        updates.lockedUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 min lockout
      }
      await prisma.guardianSession.update({
        where: { id: session.id },
        data: updates
      });
      await prisma.guardianLoginAttempt.create({
        data: { college_id: collegeId, ipHash, success: false }
      });
      return res.status(401).json({ success: false, message: 'Invalid roll number or PIN' });
    }

    // 6. Login Success: Reset failures & issue token
    await prisma.guardianSession.update({
      where: { id: session.id },
      data: {
        failedAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date()
      }
    });
    await prisma.guardianLoginAttempt.create({
      data: { college_id: collegeId, ipHash, success: true }
    });

    const college = await prisma.college.findUnique({
      where: { id: collegeId },
      select: { tokenEpoch: true }
    });

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    await prisma.guardianToken.create({
      data: {
        college_id: collegeId,
        sessionId: session.id,
        tokenHash,
        tokenEpoch: college?.tokenEpoch || 0,
        expiresAt
      }
    });

    res.json({
      success: true,
      data: {
        token: rawToken,
        student: {
          id: student.id,
          name: student.name,
          rollNumber: student.rollNumber,
          class: student.class,
          section: student.section,
          group: student.group
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Logout
 * POST /api/parent/auth/logout
 */
exports.logout = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    if (req.guardianToken) {
      await prisma.guardianToken.update({
        where: { id: req.guardianToken.id },
        data: { revokedAt: new Date() }
      });
    }
    res.set('Clear-Site-Data', '"cache", "storage"');
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    next(error);
  }
};

/**
 * Student Profile
 * GET /api/parent/student
 */
exports.getStudentProfile = async (req, res, next) => {
  try {
    res.json({ success: true, data: req.student });
  } catch (error) {
    next(error);
  }
};

/**
 * Daily Attendance History
 * GET /api/parent/attendance
 */
exports.getAttendance = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const records = await prisma.attendance.findMany({
      where: {
        college_id: req.collegeId,
        student_id: req.studentId
      },
      orderBy: { date: 'desc' },
      take: 60
    });
    res.json({ success: true, data: records });
  } catch (error) {
    next(error);
  }
};

/**
 * Fees Ledger
 * GET /api/parent/fees
 */
exports.getFees = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const fees = await prisma.studentFee.findMany({
      where: {
        college_id: req.collegeId,
        student_id: req.studentId
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json({ success: true, data: fees });
  } catch (error) {
    next(error);
  }
};

/**
 * Results & Result Cards
 * GET /api/parent/results
 */
exports.getResults = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const results = await prisma.examResult.findMany({
      where: {
        college_id: req.collegeId,
        student_id: req.studentId
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json({ success: true, data: results });
  } catch (error) {
    next(error);
  }
};

/**
 * Class Diary (Homework)
 * GET /api/parent/diary
 */
exports.getDiary = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const where = { college_id: req.collegeId };
    if (req.student.section_id) {
      where.section_id = req.student.section_id;
    }
    const diary = await prisma.classDiaryEntry.findMany({
      where,
      include: { attachments: true },
      orderBy: { entryDate: 'desc' },
      take: 30
    });
    res.json({ success: true, data: diary });
  } catch (error) {
    next(error);
  }
};

/**
 * Academic Calendar
 * GET /api/parent/calendar
 */
exports.getCalendar = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const events = await prisma.academicCalendarEvent.findMany({
      where: { college_id: req.collegeId },
      orderBy: { startDate: 'asc' }
    });
    res.json({ success: true, data: events });
  } catch (error) {
    next(error);
  }
};

/**
 * Circulars & Announcements
 * GET /api/parent/circulars
 */
exports.getCirculars = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const circulars = await prisma.announcement.findMany({
      where: {
        college_id: req.collegeId,
        status: 'published',
        targetAudience: { in: ['ALL', 'PARENTS'] }
      },
      orderBy: { publishDate: 'desc' },
      take: 30
    });
    res.json({ success: true, data: circulars });
  } catch (error) {
    next(error);
  }
};

/**
 * Notifications Feed
 * GET /api/parent/notifications
 */
exports.getNotifications = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const notifications = await prisma.guardianNotification.findMany({
      where: {
        college_id: req.collegeId,
        student_id: req.studentId
      },
      orderBy: { createdAt: 'desc' },
      take: 50
    });
    res.json({ success: true, data: notifications });
  } catch (error) {
    next(error);
  }
};

/**
 * Mark Notification Read
 * POST /api/parent/notifications/:id/read
 */
exports.markNotificationRead = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const { id } = req.params;
    const notif = await prisma.guardianNotification.findFirst({
      where: { id, college_id: req.collegeId, student_id: req.studentId }
    });
    if (!notif) return res.status(404).json({ success: false, message: 'Notification not found' });

    const updated = await prisma.guardianNotification.update({
      where: { id },
      data: { readAt: new Date() }
    });
    res.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
};

// ─── Admin Parent Portal Management ───────────────────────────────

/**
 * Issue or reset PIN for single student
 * POST /api/admin/parent-portal/issue
 */
exports.issueSinglePin = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const { studentId } = req.body;
    if (!studentId) return res.status(400).json({ success: false, message: 'studentId is required' });

    const student = await prisma.student.findFirst({
      where: { id: studentId, college_id: req.collegeId }
    });
    if (!student) return res.status(404).json({ success: false, message: 'Student not found' });

    const plainPin = generateGuardianPin();
    const pinHash = await hashGuardianPin(plainPin);

    const session = await prisma.guardianSession.upsert({
      where: {
        college_id_studentId: {
          college_id: req.collegeId,
          studentId: student.id
        }
      },
      create: {
        college_id: req.collegeId,
        campus_id: null,
        studentId: student.id,
        pinHash,
        isActive: true,
        pinIssuedAt: new Date(),
        pinResetBy: req.user?.id || req.user?._id || 'admin'
      },
      update: {
        pinHash,
        isActive: true,
        failedAttempts: 0,
        lockedUntil: null,
        pinIssuedAt: new Date(),
        pinResetBy: req.user?.id || req.user?._id || 'admin'
      }
    });

    // Revoke any existing active tokens
    await prisma.guardianToken.updateMany({
      where: { sessionId: session.id, revokedAt: null },
      data: { revokedAt: new Date() }
    });

    // Audit log
    try {
      await prisma.auditLog.create({
        data: {
          college_id: req.collegeId,
          user_id: req.user?.id || req.user?._id || 'system',
          action: 'PARENT_PIN_ISSUE',
          details: JSON.stringify({ studentId: student.id, rollNumber: student.rollNumber })
        }
      });
    } catch (e) {}

    res.json({
      success: true,
      data: {
        sessionId: session.id,
        studentId: student.id,
        rollNumber: student.rollNumber,
        guardianPin: plainPin // Plaintext shown ONCE on issue
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Bulk issue PINs for all active students lacking a session
 * POST /api/admin/parent-portal/issue-bulk
 */
exports.issueBulkPins = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const activeStudents = await prisma.student.findMany({
      where: { college_id: req.collegeId, status: 'active' },
      select: { id: true, rollNumber: true, name: true, class: true, section: true }
    });

    const existingSessions = await prisma.guardianSession.findMany({
      where: { college_id: req.collegeId },
      select: { studentId: true }
    });
    const sessionSet = new Set(existingSessions.map(s => s.studentId));

    const issuedList = [];

    for (const student of activeStudents) {
      if (sessionSet.has(student.id)) continue;

      const plainPin = generateGuardianPin();
      const pinHash = await hashGuardianPin(plainPin);

      await prisma.guardianSession.create({
        data: {
          college_id: req.collegeId,
          studentId: student.id,
          pinHash,
          isActive: true,
          pinIssuedAt: new Date(),
          pinResetBy: req.user?.id || req.user?._id || 'admin'
        }
      });

      issuedList.push({
        studentId: student.id,
        rollNumber: student.rollNumber,
        name: student.name,
        class: student.class,
        section: student.section,
        guardianPin: plainPin
      });
    }

    res.json({
      success: true,
      message: `Issued PINs for ${issuedList.length} students.`,
      count: issuedList.length,
      data: issuedList
    });
  } catch (error) {
    next(error);
  }
};

/**
 * List Guardian Sessions
 * GET /api/admin/parent-portal/sessions
 */
exports.getSessions = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const sessions = await prisma.guardianSession.findMany({
      where: { college_id: req.collegeId },
      orderBy: { pinIssuedAt: 'desc' },
      take: 100
    });
    res.json({ success: true, data: sessions });
  } catch (error) {
    next(error);
  }
};

// --- N22: Parent App Web Push Delivery ---
const guardianPushService = require('../services/guardianPushService');

exports.subscribePush = async (req, res, next) => {
  try {
    const studentId = req.guardianSession?.student_id || req.body.studentId;
    const { endpoint, p256dh, auth, userAgent } = req.body;

    if (!endpoint || !p256dh || !auth) {
      return res.status(400).json({ success: false, message: 'endpoint, p256dh, and auth keys are required' });
    }

    const sub = await guardianPushService.saveSubscription({
      collegeId: req.collegeId,
      studentId,
      endpoint,
      p256dh,
      auth,
      userAgent: userAgent || req.headers['user-agent'],
    });

    res.status(201).json({ success: true, data: sub });
  } catch (error) {
    next(error);
  }
};

exports.sendPushTest = async (req, res, next) => {
  try {
    const studentId = req.guardianSession?.student_id || req.body.studentId;
    const { title, body } = req.body;

    const result = await guardianPushService.sendPushNotification({
      collegeId: req.collegeId,
      studentId,
      title: title || 'Test Notification',
      body: body || 'Test Push Alert Body',
    });

    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};
