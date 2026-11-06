const { getSystemClient } = require('../config/prismaManager');
const prisma = getSystemClient();

/**
 * Alumni Registry & Placement Tracking Service (N34)
 */

async function registerAlumni({
  collegeId,
  campusId = null,
  studentId = null,
  fullName,
  fatherName = null,
  matricRollNumber = null,
  boardRollNumber,
  passingYear,
  academicGroup,
  finalBoardMarks = null,
  finalBoardTotal = 1100,
  currentStatus = 'ENROLLED_UNIVERSITY', // ENROLLED_UNIVERSITY | EMPLOYED | PREPARING | ABROAD
  universityName = null,
  degreeProgram = null,
  email = null,
  phone = null,
  linkedInUrl = null,
  isTestimonialShared = false,
}) {
  return await prisma.alumniProfile.create({
    data: {
      college_id: collegeId,
      campus_id: campusId,
      student_id: studentId,
      fullName,
      fatherName,
      matricRollNumber,
      boardRollNumber,
      passingYear: parseInt(passingYear, 10),
      academicGroup,
      finalBoardMarks: finalBoardMarks ? parseInt(finalBoardMarks, 10) : null,
      finalBoardTotal: parseInt(finalBoardTotal || 1100, 10),
      currentStatus,
      universityName,
      degreeProgram,
      email,
      phone,
      linkedInUrl,
      isTestimonialShared: Boolean(isTestimonialShared),
    },
  });
}

async function listAlumni(collegeId, filters = {}) {
  const where = {
    college_id: collegeId,
    ...(filters.passingYear ? { passingYear: parseInt(filters.passingYear, 10) } : {}),
    ...(filters.academicGroup ? { academicGroup: filters.academicGroup } : {}),
    ...(filters.currentStatus ? { currentStatus: filters.currentStatus } : {}),
  };

  return await prisma.alumniProfile.findMany({
    where,
    orderBy: [{ passingYear: 'desc' }, { fullName: 'asc' }],
  });
}

async function getPlacementAnalytics(collegeId) {
  const profiles = await prisma.alumniProfile.findMany({
    where: { college_id: collegeId },
    select: {
      passingYear: true,
      academicGroup: true,
      currentStatus: true,
      universityName: true,
    },
  });

  const totalAlumni = profiles.length;
  const statusCounts = {};
  const universityPlacements = {};

  for (const p of profiles) {
    statusCounts[p.currentStatus] = (statusCounts[p.currentStatus] || 0) + 1;
    if (p.universityName) {
      universityPlacements[p.universityName] = (universityPlacements[p.universityName] || 0) + 1;
    }
  }

  return {
    totalAlumni,
    statusBreakdown: statusCounts,
    topUniversities: universityPlacements,
  };
}

module.exports = {
  registerAlumni,
  listAlumni,
  getPlacementAnalytics,
};
