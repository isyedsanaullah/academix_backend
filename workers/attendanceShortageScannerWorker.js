const { getSystemClient } = require('../config/prismaManager');
const { calculateStudentAttendance } = require('../services/attendanceCalculationService');
const { sendMessage } = require('../services/messagingAdapter');
const { getEntitlements } = require('../services/entitlements');

/**
 * Weekly or on-demand Attendance Shortage Scanner Worker
 */
async function runShortageScannerForCollege(collegeId, { runKey, campusId = null, thresholdOverride = null } = {}) {
  const prisma = getSystemClient();

  // 1. Entitlement and status check
  const college = await prisma.college.findUnique({
    where: { id: collegeId },
    select: { id: true, subStatus: true, planId: true, settings: true }
  });

  if (!college) throw new Error(`College ${collegeId} not found`);
  if (college.subStatus === 'SUSPENDED') {
    return { skipped: true, reason: 'COLLEGE_SUSPENDED' };
  }

  const entitlements = await getEntitlements(collegeId, prisma);
  const hasFeature = entitlements.features?.includes('attendance-shortage-warnings');
  if (!hasFeature) {
    return { skipped: true, reason: 'FEATURE_NOT_IN_PLAN' };
  }

  // 2. Atomic Job Claim via JobRunLog
  const effectiveRunKey = runKey || `WEEK_${new Date().toISOString().slice(0, 10)}`;
  let jobRun;
  try {
    jobRun = await prisma.jobRunLog.create({
      data: {
        college_id: collegeId,
        campus_id: campusId,
        jobKey: 'shortage-scanner',
        runKey: effectiveRunKey,
        status: 'RUNNING'
      }
    });
  } catch (err) {
    if (err.code === 'P2002') {
      // Already ran or currently running for this period
      return { skipped: true, reason: 'ALREADY_RAN', runKey: effectiveRunKey };
    }
    throw err;
  }

  try {
    const settings = (college.settings && typeof college.settings === 'object') ? college.settings : {};
    const thresholdPct = Number(thresholdOverride || settings['attendance.shortageThresholdPct'] || 75.0);
    const shortageRenotifyDropPct = Number(settings['attendance.shortageRenotifyDropPct'] || 5.0);

    // 3. Find active session & students
    const activeSession = await prisma.session.findFirst({
      where: { college_id: collegeId },
      orderBy: { createdAt: 'desc' }
    });
    const termKey = activeSession?.id || 'DEFAULT_TERM';

    const students = await prisma.student.findMany({
      where: {
        college_id: collegeId,
        status: 'active'
      },
      select: { id: true, session_id: true, section_id: true, name: true, rollNumber: true }
    });

    let noticesIssued = 0;
    let noticesUpdated = 0;
    let noticesResolved = 0;

    for (const student of students) {
      const stats = await calculateStudentAttendance(collegeId, student.id, {
        sessionId: student.session_id || activeSession?.id
      });

      const { markedDays, attendedDays, attendancePercent } = stats;

      // We only assess shortage if at least 1 day has been marked
      if (markedDays === 0) continue;

      const existingNotice = await prisma.attendanceShortageNotice.findUnique({
        where: {
          college_id_studentId_termKey: {
            college_id: collegeId,
            studentId: student.id,
            termKey
          }
        }
      });

      if (attendancePercent < thresholdPct) {
        if (!existingNotice) {
          // Newly ISSUED shortage notice -> notify guardian
          await prisma.attendanceShortageNotice.create({
            data: {
              college_id: collegeId,
              campus_id: campusId,
              studentId: student.id,
              sectionId: student.section_id,
              termKey,
              markedDays,
              attendedDays,
              attendancePercent,
              thresholdPct,
              status: 'ISSUED',
              lastNotifiedPct: attendancePercent,
              notifyCount: 1
            }
          });
          noticesIssued++;

          // Send in-app guardian notice (at 0 credits)
          try {
            await sendMessage({
              collegeId,
              campusId,
              recipient: { type: 'GUARDIAN', studentId: student.id },
              title: 'Attendance Shortage Warning',
              body: `Attendance has dropped to ${attendancePercent}% (below required ${thresholdPct}%).`,
              kind: 'SHORTAGE'
            });
          } catch (e) {
            console.warn('Could not dispatch guardian notice:', e.message);
          }
        } else {
          // Existing notice: check if percentage worsened by >= shortageRenotifyDropPct
          const drop = (existingNotice.lastNotifiedPct !== null)
            ? (Number(existingNotice.lastNotifiedPct) - attendancePercent)
            : 0;

          const shouldRenotify = (drop >= shortageRenotifyDropPct) || (existingNotice.status === 'RESOLVED');

          await prisma.attendanceShortageNotice.update({
            where: { id: existingNotice.id },
            data: {
              markedDays,
              attendedDays,
              attendancePercent,
              thresholdPct,
              status: existingNotice.status === 'RESOLVED' ? 'ISSUED' : existingNotice.status, // preserve ACKNOWLEDGED
              lastNotifiedPct: shouldRenotify ? attendancePercent : existingNotice.lastNotifiedPct,
              notifyCount: shouldRenotify ? existingNotice.notifyCount + 1 : existingNotice.notifyCount
            }
          });
          noticesUpdated++;

          if (shouldRenotify) {
            try {
              await sendMessage({
                collegeId,
                campusId,
                recipient: { type: 'GUARDIAN', studentId: student.id },
                title: 'Attendance Shortage Warning (Update)',
                body: `Attendance has dropped further to ${attendancePercent}% (required ${thresholdPct}%).`,
                kind: 'SHORTAGE'
              });
            } catch (e) {
              console.warn('Could not dispatch guardian notice:', e.message);
            }
          }
        }
      } else if (existingNotice && existingNotice.status !== 'RESOLVED') {
        // Attendance recovered! Mark as RESOLVED
        await prisma.attendanceShortageNotice.update({
          where: { id: existingNotice.id },
          data: {
            markedDays,
            attendedDays,
            attendancePercent,
            status: 'RESOLVED'
          }
        });
        noticesResolved++;
      }
    }

    // Mark job completed
    await prisma.jobRunLog.update({
      where: { id: jobRun.id },
      data: {
        status: 'COMPLETED',
        finishedAt: new Date(),
        metaJson: {
          scannedStudents: students.length,
          noticesIssued,
          noticesUpdated,
          noticesResolved
        }
      }
    });

    return {
      success: true,
      scannedStudents: students.length,
      noticesIssued,
      noticesUpdated,
      noticesResolved
    };
  } catch (error) {
    await prisma.jobRunLog.update({
      where: { id: jobRun.id },
      data: { status: 'FAILED', finishedAt: new Date(), metaJson: { error: error.message } }
    });
    throw error;
  }
}

module.exports = {
  runShortageScannerForCollege
};

