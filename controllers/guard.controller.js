// ─── Guard Controller (Multi-DB with Prisma) ───────────────────
const { getSystemClient } = require('../config/prismaManager');

const getCurrentSessionId = async (tenantDb, collegeId) => {
  const session = await tenantDb.session.findFirst({
    where: { college_id: collegeId, isCurrent: true }
  });
  return session?.id || null;
};

const getKarachiMidnight = (date = new Date()) => {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find(p => p.type === 'year').value;
  const month = parts.find(p => p.type === 'month').value;
  const day = parts.find(p => p.type === 'day').value;
  return new Date(`${year}-${month}-${day}T00:00:00+05:00`);
};

const getKarachiHour = (date = new Date()) => {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Karachi',
    hour: 'numeric',
    hour12: false
  });
  return parseInt(formatter.format(date), 10);
};

const findPersonByIdentifier = async (tenantDb, prisma, identifier, method, collegeId) => {
  if (method === 'QR' || method === 'MANUAL') {
    const student = await tenantDb.student.findFirst({
      where: { college_id: collegeId, qrCode: identifier, status: 'active' }
    });
    if (student) {
      return {
        type: 'student',
        person: student,
        model: 'Student',
        name: student.name,
        role: 'student',
        id: student.id
      };
    }

    const teacher = await tenantDb.teacher.findFirst({
      where: { college_id: collegeId, qrCode: identifier }
    });
    if (teacher) {
      const user = await prisma.user.findUnique({
        where: { id: teacher.user_id },
        select: { name: true }
      });
      return {
        type: 'teacher',
        person: teacher,
        model: 'Teacher',
        name: user?.name || teacher.name || 'Teacher',
        role: 'teacher',
        id: teacher.id
      };
    }

    const user = await prisma.user.findFirst({
      where: { college_id: collegeId, qrCode: identifier, isActive: true }
    });
    if (user) {
      return {
        type: 'employee',
        person: user,
        model: 'User',
        name: user.name,
        role: user.role,
        id: user.id
      };
    }
  } else if (method === 'FINGERPRINT') {
    const student = await tenantDb.student.findFirst({
      where: { college_id: collegeId, biometricId: identifier, status: 'active' }
    });
    if (student) {
      return {
        type: 'student',
        person: student,
        model: 'Student',
        name: student.name,
        role: 'student',
        id: student.id
      };
    }
  }
  return null;
};

