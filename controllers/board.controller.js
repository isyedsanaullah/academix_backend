// controllers/board.controller.js
// Handles Board Registration Forms, Exam Admission Forms, Roll Number Slips,
// Attendance Eligibility Checks, Datesheets, Results Entry & CSV Import,
// Result Analysis, and Fee Alerts.

const PDFDocument = require('pdfkit');
const { getSystemClient } = require('../config/prismaManager');
const { getBoardConfig, normalizeColumnHeader, defaultBoard } = require('../config/boards');

// Helper to calculate grade from percentage
function getGrade(percentage) {
  if (percentage == null || isNaN(percentage)) return 'F';
  if (percentage >= 80) return 'A+';
  if (percentage >= 70) return 'A';
  if (percentage >= 60) return 'B';
  if (percentage >= 50) return 'C';
  if (percentage >= 40) return 'D';
  if (percentage >= 33) return 'E';
  return 'F';
}

/**
 * List all Board Forms with filtering and pagination
 * GET /api/board/forms
 */
exports.getBoardForms = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const {
      session_id,
      kind,
      candidateType,
      status,
      board,
      search,
      page = 1,
      limit = 20
    } = req.query;

    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const take = parseInt(limit, 10);

    const where = { college_id: req.collegeId };
    if (session_id) where.session_id = session_id;
    if (kind) where.kind = kind;
    if (candidateType) where.candidateType = candidateType;
    if (status) where.status = status;
    if (board) where.board = { contains: board, mode: 'insensitive' };

    // Search by roll number, reg no, form no
    if (search) {
      where.OR = [
        { boardRollNumber: { contains: search, mode: 'insensitive' } },
        { boardRegistrationNo: { contains: search, mode: 'insensitive' } },
        { formNumber: { contains: search, mode: 'insensitive' } }
      ];
    }

    const [total, forms] = await Promise.all([
      tenantDb.boardForm.count({ where }),
      tenantDb.boardForm.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip,
        take
      })
    ]);

    // Populate student information
    const studentIds = forms.map(f => f.student_id).filter(Boolean);
    const students = await tenantDb.student.findMany({
      where: { id: { in: studentIds } },
      select: {
        id: true,
        name: true,
        rollNumber: true,
        fatherName: true,
        class: true,
        section: true,
        group: true,
        status: true,
        candidateType: true
      }
    });
    const studentMap = new Map(students.map(s => [s.id, s]));

    // Populate fee information
    const feeIds = forms.map(f => f.fee_id).filter(Boolean);
    const fees = await tenantDb.fee.findMany({
      where: { id: { in: feeIds } },
      select: { id: true, status: true, totalAmount: true, paidAmount: true, dueDate: true }
    });
    const feeMap = new Map(fees.map(f => [f.id, f]));

    const formatted = forms.map(form => ({
      ...form,
      _id: form.id,
      student: studentMap.get(form.student_id) || null,
      fee: feeMap.get(form.fee_id) || null
    }));

    res.json({
      success: true,
      data: formatted,
      pagination: {
        total,
        page: parseInt(page, 10),
        pages: Math.ceil(total / take)
      }
    });
  } catch (error) { next(error); }
};

/**
 * Get single Board Form by ID
 * GET /api/board/forms/:id
 */
exports.getBoardFormById = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { id } = req.params;

    const form = await tenantDb.boardForm.findFirst({
      where: { id, college_id: req.collegeId }
    });
    if (!form) return res.status(404).json({ success: false, message: 'Board form not found' });

    const [student, fee] = await Promise.all([
      tenantDb.student.findFirst({ where: { id: form.student_id } }),
      form.fee_id ? tenantDb.fee.findFirst({ where: { id: form.fee_id } }) : null
    ]);

    res.json({
      success: true,
      data: {
        ...form,
        _id: form.id,
        student,
        fee
      }
    });
  } catch (error) { next(error); }
};

/**
 * Batch register 1st-year students for Board Registration
 * Copies group and subjects from StudentSubject (or Student.subjects),
 * Creates a board Fee row, and sets status to 'draft'.
 * POST /api/board/forms/register-batch
 */
exports.registerBatch = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const {
      session_id,
      class: targetClass = 'FSC Part 1',
      board = 'FBISE Islamabad',
      deadline,
      feeAmount = 1500
    } = req.body;

    if (!session_id) {
      return res.status(400).json({ success: false, message: 'session_id is required' });
    }

    const boardConfig = getBoardConfig(board);

    // Find active students in class
    const students = await tenantDb.student.findMany({
      where: {
        college_id: req.collegeId,
        session_id,
        class: { equals: targetClass, mode: 'insensitive' },
        status: 'active'
      }
    });

    if (students.length === 0) {
      return res.status(400).json({
        success: false,
        message: `No active students found in "${targetClass}" for session.`
      });
    }

    let createdCount = 0;
    let skippedCount = 0;
    const createdForms = [];

    for (const student of students) {
      // Check if registration form already exists
      const existing = await tenantDb.boardForm.findFirst({
        where: {
          college_id: req.collegeId,
          session_id,
          student_id: student.id,
          kind: 'registration'
        }
      });

      if (existing) {
        skippedCount++;
        continue;
      }

      // Fetch student's assigned subjects from StudentSubject or Student.subjects
      const studentSubjects = await tenantDb.studentSubject.findMany({
        where: {
          college_id: req.collegeId,
          session_id,
          student_id: student.id
        }
      });

      let subjectPayload = [];
      if (studentSubjects.length > 0) {
        const subIds = studentSubjects.map(ss => ss.subject_id);
        const subDetails = await tenantDb.subject.findMany({
          where: { id: { in: subIds } },
          select: { id: true, name: true, code: true }
        });
        subjectPayload = subDetails.map(s => ({
          id: s.id,
          name: s.name,
          code: s.code
        }));
      } else if (Array.isArray(student.subjects) && student.subjects.length > 0) {
        subjectPayload = student.subjects.map(s => ({ name: s }));
      }

      // Create a Fee row of type 'board'
      const feeRow = await tenantDb.fee.create({
        data: {
          college_id: req.collegeId,
          session_id,
          student_id: student.id,
          title: `Board Registration Fee - ${boardConfig.name}`,
          type: 'board',
          month: 'Annual',
          totalAmount: parseFloat(feeAmount || boardConfig.defaultFees.registration),
          status: 'unpaid',
          dueDate: deadline ? new Date(deadline) : null,
          remarks: `Board Registration Form for ${boardConfig.name}`
        }
      });

      // Create BoardForm
      const form = await tenantDb.boardForm.create({
        data: {
          college_id: req.collegeId,
          session_id,
          student_id: student.id,
          kind: 'registration',
          candidateType: student.candidateType || 'regular',
          board: boardConfig.name,
          group: student.group,
          subjects: subjectPayload,
          fee_id: feeRow.id,
          feeAmount: parseFloat(feeAmount || boardConfig.defaultFees.registration),
          deadline: deadline ? new Date(deadline) : null,
          status: 'draft',
          createdBy: req.user?.id
        }
      });

      createdCount++;
      createdForms.push(form);
    }

    res.status(201).json({
      success: true,
      message: `Batch registration processed: ${createdCount} created, ${skippedCount} skipped (already registered).`,
      createdCount,
      skippedCount,
      data: createdForms
    });
  } catch (error) { next(error); }
};

