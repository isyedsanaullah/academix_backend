// ─── Practical & Lab Management Controller (Multi-DB with Prisma) ─────────────
const getCurrentSessionId = async (tenantDb, collegeId) => {
  const session = await tenantDb.session.findFirst({
    where: { college_id: collegeId, isCurrent: true }
  });
  return session?.id || null;
};

// ── 1. Practical Sessions (Timetable & Lab Batches) ───────────────────────────

exports.getPracticalSessions = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { session_id, subject_id, class: cls, group, section, date } = req.query;
    const sessionId = session_id || await getCurrentSessionId(tenantDb, req.collegeId);

    const where = { college_id: req.collegeId };
    if (sessionId) where.session_id = sessionId;
    if (subject_id) where.subject_id = subject_id;
    if (cls) where.class = cls;
    if (group) where.group = group;
    if (section) where.section = section;
    if (date) {
      const d = new Date(date);
      where.date = {
        gte: new Date(d.setHours(0, 0, 0, 0)),
        lte: new Date(d.setHours(23, 59, 59, 999))
      };
    }

    const sessions = await tenantDb.practicalSession.findMany({
      where,
      orderBy: { date: 'asc' }
    });

    res.json({ success: true, count: sessions.length, data: sessions });
  } catch (error) {
    next(error);
  }
};

exports.createPracticalSession = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const sessionId = req.body.session_id || await getCurrentSessionId(tenantDb, req.collegeId);
    if (!sessionId) {
      return res.status(400).json({ success: false, message: 'Session ID is required' });
    }

    const {
      subject_id,
      class: cls,
      group,
      section,
      batchNo = 1,
      date,
      startTime,
      endTime,
      labName,
      teacher_id,
      status = 'scheduled'
    } = req.body;

    if (!subject_id || !cls || !date) {
      return res.status(400).json({ success: false, message: 'Subject, class, and date are required' });
    }

    const session = await tenantDb.practicalSession.create({
      data: {
        college_id: req.collegeId,
        session_id: sessionId,
        subject_id,
        class: cls,
        group: group || null,
        section: section || null,
        batchNo: parseInt(batchNo, 10) || 1,
        date: new Date(date),
        startTime: startTime || null,
        endTime: endTime || null,
        labName: labName || null,
        teacher_id: teacher_id || null,
        status
      }
    });

    res.status(201).json({ success: true, message: 'Practical session scheduled successfully', data: session });
  } catch (error) {
    next(error);
  }
};

exports.updatePracticalSession = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { id } = req.params;

    const existing = await tenantDb.practicalSession.findFirst({
      where: { id, college_id: req.collegeId }
    });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Practical session not found' });
    }

    const data = { ...req.body };
    if (data.date) data.date = new Date(data.date);
    if (data.batchNo) data.batchNo = parseInt(data.batchNo, 10);

    const updated = await tenantDb.practicalSession.update({
      where: { id },
      data
    });

    res.json({ success: true, message: 'Practical session updated', data: updated });
  } catch (error) {
    next(error);
  }
};

exports.deletePracticalSession = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { id } = req.params;

    await tenantDb.practicalSession.deleteMany({
      where: { id, college_id: req.collegeId }
    });

    res.json({ success: true, message: 'Practical session deleted' });
  } catch (error) {
    next(error);
  }
};

// ── 2. Practical Marks & Lab Attendance ───────────────────────────────────────

