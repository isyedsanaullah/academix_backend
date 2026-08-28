// ─── Registrar Controller (Multi-DB with Prisma) ───────────────────

const mapRecord = (rec) => {
  if (!rec) return null;
  return {
    ...rec,
    _id: rec.id
  };
};

exports.getSeasons = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const seasons = await tenantDb.admissionSeason.findMany({
      where: { college_id: req.collegeId },
      orderBy: { createdAt: 'desc' }
    });
    res.json({ success: true, data: seasons.map(mapRecord) });
  } catch (error) {
    next(error);
  }
};

exports.createSeason = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const userId = req.user.id || req.user._id;
    const { title, description, startDate, endDate, availableGroups, availableClasses, entryTestRequired, entryTestDate, entryTestVenue, minAggregate, maxSeats, status, instructions } = req.body;

    const season = await tenantDb.admissionSeason.create({
      data: {
        college_id: req.collegeId,
        session_id: req.body.session_id || '', // session_id is a required field in schema.prisma
        title,
        description,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        availableGroups: availableGroups || [],
        availableClasses: availableClasses || [],
        entryTestRequired: entryTestRequired || false,
        entryTestDate: entryTestDate ? new Date(entryTestDate) : null,
        entryTestVenue,
        minAggregate: minAggregate ? parseFloat(minAggregate) : null,
        maxSeats: maxSeats ? parseInt(maxSeats) : null,
        status: status || 'draft',
        instructions,
        createdBy: userId
      }
    });

    res.status(201).json({ success: true, data: mapRecord(season) });
  } catch (error) {
    next(error);
  }
};

exports.updateSeason = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { id } = req.params;

    const existing = await tenantDb.admissionSeason.findFirst({
      where: { id, college_id: req.collegeId }
    });
    if (!existing) return res.status(404).json({ success: false, message: 'Season not found' });

    const { title, description, startDate, endDate, availableGroups, availableClasses, entryTestRequired, entryTestDate, entryTestVenue, minAggregate, maxSeats, status, instructions, session_id } = req.body;

    const data = {};
    if (session_id !== undefined) data.session_id = session_id;
    if (title !== undefined) data.title = title;
    if (description !== undefined) data.description = description;
    if (startDate !== undefined) data.startDate = new Date(startDate);
    if (endDate !== undefined) data.endDate = new Date(endDate);
    if (availableGroups !== undefined) data.availableGroups = availableGroups;
    if (availableClasses !== undefined) data.availableClasses = availableClasses;
    if (entryTestRequired !== undefined) data.entryTestRequired = entryTestRequired;
    if (entryTestDate !== undefined) data.entryTestDate = entryTestDate ? new Date(entryTestDate) : null;
    if (entryTestVenue !== undefined) data.entryTestVenue = entryTestVenue;
    if (minAggregate !== undefined) data.minAggregate = minAggregate ? parseFloat(minAggregate) : null;
    if (maxSeats !== undefined) data.maxSeats = maxSeats ? parseInt(maxSeats) : null;
    if (status !== undefined) data.status = status;
    if (instructions !== undefined) data.instructions = instructions;

    const season = await tenantDb.admissionSeason.update({
      where: { id },
      data
    });

    res.json({ success: true, data: mapRecord(season) });
  } catch (error) {
    next(error);
  }
};

exports.getApplications = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { status, group, search, page = 1, limit = 20 } = req.query;
    
    const where = { college_id: req.collegeId };
    if (status) where.status = status;
    if (group) where.preferredGroup = group;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { applicationNumber: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } }
      ];
    }

    const take = parseInt(limit) || 20;
    const skip = (parseInt(page) - 1) * take;

    const [applications, total, stats] = await Promise.all([
      tenantDb.application.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take
      }),
      tenantDb.application.count({ where }),
      tenantDb.application.groupBy({
        by: ['status'],
        where: { college_id: req.collegeId },
        _count: { status: true }
      })
    ]);

    const formattedStats = stats.reduce((acc, s) => {
      if (s.status) acc[s.status] = s._count.status;
      return acc;
    }, {});

    res.json({
      success: true,
      data: applications.map(mapRecord),
      stats: formattedStats,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / take)
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.getApplication = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { id } = req.params;

    const app = await tenantDb.application.findFirst({
      where: { id, college_id: req.collegeId }
    });
    if (!app) return res.status(404).json({ success: false, message: 'Application not found' });
    
    res.json({ success: true, data: mapRecord(app) });
  } catch (error) {
    next(error);
  }
};