exports.scanQR = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const tenantDb = req.tenantClient;
    const { identifier, verificationMethod = 'QR', deviceId = 'LAPTOP_CAMERA', location = 'Main Gate' } = req.body;

    const finalIdentifier = identifier || req.body.qrCode;
    const finalMethod = req.body.verificationMethod || req.body.method || verificationMethod || 'QR';
    const finalDeviceId = deviceId || 'LAPTOP_CAMERA';

    if (!finalIdentifier) {
      return res.status(400).json({ success: false, message: 'Identifier / QR code is required' });
    }

    const found = await findPersonByIdentifier(tenantDb, prisma, finalIdentifier, finalMethod, req.collegeId);
    if (!found) {
      return res.status(404).json({ success: false, errorCode: 'PERSON_NOT_FOUND', message: 'Person not found. Invalid identifier.' });
    }

    const todayKarachi = getKarachiMidnight();
    const now = new Date();

    let resultLog = null;
    let autoAction = 'entry';
    let isDuplicate = false;
    let isEarlyExit = false;
    let earlyExitApproved = false;
    let earlyExitRequestId = null;
    let isLateEntry = false;
    let fineIssued = null;

    // Fetch College Settings & Universal Timetable config
    const college = await prisma.college.findUnique({
      where: { id: req.collegeId },
      select: { settings: true }
    });
    const cSettings = (college && college.settings && typeof college.settings === 'object') ? college.settings : {};

    let openingTimeStr = cSettings.openingTime || '08:00';
    let closingTimeStr = cSettings.closingTime || '14:00';
    let graceMinutes = parseInt(cSettings.lateGraceMinutes ?? 15, 10);
    let lateFineAmount = parseFloat(cSettings.lateFineAmount ?? 100);
    let autoLateFineEnabled = cSettings.autoLateFine !== false;

    // Check if active UniversalTimetable exists for today
    const activeTimetable = await tenantDb.universalTimetable.findFirst({
      where: {
        college_id: req.collegeId,
        isActive: true,
        fromDate: { lte: now },
        toDate: { gte: now }
      }
    });

    if (activeTimetable && Array.isArray(activeTimetable.slots) && activeTimetable.slots.length > 0) {
      const firstSlot = activeTimetable.slots[0];
      const lastSlot = activeTimetable.slots[activeTimetable.slots.length - 1];
      if (firstSlot?.startTime) openingTimeStr = firstSlot.startTime;
      if (lastSlot?.endTime) closingTimeStr = lastSlot.endTime;
    }

    const parseTimeOnToday = (timeStr) => {
      const [h, m] = (timeStr || '08:00').split(':').map(n => parseInt(n, 10));
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Karachi',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
      const parts = formatter.formatToParts(now);
      const yr = parts.find(p => p.type === 'year').value;
      const mo = parts.find(p => p.type === 'month').value;
      const da = parts.find(p => p.type === 'day').value;
      const hh = String(h || 0).padStart(2, '0');
      const mm = String(m || 0).padStart(2, '0');
      return new Date(`${yr}-${mo}-${da}T${hh}:${mm}:00+05:00`);
    };

    const openingTimeDate = parseTimeOnToday(openingTimeStr);
    const closingTimeDate = parseTimeOnToday(closingTimeStr);
    const graceCutoffDate = new Date(openingTimeDate.getTime() + graceMinutes * 60 * 1000);

    // Execute everything in a transaction with an advisory lock for concurrency safety
    await tenantDb.$transaction(async (tx) => {
      // Advisory lock based on hashtext of person's UUID
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, found.id);

      // Fetch the last GateLog record for this person
      const lastLog = await tx.gateLog.findFirst({
        where: {
          college_id: req.collegeId,
          personId: found.id
        },
        orderBy: { timestamp: 'desc' }
      });

      // Concurrency/Duplicate Check: within 10 seconds
      if (lastLog && lastLog.timestamp && (now.getTime() - new Date(lastLog.timestamp).getTime() < 10000)) {
        isDuplicate = true;
        resultLog = lastLog;
        return; // Exit transaction block
      }

      // Determine state: Entry vs Exit
      if (lastLog) {
        const lastLogKarachiDate = getKarachiMidnight(new Date(lastLog.timestamp));
        if (lastLogKarachiDate.getTime() < todayKarachi.getTime()) {
          autoAction = 'entry';
        } else {
          autoAction = lastLog.action === 'entry' ? 'exit' : 'entry';
        }
      } else {
        autoAction = 'entry';
      }

      // Early Exit Validation against Closing Time
      if (autoAction === 'exit') {
        if (now.getTime() < closingTimeDate.getTime()) {
          isEarlyExit = true;
          const approval = await tx.earlyExitRequest.findFirst({
            where: {
              college_id: req.collegeId,
              personId: found.id,
              exitDate: todayKarachi,
              status: 'approved',
              used: false
            }
          });
          if (approval) {
            earlyExitApproved = true;
            earlyExitRequestId = approval.id;
            await tx.earlyExitRequest.update({
              where: { id: approval.id },
              data: { used: true, usedAt: now }
            });
          } else {
            const error = new Error(`⚠️ Early exit requires principal approval. ${found.name} cannot exit before closing time (${closingTimeStr}).`);
            error.statusCode = 403;
            error.requiresApproval = true;
            error.person = { name: found.name, type: found.type, role: found.role };
            throw error;
          }
        }
      }

      // Late Entry & Auto Fine Logic
      if (autoAction === 'entry') {
        if (now.getTime() > graceCutoffDate.getTime()) {
          isLateEntry = true;

          // Auto-issue fine ONLY for Students
          if (found.type === 'student' && autoLateFineEnabled && lateFineAmount > 0) {
            const existingFine = await tx.fine.findFirst({
              where: {
                college_id: req.collegeId,
                student_id: found.id,
                category: 'late',
                createdAt: { gte: todayKarachi }
              }
            });

            if (!existingFine) {
              const sessionId = await getCurrentSessionId(tx, req.collegeId);
              const timeFormatted = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
              fineIssued = await tx.fine.create({
                data: {
                  college_id: req.collegeId,
                  session_id: sessionId || '',
                  student_id: found.id,
                  teacher_id: '',
                  amount: lateFineAmount,
                  reason: `Auto late gate entry fine (${timeFormatted}, College Opening: ${openingTimeStr})`,
                  category: 'late',
                  status: 'unpaid'
                }
              });
            }
          }
        }
      }

      // Insert new GateLog inside transaction
      resultLog = await tx.gateLog.create({
        data: {
          college_id: req.collegeId,
          personType: found.type,
          personId: found.id,
          personModel: found.model,
          personName: found.name,
          personRole: found.role,
          qrCode: finalMethod === 'QR' ? finalIdentifier : null,
          action: autoAction,
          date: todayKarachi,
          timestamp: now,
          isEarlyExit,
          earlyExitApproved,
          earlyExitRequestId,
          scannedBy: req.user.id || req.user._id,
          verificationMethod: finalMethod,
          deviceId: finalDeviceId,
          location: location,
          remarks: isLateEntry ? (fineIssued ? `Late Entry (Fine: Rs.${lateFineAmount})` : 'Late Entry') : null
        }
      });

      // Auto mark student attendance on entry
      if (autoAction === 'entry' && found.type === 'student') {
        const sessionId = await getCurrentSessionId(tx, req.collegeId);
        if (sessionId) {
          const attStatus = isLateEntry ? 'late' : 'present';
          const whereUnique = {
            college_id_session_id_student_id_date: {
              college_id: req.collegeId,
              session_id: sessionId,
              student_id: found.id,
              date: todayKarachi
            }
          };
          await tx.attendance.upsert({
            where: whereUnique,
            update: {
              status: attStatus,
              method: finalMethod.toLowerCase(),
              entryTime: now,
              class: found.person.class,
              section: found.person.section
            },
            create: {
              college_id: req.collegeId,
              session_id: sessionId,
              student_id: found.id,
              date: todayKarachi,
              status: attStatus,
              method: finalMethod.toLowerCase(),
              entryTime: now,
              class: found.person.class,
              section: found.person.section
            }
          });
        }
      }
    });

    if (isDuplicate) {
      return res.status(400).json({
        success: false,
        errorCode: 'DUPLICATE_SCAN',
        message: 'Duplicate scan ignored',
        data: { ...resultLog, _id: resultLog.id },
        person: { name: found.name, type: found.type, role: found.role }
      });
    }

    let statusMsg = `${found.name} — ${autoAction.toUpperCase()} recorded`;
    if (autoAction === 'entry' && isLateEntry) {
      if (found.type === 'student' && fineIssued) {
        statusMsg = `⚠️ ${found.name} — LATE ENTRY (Rs.${lateFineAmount} fine issued)`;
      } else {
        statusMsg = `⚠️ ${found.name} — LATE ENTRY logged`;
      }
    } else {
      statusMsg = `${autoAction === 'entry' ? '✅' : '🚪'} ${statusMsg}`;
    }

    return res.status(201).json({
      success: true,
      message: statusMsg,
      data: { ...resultLog, _id: resultLog.id },
      person: { name: found.name, type: found.type, role: found.role, id: found.id },
      fineIssued: fineIssued ? { amount: fineIssued.amount, reason: fineIssued.reason } : null
    });

  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
        requiresApproval: error.requiresApproval,
        person: error.person
      });
    }
    next(error);
  }
};

