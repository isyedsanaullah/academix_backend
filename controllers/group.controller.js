// ─── Group Controller (Multi-DB with Prisma) ───────────────────

// @desc    Get all groups
// @route   GET /api/groups
exports.getGroups = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { class_id } = req.query;
    const where = { college_id: req.collegeId };
    if (class_id) where.class_id = class_id;

    const groups = await tenantDb.group.findMany({
      where,
      orderBy: { name: 'asc' }
    });

    const formattedGroups = groups.map(g => ({
      ...g,
      _id: g.id
    }));

    res.json({ success: true, data: formattedGroups });
  } catch (error) { next(error); }
};

// @desc    Create group
// @route   POST /api/groups
exports.createGroup = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { class_id, name, isActive } = req.body;

    const grp = await tenantDb.group.create({
      data: {
        class_id,
        name,
        isActive: isActive !== undefined ? isActive : true,
        college_id: req.collegeId
      }
    });

    res.status(201).json({ success: true, data: { ...grp, _id: grp.id } });
  } catch (error) { next(error); }
};

// @desc    Update group
// @route   PUT /api/groups/:id
exports.updateGroup = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const existing = await tenantDb.group.findFirst({
      where: { id: req.params.id, college_id: req.collegeId }
    });
    if (!existing) return res.status(404).json({ success: false, message: 'Group not found' });

    const grp = await tenantDb.group.update({
      where: { id: req.params.id },
      data: req.body
    });

    res.json({ success: true, data: { ...grp, _id: grp.id } });
  } catch (error) { next(error); }
};

// @desc    Delete group
// @route   DELETE /api/groups/:id
exports.deleteGroup = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const existing = await tenantDb.group.findFirst({
      where: { id: req.params.id, college_id: req.collegeId }
    });
    if (!existing) return res.status(404).json({ success: false, message: 'Group not found' });

    // Check if any sections are using this group
    const usingSections = await tenantDb.section.findFirst({
      where: { group_id: req.params.id }
    });
    if (usingSections) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete group as it is currently assigned to one or more sections.'
      });
    }

    await tenantDb.group.delete({
      where: { id: req.params.id }
    });

    res.json({ success: true, message: 'Group deleted successfully' });
  } catch (error) { next(error); }
};
