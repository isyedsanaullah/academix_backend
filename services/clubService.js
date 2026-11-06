const { getSystemClient } = require('../config/prismaManager');
const prisma = getSystemClient();

/**
 * Events, Sports Teams & Club Management Service (N33)
 */

async function createClub({
  collegeId,
  campusId = null,
  name,
  category = 'ACADEMIC', // ACADEMIC | SPORTS | CULTURAL | SOCIAL_WORK | LEADERSHIP
  description = null,
  leadTeacherId,
  presidentStudentId = null,
}) {
  return await prisma.studentClub.create({
    data: {
      college_id: collegeId,
      campus_id: campusId,
      name,
      category,
      description,
      leadTeacherId,
      presidentStudentId,
      isActive: true,
    },
  });
}

async function addClubMember({
  clubId,
  studentId,
  role = 'MEMBER', // MEMBER | CAPTAIN | SECRETARY | VICE_PRESIDENT
}) {
  return await prisma.studentClubMember.create({
    data: {
      clubId,
      student_id: studentId,
      role,
    },
  });
}

async function scheduleClubEvent({
  collegeId,
  campusId = null,
  clubId,
  title,
  eventDate,
  venue,
  description = null,
  budgetPkr = 0,
}) {
  return await prisma.clubEvent.create({
    data: {
      college_id: collegeId,
      campus_id: campusId,
      clubId,
      title,
      eventDate: new Date(eventDate),
      venue,
      description,
      budgetPkr: parseInt(budgetPkr || 0, 10),
    },
  });
}

async function listClubs(collegeId, campusId = null) {
  const where = {
    college_id: collegeId,
    isActive: true,
    ...(campusId ? { campus_id: campusId } : {}),
  };

  return await prisma.studentClub.findMany({
    where,
    include: {
      members: true,
      events: { orderBy: { eventDate: 'desc' }, take: 10 },
    },
    orderBy: { name: 'asc' },
  });
}

module.exports = {
  createClub,
  addClubMember,
  scheduleClubEvent,
  listClubs,
};
