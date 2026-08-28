// ─── Section Controller (Multi-DB with Prisma) ───────────────────

// @desc    Get all sections
// @route   GET /api/sections
exports.getSections = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { session_id, class_id, group_id } = req.query;
    const where = { college_id: req.collegeId };
    if (session_id) where.session_id = session_id;
    if (class_id) where.class_id = class_id;
    if (group_id) where.group_id = group_id;

    const sections = await tenantDb.section.findMany({
      where,
      orderBy: { code: 'asc' }
    });

    // Populate class_id manually
    const classIds = [...new Set(sections.map(s => s.class_id).filter(Boolean))];
    const classes = await tenantDb.class.findMany({
      where: {
        id: { in: classIds }
      }
    });

    const classMap = new Map(classes.map(c => [c.id, { ...c, _id: c.id }]));

    // Populate group_id manually
    const groupIds = [...new Set(sections.map(s => s.group_id).filter(Boolean))];
    const groups = await tenantDb.group.findMany({
      where: {
        id: { in: groupIds }
      }
    });

    const groupMap = new Map(groups.map(g => [g.id, { ...g, _id: g.id }]));

    const formattedSections = sections.map(s => {
      const cls = classMap.get(s.class_id) || null;
      const grp = groupMap.get(s.group_id) || null;
      return {
        ...s,
        _id: s.id,
        class_id: cls,
        group_id: grp
      };
    });

    res.json({ success: true, data: formattedSections });
  } catch (error) { next(error); }
};

// @desc    Create section
// @route   POST /api/sections
exports.createSection = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    let { session_id, class_id, group_id, code, name, capacity, classTeacher, isActive } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Section name is required.' });
    }

    // Auto-uppercase: name is the canonical key, code stays in sync
    name = name.trim().toUpperCase();
    code = name; // code always mirrors name

    // Resolve current session if not provided
    if (!session_id) {
      const currentSession = await tenantDb.session.findFirst({
        where: { college_id: req.collegeId, isCurrent: true }
      });
      session_id = currentSession?.id || null;
      if (!session_id) {
        return res.status(400).json({ success: false, message: 'Current session not found. Please provide session_id.' });
      }
    }

    // Enforce uniqueness on name (primary key) scoped to college + session + class + group
    const existingName = await tenantDb.section.findFirst({
      where: { college_id: req.collegeId, session_id, name }
    });
    if (existingName) {
      return res.status(400).json({ success: false, message: `Section "${name}" already exists in this session.` });
    }

    const section = await tenantDb.section.create({
      data: {
        session_id,
        class_id,
        group_id: group_id || null,
        code,
        name,
        capacity: capacity ? parseInt(capacity, 10) : null,
        classTeacher,
        isActive: isActive !== undefined ? isActive : true,
        college_id: req.collegeId
      }
    });
    
    res.status(201).json({ success: true, data: { ...section, _id: section.id } });
  } catch (error) { next(error); }
};

// @desc    Update section
// @route   PUT /api/sections/:id
exports.updateSection = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const existing = await tenantDb.section.findFirst({
      where: { id: req.params.id, college_id: req.collegeId }
    });
    if (!existing) return res.status(404).json({ success: false, message: 'Section not found' });

    // Auto-uppercase name and keep code in sync
    if (req.body.name) {
      req.body.name = req.body.name.trim().toUpperCase();
      req.body.code = req.body.name; // code always mirrors name
    }

    // Handle name uniqueness on update
    if (req.body.name && req.body.name !== existing.name) {
      const duplicateName = await tenantDb.section.findFirst({
        where: { college_id: req.collegeId, session_id: existing.session_id, name: req.body.name, NOT: { id: req.params.id } }
      });
      if (duplicateName) {
        return res.status(400).json({ success: false, message: `Section "${req.body.name}" already exists in this session.` });
      }
    }

    const data = { ...req.body };
    if (data.capacity !== undefined) data.capacity = data.capacity ? parseInt(data.capacity, 10) : null;

    const section = await tenantDb.section.update({
      where: { id: req.params.id },
      data
    });
    
    res.json({ success: true, data: { ...section, _id: section.id } });
  } catch (error) { next(error); }
};

// @desc    Delete section
// @route   DELETE /api/sections/:id
exports.deleteSection = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const existing = await tenantDb.section.findFirst({
      where: { id: req.params.id, college_id: req.collegeId }
    });
    if (!existing) return res.status(404).json({ success: false, message: 'Section not found' });

    await tenantDb.section.delete({
      where: { id: req.params.id }
    });
    
    res.json({ success: true, message: 'Section deleted' });
  } catch (error) { next(error); }
};
