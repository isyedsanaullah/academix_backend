const { getSystemClient } = require('../config/prismaManager');
const { generateCardId } = require('../utils/cardIdGenerator');

// Helper
const getCurrentSessionId = async (tenantDb, collegeId) => {
  const session = await tenantDb.session.findFirst({
    where: { college_id: collegeId, isCurrent: true }
  });
  return session?.id || null;
};

exports.getStudents = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { class: cls, section, group, section_id, status, search, session_id, page = 1, limit = 50 } = req.query;
    const where = { college_id: req.collegeId };

    // Use provided session or current session
    if (session_id) {
      where.session_id = session_id;
    } else {
      const currentSession = await getCurrentSessionId(tenantDb, req.collegeId);
      if (currentSession) where.session_id = currentSession;
    }

    if (cls) where.class = cls;
    if (section) where.section = section;
    if (group) where.group = group;
    if (section_id) where.section_id = section_id;
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { rollNumber: { contains: search, mode: 'insensitive' } },
        { fatherName: { contains: search, mode: 'insensitive' } }
      ];
    }

    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 50;
    const skipNum = (pageNum - 1) * limitNum;

    const total = await tenantDb.student.count({ where });
    const students = await tenantDb.student.findMany({
      where,
      orderBy: { rollNumber: 'asc' },
      skip: skipNum,
      take: limitNum
    });

    const formatted = students.map(s => ({
      ...s,
      _id: s.id
    }));

    res.json({
      success: true,
      data: formatted,
      pagination: {
        total,
        page: pageNum,
        pages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) { next(error); }
};

exports.getStudent = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const student = await tenantDb.student.findFirst({
      where: { id: req.params.id, college_id: req.collegeId }
    });
    if (!student) return res.status(404).json({ success: false, message: 'Student not found' });
    
    res.json({ success: true, data: { ...student, _id: student.id } });
  } catch (error) { next(error); }
};

exports.createStudent = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const tenantDb = req.tenantClient;
    const studentData = { ...req.body, college_id: req.collegeId };

    // Auto-assign current session if not provided
    if (!studentData.session_id) {
      const currentSession = await getCurrentSessionId(tenantDb, req.collegeId);
      if (currentSession) studentData.session_id = currentSession;
    }

    // Create user account if requested (in SYSTEM DB)
    if (req.body.createAccount && req.body.email) {
      const bcrypt = require('bcryptjs');
      const salt = await bcrypt.genSalt(12);
      const hashedPassword = await bcrypt.hash(req.body.password || 'student123', salt);

      const user = await prisma.user.create({
        data: {
          name: req.body.name,
          email: req.body.email.toLowerCase(),
          password: hashedPassword,
          role: 'student',
          college_id: req.collegeId,
          authProvider: 'local',
          isActive: true
        }
      });
      studentData.user_id = user.id;
    }

    // Process section_id & backwards-compatibility sync
    let sectionId = studentData.section_id;
    if (sectionId) {
      const sectionRecord = await tenantDb.section.findUnique({
        where: { id: sectionId }
      });
      if (!sectionRecord) {
        return res.status(404).json({ success: false, message: 'Selected section not found.' });
      }

      // Capacity Validation
      const capacity = sectionRecord.capacity || 40;
      const activeStudentCount = await tenantDb.student.count({
        where: {
          college_id: req.collegeId,
          section_id: sectionId,
          status: 'active'
        }
      });

      if (activeStudentCount >= capacity) {
        return res.status(400).json({
          success: false,
          message: `Section "${sectionRecord.code}" (${sectionRecord.name || 'No Name'}) is full. Capacity: ${capacity}, Enrolled: ${activeStudentCount}.`
        });
      }

      // Fetch class & group details
      const classRecord = await tenantDb.class.findUnique({
        where: { id: sectionRecord.class_id }
      });
      if (!classRecord) {
        return res.status(404).json({ success: false, message: 'Class/Part not found for this section.' });
      }

      let groupName = '';
      if (sectionRecord.group_id) {
        const groupRecord = await tenantDb.group.findUnique({
          where: { id: sectionRecord.group_id }
        });
        if (groupRecord) {
          groupName = groupRecord.name;
        }
      }

      studentData.section = sectionRecord.code;
      studentData.class = classRecord.name;
      studentData.group = groupName;
    } else if (studentData.class && studentData.section) {
      // Look up section_id from strings for backward compatibility
      const classRecord = await tenantDb.class.findFirst({
        where: { college_id: req.collegeId, name: studentData.class }
      });
      if (classRecord) {
        const groupRecord = studentData.group
          ? await tenantDb.group.findFirst({
              where: { college_id: req.collegeId, class_id: classRecord.id, name: studentData.group }
            })
          : null;

        const sectionRecord = await tenantDb.section.findFirst({
          where: {
            college_id: req.collegeId,
            class_id: classRecord.id,
            group_id: groupRecord ? groupRecord.id : null,
            code: studentData.section
          }
        });

        if (sectionRecord) {
          studentData.section_id = sectionRecord.id;
        }
      }
    }

    // Auto-generate Card ID & QR code if missing
    if (!studentData.qrCode || !studentData.rollNumber) {
      const generatedCardId = await generateCardId(tenantDb, req.collegeId, 'student');
      if (!studentData.qrCode) studentData.qrCode = generatedCardId;
      if (!studentData.rollNumber) studentData.rollNumber = generatedCardId;
      if (!studentData.cardId) studentData.cardId = generatedCardId;
    }

    // Convert types for Prisma
    if (studentData.dateOfBirth) studentData.dateOfBirth = new Date(studentData.dateOfBirth);
    if (studentData.admissionDate) studentData.admissionDate = new Date(studentData.admissionDate);
    if (studentData.canteenBalance) studentData.canteenBalance = parseFloat(studentData.canteenBalance);

    const allowedFields = [
      'college_id', 'session_id', 'user_id', 'name', 'fatherName', 'cnic',
      'dateOfBirth', 'gender', 'phone', 'email', 'address', 'guardianName',
      'guardianPhone', 'guardianRelation', 'guardianCnic', 'rollNumber',
      'registrationNumber', 'class', 'group', 'section', 'section_id', 'subjects',
      'admissionDate', 'biometricId', 'cardId', 'faceData', 'qrCode',
      'photo', 'documents', 'status', 'canteenBalance'
    ];
    const dataPayload = {};
    allowedFields.forEach(f => {
      if (studentData[f] !== undefined) {
        dataPayload[f] = studentData[f];
      }
    });

    const student = await tenantDb.student.create({
      data: dataPayload
    });

    res.status(201).json({ success: true, data: { ...student, _id: student.id } });
  } catch (error) { next(error); }
};

