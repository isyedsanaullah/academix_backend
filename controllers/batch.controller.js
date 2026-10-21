// controllers/batch.controller.js
// Handles Batches (two-year cycles), Combined Classes, and Student Promotion Engine with Dry-Run mode.

/**
 * List batches
 * GET /api/batches
 */
exports.getBatches = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const batches = await tenantDb.batch.findMany({
      where: { college_id: req.collegeId },
      orderBy: { startYear: 'desc' }
    });
    res.json({ success: true, data: batches.map(b => ({ ...b, _id: b.id })) });
  } catch (error) { next(error); }
};

/**
 * Create batch
 * POST /api/batches
 */
exports.createBatch = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { name, startYear, endYear, status = 'active' } = req.body;

    if (!name || !startYear || !endYear) {
      return res.status(400).json({ success: false, message: 'Name, startYear, and endYear are required' });
    }

    const batch = await tenantDb.batch.create({
      data: {
        college_id: req.collegeId,
        name,
        startYear: parseInt(startYear, 10),
        endYear: parseInt(endYear, 10),
        status
      }
    });

    res.status(201).json({ success: true, data: { ...batch, _id: batch.id } });
  } catch (error) { next(error); }
};

/**
 * Update batch
 * PUT /api/batches/:id
 */
exports.updateBatch = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { id } = req.params;
    const { name, startYear, endYear, status } = req.body;

    const existing = await tenantDb.batch.findFirst({
      where: { id, college_id: req.collegeId }
    });
    if (!existing) return res.status(404).json({ success: false, message: 'Batch not found' });

    const updated = await tenantDb.batch.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(startYear && { startYear: parseInt(startYear, 10) }),
        ...(endYear && { endYear: parseInt(endYear, 10) }),
        ...(status && { status })
      }
    });

    res.json({ success: true, data: { ...updated, _id: updated.id } });
  } catch (error) { next(error); }
};

/**
 * Delete batch
 * DELETE /api/batches/:id
 */
exports.deleteBatch = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { id } = req.params;

    const existing = await tenantDb.batch.findFirst({
      where: { id, college_id: req.collegeId }
    });
    if (!existing) return res.status(404).json({ success: false, message: 'Batch not found' });

    await tenantDb.batch.delete({ where: { id } });
    res.json({ success: true, message: 'Batch deleted successfully' });
  } catch (error) { next(error); }
};

/**
 * List Combined Classes
 * GET /api/combined-classes
 */
exports.getCombinedClasses = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { session_id, subject_id } = req.query;

    const where = { college_id: req.collegeId };
    if (session_id) where.session_id = session_id;
    if (subject_id) where.subject_id = subject_id;

    const combined = await tenantDb.combinedClass.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });

    // Populate subject and teacher details
    const subjectIds = [...new Set(combined.map(c => c.subject_id))];
    const teacherIds = [...new Set(combined.map(c => c.teacher_id).filter(Boolean))];

    const [subjects, teachers] = await Promise.all([
      tenantDb.subject.findMany({ where: { id: { in: subjectIds }, college_id: req.collegeId } }),
      tenantDb.teacher ? tenantDb.teacher.findMany({ where: { id: { in: teacherIds }, college_id: req.collegeId } }) : []
    ]);

    const subjectMap = new Map(subjects.map(s => [s.id, s]));
    const teacherMap = new Map(teachers.map(t => [t.id, t]));

    const formatted = combined.map(c => ({
      ...c,
      _id: c.id,
      subject: subjectMap.get(c.subject_id) || null,
      teacher: teacherMap.get(c.teacher_id) || null
    }));

    res.json({ success: true, data: formatted });
  } catch (error) { next(error); }
};

/**
 * Create Combined Class
 * POST /api/combined-classes
 */