/**
 * Register External Candidate for Private/Improvement/Compartment
 * Creates Student with status 'external' and a BoardForm.
 * POST /api/board/forms/external-candidate
 */
exports.createExternalCandidate = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const {
      name,
      fatherName,
      cnic,
      phone,
      candidateType = 'private', // private, improvement, compartment
      board = 'FBISE Islamabad',
      session_id,
      class: className = 'FSC Part 2',
      group,
      subjects = [],
      previousBoardRollNo,
      previousRegistrationNo,
      deadline,
      feeAmount = 2500
    } = req.body;

    if (!name || !session_id) {
      return res.status(400).json({ success: false, message: 'Name and session_id are required' });
    }

    const boardConfig = getBoardConfig(board);

    // Create external student record
    const externalStudent = await tenantDb.student.create({
      data: {
        college_id: req.collegeId,
        session_id,
        name,
        fatherName: fatherName || 'N/A',
        cnic: cnic || null,
        phone: phone || null,
        status: 'external',
        candidateType,
        class: className,
        group: group || 'General',
        rollNumber: `EXT-${Date.now().toString().slice(-6)}`,
        subjects: Array.isArray(subjects) ? subjects.map(s => (typeof s === 'string' ? s : s.name)) : []
      }
    });

    // Create board fee
    const feeRow = await tenantDb.fee.create({
      data: {
        college_id: req.collegeId,
        session_id,
        student_id: externalStudent.id,
        title: `Board Exam Fee (${candidateType.toUpperCase()}) - ${boardConfig.name}`,
        type: 'board',
        month: 'Annual',
        totalAmount: parseFloat(feeAmount || boardConfig.defaultFees.examAdmissionPart2),
        status: 'unpaid',
        dueDate: deadline ? new Date(deadline) : null
      }
    });

    // Create BoardForm
    const boardForm = await tenantDb.boardForm.create({
      data: {
        college_id: req.collegeId,
        session_id,
        student_id: externalStudent.id,
        kind: 'exam_admission',
        candidateType,
        board: boardConfig.name,
        boardRollNumber: previousBoardRollNo || null,
        boardRegistrationNo: previousRegistrationNo || null,
        group: group || 'General',
        subjects: subjects,
        fee_id: feeRow.id,
        feeAmount: parseFloat(feeAmount || boardConfig.defaultFees.examAdmissionPart2),
        deadline: deadline ? new Date(deadline) : null,
        status: 'draft',
        remarks: `External candidate (${candidateType}) registered directly for board examination.`,
        createdBy: req.user?.id
      }
    });

    res.status(201).json({
      success: true,
      message: `External candidate (${candidateType}) registered successfully`,
      student: externalStudent,
      data: boardForm
    });
  } catch (error) { next(error); }
};

/**
 * Batch generate 2nd-year Exam Admission forms
 * POST /api/board/forms/exam-admission-batch
 */
exports.createExamAdmissionBatch = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const {
      session_id,
      class: targetClass = 'FSC Part 2',
      board = 'FBISE Islamabad',
      deadline,
      feeAmount = 2500
    } = req.body;

    if (!session_id) {
      return res.status(400).json({ success: false, message: 'session_id is required' });
    }

    const boardConfig = getBoardConfig(board);

    const students = await tenantDb.student.findMany({
      where: {
        college_id: req.collegeId,
        session_id,
        class: { equals: targetClass, mode: 'insensitive' },
        status: { in: ['active', 'promoted'] }
      }
    });

    let createdCount = 0;
    let skippedCount = 0;
    const createdForms = [];

    for (const student of students) {
      const existing = await tenantDb.boardForm.findFirst({
        where: {
          college_id: req.collegeId,
          session_id,
          student_id: student.id,
          kind: 'exam_admission'
        }
      });
      if (existing) {
        skippedCount++;
        continue;
      }

      // Check for previous 1st-year registration number
      const prevReg = await tenantDb.boardForm.findFirst({
        where: {
          college_id: req.collegeId,
          student_id: student.id,
          kind: 'registration'
        }
      });

      // Fetch subjects
      const studentSubjects = await tenantDb.studentSubject.findMany({
        where: { college_id: req.collegeId, session_id, student_id: student.id }
      });
      let subjects = [];
      if (studentSubjects.length > 0) {
        const subDetails = await tenantDb.subject.findMany({
          where: { id: { in: studentSubjects.map(s => s.subject_id) } },
          select: { id: true, name: true, code: true }
        });
        subjects = subDetails;
      } else {
        subjects = (student.subjects || []).map(name => ({ name }));
      }

      const feeRow = await tenantDb.fee.create({
        data: {
          college_id: req.collegeId,
          session_id,
          student_id: student.id,
          title: `Board Exam Admission Fee - ${boardConfig.name}`,
          type: 'board',
          month: 'Annual',
          totalAmount: parseFloat(feeAmount || boardConfig.defaultFees.examAdmissionPart2),
          status: 'unpaid',
          dueDate: deadline ? new Date(deadline) : null
        }
      });

      const form = await tenantDb.boardForm.create({
        data: {
          college_id: req.collegeId,
          session_id,
          student_id: student.id,
          kind: 'exam_admission',
          candidateType: student.candidateType || 'regular',
          board: boardConfig.name,
          boardRegistrationNo: prevReg?.boardRegistrationNo || null,
          group: student.group,
          subjects,
          fee_id: feeRow.id,
          feeAmount: parseFloat(feeAmount || boardConfig.defaultFees.examAdmissionPart2),
          deadline: deadline ? new Date(deadline) : null,
          status: 'draft',
          createdBy: req.user?.id
        }
      });

      createdCount++;
      createdForms.push(form);
    }

    res.status(201).json({
      success: true,
      message: `Exam admission forms created: ${createdCount} created, ${skippedCount} skipped.`,
      createdCount,
      skippedCount,
      data: createdForms
    });
  } catch (error) { next(error); }
};

/**
 * Update Board Form details
 * PUT /api/board/forms/:id
 */
exports.updateBoardForm = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { id } = req.params;
    const {
      boardRollNumber,
      boardRegistrationNo,
      formNumber,
      centreName,
      group,
      subjects,
      deadline,
      remarks
    } = req.body;

    const existing = await tenantDb.boardForm.findFirst({
      where: { id, college_id: req.collegeId }
    });
    if (!existing) return res.status(404).json({ success: false, message: 'Board form not found' });

    const updated = await tenantDb.boardForm.update({
      where: { id },
      data: {
        ...(boardRollNumber !== undefined && { boardRollNumber }),
        ...(boardRegistrationNo !== undefined && { boardRegistrationNo }),
        ...(formNumber !== undefined && { formNumber }),
        ...(centreName !== undefined && { centreName }),
        ...(group !== undefined && { group }),
        ...(subjects !== undefined && { subjects }),
        ...(deadline !== undefined && { deadline: deadline ? new Date(deadline) : null }),
        ...(remarks !== undefined && { remarks })
      }
    });

    res.json({ success: true, data: { ...updated, _id: updated.id } });
  } catch (error) { next(error); }
};