exports.updateStudent = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const existing = await tenantDb.student.findFirst({
      where: { id: req.params.id, college_id: req.collegeId }
    });
    if (!existing) return res.status(404).json({ success: false, message: 'Student not found' });

    const data = { ...req.body };

    // Process section_id & backwards-compatibility sync
    let sectionId = data.section_id;
    if (sectionId && sectionId !== existing.section_id) {
      const sectionRecord = await tenantDb.section.findUnique({
        where: { id: sectionId }
      });
      if (!sectionRecord) {
        return res.status(404).json({ success: false, message: 'Selected section not found.' });
      }

      // Capacity Validation
      const capacity = sectionRecord.capacity || 40;
      const activeStudentCount = await tenantDb.student.count({
        where: {
          college_id: req.collegeId,
          section_id: sectionId,
          status: 'active',
          id: { not: existing.id }
        }
      });

      if (activeStudentCount >= capacity) {
        return res.status(400).json({
          success: false,
          message: `Section "${sectionRecord.code}" (${sectionRecord.name || 'No Name'}) is full. Capacity: ${capacity}, Enrolled: ${activeStudentCount}.`
        });
      }

      // Fetch class & group details
      const classRecord = await tenantDb.class.findUnique({
        where: { id: sectionRecord.class_id }
      });
      if (!classRecord) {
        return res.status(404).json({ success: false, message: 'Class/Part not found for this section.' });
      }

      let groupName = '';
      if (sectionRecord.group_id) {
        const groupRecord = await tenantDb.group.findUnique({
          where: { id: sectionRecord.group_id }
        });
        if (groupRecord) {
          groupName = groupRecord.name;
        }
      }

      data.section = sectionRecord.code;
      data.class = classRecord.name;
      data.group = groupName;
    } else if (sectionId === null) {
      data.section = null;
      data.class = null;
      data.group = null;
    }

    if (data.dateOfBirth) data.dateOfBirth = new Date(data.dateOfBirth);
    if (data.admissionDate) data.admissionDate = new Date(data.admissionDate);
    if (data.canteenBalance !== undefined) data.canteenBalance = parseFloat(data.canteenBalance);

    const allowedFields = [
      'session_id', 'user_id', 'name', 'fatherName', 'cnic',
      'dateOfBirth', 'gender', 'phone', 'email', 'address', 'guardianName',
      'guardianPhone', 'guardianRelation', 'guardianCnic', 'rollNumber',
      'registrationNumber', 'class', 'group', 'section', 'section_id', 'subjects',
      'admissionDate', 'biometricId', 'cardId', 'faceData', 'qrCode',
      'photo', 'documents', 'status', 'canteenBalance'
    ];
    const dataPayload = {};
    allowedFields.forEach(f => {
      if (data[f] !== undefined) {
        dataPayload[f] = data[f];
      }
    });

    const student = await tenantDb.student.update({
      where: { id: req.params.id },
      data: dataPayload
    });
    
    res.json({ success: true, data: { ...student, _id: student.id } });
  } catch (error) { next(error); }
};