exports.createCombinedClass = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { session_id, subject_id, name, sectionIds = [], teacher_id, isActive = true } = req.body;

    if (!session_id || !subject_id || !name) {
      return res.status(400).json({ success: false, message: 'session_id, subject_id, and name are required' });
    }

    const created = await tenantDb.combinedClass.create({
      data: {
        college_id: req.collegeId,
        session_id,
        subject_id,
        name,
        sectionIds: Array.isArray(sectionIds) ? sectionIds : [],
        teacher_id: teacher_id || null,
        isActive
      }
    });

    res.status(201).json({ success: true, data: { ...created, _id: created.id } });
  } catch (error) { next(error); }
};

/**
 * Update Combined Class
 * PUT /api/combined-classes/:id
 */
exports.updateCombinedClass = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { id } = req.params;
    const { session_id, subject_id, name, sectionIds, teacher_id, isActive } = req.body;

    const existing = await tenantDb.combinedClass.findFirst({
      where: { id, college_id: req.collegeId }
    });
    if (!existing) return res.status(404).json({ success: false, message: 'Combined class not found' });

    const updated = await tenantDb.combinedClass.update({
      where: { id },
      data: {
        ...(session_id && { session_id }),
        ...(subject_id && { subject_id }),
        ...(name && { name }),
        ...(sectionIds && { sectionIds: Array.isArray(sectionIds) ? sectionIds : [] }),
        ...(teacher_id !== undefined && { teacher_id: teacher_id || null }),
        ...(isActive !== undefined && { isActive })
      }
    });

    res.json({ success: true, data: { ...updated, _id: updated.id } });
  } catch (error) { next(error); }
};

/**
 * Delete Combined Class
 * DELETE /api/combined-classes/:id
 */
exports.deleteCombinedClass = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { id } = req.params;

    const existing = await tenantDb.combinedClass.findFirst({
      where: { id, college_id: req.collegeId }
    });
    if (!existing) return res.status(404).json({ success: false, message: 'Combined class not found' });

    await tenantDb.combinedClass.delete({ where: { id } });
    res.json({ success: true, message: 'Combined class deleted successfully' });
  } catch (error) { next(error); }
};

/**
 * Run student promotions for a batch (1st year to 2nd year).
 * Dry-run mode returns counts and the first 20 rows without writing.
 * POST /api/promotions/run
 */
