// ─── Announcement Controller (Multi-DB with Prisma) ───────────────────

exports.getAnnouncements = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { audience, category, isPublic, status } = req.query;
    const where = { college_id: req.collegeId };

    if (audience) where.audience = audience;
    if (category) where.category = category;
    if (isPublic !== undefined) where.isPublic = isPublic === 'true';
    if (status) {
      where.status = status;
    } else {
      // By default return Published or Scheduled for regular feeds
      where.status = { in: ['Published', 'Scheduled', 'Draft'] };
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
  } catch (error) { next(error); }
};

exports.createAnnouncement = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
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

    const finalStatus = status || (scheduledFor ? 'Scheduled' : 'Published');

    const announcement = await tenantDb.announcement.create({
      data: {
        college_id: req.collegeId,
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

    // Create Audit Log
    try {
      if (tenantDb.auditLog) {
        await tenantDb.auditLog.create({
          data: {
            userId: String(userId),
            collegeId: String(req.collegeId),
            action: `announcement_${finalStatus.toLowerCase()}`,
            details: `Announcement "${title}" (${finalStatus}) created.`
          }
        });
      }
    } catch (e) {
      /* audit log optional */
    }

    res.status(201).json({ success: true, data: { ...announcement, _id: announcement.id } });
  } catch (error) { next(error); }
};

exports.updateAnnouncement = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const existing = await tenantDb.announcement.findFirst({
      where: { id: req.params.id, college_id: req.collegeId }
    });
    if (!existing) return res.status(404).json({ success: false, message: 'Announcement not found' });

    const updateData = {};
    const stringFields = ['title', 'content', 'category', 'audience', 'priority', 'status', 'templateType'];
    stringFields.forEach(f => {
      if (req.body[f] !== undefined) updateData[f] = req.body[f];
    });

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
  } catch (error) { next(error); }
};

exports.deleteAnnouncement = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const existing = await tenantDb.announcement.findFirst({
      where: { id: req.params.id, college_id: req.collegeId }
    });
    if (!existing) return res.status(404).json({ success: false, message: 'Announcement not found' });

    await tenantDb.announcement.delete({
      where: { id: req.params.id }
    });

    res.json({ success: true, message: 'Announcement deleted' });
  } catch (error) { next(error); }
};