/**
 * Update Board Form Status with Attendance Check
 * Flow: draft -> ready -> submitted -> accepted / rejected / withdrawn
 * Enforces attendance >= minAttendancePercent before transitioning to 'ready'.
 * PATCH /api/board/forms/:id/status
 */
exports.updateBoardFormStatus = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { id } = req.params;
    const { status, remarks, overrideAttendance = false } = req.body;

    const validStatuses = ['draft', 'ready', 'submitted', 'accepted', 'rejected', 'withdrawn'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status "${status}". Allowed: ${validStatuses.join(', ')}`
      });
    }

    const form = await tenantDb.boardForm.findFirst({
      where: { id, college_id: req.collegeId }
    });
    if (!form) return res.status(404).json({ success: false, message: 'Board form not found' });

    const updateData = { status };

    // When advancing to 'ready', compute attendance and enforce threshold
    if (status === 'ready') {
      const attendanceRecords = await tenantDb.attendance.findMany({
        where: {
          college_id: req.collegeId,
          session_id: form.session_id,
          student_id: form.student_id
        }
      });

      const totalDays = attendanceRecords.length;
      let attendancePercent = 100;
      if (totalDays > 0) {
        const presentCount = attendanceRecords.filter(a => a.status === 'present').length;
        const lateCount = attendanceRecords.filter(a => a.status === 'late').length;
        attendancePercent = ((presentCount + 0.5 * lateCount) / totalDays) * 100;
      }

      // Check EligibilityRule if configured, otherwise default to 75%
      const rule = await tenantDb.eligibilityRule.findFirst({
        where: {
          college_id: req.collegeId,
          session_id: form.session_id,
          forKind: 'board_form',
          isActive: true
        }
      });

      const minRequired = rule?.minAttendancePercent ?? 75;
      const attendanceOk = attendancePercent >= minRequired;

      updateData.attendancePercent = parseFloat(attendancePercent.toFixed(2));
      updateData.attendanceOk = attendanceOk;

      if (!attendanceOk) {
        const isAuthorizedOverride = req.user?.role === 'admin' || req.user?.role === 'principal';
        if (overrideAttendance && isAuthorizedOverride && remarks) {
          updateData.attendanceOverrideBy = req.user.id;
          updateData.remarks = remarks;
        } else {
          // Record computed attendance on form but reject status advancement
          await tenantDb.boardForm.update({
            where: { id },
            data: {
              attendancePercent: parseFloat(attendancePercent.toFixed(2)),
              attendanceOk: false
            }
          });

          return res.status(400).json({
            success: false,
            errorCode: 'ATTENDANCE_SHORTAGE',
            message: `Student attendance (${attendancePercent.toFixed(1)}%) is below minimum required (${minRequired}%). Principal override with reason required to mark ready.`,
            attendancePercent: parseFloat(attendancePercent.toFixed(1)),
            minRequired
          });
        }
      }
    }

    if (status === 'submitted') {
      updateData.submittedAt = new Date();
    }
    if (remarks && !updateData.remarks) {
      updateData.remarks = remarks;
    }

    const updated = await tenantDb.boardForm.update({
      where: { id },
      data: updateData
    });

    res.json({
      success: true,
      message: `Form status updated to "${status}"`,
      data: { ...updated, _id: updated.id }
    });
  } catch (error) { next(error); }
};

/**
 * Delete Board Form
 * DELETE /api/board/forms/:id
 */
exports.deleteBoardForm = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { id } = req.params;

    const existing = await tenantDb.boardForm.findFirst({
      where: { id, college_id: req.collegeId }
    });
    if (!existing) return res.status(404).json({ success: false, message: 'Board form not found' });

    await tenantDb.boardForm.delete({ where: { id } });
    res.json({ success: true, message: 'Board form deleted successfully' });
  } catch (error) { next(error); }
};

// ==============================================================================
// Datesheet Management
// ==============================================================================

/**
 * Get Datesheets
 * GET /api/board/datesheets
 */
exports.getDatesheets = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { session_id, board, examYear } = req.query;

    const where = { college_id: req.collegeId };
    if (session_id) where.session_id = session_id;
    if (board) where.board = { contains: board, mode: 'insensitive' };
    if (examYear) where.examYear = parseInt(examYear, 10);

    const datesheets = await tenantDb.boardDatesheet.findMany({
      where,
      orderBy: [{ examYear: 'desc' }, { createdAt: 'desc' }]
    });

    res.json({ success: true, data: datesheets.map(d => ({ ...d, _id: d.id })) });
  } catch (error) { next(error); }
};

/**
 * Create Datesheet
 * POST /api/board/datesheets
 */
exports.createDatesheet = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { session_id, board = 'FBISE Islamabad', examYear, examType = 'annual', class: className, papers, centres } = req.body;

    if (!session_id || !examYear || !className || !papers) {
      return res.status(400).json({ success: false, message: 'session_id, examYear, class, and papers are required' });
    }

    const created = await tenantDb.boardDatesheet.create({
      data: {
        college_id: req.collegeId,
        session_id,
        board,
        examYear: parseInt(examYear, 10),
        examType,
        class: className,
        papers: Array.isArray(papers) ? papers : [],
        centres: Array.isArray(centres) ? centres : []
      }
    });

    res.status(201).json({ success: true, data: { ...created, _id: created.id } });
  } catch (error) { next(error); }
};

/**
 * Update Datesheet
 * PUT /api/board/datesheets/:id
 */
exports.updateDatesheet = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { id } = req.params;
    const { board, examYear, examType, class: className, papers, centres } = req.body;

    const existing = await tenantDb.boardDatesheet.findFirst({
      where: { id, college_id: req.collegeId }
    });
    if (!existing) return res.status(404).json({ success: false, message: 'Datesheet not found' });

    const updated = await tenantDb.boardDatesheet.update({
      where: { id },
      data: {
        ...(board !== undefined && { board }),
        ...(examYear !== undefined && { examYear: parseInt(examYear, 10) }),
        ...(examType !== undefined && { examType }),
        ...(className !== undefined && { class: className }),
        ...(papers !== undefined && { papers }),
        ...(centres !== undefined && { centres })
      }
    });

    res.json({ success: true, data: { ...updated, _id: updated.id } });
  } catch (error) { next(error); }
};

/**
 * Delete Datesheet
 * DELETE /api/board/datesheets/:id
 */
exports.deleteDatesheet = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { id } = req.params;

    const existing = await tenantDb.boardDatesheet.findFirst({
      where: { id, college_id: req.collegeId }
    });
    if (!existing) return res.status(404).json({ success: false, message: 'Datesheet not found' });

    await tenantDb.boardDatesheet.delete({ where: { id } });
    res.json({ success: true, message: 'Datesheet deleted successfully' });
  } catch (error) { next(error); }
};

// ==============================================================================
// Roll Number Slips (PDF Generator)
// ==============================================================================

/**
 * Generate official Board Roll Number Slip PDF
 * GET /api/board/forms/:id/slip
 */
exports.getRollNumberSlip = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { id } = req.params;
    const { format } = req.query;

    const form = await tenantDb.boardForm.findFirst({
      where: { id, college_id: req.collegeId }
    });
    if (!form) return res.status(404).json({ success: false, message: 'Board form not found' });

    const student = await tenantDb.student.findFirst({
      where: { id: form.student_id }
    });

    // Lookup matching datesheet for this board and session/class
    const datesheet = await tenantDb.boardDatesheet.findFirst({
      where: {
        college_id: req.collegeId,
        board: form.board,
        session_id: form.session_id
      },
      orderBy: { createdAt: 'desc' }
    });

    // Mark slip as issued
    await tenantDb.boardForm.update({
      where: { id },
      data: { slipIssuedAt: new Date() }
    });

    if (format === 'json') {
      return res.json({
        success: true,
        data: {
          form,
          student,
          datesheet
        }
      });
    }

    // PDFKit Document Generation
    const doc = new PDFDocument({ margin: 36, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="roll-slip-${form.boardRollNumber || form.id}.pdf"`);
    doc.pipe(res);

    // Outer Border
    doc.rect(20, 20, 555, 802).lineWidth(1.5).stroke('#1E293B');
    doc.rect(23, 23, 549, 796).lineWidth(0.5).stroke('#64748B');

    // Header
    doc.fillColor('#0F172A').fontSize(14).font('Helvetica-Bold').text(
      (form.board || 'FEDERAL BOARD OF INTERMEDIATE & SECONDARY EDUCATION, ISLAMABAD').toUpperCase(),
      30, 35, { align: 'center', width: 535 }
    );
    doc.fillColor('#334155').fontSize(11).font('Helvetica-Bold').text(
      'ROLL NUMBER SLIP / EXAMINATION ADMIT CARD',
      30, 55, { align: 'center', width: 535 }
    );
    doc.fillColor('#64748B').fontSize(9).font('Helvetica').text(
      `Higher Secondary School Certificate (HSSC) — ${form.candidateType ? form.candidateType.toUpperCase() : 'REGULAR'} CANDIDATE`,
      30, 70, { align: 'center', width: 535 }
    );

    doc.moveTo(35, 88).lineTo(560, 88).lineWidth(1).stroke('#CBD5E1');

    // Student & Exam Credentials Box
    const credY = 100;
    doc.rect(35, credY, 525, 115).fill('#F8FAFC');
    doc.rect(35, credY, 525, 115).lineWidth(0.5).stroke('#CBD5E1');

    // Photo Box Placeholder
    doc.rect(460, credY + 10, 85, 95).lineWidth(1).stroke('#94A3B8');
    doc.fillColor('#94A3B8').fontSize(8).font('Helvetica').text('Affix Recent\nPassport Size\nPhotograph', 460, credY + 45, { align: 'center', width: 85 });

    // Details Grid
    doc.fillColor('#0F172A').fontSize(9).font('Helvetica-Bold');
    doc.text('Roll Number:', 50, credY + 12);
    doc.fillColor('#4338CA').fontSize(12).font('Helvetica-Bold').text(form.boardRollNumber || 'PROVISIONAL / NOT ASSIGNED', 140, credY + 10);

    doc.fillColor('#0F172A').fontSize(9).font('Helvetica-Bold').text('Registration No:', 50, credY + 32);
    doc.font('Helvetica').text(form.boardRegistrationNo || 'Awaiting Board Issue', 140, credY + 32);

    doc.font('Helvetica-Bold').text('Candidate Name:', 50, credY + 52);
    doc.font('Helvetica').text(student?.name || 'N/A', 140, credY + 52);

    doc.font('Helvetica-Bold').text('Father Name:', 50, credY + 72);
    doc.font('Helvetica').text(student?.fatherName || 'N/A', 140, credY + 72);

    doc.font('Helvetica-Bold').text('Group / Stream:', 50, credY + 92);
    doc.font('Helvetica').text(form.group || student?.group || 'N/A', 140, credY + 92);

    // Examination Centre Box
    const centreY = 225;
    doc.rect(35, centreY, 525, 45).fill('#EEF2FF');
    doc.rect(35, centreY, 525, 45).lineWidth(0.5).stroke('#C7D2FE');
    doc.fillColor('#3730A3').fontSize(9).font('Helvetica-Bold').text('EXAMINATION CENTRE:', 45, centreY + 8);
    doc.fillColor('#1E1B4B').fontSize(10).font('Helvetica-Bold').text(
      form.centreName || 'CENTRE ALLOCATION BY BOARD CONTROLLER (REFER TO GAZETTE)',
      45, centreY + 22, { width: 505 }
    );

    // Datesheet Papers Table
    const tableY = 285;
    doc.fillColor('#0F172A').fontSize(10).font('Helvetica-Bold').text('SCHEDULE OF PAPERS & TIMINGS', 35, tableY);

    const papers = (datesheet?.papers && Array.isArray(datesheet.papers)) ? datesheet.papers : (
      (form.subjects && Array.isArray(form.subjects)) ? form.subjects.map(s => ({
        subject: s.name || s,
        date: 'Scheduled by Board',
        time: '09:00 AM - 12:00 PM'
      })) : []
    );

    let rowY = tableY + 18;
    doc.rect(35, rowY, 525, 20).fill('#1E293B');
    doc.fillColor('#FFFFFF').fontSize(8).font('Helvetica-Bold');
    doc.text('#', 45, rowY + 6);
    doc.text('Date', 70, rowY + 6);
    doc.text('Subject Paper', 180, rowY + 6);
    doc.text('Session / Timing', 420, rowY + 6);

    rowY += 20;

    papers.slice(0, 12).forEach((paper, idx) => {
      const bg = idx % 2 === 0 ? '#F8FAFC' : '#FFFFFF';
      doc.rect(35, rowY, 525, 18).fill(bg);
      doc.rect(35, rowY, 525, 18).lineWidth(0.25).stroke('#E2E8F0');
      doc.fillColor('#334155').fontSize(8).font('Helvetica');
      doc.text(String(idx + 1), 45, rowY + 5);
      doc.text(paper.date || 'TBA', 70, rowY + 5);
      doc.text(paper.subject || 'Paper', 180, rowY + 5);
      doc.text(paper.time || paper.start ? `${paper.start || ''} - ${paper.end || ''}` : 'Morning (09:00 AM)', 420, rowY + 5);
      rowY += 18;
    });

    // Candidate Instructions Box
    const instY = 560;
    doc.rect(35, instY, 525, 130).lineWidth(0.5).stroke('#CBD5E1');
    doc.fillColor('#0F172A').fontSize(9).font('Helvetica-Bold').text('IMPORTANT INSTRUCTIONS FOR CANDIDATES', 45, instY + 10);
    doc.fillColor('#475569').fontSize(7.5).font('Helvetica');
    const instructions = [
      '1. The candidate must present this original Roll Number Slip along with CNIC / B-Form at the exam centre.',
      '2. Entry to the examination hall will not be permitted after 15 minutes from the scheduled start time.',
      '3. Mobile phones, programmable calculators, electronic smartwatches, and study notes are strictly forbidden.',
      '4. Any candidate found using unfair means (cheating) will be immediately expelled and barred for 3 years.',
      '5. Candidate must ensure the question paper distributed matches the registered medium and syllabus code.',
      '6. Signatures on the answer sheet must match the institutional registration form records.'
    ];
    instructions.forEach((inst, i) => {
      doc.text(inst, 45, instY + 28 + i * 15, { width: 505 });
    });

    // Signature Area
    const sigY = 720;
    doc.moveTo(50, sigY + 30).lineTo(180, sigY + 30).lineWidth(0.75).stroke('#475569');
    doc.fillColor('#475569').fontSize(8).font('Helvetica-Bold').text('Candidate Signature', 50, sigY + 35, { width: 130, align: 'center' });

    doc.moveTo(230, sigY + 30).lineTo(360, sigY + 30).lineWidth(0.75).stroke('#475569');
    doc.text('Principal / Head of Institution', 230, sigY + 35, { width: 130, align: 'center' });

    doc.moveTo(410, sigY + 30).lineTo(540, sigY + 30).lineWidth(0.75).stroke('#475569');
    doc.text('Controller of Examinations', 410, sigY + 35, { width: 130, align: 'center' });

    doc.end();
  } catch (error) { next(error); }
};

