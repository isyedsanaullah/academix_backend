const { getSystemClient } = require('../config/prismaManager');
const prisma = getSystemClient();

/**
 * Confidential Discipline & Counselling Records Service (N32)
 */

function checkDisciplineAuthorization(userRole, userPermissions = []) {
  const allowedRoles = ['admin', 'principal', 'superadmin'];
  if (allowedRoles.includes(userRole)) return true;
  if (Array.isArray(userPermissions) && userPermissions.includes('discipline:view_confidential')) return true;
  return false;
}

async function recordIncident({
  collegeId,
  campusId = null,
  studentId,
  sessionId,
  incidentDate,
  category = 'MISCONDUCT',
  severity = 'MEDIUM',
  description,
  actionTaken = 'WARNING',
  fineAmountPkr = null,
  suspensionDays = null,
  reportedById,
  hearingDate = null,
  userRole,
  userPermissions = [],
}) {
  if (!checkDisciplineAuthorization(userRole, userPermissions)) {
    throw {
      statusCode: 403,
      code: 'CONFIDENTIAL_DISCIPLINE_ACCESS_DENIED',
      message: 'Access denied: Disciplinary incident logs are strictly confidential and restricted to administration and authorized welfare officers.',
    };
  }

  return await prisma.disciplinaryIncident.create({
    data: {
      college_id: collegeId,
      campus_id: campusId,
      student_id: studentId,
      session_id: sessionId,
      incidentDate: new Date(incidentDate),
      category,
      severity,
      description,
      actionTaken,
      fineAmountPkr: fineAmountPkr ? parseInt(fineAmountPkr, 10) : null,
      suspensionDays: suspensionDays ? parseInt(suspensionDays, 10) : null,
      reportedById,
      hearingDate: hearingDate ? new Date(hearingDate) : null,
    },
  });
}

async function addCounselingLog({
  collegeId,
  campusId = null,
  incidentId = null,
  studentId,
  counselorId,
  sessionDate,
  sessionNotes,
  actionPlan = null,
  followUpDate = null,
  userRole,
  userPermissions = [],
}) {
  if (!checkDisciplineAuthorization(userRole, userPermissions)) {
    throw {
      statusCode: 403,
      code: 'CONFIDENTIAL_DISCIPLINE_ACCESS_DENIED',
      message: 'Access denied: Psychological counseling logs are strictly confidential.',
    };
  }

  return await prisma.studentCounselingLog.create({
    data: {
      college_id: collegeId,
      campus_id: campusId,
      incidentId,
      student_id: studentId,
      counselorId,
      sessionDate: new Date(sessionDate),
      sessionNotes,
      actionPlan,
      followUpDate: followUpDate ? new Date(followUpDate) : null,
    },
  });
}

async function getStudentDisciplinaryHistory({
  collegeId,
  studentId,
  userRole,
  userPermissions = [],
}) {
  if (!checkDisciplineAuthorization(userRole, userPermissions)) {
    throw {
      statusCode: 403,
      code: 'CONFIDENTIAL_DISCIPLINE_ACCESS_DENIED',
      message: 'Access denied: Disciplinary records cannot be accessed by general staff, parents, or students.',
    };
  }

  const [incidents, counselingLogs] = await Promise.all([
    prisma.disciplinaryIncident.findMany({
      where: { college_id: collegeId, student_id: studentId },
      include: { counselingNotes: true },
      orderBy: { incidentDate: 'desc' },
    }),
    prisma.studentCounselingLog.findMany({
      where: { college_id: collegeId, student_id: studentId },
      orderBy: { sessionDate: 'desc' },
    }),
  ]);

  return {
    studentId,
    totalIncidents: incidents.length,
    incidents,
    counselingLogs,
  };
}

module.exports = {
  checkDisciplineAuthorization,
  recordIncident,
  addCounselingLog,
  getStudentDisciplinaryHistory,
};