exports.getPracticalMarks = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { session_id, subject_id, exam_id, practical_id, student_id } = req.query;
    const sessionId = session_id || await getCurrentSessionId(tenantDb, req.collegeId);

    const where = { college_id: req.collegeId };
    if (sessionId) where.session_id = sessionId;
    if (subject_id) where.subject_id = subject_id;
    if (exam_id) where.exam_id = exam_id;
    if (practical_id) where.practical_id = practical_id;
    if (student_id) where.student_id = student_id;

    const marks = await tenantDb.practicalMark.findMany({ where });

    // Join student details
    const studentIds = [...new Set(marks.map(m => m.student_id))];
    const students = await tenantDb.student.findMany({
      where: { id: { in: studentIds } },
      select: { id: true, name: true, rollNumber: true, class: true, section: true, group: true }
    });
    const studentMap = Object.fromEntries(students.map(s => [s.id, s]));

    const formatted = marks.map(m => ({
      ...m,
      student: studentMap[m.student_id] || null
    }));

    res.json({ success: true, count: formatted.length, data: formatted });
  } catch (error) {
    next(error);
  }
};

exports.savePracticalMarks = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const sessionId = req.body.session_id || await getCurrentSessionId(tenantDb, req.collegeId);
    if (!sessionId) {
      return res.status(400).json({ success: false, message: 'Session ID is required' });
    }

    const { marks = [], exam_id = null, practical_id = null, subject_id } = req.body;
    const userId = req.user?.id || req.user?._id || 'unknown';

    if (!Array.isArray(marks) || marks.length === 0) {
      return res.status(400).json({ success: false, message: 'Marks array is required' });
    }

    const results = [];
    for (const item of marks) {
      const subId = item.subject_id || subject_id;
      if (!item.student_id || !subId) continue;

      const record = await tenantDb.practicalMark.upsert({
        where: {
          college_id_session_id_student_id_subject_id_exam_id: {
            college_id: req.collegeId,
            session_id: sessionId,
            student_id: item.student_id,
            subject_id: subId,
            exam_id: item.exam_id || exam_id || 'general_practical'
          }
        },
        create: {
          college_id: req.collegeId,
          session_id: sessionId,
          student_id: item.student_id,
          subject_id: subId,
          exam_id: item.exam_id || exam_id || 'general_practical',
          practical_id: item.practical_id || practical_id || null,
          marks: item.marks != null ? parseFloat(item.marks) : null,
          maxMarks: item.maxMarks != null ? parseFloat(item.maxMarks) : 30,
          journalMarks: item.journalMarks != null ? parseFloat(item.journalMarks) : null,
          attended: item.attended !== undefined ? !!item.attended : true,
          enteredBy: userId
        },
        update: {
          practical_id: item.practical_id || practical_id || undefined,
          marks: item.marks != null ? parseFloat(item.marks) : undefined,
          maxMarks: item.maxMarks != null ? parseFloat(item.maxMarks) : undefined,
          journalMarks: item.journalMarks != null ? parseFloat(item.journalMarks) : undefined,
          attended: item.attended !== undefined ? !!item.attended : undefined,
          enteredBy: userId
        }
      });
      results.push(record);
    }

    res.json({
      success: true,
      message: `Saved practical marks for ${results.length} student(s)`,
      data: results
    });
  } catch (error) {
    next(error);
  }
};

// ── 3. Lab Journals ──────────────────────────────────────────────────────────

exports.getLabJournals = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { session_id, subject_id, class: cls, section } = req.query;
    const sessionId = session_id || await getCurrentSessionId(tenantDb, req.collegeId);

    const where = { college_id: req.collegeId };
    if (sessionId) where.session_id = sessionId;
    if (subject_id) where.subject_id = subject_id;

    const journals = await tenantDb.labJournal.findMany({ where });

    const studentIds = journals.map(j => j.student_id);
    const studentWhere = { id: { in: studentIds } };
    if (cls) studentWhere.class = cls;
    if (section) studentWhere.section = section;

    const students = await tenantDb.student.findMany({
      where: studentWhere,
      select: { id: true, name: true, rollNumber: true, class: true, section: true, group: true }
    });
    const studentMap = Object.fromEntries(students.map(s => [s.id, s]));

    const formatted = journals
      .filter(j => studentMap[j.student_id])
      .map(j => ({
        ...j,
        student: studentMap[j.student_id]
      }));

    res.json({ success: true, count: formatted.length, data: formatted });
  } catch (error) {
    next(error);
  }
};