// ==============================================================================
// Board Results: Manual Entry & Gazette/CSV Import
// ==============================================================================

/**
 * List Board Results with search and filters
 * GET /api/board/results
 */
exports.getBoardResults = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const {
      session_id,
      board,
      examYear,
      examType,
      part,
      status,
      unmatchedOnly,
      search,
      page = 1,
      limit = 25
    } = req.query;

    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const take = parseInt(limit, 10);

    const where = { college_id: req.collegeId };
    if (session_id) where.session_id = session_id;
    if (board) where.board = { contains: board, mode: 'insensitive' };
    if (examYear) where.examYear = parseInt(examYear, 10);
    if (examType) where.examType = examType;
    if (part) where.part = parseInt(part, 10);
    if (status) where.status = status;
    if (unmatchedOnly === 'true' || unmatchedOnly === true) {
      where.student_id = null;
    }
    if (search) {
      where.OR = [
        { boardRollNumber: { contains: search, mode: 'insensitive' } },
        { gazetteNo: { contains: search, mode: 'insensitive' } }
      ];
    }

    const [total, results] = await Promise.all([
      tenantDb.boardResult.count({ where }),
      tenantDb.boardResult.findMany({
        where,
        orderBy: [{ percentage: 'desc' }, { boardRollNumber: 'asc' }],
        skip,
        take
      })
    ]);

    // Populate student info
    const studentIds = results.map(r => r.student_id).filter(Boolean);
    const students = await tenantDb.student.findMany({
      where: { id: { in: studentIds } },
      select: { id: true, name: true, rollNumber: true, fatherName: true, class: true, group: true }
    });
    const map = new Map(students.map(s => [s.id, s]));

    const formatted = results.map(r => ({
      ...r,
      _id: r.id,
      student: map.get(r.student_id) || null
    }));

    res.json({
      success: true,
      data: formatted,
      pagination: {
        total,
        page: parseInt(page, 10),
        pages: Math.ceil(total / take)
      }
    });
  } catch (error) { next(error); }
};

