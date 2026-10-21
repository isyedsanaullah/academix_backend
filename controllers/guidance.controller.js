// controllers/guidance.controller.js
// Phase 10: Parents, Guidance & Student Feedback

const { getSystemClient, getTenantClient } = require('../config/prismaManager');

/**
 * -----------------------------------------------------------------------------
 * 1. Parent-Teacher Meetings (ptm)
 * -----------------------------------------------------------------------------
 */

// GET /api/guidance/parent-meetings
async function getParentMeetings(req, res, next) {
  try {
    const tenantDb = req.tenantClient || (await getTenantClient(req.collegeId));
    const { session_id, status } = req.query;

    const where = { college_id: req.collegeId };
    if (session_id) where.session_id = session_id;
    if (status) where.status = status;

    const meetings = await tenantDb.parentMeeting.findMany({
      where,
      orderBy: { meetingDate: 'desc' }
    });

    res.json({ success: true, count: meetings.length, data: meetings });
  } catch (err) {
    next(err);
  }
}

// POST /api/guidance/parent-meetings
async function createParentMeeting(req, res, next) {
  try {
    const tenantDb = req.tenantClient || (await getTenantClient(req.collegeId));
    const { session_id, title, exam_id, meetingDate, sectionIds, notes, status } = req.body;

    if (!session_id || !title || !meetingDate) {
      return res.status(400).json({ error: 'session_id, title, and meetingDate are required' });
    }

    const meeting = await tenantDb.parentMeeting.create({
      data: {
        college_id: req.collegeId,
        session_id,
        title,
        exam_id: exam_id || null,
        meetingDate: new Date(meetingDate),
        sectionIds: Array.isArray(sectionIds) ? sectionIds : [],
        notes: notes || null,
        status: status || 'scheduled'
      }
    });

    res.status(201).json({ success: true, data: meeting });
  } catch (err) {
    next(err);
  }
}

