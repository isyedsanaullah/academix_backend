// ─── Campus & Multi-Campus Service (Phase 10: §10.1 & N18) ──────────────
const { getSystemClient } = require('../config/prismaManager');
const { withQuota } = require('./quotaService');
const { getKpiSummary } = require('./executiveKpiService');

/**
 * Derives a student's campus from their Section assignment
 * (Option B invariant: campus_id lives on Section and Class, never duplicated on Student)
 */
async function getStudentCampus(studentId, collegeId) {
  const prisma = getSystemClient();

  const student = await prisma.student.findFirst({
    where: { id: studentId, college_id: collegeId },
    select: { id: true, college_id: true, section: true }
  });

  if (!student) return null;

  // 1. Try to derive from section
  if (student.section) {
    const section = await prisma.section.findFirst({
      where: {
        college_id: collegeId,
        OR: [
          { id: student.section },
          { name: student.section },
          { code: student.section }
        ]
      },
      select: { campus_id: true }
    });

    if (section?.campus_id) {
      const campus = await prisma.campus.findUnique({
        where: { id: section.campus_id }
      });
      if (campus) return campus;
    }
  }

  // 2. Fall back to college's default campus
  return await prisma.campus.findFirst({
    where: { college_id: collegeId, isDefault: true }
  });
}

/**
 * List all campuses for a college
 */
async function listCampuses(collegeId) {
  const prisma = getSystemClient();
  return await prisma.campus.findMany({
    where: { college_id: collegeId },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }]
  });
}

/**
 * Create a new campus under withQuota('campuses', 1)
 */
async function createCampus(collegeId, { name, code, address = null, isDefault = false }) {
  const prisma = getSystemClient();

  if (!name || typeof name !== 'string' || !name.trim()) {
    const err = new Error('Campus name is required');
    err.statusCode = 422;
    throw err;
  }

  if (!code || typeof code !== 'string' || !code.trim()) {
    const err = new Error('Campus code is required');
    err.statusCode = 422;
    throw err;
  }

  const cleanCode = code.trim().toUpperCase();
  const { getEntitlements } = require('./entitlements');
  const entitlements = await getEntitlements(collegeId, prisma);
  const maxCampuses = entitlements.effectiveLimits.maxCampuses || 1;

  // Enforce campus quota inside an atomic transaction
  return await prisma.$transaction(async (tx) => {
    const currentCount = await tx.campus.count({
      where: { college_id: collegeId }
    });

    if (currentCount >= maxCampuses) {
      const err = new Error(`Campus limit reached. Your ${entitlements.planId} plan permits at most ${maxCampuses} campus(es).`);
      err.statusCode = 422;
      err.code = 'QUOTA_EXCEEDED';
      throw err;
    }

    const existingCode = await tx.campus.findFirst({
      where: { college_id: collegeId, code: cleanCode }
    });
    if (existingCode) {
      const err = new Error(`Campus code "${cleanCode}" is already in use by this institution`);
      err.statusCode = 409;
      err.code = 'CAMPUS_CODE_EXISTS';
      throw err;
    }

    if (isDefault) {
      // Clear previous default
      await tx.campus.updateMany({
        where: { college_id: collegeId, isDefault: true },
        data: { isDefault: false }
      });
    }

    return await tx.campus.create({
      data: {
        college_id: collegeId,
        name: name.trim(),
        code: cleanCode,
        address: address ? address.trim() : null,
        isDefault: Boolean(isDefault),
        isActive: true
      }
    });
  });
}

/**
 * Update an existing campus
 */
async function updateCampus(collegeId, campusId, { name, address, isActive, isDefault }) {
  const prisma = getSystemClient();

  const existing = await prisma.campus.findFirst({
    where: { id: campusId, college_id: collegeId }
  });
  if (!existing) {
    const err = new Error('Campus not found');
    err.statusCode = 404;
    throw err;
  }

  return await prisma.$transaction(async (tx) => {
    if (isDefault && !existing.isDefault) {
      await tx.campus.updateMany({
        where: { college_id: collegeId, isDefault: true },
        data: { isDefault: false }
      });
    }

    // Protect: cannot unset default without setting another
    if (existing.isDefault && isDefault === false) {
      const err = new Error('Cannot unset default status. Designate another campus as default instead.');
      err.statusCode = 422;
      throw err;
    }

    return await tx.campus.update({
      where: { id: campusId },
      data: {
        name: name !== undefined ? name.trim() : existing.name,
        address: address !== undefined ? (address ? address.trim() : null) : existing.address,
        isActive: isActive !== undefined ? Boolean(isActive) : existing.isActive,
        isDefault: isDefault !== undefined ? Boolean(isDefault) : existing.isDefault
      }
    });
  });
}

/**
 * Delete a non-default campus with validation against assigned sections/classes
 */
async function deleteCampus(collegeId, campusId) {
  const prisma = getSystemClient();

  const campus = await prisma.campus.findFirst({
    where: { id: campusId, college_id: collegeId }
  });
  if (!campus) {
    const err = new Error('Campus not found');
    err.statusCode = 404;
    throw err;
  }

  if (campus.isDefault) {
    const err = new Error('The default Main Campus cannot be deleted');
    err.statusCode = 422;
    err.code = 'CANNOT_DELETE_DEFAULT_CAMPUS';
    throw err;
  }

  // Check assigned sections or classes
  const [sectionsCount, classesCount] = await Promise.all([
    prisma.section.count({ where: { campus_id: campusId } }),
    prisma.class.count({ where: { campus_id: campusId } })
  ]);

  if (sectionsCount > 0 || classesCount > 0) {
    const err = new Error(`Cannot delete campus: ${sectionsCount} sections and ${classesCount} classes are assigned to it`);
    err.statusCode = 409;
    err.code = 'CAMPUS_HAS_ASSIGNMENTS';
    throw err;
  }

  return await prisma.campus.delete({
    where: { id: campusId }
  });
}