exports.deleteStudent = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const tenantDb = req.tenantClient;
    
    const student = await tenantDb.student.findFirst({
      where: { id: req.params.id, college_id: req.collegeId }
    });
    if (!student) return res.status(404).json({ success: false, message: 'Student not found' });

    await tenantDb.student.update({
      where: { id: student.id },
      data: { status: 'dropped' }
    });

    if (student.user_id) {
      await prisma.user.update({
        where: { id: student.user_id },
        data: { isActive: false }
      });
    }

    res.json({ success: true, message: 'Student removed successfully' });
  } catch (error) { next(error); }
};

// get own profile
exports.getMyProfile = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const student = await tenantDb.student.findFirst({
      where: { user_id: req.user.id, college_id: req.collegeId }
    });
    if (!student) return res.status(404).json({ success: false, message: 'Student record not found' });
    
    res.json({ success: true, data: { ...student, _id: student.id } });
  } catch (error) { next(error); }
};

// Admin: batch section assignment
exports.assignSections = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { mode, classFilter, sections = ['A', 'B', 'C'], assignments } = req.body;

    if (mode === 'custom' && assignments) {
      for (const [studentId, section] of Object.entries(assignments)) {
        await tenantDb.student.updateMany({
          where: { id: studentId, college_id: req.collegeId },
          data: { section }
        });
      }
      return res.json({ success: true, message: `${Object.keys(assignments).length} students assigned` });
    }

    // Auto modes
    const query = { college_id: req.collegeId, status: 'active' };
    if (classFilter) query.class = classFilter;
    
    let students = await tenantDb.student.findMany({
      where: query,
      orderBy: { name: 'asc' }
    });

    if (mode === 'result') {
      const results = await tenantDb.result.findMany({
        where: { college_id: req.collegeId },
        orderBy: { percentage: 'desc' }
      });
      const resultMap = {};
      results.forEach(r => {
        if (r.student_id && !resultMap[r.student_id]) {
          resultMap[r.student_id] = r.percentage;
        }
      });
      students.sort((a, b) => (resultMap[b.id] || 0) - (resultMap[a.id] || 0));
    }

    const updates = [];
    students.forEach((s, i) => {
      const section = sections[i % sections.length];
      updates.push(
        tenantDb.student.update({
          where: { id: s.id },
          data: { section }
        })
      );
    });
    await Promise.all(updates);

    res.json({ success: true, message: `${students.length} students distributed across ${sections.join(', ')} sections (${mode})` });
  } catch (error) { next(error); }
};

//   Shuffle student to another section
exports.shuffleStudent = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { section_id } = req.body;

    if (!section_id) {
      return res.status(400).json({ success: false, message: 'Target section ID is required.' });
    }

    const student = await tenantDb.student.findFirst({
      where: { id: req.params.id, college_id: req.collegeId }
    });
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    const sectionRecord = await tenantDb.section.findUnique({
      where: { id: section_id }
    });
    if (!sectionRecord) {
      return res.status(404).json({ success: false, message: 'Target section not found.' });
    }

    // Capacity Validation
    const capacity = sectionRecord.capacity || 40;
    const activeStudentCount = await tenantDb.student.count({
      where: {
        college_id: req.collegeId,
        section_id: section_id,
        status: 'active',
        id: { not: student.id }
      }
    });

    if (activeStudentCount >= capacity) {
      return res.status(400).json({
        success: false,
        message: `Section "${sectionRecord.code}" (${sectionRecord.name || 'No Name'}) is full. Capacity: ${capacity}, Enrolled: ${activeStudentCount}.`
      });
    }

    // Get Class
    const classRecord = await tenantDb.class.findUnique({
      where: { id: sectionRecord.class_id }
    });
    if (!classRecord) {
      return res.status(404).json({ success: false, message: 'Class/Part not found for the target section.' });
    }

    // Get Group
    let groupName = '';
    if (sectionRecord.group_id) {
      const groupRecord = await tenantDb.group.findUnique({
        where: { id: sectionRecord.group_id }
      });
      if (groupRecord) {
        groupName = groupRecord.name;
      }
    }

    // Update student details
    const updatedStudent = await tenantDb.student.update({
      where: { id: student.id },
      data: {
        section_id,
        section: sectionRecord.code,
        class: classRecord.name,
        group: groupName
      }
    });

    res.json({
      success: true,
      message: `Student shuffled to section ${sectionRecord.code} (${sectionRecord.name || 'No Name'}) successfully.`,
      data: { ...updatedStudent, _id: updatedStudent.id }
    });
  } catch (error) { next(error); }
};
