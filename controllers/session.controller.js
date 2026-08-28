// ─── Session Controller (Multi-DB with Prisma) ───────────────────

// @desc    Get all sessions for a college
// @route   GET /api/sessions
exports.getSessions = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const sessions = await tenantDb.session.findMany({
      where: { college_id: req.collegeId },
      orderBy: { startDate: 'desc' }
    });
    
    const formatted = sessions.map(s => ({
      ...s,
      _id: s.id
    }));
    
    res.json({ success: true, data: formatted });
  } catch (error) { next(error); }
};

// @desc    Get current active session
// @route   GET /api/sessions/current
exports.getCurrentSession = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const session = await tenantDb.session.findFirst({
      where: { college_id: req.collegeId, isCurrent: true }
    });
    if (!session) return res.status(404).json({ success: false, message: 'No active session found' });
    
    res.json({ success: true, data: { ...session, _id: session.id } });
  } catch (error) { next(error); }
};

// @desc    Create session
// @route   POST /api/sessions
exports.createSession = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { name, startDate, endDate, isCurrent, status } = req.body;
    
    if (isCurrent) {
      await tenantDb.session.updateMany({
        where: { college_id: req.collegeId },
        data: { isCurrent: false }
      });
    }
    
    const session = await tenantDb.session.create({
      data: {
        college_id: req.collegeId,
        name,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        isCurrent: isCurrent || false,
        status: status || 'upcoming',
        createdBy: req.user.id
      }
    });
    
    res.status(201).json({ success: true, data: { ...session, _id: session.id } });
  } catch (error) { next(error); }
};

// @desc    Update session
// @route   PUT /api/sessions/:id
exports.updateSession = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const existing = await tenantDb.session.findFirst({
      where: { id: req.params.id, college_id: req.collegeId }
    });
    if (!existing) return res.status(404).json({ success: false, message: 'Session not found' });

    if (req.body.isCurrent) {
      await tenantDb.session.updateMany({
        where: { college_id: req.collegeId },
        data: { isCurrent: false }
      });
    }

    const data = { ...req.body };
    if (data.startDate) data.startDate = new Date(data.startDate);
    if (data.endDate) data.endDate = new Date(data.endDate);

    const session = await tenantDb.session.update({
      where: { id: req.params.id },
      data
    });
    
    res.json({ success: true, data: { ...session, _id: session.id } });
  } catch (error) { next(error); }
};

// @desc    Delete session
// @route   DELETE /api/sessions/:id
exports.deleteSession = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const existing = await tenantDb.session.findFirst({
      where: { id: req.params.id, college_id: req.collegeId }
    });
    if (!existing) return res.status(404).json({ success: false, message: 'Session not found' });

    await tenantDb.session.delete({
      where: { id: req.params.id }
    });
    
    res.json({ success: true, message: 'Session deleted' });
  } catch (error) { next(error); }
};
