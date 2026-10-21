// controllers/groupSubject.controller.js
// Handles GroupSubject, StudentSubject assignment with validation, and group transfers.

const { getSystemClient } = require('../config/prismaManager');

/**
 * List all subjects configured for a group
 * GET /api/groups/:groupId/subjects
 */
exports.getGroupSubjects = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { groupId } = req.params;

    const groupSubjects = await tenantDb.groupSubject.findMany({
      where: {
        college_id: req.collegeId,
        group_id: groupId
      },
      orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }]
    });

    // Populate subject details
    const subjectIds = groupSubjects.map(gs => gs.subject_id);
    const subjects = await tenantDb.subject.findMany({
      where: {
        id: { in: subjectIds },
        college_id: req.collegeId
      },
      select: { id: true, name: true, code: true }
    });
    const subjectMap = new Map(subjects.map(s => [s.id, s]));

    const formatted = groupSubjects.map(gs => ({
      ...gs,
      _id: gs.id,
      subject: subjectMap.get(gs.subject_id) || null
    }));

    res.json({ success: true, data: formatted });
  } catch (error) { next(error); }
};

/**
 * Add or configure a subject for a group
 * POST /api/groups/:groupId/subjects
 */
exports.addGroupSubject = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { groupId } = req.params;
    const { subject_id, kind = 'compulsory', electiveSet, maxChoices, isActive = true } = req.body;

    if (!subject_id) {
      return res.status(400).json({ success: false, message: 'subject_id is required' });
    }

    // Verify group and subject exist
    const [group, subject] = await Promise.all([
      tenantDb.group.findFirst({ where: { id: groupId, college_id: req.collegeId } }),
      tenantDb.subject.findFirst({ where: { id: subject_id, college_id: req.collegeId } })
    ]);

    if (!group) return res.status(404).json({ success: false, message: 'Group not found' });
    if (!subject) return res.status(404).json({ success: false, message: 'Subject not found' });

    // Upsert mapping
    const groupSubject = await tenantDb.groupSubject.upsert({
      where: {
        college_id_group_id_subject_id: {
          college_id: req.collegeId,
          group_id: groupId,
          subject_id
        }
      },
      update: {
        kind,
        electiveSet: electiveSet || null,
        maxChoices: maxChoices ? parseInt(maxChoices, 10) : null,
        isActive
      },
      create: {
        college_id: req.collegeId,
        group_id: groupId,
        subject_id,
        kind,
        electiveSet: electiveSet || null,
        maxChoices: maxChoices ? parseInt(maxChoices, 10) : null,
        isActive
      }
    });

    res.status(201).json({ success: true, data: { ...groupSubject, _id: groupSubject.id, subject } });
  } catch (error) { next(error); }
};

/**
 * Update a GroupSubject configuration
 * PUT /api/groups/:groupId/subjects/:id
 */
exports.updateGroupSubject = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { groupId, id } = req.params;
    const { kind, electiveSet, maxChoices, isActive } = req.body;

    const existing = await tenantDb.groupSubject.findFirst({
      where: { id, group_id: groupId, college_id: req.collegeId }
    });
    if (!existing) return res.status(404).json({ success: false, message: 'Group subject configuration not found' });

    const updated = await tenantDb.groupSubject.update({
      where: { id },
      data: {
        ...(kind !== undefined && { kind }),
        ...(electiveSet !== undefined && { electiveSet: electiveSet || null }),
        ...(maxChoices !== undefined && { maxChoices: maxChoices ? parseInt(maxChoices, 10) : null }),
        ...(isActive !== undefined && { isActive })
      }
    });

    res.json({ success: true, data: { ...updated, _id: updated.id } });
  } catch (error) { next(error); }
};

/**
 * Delete a GroupSubject configuration
 * DELETE /api/groups/:groupId/subjects/:id
 */
exports.deleteGroupSubject = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { groupId, id } = req.params;

    const existing = await tenantDb.groupSubject.findFirst({
      where: { id, group_id: groupId, college_id: req.collegeId }
    });
    if (!existing) return res.status(404).json({ success: false, message: 'Group subject configuration not found' });

    await tenantDb.groupSubject.delete({ where: { id } });
    res.json({ success: true, message: 'Subject removed from group successfully' });
  } catch (error) { next(error); }
};

/**
 * Get assigned subjects for a student
 * GET /api/students/:id/subjects
 */