exports.saveLabJournal = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const sessionId = req.body.session_id || await getCurrentSessionId(tenantDb, req.collegeId);
    if (!sessionId) {
      return res.status(400).json({ success: false, message: 'Session ID is required' });
    }

    const { student_id, subject_id, required = 0, submitted = 0, checked = 0, remarks = null } = req.body;

    if (!student_id || !subject_id) {
      return res.status(400).json({ success: false, message: 'Student ID and Subject ID are required' });
    }

    const journal = await tenantDb.labJournal.upsert({
      where: {
        college_id_session_id_student_id_subject_id: {
          college_id: req.collegeId,
          session_id: sessionId,
          student_id,
          subject_id
        }
      },
      create: {
        college_id: req.collegeId,
        session_id: sessionId,
        student_id,
        subject_id,
        required: parseInt(required, 10) || 0,
        submitted: parseInt(submitted, 10) || 0,
        checked: parseInt(checked, 10) || 0,
        remarks: remarks || null
      },
      update: {
        required: parseInt(required, 10) || 0,
        submitted: parseInt(submitted, 10) || 0,
        checked: parseInt(checked, 10) || 0,
        remarks: remarks || null
      }
    });

    res.json({ success: true, message: 'Lab journal status updated', data: journal });
  } catch (error) {
    next(error);
  }
};

// ── 4. Board Practical Examiners ─────────────────────────────────────────────

exports.getExaminers = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { session_id, board, subject_id } = req.query;
    const sessionId = session_id || await getCurrentSessionId(tenantDb, req.collegeId);

    const where = { college_id: req.collegeId };
    if (sessionId) where.session_id = sessionId;
    if (board) where.board = board;
    if (subject_id) where.subject_id = subject_id;

    const examiners = await tenantDb.boardPracticalExaminer.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });

    res.json({ success: true, count: examiners.length, data: examiners });
  } catch (error) {
    next(error);
  }
};

exports.createExaminer = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const sessionId = req.body.session_id || await getCurrentSessionId(tenantDb, req.collegeId);
    if (!sessionId) {
      return res.status(400).json({ success: false, message: 'Session ID is required' });
    }

    const {
      board,
      subject_id,
      centreName,
      examDate,
      examinerName,
      examinerCnic,
      examinerType = 'external',
      remarks
    } = req.body;

    if (!board || !examinerName) {
      return res.status(400).json({ success: false, message: 'Board name and examiner name are required' });
    }

    const examiner = await tenantDb.boardPracticalExaminer.create({
      data: {
        college_id: req.collegeId,
        session_id: sessionId,
        board,
        subject_id: subject_id || null,
        centreName: centreName || null,
        examDate: examDate ? new Date(examDate) : null,
        examinerName,
        examinerCnic: examinerCnic || null,
        examinerType,
        remarks: remarks || null
      }
    });

    res.status(201).json({ success: true, message: 'Examiner registered', data: examiner });
  } catch (error) {
    next(error);
  }
};

exports.deleteExaminer = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { id } = req.params;

    await tenantDb.boardPracticalExaminer.deleteMany({
      where: { id, college_id: req.collegeId }
    });

    res.json({ success: true, message: 'Examiner record removed' });
  } catch (error) {
    next(error);
  }
};

// ── 5. Lab Stock & Movements (Inventory) ──────────────────────────────────────

exports.getStockItems = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { category, subject, lowStockOnly } = req.query;

    const where = { college_id: req.collegeId, isActive: true };
    if (category) where.category = category;
    if (subject) where.subject = subject;

    const items = await tenantDb.labStockItem.findMany({
      where,
      orderBy: { name: 'asc' }
    });

    let filtered = items;
    if (lowStockOnly === 'true') {
      filtered = items.filter(i => i.quantity <= (i.minQuantity || 0));
    }

    res.json({ success: true, count: filtered.length, data: filtered });
  } catch (error) {
    next(error);
  }
};