/**
 * Multi-Campus Executive Dashboard Aggregator (N18)
 * Rule: Sum numerators and denominators across campuses, then recompute percentages
 * (ratio of sums != sum of ratios)
 */
async function getMultiCampusDashboard(collegeId) {
  const prisma = getSystemClient();
  const campuses = await prisma.campus.findMany({
    where: { college_id: collegeId, isActive: true },
    orderBy: { createdAt: 'asc' }
  });

  const perCampusData = [];
  let totalEnrolled = 0;
  let totalCapacity = 0;
  let totalStaffActive = 0;
  let totalStaffPresent = 0;
  let totalFeeDue = 0;
  let totalFeeRecovered = 0;

  for (const camp of campuses) {
    // 1. Enrollment & Capacity
    const sections = await prisma.section.findMany({
      where: { college_id: collegeId, campus_id: camp.id }
    });
    const sectionNames = sections.map(s => s.name || s.code).filter(Boolean);
    const enrolledStudents = sectionNames.length > 0 ? await prisma.student.count({
      where: {
        college_id: collegeId,
        section: { in: sectionNames },
        status: { not: 'dropped' }
      }
    }) : 0;

    const capacity = sections.reduce((sum, s) => sum + (s.capacity || 40), 0);
    const capacityRate = capacity > 0 ? ((enrolledStudents / capacity) * 100).toFixed(1) : '100.0';

    // 2. Staff attendance
    const staffAttendance = await prisma.staffAttendance.findMany({
      where: {
        college_id: collegeId,
        campus_id: camp.id,
        date: new Date(new Date().toISOString().slice(0, 10))
      }
    });
    const staffPresentCount = staffAttendance.filter(s => s.status === 'PRESENT' || s.status === 'LATE').length;
    const staffTotalCount = staffAttendance.length || 1; // avoid division by zero
    const staffRate = ((staffPresentCount / staffTotalCount) * 100).toFixed(1);

    // 3. Fee recovery for campus
    const studentsInCampus = sectionNames.length > 0 ? await prisma.student.findMany({
      where: { college_id: collegeId, section: { in: sectionNames } },
      select: { id: true }
    }) : [];
    const studentIds = studentsInCampus.map(s => s.id);

    const fees = studentIds.length > 0 ? await prisma.fee.findMany({
      where: {
        college_id: collegeId,
        student_id: { in: studentIds }
      },
      select: { totalAmount: true, paidAmount: true }
    }) : [];
    const feeDue = fees.reduce((sum, f) => sum + Number(f.totalAmount || 0), 0);
    const feeCollected = fees.reduce((sum, f) => sum + Number(f.paidAmount || 0), 0);
    const feeRecoveryRate = feeDue > 0 ? ((feeCollected / feeDue) * 100).toFixed(1) : '100.0';

    perCampusData.push({
      campus: {
        id: camp.id,
        name: camp.name,
        code: camp.code,
        isDefault: camp.isDefault
      },
      metrics: {
        enrolledStudents,
        capacity,
        capacityRate: `${capacityRate}%`,
        staffPresent: staffPresentCount,
        staffTotal: staffTotalCount,
        staffAttendanceRate: `${staffRate}%`,
        feeDuePkr: feeDue,
        feeCollectedPkr: feeCollected,
        feeRecoveryRate: `${feeRecoveryRate}%`
      },
      _raw: {
        enrolledStudents,
        capacity,
        staffPresentCount,
        staffTotalCount,
        feeDue,
        feeCollected
      }
    });

    totalEnrolled += enrolledStudents;
    totalCapacity += capacity;
    totalStaffPresent += staffPresentCount;
    totalStaffActive += staffTotalCount;
    totalFeeDue += feeDue;
    totalFeeRecovered += feeCollected;
  }

  // Mathematically sound recomputed weighted rates (ratio of sums, NEVER average of percentages)
  const networkCapacityRate = totalCapacity > 0 ? ((totalEnrolled / totalCapacity) * 100).toFixed(1) : '100.0';
  const networkStaffRate = totalStaffActive > 0 ? ((totalStaffPresent / totalStaffActive) * 100).toFixed(1) : '100.0';
  const networkFeeRecoveryRate = totalFeeDue > 0 ? ((totalFeeRecovered / totalFeeDue) * 100).toFixed(1) : '100.0';

  return {
    campusCount: campuses.length,
    campuses: perCampusData.map(c => ({ campus: c.campus, metrics: c.metrics })),
    networkAggregates: {
      totalEnrolled,
      totalCapacity,
      capacityUtilizationRate: `${networkCapacityRate}%`,
      staffAttendanceRate: `${networkStaffRate}%`,
      feeDuePkr: totalFeeDue,
      feeCollectedPkr: totalFeeRecovered,
      feeRecoveryRate: `${networkFeeRecoveryRate}%`
    }
  };
}

module.exports = {
  getStudentCampus,
  listCampuses,
  createCampus,
  updateCampus,
  deleteCampus,
  getMultiCampusDashboard
};