exports.getStudentSubjects = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { id } = req.params;

    const studentSubjects = await tenantDb.studentSubject.findMany({
      where: {
        student_id: id,
        college_id: req.collegeId
      },
      orderBy: { createdAt: 'asc' }
    });

    const subjectIds = studentSubjects.map(ss => ss.subject_id);
    const subjects = await tenantDb.subject.findMany({
      where: {
        id: { in: subjectIds },
        college_id: req.collegeId
      },
      select: { id: true, name: true, code: true }
    });
    const map = new Map(subjects.map(s => [s.id, s]));

    const formatted = studentSubjects.map(ss => ({
      ...ss,
      _id: ss.id,
      subject: map.get(ss.subject_id) || null
    }));

    res.json({ success: true, data: formatted });
  } catch (error) { next(error); }
};

/**
 * Assign subjects for a student with validation against group's rules.
 * All compulsory subjects MUST be present.
 * Electives must not exceed maxChoices per electiveSet.
 * Updates Student.subjects array to keep legacy UI in sync.
 * POST /api/students/:id/subjects
 */
exports.assignStudentSubjects = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { id } = req.params;
    const { subjectIds = [], session_id } = req.body;

    const student = await tenantDb.student.findFirst({
      where: { id, college_id: req.collegeId }
    });
    if (!student) return res.status(404).json({ success: false, message: 'Student not found' });

    const targetSessionId = session_id || student.session_id;

    // Lookup student's group in Group model
    let groupRecord = null;
    if (student.group) {
      groupRecord = await tenantDb.group.findFirst({
        where: {
          college_id: req.collegeId,
          name: { equals: student.group, mode: 'insensitive' }
        }
      });
    }

    // If group has GroupSubject rules defined, validate them
    if (groupRecord) {
      const groupRules = await tenantDb.groupSubject.findMany({
        where: {
          college_id: req.collegeId,
          group_id: groupRecord.id,
          isActive: true
        }
      });

      if (groupRules.length > 0) {
        const chosenSet = new Set(subjectIds);
        const compulsoryRules = groupRules.filter(r => r.kind === 'compulsory');

        for (const comp of compulsoryRules) {
          if (!chosenSet.has(comp.subject_id)) {
            const missingSubject = await tenantDb.subject.findUnique({
              where: { id: comp.subject_id },
              select: { name: true }
            });
            return res.status(400).json({
              success: false,
              errorCode: 'MISSING_COMPULSORY_SUBJECT',
              message: `Missing compulsory subject: "${missingSubject?.name || comp.subject_id}". All compulsory subjects must be assigned.`,
              missingSubjectId: comp.subject_id
            });
          }
        }

        // Validate elective sets
        const electiveSets = new Map();
        for (const rule of groupRules.filter(r => r.kind === 'elective' && r.electiveSet)) {
          if (!electiveSets.has(rule.electiveSet)) {
            electiveSets.set(rule.electiveSet, { max: rule.maxChoices || 1, subjectIds: new Set() });
          }
          electiveSets.get(rule.electiveSet).subjectIds.add(rule.subject_id);
        }

        for (const [setName, info] of electiveSets.entries()) {
          const chosenCount = subjectIds.filter(sid => info.subjectIds.has(sid)).length;
          if (chosenCount > info.max) {
            return res.status(400).json({
              success: false,
              errorCode: 'ELECTIVE_LIMIT_EXCEEDED',
              message: `Too many subjects selected for elective set "${setName}". Maximum allowed is ${info.max}, but ${chosenCount} were selected.`
            });
          }
        }
      }
    }

    // Fetch subject names to keep Student.subjects string array updated
    const subjects = await tenantDb.subject.findMany({
      where: { id: { in: subjectIds }, college_id: req.collegeId },
      select: { id: true, name: true, code: true }
    });
    const subjectNames = subjects.map(s => s.name);

    // Delete existing StudentSubject for this session & insert new
    await tenantDb.studentSubject.deleteMany({
      where: {
        college_id: req.collegeId,
        session_id: targetSessionId,
        student_id: id
      }
    });

    const newStudentSubjects = [];
    for (const sid of subjectIds) {
      newStudentSubjects.push({
        college_id: req.collegeId,
        session_id: targetSessionId,
        student_id: id,
        subject_id: sid,
        kind: 'compulsory' // default kind for StudentSubject
      });
    }

    if (newStudentSubjects.length > 0) {
      await tenantDb.studentSubject.createMany({
        data: newStudentSubjects
      });
    }

    // Sync legacy Student.subjects String[]
    const updatedStudent = await tenantDb.student.update({
      where: { id },
      data: { subjects: subjectNames }
    });

    res.json({
      success: true,
      message: 'Student subjects assigned successfully',
      subjects: subjectNames,
      data: newStudentSubjects
    });
  } catch (error) { next(error); }
};

