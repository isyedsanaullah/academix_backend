const { getSystemClient } = require('../config/prismaManager');

/**
 * Pure KPI computation service for Principal & Executive Dashboard (#87)
 * Signature accepts optional campusId for multi-campus isolation (Phase 10)
 */
async function getKpiSummary(collegeId, { periodStart, periodEnd, campusId = null } = {}) {
  const prisma = getSystemClient();

  const now = new Date();
  const start = periodStart ? new Date(periodStart) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)); // start of month
  const end = periodEnd ? new Date(periodEnd) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59));

  // 1. College Settings
  const college = await prisma.college.findUnique({
    where: { id: collegeId },
    select: { settings: true }
  });
  const settings = (college?.settings && typeof college.settings === 'object') ? college.settings : {};
  const lateCountsAsPresent = settings['kpi.lateCountsAsPresent'] !== false; // default true
  const minCoveragePct = Number(settings['kpi.minCoveragePct'] || 50.0);

  // 2. Total Enrolled Active Students
  const studentWhere = {
    college_id: collegeId,
    status: 'active'
  };
  if (campusId) studentWhere.campus_id = campusId;
  const totalEnrolled = await prisma.student.count({ where: studentWhere });

  // 3. Student Attendance Rate & Coverage
  const attWhere = {
    college_id: collegeId,
    date: { gte: start, lte: end }
  };
  // Exclude leaves from marked denominator
  const studentAttRecords = await prisma.attendance.findMany({
    where: attWhere
  });

  const markedStudentAtt = studentAttRecords.filter(a => a.status !== 'leave');
  const totalStudentMarked = markedStudentAtt.length;
  let presentStudentCount = markedStudentAtt.filter(a => a.status === 'present').length;
  const lateStudentCount = markedStudentAtt.filter(a => a.status === 'late').length;

  if (lateCountsAsPresent) {
    presentStudentCount += lateStudentCount;
  } else {
    presentStudentCount += (0.5 * lateStudentCount);
  }

  const studentAttendancePct = totalStudentMarked > 0
    ? parseFloat(((presentStudentCount / totalStudentMarked) * 100).toFixed(2))
    : 0.0;

  // Sections coverage
  const sectionWhere = { college_id: collegeId };
  if (campusId) sectionWhere.campus_id = campusId;
  const totalExpectedSections = await prisma.section.count({ where: sectionWhere });

  // Unique sections with attendance in period
  const markedSectionSet = new Set(studentAttRecords.map(a => a.section).filter(Boolean));
  const markedSectionsCount = markedSectionSet.size;
  const studentAttendanceCoverage = totalExpectedSections > 0
    ? parseFloat(((markedSectionsCount / totalExpectedSections) * 100).toFixed(2))
    : 100.0;
  const lowCoverage = studentAttendanceCoverage < minCoveragePct;

  // 4. Staff Attendance Rate
  const staffAttWhere = {
    college_id: collegeId,
    date: { gte: start, lte: end }
  };
  if (campusId) staffAttWhere.campus_id = campusId;
  const staffAttRecords = await prisma.staffAttendance.findMany({ where: staffAttWhere });

  const activeStaffWhere = {
    college_id: collegeId,
    role: { in: ['teacher', 'employee', 'staff'] },
    isActive: true
  };
  const totalActiveStaff = await prisma.user.count({ where: activeStaffWhere });

  const markedStaff = staffAttRecords.filter(r => r.status !== 'DEFERRED_PROCESSING');
  const presentStaffCount = markedStaff.filter(r => r.status === 'PRESENT' || r.status === 'LATE').length;
  const staffAttendancePct = markedStaff.length > 0
    ? parseFloat(((presentStaffCount / markedStaff.length) * 100).toFixed(2))
    : 0.0;

  // 5. Fee Recovery Rate (Cohort by dueDate strictly within period)
  const feeWhere = {
    college_id: collegeId,
    dueDate: { gte: start, lte: end }
  };
  const cohortFees = await prisma.fee.findMany({ where: feeWhere });

  let billedCohortPkr = 0;
  let collectedCohortPkr = 0;

  cohortFees.forEach(f => {
    const total = Number(f.totalAmount || 0);
    const paid = Number(f.paidAmount || 0);
    billedCohortPkr += total;
    collectedCohortPkr += Math.min(total, paid);
  });

  const feeRecoveryRate = billedCohortPkr > 0
    ? parseFloat(((collectedCohortPkr / billedCohortPkr) * 100).toFixed(2))
    : 0.0;

  // Total collected in period (all receipts with paymentDate inside period)
  const paymentProofWhere = {
    college_id: collegeId,
    status: 'verified',
    createdAt: { gte: start, lte: end }
  };
  const verifiedProofs = await prisma.paymentProof.findMany({ where: paymentProofWhere });
  const collectedInPeriodPkr = verifiedProofs.reduce((sum, p) => sum + Number(p.amount || 0), 0);

  return {
    period: {
      start: start.toISOString(),
      end: end.toISOString()
    },
    students: {
      totalEnrolled,
      studentAttendancePct,
      presentStudentCount: Math.round(presentStudentCount),
      totalStudentMarked,
      studentAttendanceCoverage,
      markedSectionsCount,
      totalExpectedSections,
      lowCoverage
    },
    staff: {
      totalActiveStaff,
      staffAttendancePct,
      presentStaffCount,
      totalStaffMarked: markedStaff.length
    },
    fees: {
      feeRecoveryRate,
      billedCohortPkr,
      collectedCohortPkr,
      collectedInPeriodPkr
    }
  };
}

module.exports = {
  getKpiSummary
};