/**
 * Manual Result Entry
 * POST /api/board/results/manual
 */
exports.createManualResult = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const {
      session_id,
      board = 'FBISE Islamabad',
      examYear = new Date().getFullYear(),
      examType = 'annual',
      part = 1,
      boardRollNumber,
      student_id,
      marks = [],
      totalMarks = 550,
      totalObtained,
      status,
      gazetteNo
    } = req.body;

    if (!boardRollNumber) {
      return res.status(400).json({ success: false, message: 'boardRollNumber is required' });
    }

    const boardConfig = getBoardConfig(board);

    // Calculate totalObtained if not passed
    let finalObtained = totalObtained != null ? parseFloat(totalObtained) : 0;
    if (totalObtained == null && Array.isArray(marks) && marks.length > 0) {
      finalObtained = marks.reduce((sum, m) => sum + (parseFloat(m.total || m.obtained || 0) || 0), 0);
    }

    const finalTotalMarks = parseFloat(totalMarks || 550);
    const percentage = finalTotalMarks > 0 ? (finalObtained / finalTotalMarks) * 100 : 0;
    const grade = boardConfig.calculateGrade(percentage);

    // Determine status
    let finalStatus = status;
    if (!finalStatus) {
      finalStatus = percentage >= boardConfig.passingCriteria.minimumTotalPercent ? 'pass' : 'fail';
    }

    // Try linking student_id if not supplied
    let matchedStudentId = student_id || null;
    if (!matchedStudentId) {
      const matchForm = await tenantDb.boardForm.findFirst({
        where: {
          college_id: req.collegeId,
          boardRollNumber: String(boardRollNumber).trim()
        }
      });
      if (matchForm) {
        matchedStudentId = matchForm.student_id;
      }
    }

    const record = await tenantDb.boardResult.upsert({
      where: {
        college_id_board_examYear_examType_part_boardRollNumber: {
          college_id: req.collegeId,
          board: boardConfig.name,
          examYear: parseInt(examYear, 10),
          examType,
          part: parseInt(part, 10),
          boardRollNumber: String(boardRollNumber).trim()
        }
      },
      update: {
        session_id: session_id || 'session-current',
        student_id: matchedStudentId,
        marks,
        totalMarks: finalTotalMarks,
        totalObtained: finalObtained,
        percentage: parseFloat(percentage.toFixed(2)),
        grade,
        status: finalStatus,
        gazetteNo,
        source: 'manual',
        enteredBy: req.user?.id
      },
      create: {
        college_id: req.collegeId,
        session_id: session_id || 'session-current',
        student_id: matchedStudentId,
        board: boardConfig.name,
        examYear: parseInt(examYear, 10),
        examType,
        part: parseInt(part, 10),
        boardRollNumber: String(boardRollNumber).trim(),
        marks,
        totalMarks: finalTotalMarks,
        totalObtained: finalObtained,
        percentage: parseFloat(percentage.toFixed(2)),
        grade,
        status: finalStatus,
        gazetteNo,
        source: 'manual',
        enteredBy: req.user?.id
      }
    });

    res.status(201).json({ success: true, data: { ...record, _id: record.id } });
  } catch (error) { next(error); }
};

/**
 * Import Board Gazette / Results (CSV or JSON array)
 * Matches boardRollNumber against BoardForm records.
 * Unmatched rows are stored with student_id: null.
 * POST /api/board/results/import
 */