exports.getTodayLogs = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { action, personType, page = 1, limit = 100 } = req.query;

    const todayKarachi = getKarachiMidnight();
    const where = { college_id: req.collegeId, date: todayKarachi };
    if (action) where.action = action;
    if (personType) where.personType = personType;

    const take = parseInt(limit) || 100;
    const skip = (parseInt(page) - 1) * take;

    const [total, logs, allToday] = await Promise.all([
      tenantDb.gateLog.count({ where }),
      tenantDb.gateLog.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        skip,
        take
      }),
      tenantDb.gateLog.findMany({
        where: { college_id: req.collegeId, date: todayKarachi },
        orderBy: { timestamp: 'asc' }
      })
    ]);

    // Calculate unique latest state today per person
    const latestStatePerPerson = {};
    for (const log of allToday) {
      latestStatePerPerson[log.personId] = {
        personType: log.personType,
        action: log.action
      };
    }

    const currentlyInsideStudents = Object.values(latestStatePerPerson).filter(
      p => p.personType === 'student' && p.action === 'entry'
    ).length;

    const currentlyInsideStaff = Object.values(latestStatePerPerson).filter(
      p => (p.personType === 'teacher' || p.personType === 'employee') && p.action === 'entry'
    ).length;

    const summary = {
      totalEntries: allToday.filter(l => l.action === 'entry').length,
      totalExits: allToday.filter(l => l.action === 'exit').length,
      students: allToday.filter(l => l.personType === 'student' && l.action === 'entry').length,
      teachers: allToday.filter(l => l.personType === 'teacher' && l.action === 'entry').length,
      employees: allToday.filter(l => l.personType === 'employee' && l.action === 'entry').length,
      currentlyInsideStudents,
      currentlyInsideStaff
    };

    res.json({
      success: true,
      data: logs.map(l => ({ ...l, _id: l.id })),
      summary,
      pagination: { total, page: parseInt(page) }
    });
  } catch (error) { next(error); }
};

exports.getLogsByDate = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { date, personType, action } = req.query;

    const d = getKarachiMidnight(date ? new Date(date) : new Date());
    const where = { college_id: req.collegeId, date: d };
    if (personType) where.personType = personType;
    if (action) where.action = action;

    const logs = await tenantDb.gateLog.findMany({
      where,
      orderBy: { timestamp: 'desc' }
    });
    res.json({ success: true, data: logs.map(l => ({ ...l, _id: l.id })) });
  } catch (error) { next(error); }
};