/**
 * Move student between groups in first weeks
 * Changes Student.group and section, rewrites StudentSubject for new group, writes audit log.
 * Allowed only for status 'active'.
 * POST /api/students/:id/move-group
 */
exports.moveStudentGroup = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { id } = req.params;
    const { targetGroupId, targetGroupName, section_id, section, subjectIds, reason } = req.body;

    const student = await tenantDb.student.findFirst({
      where: { id, college_id: req.collegeId }
    });
    if (!student) return res.status(404).json({ success: false, message: 'Student not found' });

    if (student.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: `Only active students can be moved between groups. Current status: "${student.status}".`
      });
    }

    // Find target group
    const targetGroup = await tenantDb.group.findFirst({
      where: {
        college_id: req.collegeId,
        ...(targetGroupId ? { id: targetGroupId } : { name: targetGroupName })
      }
    });
    if (!targetGroup) {
      return res.status(404).json({ success: false, message: 'Target group not found' });
    }

    // Check target group seats if configured
    if (targetGroup.seats && targetGroup.seats > 0) {
      const activeCount = await tenantDb.student.count({
        where: {
          college_id: req.collegeId,
          session_id: student.session_id,
          group: targetGroup.name,
          status: 'active'
        }
      });
      if (activeCount >= targetGroup.seats) {
        return res.status(400).json({
          success: false,
          message: `Target group "${targetGroup.name}" is full (Capacity: ${targetGroup.seats}, Enrolled: ${activeCount}).`
        });
      }
    }

    // Fetch target group compulsory subjects
    const groupRules = await tenantDb.groupSubject.findMany({
      where: {
        college_id: req.collegeId,
        group_id: targetGroup.id,
        isActive: true
      }
    });

    let finalSubjectIds = subjectIds;
    if (!finalSubjectIds || !Array.isArray(finalSubjectIds) || finalSubjectIds.length === 0) {
      // Default to compulsory subjects of target group
      finalSubjectIds = groupRules.filter(r => r.kind === 'compulsory').map(r => r.subject_id);
    } else {
      // Validate compulsory subjects are present
      const chosenSet = new Set(finalSubjectIds);
      const compulsoryRules = groupRules.filter(r => r.kind === 'compulsory');
      for (const comp of compulsoryRules) {
        if (!chosenSet.has(comp.subject_id)) {
          const missingSubject = await tenantDb.subject.findUnique({
            where: { id: comp.subject_id },
            select: { name: true }
          });
          return res.status(400).json({
            success: false,
            errorCode: 'MISSING_COMPULSORY_SUBJECT',
            message: `Missing compulsory subject for target group: "${missingSubject?.name || comp.subject_id}".`
          });
        }
      }
    }

    // Fetch subject names
    const subjects = await tenantDb.subject.findMany({
      where: { id: { in: finalSubjectIds }, college_id: req.collegeId },
      select: { id: true, name: true }
    });
    const subjectNames = subjects.map(s => s.name);

    // Rewrite StudentSubject
    await tenantDb.studentSubject.deleteMany({
      where: {
        college_id: req.collegeId,
        session_id: student.session_id,
        student_id: id
      }
    });

    if (finalSubjectIds.length > 0) {
      await tenantDb.studentSubject.createMany({
        data: finalSubjectIds.map(sid => ({
          college_id: req.collegeId,
          session_id: student.session_id,
          student_id: id,
          subject_id: sid,
          kind: 'compulsory'
        }))
      });
    }

    const oldGroup = student.group;
    const oldSection = student.section;

    // Update Student record
    const updatedStudent = await tenantDb.student.update({
      where: { id },
      data: {
        group: targetGroup.name,
        subjects: subjectNames,
        ...(section_id !== undefined && { section_id }),
        ...(section !== undefined && { section })
      }
    });

    // Write audit activity log if model exists
    try {
      if (tenantDb.activityLog) {
        await tenantDb.activityLog.create({
          data: {
            college_id: req.collegeId,
            action: 'MOVE_GROUP',
            userId: req.user?.id || 'system',
            details: `Moved student "${student.name}" (${student.rollNumber}) from group "${oldGroup}" to "${targetGroup.name}". Reason: ${reason || 'N/A'}`
          }
        });
      }
    } catch (_) { /* non-blocking */ }

    res.json({
      success: true,
      message: `Student successfully moved from "${oldGroup}" to "${targetGroup.name}"`,
      data: {
        student: updatedStudent,
        fromGroup: oldGroup,
        toGroup: targetGroup.name,
        subjects: subjectNames
      }
    });
  } catch (error) { next(error); }
};