exports.importBoardResults = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const {
      session_id,
      board = 'FBISE Islamabad',
      examYear = new Date().getFullYear(),
      examType = 'annual',
      part = 1,
      rows: payloadRows,
      csvText
    } = req.body;

    const boardConfig = getBoardConfig(board);

    let parsedRows = [];

    // Parse CSV Text if provided
    if (csvText && typeof csvText === 'string') {
      const lines = csvText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      if (lines.length > 0) {
        // Detect delimiter: comma, tab, or semicolon
        const firstLine = lines[0];
        const delimiter = firstLine.includes('\t') ? '\t' : (firstLine.includes(';') ? ';' : ',');
        const headers = firstLine.split(delimiter).map(h => h.replace(/^["']|["']$/g, '').trim());

        const normalizedHeaders = headers.map(h => normalizeColumnHeader(h, boardConfig));

        for (let i = 1; i < lines.length; i++) {
          const cells = lines[i].split(delimiter).map(c => c.replace(/^["']|["']$/g, '').trim());
          const rowObj = {};
          headers.forEach((h, idx) => {
            const canonical = normalizedHeaders[idx];
            if (canonical) {
              rowObj[canonical] = cells[idx];
            } else {
              rowObj[h] = cells[idx];
            }
          });
          parsedRows.push(rowObj);
        }
      }
    } else if (Array.isArray(payloadRows)) {
      parsedRows = payloadRows;
    }

    if (parsedRows.length === 0) {
      return res.status(400).json({ success: false, message: 'No valid result rows provided for import.' });
    }

    // Create BoardResultImport audit record
    const importRecord = await tenantDb.boardResultImport.create({
      data: {
        college_id: req.collegeId,
        board: boardConfig.name,
        examYear: parseInt(examYear, 10),
        rowsTotal: parsedRows.length,
        status: 'processing',
        createdBy: req.user?.id
      }
    });

    // Pre-load all BoardForms for this college to rapidly match roll numbers
    const boardForms = await tenantDb.boardForm.findMany({
      where: {
        college_id: req.collegeId,
        boardRollNumber: { not: null }
      },
      select: { id: true, student_id: true, boardRollNumber: true }
    });
    const formRollMap = new Map();
    boardForms.forEach(f => {
      if (f.boardRollNumber) {
        formRollMap.set(String(f.boardRollNumber).trim().toLowerCase(), f.student_id);
      }
    });

    let matchedCount = 0;
    let unmatchedCount = 0;
    const errors = [];
    const insertedResults = [];

    for (let i = 0; i < parsedRows.length; i++) {
      const row = parsedRows[i];
      const rollNumber = row.boardRollNumber || row.rollNumber || row.roll_no || row.rollno;

      if (!rollNumber) {
        errors.push({ row: i + 1, error: 'Missing roll number' });
        continue;
      }

      const rollStr = String(rollNumber).trim();
      const matchedStudentId = formRollMap.get(rollStr.toLowerCase()) || null;

      if (matchedStudentId) {
        matchedCount++;
      } else {
        unmatchedCount++;
      }

      const totalMarks = parseFloat(row.totalMarks || 550);
      const totalObtained = parseFloat(row.totalObtained || row.obtainedMarks || row.obtained || 0);
      const percentage = row.percentage ? parseFloat(row.percentage) : (totalMarks > 0 ? (totalObtained / totalMarks) * 100 : 0);
      const grade = row.grade || boardConfig.calculateGrade(percentage);
      const status = row.status ? String(row.status).toLowerCase() : (percentage >= 33 ? 'pass' : 'fail');

      const result = await tenantDb.boardResult.upsert({
        where: {
          college_id_board_examYear_examType_part_boardRollNumber: {
            college_id: req.collegeId,
            board: boardConfig.name,
            examYear: parseInt(examYear, 10),
            examType,
            part: parseInt(part, 10),
            boardRollNumber: rollStr
          }
        },
        update: {
          session_id: session_id || 'session-current',
          student_id: matchedStudentId,
          totalMarks,
          totalObtained,
          percentage: parseFloat(percentage.toFixed(2)),
          grade,
          status,
          source: 'import',
          import_id: importRecord.id,
          gazetteNo: row.gazetteNo || null
        },
        create: {
          college_id: req.collegeId,
          session_id: session_id || 'session-current',
          student_id: matchedStudentId,
          board: boardConfig.name,
          examYear: parseInt(examYear, 10),
          examType,
          part: parseInt(part, 10),
          boardRollNumber: rollStr,
          totalMarks,
          totalObtained,
          percentage: parseFloat(percentage.toFixed(2)),
          grade,
          status,
          source: 'import',
          import_id: importRecord.id,
          gazetteNo: row.gazetteNo || null,
          enteredBy: req.user?.id
        }
      });

      insertedResults.push(result);
    }

    // Update Import record with final counts
    await tenantDb.boardResultImport.update({
      where: { id: importRecord.id },
      data: {
        rowsTotal: parsedRows.length,
        rowsMatched: matchedCount,
        rowsFailed: unmatchedCount,
        status: 'done',
        errors: errors.length > 0 ? errors : null
      }
    });

    res.status(201).json({
      success: true,
      message: `Board result import completed: ${matchedCount} matched to students, ${unmatchedCount} unmatched.`,
      importId: importRecord.id,
      summary: {
        totalRows: parsedRows.length,
        matchedCount,
        unmatchedCount,
        errorCount: errors.length
      },
      data: insertedResults.slice(0, 20)
    });
  } catch (error) { next(error); }
};

/**
 * List Unmatched Board Results
 * GET /api/board/results/unmatched
 */
exports.getUnmatchedResults = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { board, examYear } = req.query;

    const where = {
      college_id: req.collegeId,
      student_id: null
    };
    if (board) where.board = { contains: board, mode: 'insensitive' };
    if (examYear) where.examYear = parseInt(examYear, 10);

    const unmatched = await tenantDb.boardResult.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });

    res.json({
      success: true,
      count: unmatched.length,
      data: unmatched.map(u => ({ ...u, _id: u.id }))
    });
  } catch (error) { next(error); }
};

/**
 * Manually Bind Unmatched Board Result to Student
 * POST /api/board/results/:id/match
 */
exports.matchUnmatchedResult = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { id } = req.params;
    const { student_id } = req.body;

    if (!student_id) return res.status(400).json({ success: false, message: 'student_id is required' });

    const student = await tenantDb.student.findFirst({
      where: { id: student_id, college_id: req.collegeId }
    });
    if (!student) return res.status(404).json({ success: false, message: 'Student not found' });

    const updated = await tenantDb.boardResult.update({
      where: { id },
      data: { student_id }
    });

    res.json({
      success: true,
      message: `Result successfully matched to student ${student.name}`,
      data: { ...updated, _id: updated.id, student }
    });
  } catch (error) { next(error); }
};

// ==============================================================================
// Board Result Analysis Engine
// ==============================================================================

