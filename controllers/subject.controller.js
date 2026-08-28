// ─── Subject Controller (Multi-DB with Prisma) ───────────────────

// @desc    Get all subjects
// @route   GET /api/subjects
exports.getSubjects = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { group, class: cls } = req.query;
    
    const andConditions = [
      { college_id: req.collegeId, isActive: true }
    ];
    
    if (group) {
      andConditions.push({
        OR: [
          { group: { contains: group, mode: 'insensitive' } },
          { group: 'Common' }
        ]
      });
    }
    
    if (cls) {
      andConditions.push({
        OR: [
          { class: cls },
          { class: 'Both' }
        ]
      });
    }
    
    if (req.user && req.user.role === 'teacher') {
      const userId = req.user.id || req.user._id;
      const teacher = await tenantDb.teacher.findFirst({
        where: { college_id: req.collegeId, user_id: userId }
      });
      if (teacher && teacher.subjects && Array.isArray(teacher.subjects) && teacher.subjects.length > 0) {
        andConditions.push({
          OR: [
            { teacher_id: userId },
            { name: { in: teacher.subjects } },
            { id: { in: teacher.subjects } }
          ]
        });
      } else {
        andConditions.push({ teacher_id: userId });
      }
    }

    const subjects = await tenantDb.subject.findMany({
      where: { AND: andConditions },
      orderBy: [
        { group: 'asc' },
        { name: 'asc' }
      ]
    });
    
    const formatted = subjects.map(s => ({
      ...s,
      _id: s.id
    }));
    
    res.json({ success: true, data: formatted });
  } catch (error) { next(error); }
};

// @desc    Create subject
// @route   POST /api/subjects
exports.createSubject = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { name, code, group, class: cls, teacher_id, section, totalMarks, passingMarks, isActive } = req.body;
    
    let groupVal = 'Common';
    if (Array.isArray(group)) {
      if (group.includes('Common') || group.length === 0) {
        groupVal = 'Common';
      } else {
        groupVal = group.filter(Boolean).join(', ');
      }
    } else if (typeof group === 'string') {
      groupVal = group;
    }
    
    const subject = await tenantDb.subject.create({
      data: {
        name,
        code,
        group: groupVal,
        class: cls,
        teacher_id,
        section,
        totalMarks: totalMarks ? parseFloat(totalMarks) : null,
        passingMarks: passingMarks ? parseFloat(passingMarks) : null,
        college_id: req.collegeId,
        isActive: isActive !== undefined ? isActive : true
      }
    });
    
    res.status(201).json({ success: true, data: { ...subject, _id: subject.id } });
  } catch (error) { next(error); }
};

// @desc    Update subject
// @route   PUT /api/subjects/:id
exports.updateSubject = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const existing = await tenantDb.subject.findFirst({
      where: { id: req.params.id, college_id: req.collegeId }
    });
    if (!existing) return res.status(404).json({ success: false, message: 'Subject not found' });

    const data = { ...req.body };
    if (data.totalMarks !== undefined) data.totalMarks = data.totalMarks ? parseFloat(data.totalMarks) : null;
    if (data.passingMarks !== undefined) data.passingMarks = data.passingMarks ? parseFloat(data.passingMarks) : null;
    if (data.class !== undefined) data.class = data.class;

    if (data.group !== undefined) {
      if (Array.isArray(data.group)) {
        if (data.group.includes('Common') || data.group.length === 0) {
          data.group = 'Common';
        } else {
          data.group = data.group.filter(Boolean).join(', ');
        }
      }
    }

    const subject = await tenantDb.subject.update({
      where: { id: req.params.id },
      data
    });
    
    res.json({ success: true, data: { ...subject, _id: subject.id } });
  } catch (error) { next(error); }
};

// @desc    Delete subject (soft)
// @route   DELETE /api/subjects/:id
exports.deleteSubject = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const existing = await tenantDb.subject.findFirst({
      where: { id: req.params.id, college_id: req.collegeId }
    });
    if (!existing) return res.status(404).json({ success: false, message: 'Subject not found' });

    await tenantDb.subject.update({
      where: { id: req.params.id },
      data: { isActive: false }
    });
    
    res.json({ success: true, message: 'Subject deactivated' });
  } catch (error) { next(error); }
};