exports.approveApplication = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const userId = req.user.id || req.user._id;
    const { id } = req.params;

    const app = await tenantDb.application.findFirst({
      where: { id, college_id: req.collegeId }
    });
    if (!app) return res.status(404).json({ success: false, message: 'Application not found' });
    if (app.status === 'approved' || app.status === 'enrolled') {
      return res.status(400).json({ success: false, message: 'Already approved' });
    }
    if (app.status === 'under_review') {
      return res.status(400).json({ success: false, message: 'Already sent to Principal' });
    }

    const existingApproval = await tenantDb.approval.findFirst({
      where: {
        college_id: req.collegeId,
        type: 'student_admission',
        relatedId: app.id,
        status: 'pending'
      }
    });
    if (existingApproval) return res.status(400).json({ success: false, message: 'Approval already pending' });

    const updated = await tenantDb.application.update({
      where: { id: app.id },
      data: {
        status: 'under_review',
        reviewedBy: userId,
        reviewedAt: new Date(),
        remarks: req.body.remarks || 'Recommended by Registrar.'
      }
    });

    await tenantDb.approval.create({
      data: {
        college_id: req.collegeId,
        type: 'student_admission',
        requestedBy: userId,
        relatedModel: 'Application',
        relatedId: app.id,
        title: `Admit ${app.name} (${app.applicationNumber})`,
        description: `${app.preferredGroup} - ${app.preferredClass} | Aggregate: ${app.sscAggregate || 0}%`,
        data: { section: req.body.section || 'A', applicationId: app.id }
      }
    });

    res.json({ success: true, message: 'Sent to Principal for approval.', data: mapRecord(updated) });
  } catch (error) {
    next(error);
  }
};

exports.rejectApplication = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const userId = req.user.id || req.user._id;
    const { id } = req.params;

    const app = await tenantDb.application.findFirst({
      where: { id, college_id: req.collegeId }
    });
    if (!app) return res.status(404).json({ success: false, message: 'Not found' });

    const updated = await tenantDb.application.update({
      where: { id: app.id },
      data: {
        status: 'rejected',
        rejectionReason: req.body.reason || 'Not approved',
        reviewedBy: userId,
        reviewedAt: new Date(),
        remarks: req.body.remarks
      }
    });

    res.json({ success: true, message: 'Application rejected', data: mapRecord(updated) });
  } catch (error) {
    next(error);
  }
};

exports.scheduleEntryTest = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { id } = req.params;

    const app = await tenantDb.application.findFirst({
      where: { id, college_id: req.collegeId }
    });
    if (!app) return res.status(404).json({ success: false, message: 'Not found' });

    const updated = await tenantDb.application.update({
      where: { id: app.id },
      data: {
        status: 'entry_test',
        entryTestRequired: true,
        entryTestDate: req.body.date ? new Date(req.body.date) : null,
        entryTestVenue: req.body.venue,
        entryTestStatus: 'scheduled'
      }
    });

    res.json({ success: true, message: 'Entry test scheduled', data: mapRecord(updated) });
  } catch (error) {
    next(error);
  }
};

exports.updateTestResult = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { score, passed } = req.body;
    const { id } = req.params;

    const app = await tenantDb.application.findFirst({
      where: { id, college_id: req.collegeId }
    });
    if (!app) return res.status(404).json({ success: false, message: 'Not found' });

    const updated = await tenantDb.application.update({
      where: { id: app.id },
      data: {
        entryTestScore: score ? parseFloat(score) : null,
        entryTestStatus: passed ? 'passed' : 'failed',
        status: passed ? 'under_review' : 'rejected',
        rejectionReason: passed ? null : 'Failed entry test'
      }
    });

    res.json({ success: true, data: mapRecord(updated) });
  } catch (error) {
    next(error);
  }
};