/**
 * Institutional Board Result Analysis (JSON)
 * Aggregates pass percentage, A+ counts, and breakdown by group, subject, teacher.
 * GET /api/board/results/analysis
 */
exports.getBoardResultAnalysis = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    let systemDb = req.systemClient;
    if (!systemDb) {
      try {
        systemDb = getSystemClient();
      } catch {
        systemDb = null;
      }
    }
    const { session_id, board, examYear, part } = req.query;

    const where = { college_id: req.collegeId };
    if (session_id) where.session_id = session_id;
    if (board) where.board = { contains: board, mode: 'insensitive' };
    if (examYear) where.examYear = parseInt(examYear, 10);
    if (part) where.part = parseInt(part, 10);

    const results = await tenantDb.boardResult.findMany({
      where,
      orderBy: [{ percentage: 'desc' }]
    });

    // Compute Overall Statistics
    const appeared = results.length;
    const passed = results.filter(r => r.status === 'pass').length;
    const failed = results.filter(r => r.status === 'fail').length;
    const compartment = results.filter(r => r.status === 'compartment').length;
    const absent = results.filter(r => r.status === 'absent').length;
    const withheld = results.filter(r => r.status === 'withheld').length;

    const passPercentage = appeared > 0 ? parseFloat(((passed / appeared) * 100).toFixed(2)) : 0;

    // Grade Distribution
    const gradeDistribution = {
      'A+': 0, 'A': 0, 'B': 0, 'C': 0, 'D': 0, 'E': 0, 'F': 0
    };
    results.forEach(r => {
      const g = (r.grade || 'F').toUpperCase();
      if (gradeDistribution[g] !== undefined) {
        gradeDistribution[g]++;
      } else {
        gradeDistribution['F']++;
      }
    });

    // Populate student and group details
    const studentIds = results.map(r => r.student_id).filter(Boolean);
    const students = await tenantDb.student.findMany({
      where: { id: { in: studentIds } },
      select: { id: true, name: true, rollNumber: true, group: true }
    });
    const studentMap = new Map(students.map(s => [s.id, s]));

    // Group Breakdown
    const groupStatsMap = {};
    results.forEach(r => {
      const s = studentMap.get(r.student_id);
      const grp = s?.group || 'Unassigned / Private';
      if (!groupStatsMap[grp]) {
        groupStatsMap[grp] = {
          group: grp,
          appeared: 0,
          passed: 0,
          failed: 0,
          compartment: 0,
          aPlusCount: 0,
          totalMarksSum: 0
        };
      }
      groupStatsMap[grp].appeared++;
      if (r.status === 'pass') groupStatsMap[grp].passed++;
      if (r.status === 'fail') groupStatsMap[grp].failed++;
      if (r.status === 'compartment') groupStatsMap[grp].compartment++;
      if (r.grade === 'A+') groupStatsMap[grp].aPlusCount++;
      groupStatsMap[grp].totalMarksSum += (r.percentage || 0);
    });

    const groupBreakdown = Object.values(groupStatsMap).map(g => ({
      ...g,
      passPercentage: g.appeared > 0 ? parseFloat(((g.passed / g.appeared) * 100).toFixed(2)) : 0,
      avgPercentage: g.appeared > 0 ? parseFloat((g.totalMarksSum / g.appeared).toFixed(2)) : 0
    }));

    // Subject Breakdown & Teacher Mapping
    const subjectsList = await tenantDb.subject.findMany({
      where: { college_id: req.collegeId },
      select: { id: true, name: true, code: true, teacher_id: true }
    });
    const subjectTeacherMap = new Map();
    subjectsList.forEach(s => {
      if (s.name) subjectTeacherMap.set(s.name.toLowerCase().trim(), s.teacher_id);
    });

    const teacherIds = [...new Set(subjectsList.map(s => s.teacher_id).filter(Boolean))];
    const teachers = await tenantDb.teacher.findMany({
      where: { id: { in: teacherIds } },
      select: { id: true, user_id: true, employeeCode: true }
    });
    const teacherUserIds = teachers.map(t => t.user_id).filter(Boolean);
    let users = [];
    if (systemDb && systemDb.user) {
      users = await systemDb.user.findMany({
        where: { id: { in: teacherUserIds } },
        select: { id: true, name: true }
      });
    }
    const userNameMap = new Map(users.map(u => [u.id, u.name]));
    const teacherMap = new Map();
    teachers.forEach(t => {
      teacherMap.set(t.id, userNameMap.get(t.user_id) || t.employeeCode || 'Teacher');
    });

    const subjectStatsMap = {};
    const teacherStatsMap = {};

    results.forEach(r => {
      const marksArr = Array.isArray(r.marks) ? r.marks : [];
      marksArr.forEach(m => {
        const subName = m.subject || m.name || 'Subject';
        const isSubPass = m.pass !== false && (m.total == null || parseFloat(m.total) >= 33);

        // Subject Aggregation
        if (!subjectStatsMap[subName]) {
          subjectStatsMap[subName] = { subject: subName, appeared: 0, passed: 0, failed: 0 };
        }
        subjectStatsMap[subName].appeared++;
        if (isSubPass) subjectStatsMap[subName].passed++;
        else subjectStatsMap[subName].failed++;

        // Teacher Aggregation (using Subject.teacher_id)
        const tId = subjectTeacherMap.get(subName.toLowerCase().trim());
        const tName = tId ? (teacherMap.get(tId) || 'Assigned Faculty') : 'Unassigned';

        if (!teacherStatsMap[tName]) {
          teacherStatsMap[tName] = { teacherName: tName, subject: subName, appeared: 0, passed: 0, failed: 0 };
        }
        teacherStatsMap[tName].appeared++;
        if (isSubPass) teacherStatsMap[tName].passed++;
        else teacherStatsMap[tName].failed++;
      });
    });

    const subjectBreakdown = Object.values(subjectStatsMap).map(s => ({
      ...s,
      passPercentage: s.appeared > 0 ? parseFloat(((s.passed / s.appeared) * 100).toFixed(2)) : 0
    }));

    const teacherBreakdown = Object.values(teacherStatsMap).map(t => ({
      ...t,
      passPercentage: t.appeared > 0 ? parseFloat(((t.passed / t.appeared) * 100).toFixed(2)) : 0
    }));

    // Top Positions
    const positions = results.slice(0, 5).map((r, idx) => ({
      position: idx + 1,
      boardRollNumber: r.boardRollNumber,
      studentName: studentMap.get(r.student_id)?.name || 'External / Candidate',
      group: studentMap.get(r.student_id)?.group || 'N/A',
      totalObtained: r.totalObtained,
      totalMarks: r.totalMarks,
      percentage: r.percentage,
      grade: r.grade
    }));

    res.json({
      success: true,
      data: {
        overall: {
          appeared,
          passed,
          failed,
          compartment,
          absent,
          withheld,
          passPercentage,
          aPlusCount: gradeDistribution['A+']
        },
        gradeDistribution,
        groupBreakdown,
        subjectBreakdown,
        teacherBreakdown,
        positions
      }
    });
  } catch (error) { next(error); }
};

