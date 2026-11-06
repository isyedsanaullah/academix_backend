const liveClassService = require('../services/liveClassService');

/**
 * Live Classes & Recorded Lectures Controller (N30)
 */

async function scheduleLiveClass(req, res) {
  try {
    const live = await liveClassService.scheduleLiveClass({
      collegeId: req.collegeId,
      campusId: req.campusId || null,
      sectionId: req.body.sectionId,
      subjectId: req.body.subjectId,
      teacherId: req.user.id,
      title: req.body.title,
      platform: req.body.platform,
      meetingUrl: req.body.meetingUrl,
      meetingPassword: req.body.meetingPassword,
      scheduledDate: req.body.scheduledDate,
      startTime: req.body.startTime,
      endTime: req.body.endTime,
    });
    return res.status(201).json({ success: true, data: live });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, error: err.message, code: err.code });
  }
}

async function listLiveClasses(req, res) {
  try {
    const list = await liveClassService.listLiveClasses(req.collegeId, {
      sectionId: req.query.sectionId,
      scheduledDate: req.query.scheduledDate,
    });
    return res.json({ success: true, data: list });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, error: err.message, code: err.code });
  }
}

async function uploadLectureRecording(req, res) {
  try {
    const rec = await liveClassService.uploadLectureRecording({
      collegeId: req.collegeId,
      campusId: req.campusId || null,
      subjectId: req.body.subjectId,
      className: req.body.className || req.body.class,
      unitId: req.body.unitId,
      title: req.body.title,
      description: req.body.description,
      videoSource: req.body.videoSource,
      videoUrl: req.body.videoUrl,
      durationMins: req.body.durationMins,
      uploadedById: req.user.id,
      isPublic: req.body.isPublic !== undefined ? req.body.isPublic : true,
    });
    return res.status(201).json({ success: true, data: rec });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, error: err.message, code: err.code });
  }
}

async function listLectureRecordings(req, res) {
  try {
    const list = await liveClassService.listLectureRecordings(req.collegeId, {
      subjectId: req.query.subjectId,
      className: req.query.class || req.query.className,
      unitId: req.query.unitId,
    });
    return res.json({ success: true, data: list });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, error: err.message, code: err.code });
  }
}

module.exports = {
  scheduleLiveClass,
  listLiveClasses,
  uploadLectureRecording,
  listLectureRecordings,
};