exports.runPromotions = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const {
      fromSessionId,
      toSessionId,
      batchId,
      fromClass = 'FSC Part 1',
      toClass = 'FSC Part 2',
      rollNumberRule = 'keep',
      dryRun = false,
      remarks = 'Annual Promotion'
    } = req.body;

    if (!fromSessionId || !toSessionId) {
      return res.status(400).json({
        success: false,
        message: 'Both fromSessionId and toSessionId are required.'
      });
    }

    if (fromSessionId === toSessionId) {
      return res.status(400).json({
        success: false,
        message: 'fromSessionId and toSessionId must be different academic sessions.'
      });
    }

    // Verify sessions exist
    const [fromSession, toSession] = await Promise.all([
      tenantDb.session.findUnique({ where: { id: fromSessionId } }),
      tenantDb.session.findUnique({ where: { id: toSessionId } })
    ]);
    if (!fromSession) return res.status(404).json({ success: false, message: 'Source session not found' });
    if (!toSession) return res.status(404).json({ success: false, message: 'Destination session not found' });

    // Find active students in source session and fromClass
    const studentsToPromote = await tenantDb.student.findMany({
      where: {
        college_id: req.collegeId,
        session_id: fromSessionId,
        class: { equals: fromClass, mode: 'insensitive' },
        status: 'active'
      },
      orderBy: [{ group: 'asc' }, { rollNumber: 'asc' }]
    });

    const totalEligible = studentsToPromote.length;

    // In Dry-run mode, return preview without touching database rows
    if (dryRun === true || dryRun === 'true') {
      const samplePreview = studentsToPromote.slice(0, 20).map(s => ({
        studentId: s.id,
        name: s.name,
        fatherName: s.fatherName,
        currentRollNumber: s.rollNumber,
        projectedRollNumber: rollNumberRule === 'keep' ? s.rollNumber : `${s.rollNumber}-P2`,
        group: s.group,
        section: s.section,
        fromClass,
        toClass,
        fromSession: fromSession.name,
        toSession: toSession.name
      }));

      return res.json({
        success: true,
        dryRun: true,
        totalEligible,
        previewCount: samplePreview.length,
        fromSession: { id: fromSession.id, name: fromSession.name },
        toSession: { id: toSession.id, name: toSession.name },
        fromClass,
        toClass,
        sample: samplePreview
      });
    }

    // Actual Promotion Execution
    let promotedCount = 0;
    const promotionLogs = [];

    for (const student of studentsToPromote) {
      const newRollNumber = rollNumberRule === 'keep' ? student.rollNumber : `${student.rollNumber}-P2`;

      // 1. Create the Part 2 record per existing student creation rules (keep cardId and qrCode)
      const newStudent = await tenantDb.student.create({
        data: {
          college_id: req.collegeId,
          session_id: toSessionId,
          user_id: student.user_id,
          name: student.name,
          fatherName: student.fatherName,
          cnic: student.cnic,
          dateOfBirth: student.dateOfBirth,
          gender: student.gender,
          phone: student.phone,
          email: student.email,
          address: student.address,
          guardianName: student.guardianName,
          guardianPhone: student.guardianPhone,
          guardianRelation: student.guardianRelation,
          guardianCnic: student.guardianCnic,
          rollNumber: newRollNumber,
          registrationNumber: student.registrationNumber,
          class: toClass,
          group: student.group,
          section: student.section,
          section_id: null, // section will be assigned in new session
          subjects: student.subjects || [],
          admissionDate: student.admissionDate,
          biometricId: student.biometricId || '',
          cardId: student.cardId || student.rollNumber,
          faceData: student.faceData || '',
          qrCode: student.qrCode || student.cardId || student.rollNumber,
          photo: student.photo || '',
          documents: student.documents || undefined,
          status: 'active',
          canteenBalance: 0,
          batch_id: batchId || student.batch_id || null,
          quota: student.quota || null,
          candidateType: student.candidateType || 'regular'
        }
      });

      // 2. Set status 'promoted' on old record as allowed by schema
      await tenantDb.student.update({
        where: { id: student.id },
        data: { status: 'promoted' }
      });

      // 3. Write StudentPromotion row
      const promotionRecord = await tenantDb.studentPromotion.create({
        data: {
          college_id: req.collegeId,
          student_id: student.id,
          from_session: fromSessionId,
          to_session: toSessionId,
          fromClass,
          toClass,
          newRollNumber,
          decidedBy: req.user?.id || 'system',
          remarks: remarks || 'Annual Promotion to Part 2'
        }
      });

      // 4. Carry forward StudentSubject records to new session
      const existingSubjects = await tenantDb.studentSubject.findMany({
        where: {
          college_id: req.collegeId,
          session_id: fromSessionId,
          student_id: student.id
        }
      });

      if (existingSubjects.length > 0) {
        await tenantDb.studentSubject.createMany({
          data: existingSubjects.map(es => ({
            college_id: req.collegeId,
            session_id: toSessionId,
            student_id: newStudent.id,
            subject_id: es.subject_id,
            kind: es.kind
          }))
        });
      }

      promotedCount++;
      if (promotionLogs.length < 20) {
        promotionLogs.push({
          oldStudentId: student.id,
          newStudentId: newStudent.id,
          name: student.name,
          rollNumber: newRollNumber
        });
      }
    }

    res.json({
      success: true,
      dryRun: false,
      message: `Successfully promoted ${promotedCount} students from ${fromClass} to ${toClass}.`,
      promotedCount,
      fromSession: fromSession.name,
      toSession: toSession.name,
      sample: promotionLogs
    });
  } catch (error) { next(error); }
};