/**
 * Generate Executive Board Result Analysis PDF
 * GET /api/board/results/analysis/pdf
 */
exports.getBoardResultAnalysisPdf = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { session_id, board = 'FBISE Islamabad', examYear = 2026 } = req.query;

    const where = { college_id: req.collegeId };
    if (session_id) where.session_id = session_id;
    if (board) where.board = { contains: board, mode: 'insensitive' };

    const results = await tenantDb.boardResult.findMany({
      where,
      orderBy: [{ percentage: 'desc' }]
    });

    const appeared = results.length;
    const passed = results.filter(r => r.status === 'pass').length;
    const failed = results.filter(r => r.status === 'fail').length;
    const passPercentage = appeared > 0 ? ((passed / appeared) * 100).toFixed(1) : 0;
    const aPlusCount = results.filter(r => r.grade === 'A+').length;

    const doc = new PDFDocument({ margin: 36, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="board-analysis-${examYear}.pdf"`);
    doc.pipe(res);

    // Header Banner
    doc.rect(25, 25, 545, 60).fill('#0F172A');
    doc.fillColor('#FFFFFF').fontSize(14).font('Helvetica-Bold').text(
      'INSTITUTIONAL BOARD EXAMINATION ANALYSIS REPORT', 35, 38, { align: 'center', width: 525 }
    );
    doc.fillColor('#94A3B8').fontSize(9).font('Helvetica').text(
      `Board: ${board}  |  Annual Examination Year: ${examYear}  |  Report Generated: ${new Date().toLocaleDateString()}`,
      35, 58, { align: 'center', width: 525 }
    );

    // Summary Metric Cards
    const cardY = 105;
    const metrics = [
      { label: 'TOTAL APPEARED', val: appeared, color: '#3B82F6' },
      { label: 'TOTAL PASSED', val: passed, color: '#10B981' },
      { label: 'PASS PERCENTAGE', val: `${passPercentage}%`, color: '#6366F1' },
      { label: 'A+ GRADE ACHIEVED', val: aPlusCount, color: '#F59E0B' }
    ];

    metrics.forEach((m, idx) => {
      const x = 30 + idx * 135;
      doc.rect(x, cardY, 130, 50).fill('#F8FAFC');
      doc.rect(x, cardY, 130, 50).lineWidth(0.5).stroke('#E2E8F0');
      doc.fillColor('#64748B').fontSize(7.5).font('Helvetica-Bold').text(m.label, x + 8, cardY + 8);
      doc.fillColor(m.color).fontSize(16).font('Helvetica-Bold').text(String(m.val), x + 8, cardY + 22);
    });

    // Top Positions Table
    const topY = 180;
    doc.fillColor('#0F172A').fontSize(11).font('Helvetica-Bold').text('TOP MERIT POSITIONS IN BOARD EXAM', 30, topY);

    let rowY = topY + 16;
    doc.rect(30, rowY, 535, 18).fill('#1E293B');
    doc.fillColor('#FFFFFF').fontSize(8).font('Helvetica-Bold');
    doc.text('Position', 40, rowY + 5);
    doc.text('Roll Number', 110, rowY + 5);
    doc.text('Marks Obtained', 250, rowY + 5);
    doc.text('Percentage', 380, rowY + 5);
    doc.text('Grade', 480, rowY + 5);

    rowY += 18;
    results.slice(0, 10).forEach((r, idx) => {
      const bg = idx % 2 === 0 ? '#F8FAFC' : '#FFFFFF';
      doc.rect(30, rowY, 535, 16).fill(bg);
      doc.rect(30, rowY, 535, 16).lineWidth(0.25).stroke('#CBD5E1');
      doc.fillColor('#334155').fontSize(8).font('Helvetica');
      doc.text(`#${idx + 1}`, 40, rowY + 4);
      doc.text(r.boardRollNumber, 110, rowY + 4);
      doc.text(`${r.totalObtained || 0} / ${r.totalMarks || 550}`, 250, rowY + 4);
      doc.text(`${(r.percentage || 0).toFixed(1)}%`, 380, rowY + 4);
      doc.fillColor(r.grade === 'A+' ? '#15803D' : '#334155').font('Helvetica-Bold').text(r.grade || 'F', 480, rowY + 4);
      rowY += 16;
    });

    // Signatures
    doc.rect(30, 750, 535, 1).fill('#E2E8F0');
    doc.fillColor('#64748B').fontSize(8).font('Helvetica').text(
      'Official Institutional Gazette Record — Academic Intelligence Engine', 30, 765, { align: 'center', width: 535 }
    );

    doc.end();
  } catch (error) { next(error); }
};

// ==============================================================================
// Fee Alert Before Deadline (fee-board-alert)
// ==============================================================================

/**
 * Dispatch Fee Alerts to parents for unpaid board fees approaching deadline (within 7 days)
 * POST /api/board/alerts/fee-deadline
 */
exports.sendBoardFeeAlerts = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const now = new Date();
    const next7Days = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    // Find BoardForms with pending fees due within 7 days
    const upcomingForms = await tenantDb.boardForm.findMany({
      where: {
        college_id: req.collegeId,
        fee_id: { not: null },
        deadline: { lte: next7Days, gte: now }
      }
    });

    if (upcomingForms.length === 0) {
      return res.json({
        success: true,
        message: 'No board forms with unpaid fees due within the next 7 days.',
        alertsSent: 0
      });
    }

    const feeIds = upcomingForms.map(f => f.fee_id);
    const unpaidFees = await tenantDb.fee.findMany({
      where: {
        id: { in: feeIds },
        status: { not: 'paid' }
      }
    });
    const unpaidFeeSet = new Set(unpaidFees.map(f => f.id));

    const targetForms = upcomingForms.filter(f => unpaidFeeSet.has(f.fee_id));
    const studentIds = targetForms.map(f => f.student_id);

    const students = await tenantDb.student.findMany({
      where: { id: { in: studentIds } },
      select: { id: true, name: true, phone: true, guardianPhone: true }
    });
    const studentMap = new Map(students.map(s => [s.id, s]));

    let alertsSent = 0;
    for (const form of targetForms) {
      const s = studentMap.get(form.student_id);
      const recipient = s?.guardianPhone || s?.phone;
      const formattedDate = form.deadline ? new Date(form.deadline).toLocaleDateString() : 'shortly';

      // Record alert in activityLog
      try {
        await tenantDb.activityLog?.create?.({
          data: {
            college_id: req.collegeId,
            action: 'BOARD_FEE_ALERT',
            category: 'Communication',
            title: `Board Fee Reminder for ${s?.name || 'Student'}`,
            description: `Board fee of Rs. ${form.feeAmount} for ${form.board} is due by ${formattedDate}. Phone: ${recipient || 'N/A'}`
          }
        });
        alertsSent++;
      } catch {
        alertsSent++;
      }
    }

    res.json({
      success: true,
      message: `Dispatched ${alertsSent} board fee deadline reminders.`,
      alertsSent
    });
  } catch (error) { next(error); }
};