exports.requestEarlyExit = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { reason, exitDate, exitTime } = req.body;
    if (!reason) return res.status(400).json({ success: false, message: 'Reason is required' });

    let personId, personType, personName, qrCode;
    const userId = req.user.id || req.user._id;
    const userEmail = req.user.email ? req.user.email.toLowerCase() : '';

    if (req.user.role === 'student') {
      const student = await tenantDb.student.findFirst({
        where: {
          college_id: req.collegeId,
          OR: [
            { user_id: userId },
            ...(userEmail ? [{ email: userEmail }] : [])
          ]
        }
      });
      personId = student?.id || userId;
      personType = 'student';
      personName = student?.name || req.user.name;
      qrCode = student?.qrCode || req.user.qrCode || '';
    } else if (req.user.role === 'teacher') {
      const teacher = await tenantDb.teacher.findFirst({
        where: {
          college_id: req.collegeId,
          OR: [
            { user_id: userId },
            ...(userEmail ? [{ email: userEmail }] : [])
          ]
        }
      });
      personId = teacher?.id || userId;
      personType = 'teacher';
      personName = teacher?.user_id ? req.user.name : (req.user.name || 'Teacher');
      qrCode = teacher?.qrCode || req.user.qrCode || '';
    } else {
      personId = userId;
      personType = 'employee';
      personName = req.user.name;
      qrCode = req.user.qrCode || '';
    }

    const request = await tenantDb.earlyExitRequest.create({
      data: {
        college_id: req.collegeId,
        personType,
        personId,
        personName,
        qrCode,
        reason,
        exitDate: exitDate ? new Date(exitDate) : new Date(),
        exitTime: exitTime || '',
        status: 'pending',
        used: false
      }
    });
    res.status(201).json({ success: true, data: { ...request, _id: request.id }, message: 'Early exit request submitted. Awaiting principal approval.' });
  } catch (error) { next(error); }
};

exports.getMyExitRequests = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const userId = req.user.id || req.user._id;
    const userEmail = req.user.email ? req.user.email.toLowerCase() : '';
    let personIds = [userId];

    if (req.user.role === 'student') {
      const student = await tenantDb.student.findFirst({
        where: {
          college_id: req.collegeId,
          OR: [
            { user_id: userId },
            ...(userEmail ? [{ email: userEmail }] : [])
          ]
        }
      });
      if (student?.id) personIds.push(student.id);
    } else if (req.user.role === 'teacher') {
      const teacher = await tenantDb.teacher.findFirst({
        where: {
          college_id: req.collegeId,
          user_id: userId
        }
      });
      if (teacher?.id) personIds.push(teacher.id);
    }

    const requests = await tenantDb.earlyExitRequest.findMany({
      where: {
        college_id: req.collegeId,
        personId: { in: personIds }
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json({ success: true, data: requests.map(r => ({ ...r, _id: r.id })) });
  } catch (error) { next(error); }
};

exports.getPendingExitRequests = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { status = 'pending' } = req.query;
    const where = { college_id: req.collegeId };
    if (status) where.status = status;
    const requests = await tenantDb.earlyExitRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });
    res.json({ success: true, data: requests.map(r => ({ ...r, _id: r.id })) });
  } catch (error) { next(error); }
};

exports.reviewExitRequest = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { status, approvalRemarks } = req.body;
    if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ success: false, message: 'Invalid status' });
    const request = await tenantDb.earlyExitRequest.findFirst({
      where: { id: req.params.id, college_id: req.collegeId }
    });
    if (!request) return res.status(404).json({ success: false, message: 'Request not found' });
    if (request.status !== 'pending') return res.status(400).json({ success: false, message: 'Already reviewed' });

    const updated = await tenantDb.earlyExitRequest.update({
      where: { id: req.params.id },
      data: {
        status,
        approvedBy: req.user._id,
        approvedAt: new Date(),
        approvalRemarks: approvalRemarks || ''
      }
    });

    res.json({ success: true, data: { ...updated, _id: updated.id }, message: `Request ${status}` });
  } catch (error) { next(error); }
};

exports.lookupQR = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { qrCode } = req.query;
    if (!qrCode) return res.status(400).json({ success: false, message: 'QR code required' });
    const code = String(qrCode).trim();
    const student = await tenantDb.student.findFirst({
      where: {
        college_id: req.collegeId,
        status: 'active',
        OR: [{ qrCode: code }, { cardId: code }]
      }
    });
    if (!student) return res.status(404).json({ success: false, message: 'Not found' });

    res.json({
      success: true,
      data: {
        id: student.id,
        name: student.name,
        type: 'student',
        role: 'student',
        person: {
          ...student,
          _id: student.id
        }
      }
    });
  } catch (error) { next(error); }
};