exports.createStockItem = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const {
      name,
      category,
      subject,
      unit,
      quantity = 0,
      minQuantity = 0,
      location,
      expiryDate
    } = req.body;

    if (!name || !category) {
      return res.status(400).json({ success: false, message: 'Item name and category are required' });
    }

    const item = await tenantDb.labStockItem.create({
      data: {
        college_id: req.collegeId,
        name,
        category,
        subject: subject || null,
        unit: unit || 'units',
        quantity: parseFloat(quantity) || 0,
        minQuantity: parseFloat(minQuantity) || 0,
        location: location || null,
        expiryDate: expiryDate ? new Date(expiryDate) : null,
        isActive: true
      }
    });

    res.status(201).json({ success: true, message: 'Lab stock item created', data: item });
  } catch (error) {
    next(error);
  }
};

exports.updateStockItem = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { id } = req.params;

    const item = await tenantDb.labStockItem.findFirst({
      where: { id, college_id: req.collegeId }
    });
    if (!item) {
      return res.status(404).json({ success: false, message: 'Stock item not found' });
    }

    const data = { ...req.body };
    if (data.quantity !== undefined) data.quantity = parseFloat(data.quantity);
    if (data.minQuantity !== undefined) data.minQuantity = parseFloat(data.minQuantity);
    if (data.expiryDate) data.expiryDate = new Date(data.expiryDate);

    const updated = await tenantDb.labStockItem.update({
      where: { id },
      data
    });

    res.json({ success: true, message: 'Stock item updated', data: updated });
  } catch (error) {
    next(error);
  }
};

/**
 * Record stock movement (purchase, practical use, breakage, etc.)
 * CRITICAL CONSTRAINT: Stock cannot go below zero!
 */
exports.recordStockMovement = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { id } = req.params;
    const { change, reason = 'adjustment', practical_id = null } = req.body;

    const changeNum = parseFloat(change);
    if (isNaN(changeNum) || changeNum === 0) {
      return res.status(400).json({ success: false, message: 'Valid non-zero change quantity is required' });
    }

    const item = await tenantDb.labStockItem.findFirst({
      where: { id, college_id: req.collegeId }
    });

    if (!item) {
      return res.status(404).json({ success: false, message: 'Stock item not found' });
    }

    const newQuantity = Number((item.quantity + changeNum).toFixed(3));

    // Enforce invariant: Stock quantity cannot be negative
    if (newQuantity < 0) {
      return res.status(400).json({
        success: false,
        message: `Stock cannot go below zero. Current quantity is ${item.quantity}, requested change is ${changeNum}`,
        code: 'INSUFFICIENT_STOCK',
        currentQuantity: item.quantity,
        requestedChange: changeNum
      });
    }

    const userId = req.user?.id || req.user?._id || 'unknown';

    // Atomically create movement record and update stock item quantity
    const [movement, updatedItem] = await tenantDb.$transaction([
      tenantDb.labStockMovement.create({
        data: {
          college_id: req.collegeId,
          item_id: id,
          change: changeNum,
          reason,
          practical_id,
          enteredBy: userId
        }
      }),
      tenantDb.labStockItem.update({
        where: { id },
        data: { quantity: newQuantity }
      })
    ]);

    res.json({
      success: true,
      message: 'Stock movement recorded successfully',
      movement,
      item: updatedItem
    });
  } catch (error) {
    next(error);
  }
};

exports.getStockMovements = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { id } = req.params;

    const movements = await tenantDb.labStockMovement.findMany({
      where: { item_id: id, college_id: req.collegeId },
      orderBy: { createdAt: 'desc' }
    });

    res.json({ success: true, count: movements.length, data: movements });
  } catch (error) {
    next(error);
  }
};
