// ─── Class Controller (Multi-DB with Prisma) ───────────────────

// @desc    Get all classes
// @route   GET /api/classes
exports.getClasses = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { session_id } = req.query;
    const where = { college_id: req.collegeId };
    if (session_id) where.session_id = session_id;
    
    const classes = await tenantDb.class.findMany({
      where,
      orderBy: { name: 'asc' }
    });
    
    const formattedClasses = classes.map(c => ({
      ...c,
      _id: c.id
    }));
    
    res.json({ success: true, data: formattedClasses });
  } catch (error) { next(error); }
};

// @desc    Create class
// @route   POST /api/classes
exports.createClass = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { name, groups, isActive, session_id } = req.body;
    
    const cls = await tenantDb.class.create({
      data: {
        name,
        groups: groups || [],
        isActive: isActive !== undefined ? isActive : true,
        session_id,
        college_id: req.collegeId
      }
    });
    
    res.status(201).json({ success: true, data: { ...cls, _id: cls.id } });
  } catch (error) { next(error); }
};

// @desc    Update class
// @route   PUT /api/classes/:id
exports.updateClass = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const existing = await tenantDb.class.findFirst({
      where: { id: req.params.id, college_id: req.collegeId }
    });
    if (!existing) return res.status(404).json({ success: false, message: 'Class not found' });

    const cls = await tenantDb.class.update({
      where: { id: req.params.id },
      data: req.body
    });
    
    res.json({ success: true, data: { ...cls, _id: cls.id } });
  } catch (error) { next(error); }
};

// @desc    Delete class
// @route   DELETE /api/classes/:id
exports.deleteClass = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const existing = await tenantDb.class.findFirst({
      where: { id: req.params.id, college_id: req.collegeId }
    });
    if (!existing) return res.status(404).json({ success: false, message: 'Class not found' });

    await tenantDb.class.delete({
      where: { id: req.params.id }
    });
    
    res.json({ success: true, message: 'Class deleted' });
  } catch (error) { next(error); }
};
