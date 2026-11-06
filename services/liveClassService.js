const { getSystemClient } = require('../config/prismaManager');
const prisma = getSystemClient();

/**
 * Live Class & Digital Lecture Repository Service (N30)
 */

async function scheduleLiveClass({
  collegeId,
  campusId = null,
  sectionId,
  subjectId,
  teacherId,
  title,
  platform = 'GOOGLE_MEET',
  meetingUrl,
  meetingPassword = null,
  scheduledDate,
  startTime,
  endTime,
}) {
  // Validate HTTPS link
  if (!meetingUrl || !meetingUrl.startsWith('https://')) {
    throw { statusCode: 400, code: 'INVALID_URL', message: 'Meeting URL must be a valid HTTPS link.' };
  }

  return await prisma.liveClassSchedule.create({
    data: {
      college_id: collegeId,
      campus_id: campusId,
      section_id: sectionId,
      subject_id: subjectId,
      teacher_id: teacherId,
      title,
      platform,
      meetingUrl,
      meetingPassword,
      scheduledDate: new Date(scheduledDate),
      startTime,
      endTime,
      isActive: true,
    },
  });
}

async function listLiveClasses(collegeId, filters = {}) {
  const where = {
    college_id: collegeId,
    isActive: true,
    ...(filters.sectionId ? { section_id: filters.sectionId } : {}),
    ...(filters.scheduledDate ? { scheduledDate: new Date(filters.scheduledDate) } : {}),
  };

  return await prisma.liveClassSchedule.findMany({
    where,
    orderBy: [{ scheduledDate: 'desc' }, { startTime: 'asc' }],
  });
}

async function uploadLectureRecording({
  collegeId,
  campusId = null,
  subjectId,
  className,
  unitId = null,
  title,
  description = null,
  videoSource = 'EMBEDDED_YOUTUBE',
  videoUrl,
  durationMins = null,
  uploadedById,
  isPublic = true,
}) {
  return await prisma.digitalLectureRecording.create({
    data: {
      college_id: collegeId,
      campus_id: campusId,
      subject_id: subjectId,
      class: className,
      unitId,
      title,
      description,
      videoSource,
      videoUrl,
      durationMins: durationMins ? parseInt(durationMins, 10) : null,
      uploadedById,
      isPublic: Boolean(isPublic),
    },
  });
}

async function listLectureRecordings(collegeId, filters = {}) {
  const where = {
    college_id: collegeId,
    ...(filters.subjectId ? { subject_id: filters.subjectId } : {}),
    ...(filters.className ? { class: filters.className } : {}),
    ...(filters.unitId ? { unitId: filters.unitId } : {}),
  };

  return await prisma.digitalLectureRecording.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  });
}

module.exports = {
  scheduleLiveClass,
  listLiveClasses,
  uploadLectureRecording,
  listLectureRecordings,
};