// PUT /api/guidance/parent-meetings/:id
async function updateParentMeeting(req, res, next) {
  try {
    const tenantDb = req.tenantClient || (await getTenantClient(req.collegeId));
    const { id } = req.params;

    const updated = await tenantDb.parentMeeting.update({
      where: { id },
      data: req.body
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
}

/**
 * -----------------------------------------------------------------------------
 * 2. Career Counselling (career-counselling)
 * -----------------------------------------------------------------------------
 */

// GET /api/guidance/career-counselling
async function getCareerCounselling(req, res, next) {
  try {
    const tenantDb = req.tenantClient || (await getTenantClient(req.collegeId));
    const { student_id } = req.query;

    const where = { college_id: req.collegeId };
    if (student_id) where.student_id = student_id;

    const sessions = await tenantDb.careerCounselling.findMany({
      where,
      orderBy: { sessionDate: 'desc' }
    });

    res.json({ success: true, count: sessions.length, data: sessions });
  } catch (err) {
    next(err);
  }
}

// POST /api/guidance/career-counselling
async function createCareerCounselling(req, res, next) {
  try {
    const tenantDb = req.tenantClient || (await getTenantClient(req.collegeId));
    const { student_id, sessionDate, counsellor, interests, plan, notes } = req.body;

    if (!student_id || !sessionDate) {
      return res.status(400).json({ error: 'student_id and sessionDate are required' });
    }

    const session = await tenantDb.careerCounselling.create({
      data: {
        college_id: req.collegeId,
        student_id,
        sessionDate: new Date(sessionDate),
        counsellor: counsellor || req.user?.name || req.user?.email,
        interests: Array.isArray(interests) ? interests : [],
        plan: plan || null,
        notes: notes || null
      }
    });

    res.status(201).json({ success: true, data: session });
  } catch (err) {
    next(err);
  }
}

// PUT /api/guidance/career-counselling/:id
async function updateCareerCounselling(req, res, next) {
  try {
    const tenantDb = req.tenantClient || (await getTenantClient(req.collegeId));
    const { id } = req.params;

    const updated = await tenantDb.careerCounselling.update({
      where: { id },
      data: req.body
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
}

/**
 * -----------------------------------------------------------------------------
 * 3. Scholarship Records & Renewal Reminders (scholarship-tracking)
 * -----------------------------------------------------------------------------
 */

// GET /api/guidance/scholarships
async function getScholarships(req, res, next) {
  try {
    const tenantDb = req.tenantClient || (await getTenantClient(req.collegeId));
    const { student_id, status } = req.query;

    const where = { college_id: req.collegeId };
    if (student_id) where.student_id = student_id;
    if (status) where.status = status;

    const scholarships = await tenantDb.scholarshipRecord.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });

    res.json({ success: true, count: scholarships.length, data: scholarships });
  } catch (err) {
    next(err);
  }
}

// POST /api/guidance/scholarships
async function createScholarship(req, res, next) {
  try {
    const tenantDb = req.tenantClient || (await getTenantClient(req.collegeId));
    const { student_id, scheme, provider, amount, status, renewalDate, remarks } = req.body;

    if (!student_id || !scheme) {
      return res.status(400).json({ error: 'student_id and scheme are required' });
    }

    const rec = await tenantDb.scholarshipRecord.create({
      data: {
        college_id: req.collegeId,
        student_id,
        scheme,
        provider: provider || null,
        amount: amount !== undefined ? Number(amount) : null,
        status: status || 'applied',
        renewalDate: renewalDate ? new Date(renewalDate) : null,
        remarks: remarks || null
      }
    });

    res.status(201).json({ success: true, data: rec });
  } catch (err) {
    next(err);
  }
}

// PUT /api/guidance/scholarships/:id
async function updateScholarship(req, res, next) {
  try {
    const tenantDb = req.tenantClient || (await getTenantClient(req.collegeId));
    const { id } = req.params;

    const updated = await tenantDb.scholarshipRecord.update({
      where: { id },
      data: req.body
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
}

// POST /api/guidance/scholarships/renewal-reminders
async function sendRenewalReminders(req, res, next) {
  try {
    const tenantDb = req.tenantClient || (await getTenantClient(req.collegeId));
    const now = new Date();
    const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    // Find scholarships that are renewal_due or expire within 30 days
    const dueScholarships = await tenantDb.scholarshipRecord.findMany({
      where: {
        college_id: req.collegeId,
        status: { in: ['awarded', 'renewal_due'] },
        renewalDate: { lte: in30Days }
      }
    });

    let sentCount = 0;
    for (const sc of dueScholarships) {
      // Create notification for student if Notification model exists in tenant DB
      try {
        if (tenantDb.notification) {
          await tenantDb.notification.create({
            data: {
              college_id: req.collegeId,
              title: 'Scholarship Renewal Reminder',
              message: `Your scholarship scheme "${sc.scheme}" renewal is due on ${sc.renewalDate ? sc.renewalDate.toLocaleDateString() : 'soon'}. Please submit required academic documentation.`,
              recipientType: 'student',
              recipientId: sc.student_id,
              type: 'scholarship_renewal'
            }
          });
          sentCount++;
        }
      } catch (_) {}

      // Update status to renewal_due if it was awarded
      if (sc.status === 'awarded') {
        await tenantDb.scholarshipRecord.update({
          where: { id: sc.id },
          data: { status: 'renewal_due' }
        });
      }
    }

    res.json({
      success: true,
      message: `Processed ${dueScholarships.length} scholarships; created ${sentCount} reminders.`,
      remindersSent: sentCount,
      count: dueScholarships.length
    });
  } catch (err) {
    next(err);
  }
}

/**
 * -----------------------------------------------------------------------------
 * 4. Student Feedback & Complaint Box (feedback-box)
 * -----------------------------------------------------------------------------
 */

// POST /api/guidance/feedback
async function submitFeedback(req, res, next) {
  try {
    const tenantDb = req.tenantClient || (await getTenantClient(req.collegeId));
    const { category, message, anonymous = false, student_id } = req.body;

    if (!category || !message) {
      return res.status(400).json({ error: 'category and message are required' });
    }

    const isAnon = Boolean(anonymous);

    // CRITICAL PRIVACY INVARIANT: If anonymous is true, student_id MUST BE NULL
    const record = await tenantDb.studentFeedback.create({
      data: {
        college_id: req.collegeId,
        student_id: isAnon ? null : (student_id || req.user?.studentId || null),
        category,
        message,
        anonymous: isAnon,
        status: 'open'
      }
    });

    // Return sanitized feedback record
    const sanitized = {
      ...record,
      student_id: isAnon ? null : record.student_id
    };

    res.status(201).json({ success: true, data: sanitized });
  } catch (err) {
    next(err);
  }
}

// GET /api/guidance/feedback
async function getFeedbackList(req, res, next) {
  try {
    const tenantDb = req.tenantClient || (await getTenantClient(req.collegeId));
    const { category, status } = req.query;

    const where = { college_id: req.collegeId };
    if (category) where.category = category;
    if (status) where.status = status;

    const list = await tenantDb.studentFeedback.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });

    // CRITICAL PRIVACY INVARIANT: Ensure student_id is never exposed for anonymous items
    const sanitizedList = list.map(item => {
      if (item.anonymous) {
        return {
          ...item,
          student_id: null
        };
      }
      return item;
    });

    res.json({ success: true, count: sanitizedList.length, data: sanitizedList });
  } catch (err) {
    next(err);
  }
}

// PUT /api/guidance/feedback/:id
async function updateFeedback(req, res, next) {
  try {
    const tenantDb = req.tenantClient || (await getTenantClient(req.collegeId));
    const { id } = req.params;
    const { status, response } = req.body;

    const updated = await tenantDb.studentFeedback.update({
      where: { id },
      data: {
        status: status || undefined,
        response: response || undefined,
        handledBy: req.user?.email || 'admin'
      }
    });

    const sanitized = {
      ...updated,
      student_id: updated.anonymous ? null : updated.student_id
    };

    res.json({ success: true, data: sanitized });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getParentMeetings,
  createParentMeeting,
  updateParentMeeting,
  getCareerCounselling,
  createCareerCounselling,
  updateCareerCounselling,
  getScholarships,
  createScholarship,
  updateScholarship,
  sendRenewalReminders,
  submitFeedback,
  getFeedbackList,
  updateFeedback
};
