'use strict';

const classDiaryService = require('../services/classDiaryService');
const workingDaysService = require('../services/workingDaysService');
const { getSystemClient } = require('../config/prismaManager');

/**
 * GET /api/class-diary
 * Query params: sectionId, date, startDate, endDate, teacherId
 */
async function getDiary(req, res) {
  try {
    const { sectionId, date, startDate, endDate, teacherId } = req.query;

    const entries = await classDiaryService.getDiaryEntries({
      collegeId: req.collegeId,
      campusId: req.campusId || null,
      sectionId,
      date,
      startDate,
      endDate,
      teacherId
    });

    return res.json({ success: true, count: entries.length, entries });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, error: err.message });
  }
}

/**
 * POST /api/class-diary
 * Body: { sectionId, subjectId, entryDate, periodNumber, topicCovered, homework, remarks, attachments }
 */
async function saveDiaryEntry(req, res) {
  try {
    const {
      sectionId,
      subjectId,
      entryDate,
      periodNumber,
      topicCovered,
      homework,
      remarks,
      attachments
    } = req.body;

    const teacherId = req.user?.id || req.body.teacherId;

    const entry = await classDiaryService.recordDiaryEntry({
      collegeId: req.collegeId,
      campusId: req.campusId || null,
      sectionId,
      subjectId,
      teacherId,
      entryDate,
      periodNumber,
      topicCovered,
      homework,
      remarks,
      attachments
    });

    return res.json({ success: true, entry });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, error: err.message });
  }
}

/**
 * GET /api/academic-calendar/working-days
 * Query params: session_id, startDate, endDate
 */
async function getWorkingDays(req, res) {
  try {
    const sessionId = req.query.session_id || req.query.sessionId;
    const { startDate, endDate } = req.query;

    if (!sessionId || !startDate || !endDate) {
      return res.status(400).json({ success: false, error: 'sessionId, startDate, and endDate are required' });
    }

    const result = await workingDaysService.calculateWorkingDays({
      collegeId: req.collegeId,
      campusId: req.campusId || null,
      sessionId,
      startDate,
      endDate
    });

    return res.json({ success: true, ...result });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, error: err.message });
  }
}

/**
 * POST /api/academic-calendar/events
 * Body: { sessionId, title, description, eventType, startDate, endDate, isWorkingDay, targetAudience, isPublic }
 */
async function createCalendarEvent(req, res) {
  try {
    const {
      sessionId,
      session_id,
      title,
      description,
      eventType = 'GENERAL',
      startDate,
      endDate,
      isWorkingDay = false,
      targetAudience = 'ALL',
      isPublic = true
    } = req.body;

    const targetSession = sessionId || session_id;
    if (!targetSession || !title || !startDate || !endDate) {
      return res.status(400).json({ success: false, error: 'sessionId, title, startDate, and endDate are required' });
    }

    const prisma = getSystemClient();
    const event = await prisma.academicCalendarEvent.create({
      data: {
        college_id: req.collegeId,
        campus_id: req.campusId || null,
        session_id: targetSession,
        title,
        description: description || null,
        eventType,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        isWorkingDay: Boolean(isWorkingDay),
        targetAudience,
        isPublic: Boolean(isPublic)
      }
    });

    return res.json({ success: true, event });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, error: err.message });
  }
}

module.exports = {
  getDiary,
  saveDiaryEntry,
  getWorkingDays,
  createCalendarEvent
};

