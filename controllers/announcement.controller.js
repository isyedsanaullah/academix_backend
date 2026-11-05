// ─── Announcement Controller (Phase 7B Normalized & Isolated) ───────────

const { getSystemClient } = require('../config/prismaManager');

const VALID_STATUSES = ['DRAFT', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED'];

function normalizeStatus(status, scheduledFor) {
  if (!status) return scheduledFor ? 'SCHEDULED' : 'PUBLISHED';
  const upper = String(status).toUpperCase();
  return VALID_STATUSES.includes(upper) ? upper : 'DRAFT';
}

/**
 * GET /api/announcements
 * Returns visible announcements with query-time visibility calculation
 */
exports.getAnnouncements = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient || getSystemClient();
    const collegeId = req.collegeId || req.user?.college_id;
    const { audience, category, isPublic, status } = req.query;
    const now = new Date();

    const where = { college_id: collegeId };

    if (audience) where.audience = audience;
    if (category) where.category = category;
    if (isPublic !== undefined) where.isPublic = isPublic === 'true';

    // Role-based visibility logic
    const isAdmin = ['admin', 'superAdmin', 'principal'].includes(req.user?.role);

    if (status) {
      where.status = normalizeStatus(status);
    } else if (!isAdmin) {
      // Query-time visibility for students/staff/parents:
      // Visible if PUBLISHED OR (SCHEDULED with scheduledFor <= now)
      where.OR = [
        { status: 'PUBLISHED' },
        {
          status: 'SCHEDULED',
          scheduledFor: { lte: now }
        }
      ];
    }

    const announcements = await tenantDb.announcement.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });

    const formatted = announcements.map(a => ({
      ...a,
      _id: a.id
    }));

    res.json({ success: true, data: formatted });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/announcements/:id
 * Tenant-scoped retrieval with IDOR guard
 */
exports.getAnnouncementById = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient || getSystemClient();
    const collegeId = req.collegeId || req.user?.college_id;
    const { id } = req.params;

    const announcement = await tenantDb.announcement.findFirst({
      where: {
        id,
        college_id: collegeId
      }
    });

    if (!announcement) {
      return res.status(404).json({ success: false, message: 'Announcement not found or access denied' });
    }

    // Check if current user has read receipt
    let readReceipt = null;
    if (req.user?.id) {
      readReceipt = await tenantDb.circularReadReceipt.findUnique({
        where: {
          circularId_userId: {
            circularId: id,
            userId: req.user.id
          }
        }
      });
    }

    res.json({
      success: true,
      data: {
        ...announcement,
        _id: announcement.id,
        isRead: Boolean(readReceipt),
        readAt: readReceipt?.readAt || null
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/announcements/:id/read
 * Records read receipt for user
 */
exports.markCircularRead = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient || getSystemClient();
    const collegeId = req.collegeId || req.user?.college_id;
    const userId = req.user?.id;
    const { id } = req.params;

    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    // Verify announcement exists for this tenant
    const announcement = await tenantDb.announcement.findFirst({
      where: { id, college_id: collegeId }
    });

    if (!announcement) {
      return res.status(404).json({ success: false, message: 'Announcement not found' });
    }

    const receipt = await tenantDb.circularReadReceipt.upsert({
      where: {
        circularId_userId: {
          circularId: id,
          userId
        }
      },
      create: {
        circularId: id,
        userId,
        college_id: collegeId,
        readAt: new Date()
      },
      update: {
        readAt: new Date()
      }
    });

    // Increment viewCount
    await tenantDb.announcement.update({
      where: { id },
      data: { viewCount: { increment: 1 } }
    });

    res.json({ success: true, readAt: receipt.readAt });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/announcements
 */
exports.createAnnouncement = async (req, res, next) => {
  try {
    let tenantDb = req.tenantClient || getSystemClient();
    let targetCollegeId = req.collegeId || req.user?.college_id;

    if (req.user?.role === 'superAdmin' && (req.body.targetCollegeId || req.body.college_id)) {
      targetCollegeId = req.body.targetCollegeId || req.body.college_id;
      const { getTenantClient, getSystemClient } = require('../config/prismaManager');
      tenantDb = getTenantClient(targetCollegeId) || getSystemClient();
    }

    if (!targetCollegeId && req.user?.role !== 'superAdmin') {
      return res.status(400).json({ success: false, message: 'College ID is required' });
    }

    const userId = req.user?.id || req.user?._id || null;
    const {
      title,
      content,
      category,
      audience,
      isPublic,
      priority,
      status,
      scheduledFor,
      expiresAt,
      generatedByAI,
      templateType,
      attachments
    } = req.body;

    if (!title) return res.status(400).json({ success: false, message: 'Title is required' });
    if (!content) return res.status(400).json({ success: false, message: 'Content is required' });

    const finalStatus = normalizeStatus(status, scheduledFor);

    const announcement = await tenantDb.announcement.create({
      data: {
        college_id: targetCollegeId,
        title,
        content,
        category: category || 'General',
        audience: audience || 'All Users',
        isPublic: isPublic !== undefined ? isPublic === true || isPublic === 'true' : false,
        priority: priority || 'Medium',
        status: finalStatus,
        scheduledFor: scheduledFor ? new Date(scheduledFor) : null,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        generatedByAI: Boolean(generatedByAI),
        templateType: templateType || category || 'General',
        attachments: Array.isArray(attachments) ? attachments : [],
        createdBy: userId
      }
    });

    res.status(201).json({ success: true, data: { ...announcement, _id: announcement.id } });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/announcements/:id
 */
exports.updateAnnouncement = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient || getSystemClient();
    const collegeId = req.collegeId || req.user?.college_id;

    const existing = await tenantDb.announcement.findFirst({
      where: { id: req.params.id, college_id: collegeId }
    });
    if (!existing) return res.status(404).json({ success: false, message: 'Announcement not found' });

    const updateData = {};
    const stringFields = ['title', 'content', 'category', 'audience', 'priority', 'templateType'];
    stringFields.forEach(f => {
      if (req.body[f] !== undefined) updateData[f] = req.body[f];
    });

    if (req.body.status !== undefined) {
      updateData.status = normalizeStatus(req.body.status, req.body.scheduledFor || existing.scheduledFor);
    }
    if (req.body.isPublic !== undefined) {
      updateData.isPublic = req.body.isPublic === true || req.body.isPublic === 'true';
    }
    if (req.body.attachments !== undefined) {
      updateData.attachments = Array.isArray(req.body.attachments) ? req.body.attachments : [];
    }
    if (req.body.scheduledFor !== undefined) {
      updateData.scheduledFor = req.body.scheduledFor ? new Date(req.body.scheduledFor) : null;
    }
    if (req.body.expiresAt !== undefined) {
      updateData.expiresAt = req.body.expiresAt ? new Date(req.body.expiresAt) : null;
    }
    if (req.body.viewCount !== undefined) {
      updateData.viewCount = Number(req.body.viewCount);
    }

    const ann = await tenantDb.announcement.update({
      where: { id: req.params.id },
      data: updateData
    });

    res.json({ success: true, data: { ...ann, _id: ann.id } });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/announcements/:id
 */
exports.deleteAnnouncement = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient || getSystemClient();
    const collegeId = req.collegeId || req.user?.college_id;

    const existing = await tenantDb.announcement.findFirst({
      where: { id: req.params.id, college_id: collegeId }
    });
    if (!existing) return res.status(404).json({ success: false, message: 'Announcement not found' });

    await tenantDb.announcement.delete({
      where: { id: req.params.id }
    });

    res.json({ success: true, message: 'Announcement deleted' });
  } catch (error) {
    next(error);
  }
};
