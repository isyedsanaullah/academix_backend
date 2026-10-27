'use strict';

const crypto = require('crypto');
const { getSystemClient } = require('../config/prismaManager');
const { logActivity } = require('../services/activityLog.service');
const { ACTIONS, CATEGORIES } = require('../config/activityConstants');

// ── GET /admin/onboarding/students/template ─────────────────────────────────
exports.getStudentTemplate = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient || getSystemClient();
    const collegeId = req.collegeId;

    // Fetch classes and sections for this college to generate realistic example rows
    const classes = await tenantDb.class.findMany({
      where: { college_id: collegeId, isActive: true },
      take: 2
    });

    const sampleClass1 = classes[0]?.name || 'FSc Pre-Medical (Part 1)';
    const sampleGroup1 = classes[0]?.groups?.[0] || 'Pre-Medical';
    const sampleClass2 = classes[1]?.name || 'ICS (Part 1)';
    const sampleGroup2 = classes[1]?.groups?.[0] || 'Computer Science';

    const headers = [
      'Name',
      'Father Name',
      'Admission Number',
      'Class',
      'Group',
      'Section',
      'Gender',
      'Phone',
      'Email',
      'Date of Birth',
      'Address',
      'Guardian Name',
      'Guardian Phone'
    ];

    const sampleRows = [
      [
        'Muhammad Ahmed',
        'Tariq Mehmood',
        '2026-MED-001',
        sampleClass1,
        sampleGroup1,
        'A',
        'male',
        '+92 300 1234567',
        'ahmed@example.com',
        '2008-05-15',
        'House 12, Street 4, Islamabad',
        'Tariq Mehmood',
        '+92 300 1234567'
      ],
      [
        'Fatima Zahra',
        'Rashid Ali',
        '2026-MED-002',
        sampleClass1,
        sampleGroup1,
        'A',
        'female',
        '+92 301 7654321',
        'fatima@example.com',
        '2008-09-20',
        'Sector F-7/2, Islamabad',
        'Rashid Ali',
        '+92 301 7654321'
      ],
      [
        'Ali Raza',
        'Ghulam Raza',
        '2026-ICS-001',
        sampleClass2,
        sampleGroup2,
        'B',
        'male',
        '+92 333 9876543',
        'ali.raza@example.com',
        '2008-11-10',
        'Sector G-9/1, Islamabad',
        'Ghulam Raza',
        '+92 333 9876543'
      ]
    ];

    const csvContent = [
      headers.join(','),
      ...sampleRows.map(row => row.map(val => `"${String(val).replace(/"/g, '""')}"`).join(','))
    ].join('\r\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="students_import_template.csv"');
    return res.send(csvContent);
  } catch (error) {
    next(error);
  }
};

// ── POST /admin/onboarding/students/import ──────────────────────────────────
exports.importStudents = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const tenantDb = req.tenantClient || prisma;
    const collegeId = req.collegeId;
    const { filename = 'students_import.csv', students = [] } = req.body;

    if (!Array.isArray(students) || students.length === 0) {
      return res.status(400).json({ success: false, message: 'No student records provided for import.' });
    }

    // 1. Resolve current session for the college
    const currentSession = await tenantDb.session.findFirst({
      where: { college_id: collegeId, isCurrent: true }
    }) || await tenantDb.session.findFirst({
      where: { college_id: collegeId },
      orderBy: { createdAt: 'desc' }
    });

    if (!currentSession) {
      return res.status(400).json({
        success: false,
        message: 'No active academic session found. Please complete Academic Setup first.'
      });
    }

    // 2. Fetch existing classes and sections for mapping
    const [existingClasses, existingSections] = await Promise.all([
      tenantDb.class.findMany({ where: { college_id: collegeId } }),
      tenantDb.section.findMany({ where: { college_id: collegeId, session_id: currentSession.id } })
    ]);

    const classMap = new Map();
    existingClasses.forEach(c => {
      classMap.set(c.name.trim().toLowerCase(), c);
    });

    // 3. Create ImportBatch in database
    const batch = await prisma.importBatch.create({
      data: {
        college_id: collegeId,
        created_by: req.user?.id || null,
        filename,
        total: students.length,
        status: 'processing'
      }
    });

    let createdCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    const rowResults = [];

    // 4. Process students sequentially
    for (let i = 0; i < students.length; i++) {
      const rowNo = i + 1;
      const row = students[i];

      const name = (row.name || row.Name || '').trim();
      const fatherName = (row.fatherName || row['Father Name'] || row.father_name || '').trim();
      const rollNumber = (row.rollNumber || row['Admission Number'] || row.admissionNumber || row.roll_number || '').trim();
      const className = (row.class || row.Class || '').trim();
      const groupName = (row.group || row.Group || 'General').trim();
      const sectionCode = (row.section || row.Section || 'A').toUpperCase().trim();
      const gender = (row.gender || row.Gender || 'male').toLowerCase().trim();
      const phone = (row.phone || row.Phone || '').trim();
      const email = (row.email || row.Email || '').trim().toLowerCase();
      const dateOfBirth = row.dateOfBirth || row['Date of Birth'] ? new Date(row.dateOfBirth || row['Date of Birth']) : null;
      const address = (row.address || row.Address || '').trim();
      const guardianName = (row.guardianName || row['Guardian Name'] || '').trim();
      const guardianPhone = (row.guardianPhone || row['Guardian Phone'] || '').trim();

      // Row hash for idempotency checking
      const rowHash = crypto.createHash('md5').update(`${collegeId}:${currentSession.id}:${rollNumber}:${name}`).digest('hex');

      // Validation 1: Mandatory fields
      if (!name || !rollNumber || !className) {
        failedCount++;
        const msg = 'Missing required field: Name, Admission Number, or Class is blank.';
        rowResults.push({ row_no: rowNo, name, rollNumber, status: 'failed', message: msg });
        await prisma.importBatchRow.create({
          data: { batch_id: batch.id, row_no: rowNo, row_hash: rowHash, status: 'failed', message: msg, data: row }
        }).catch(() => {});
        continue;
      }

      // Validation 2: Check class existence
      const matchedClass = classMap.get(className.toLowerCase());
      if (!matchedClass) {
        failedCount++;
        const msg = `Unknown class '${className}'. Please create it in Academic Setup first.`;
        rowResults.push({ row_no: rowNo, name, rollNumber, status: 'failed', message: msg });
        await prisma.importBatchRow.create({
          data: { batch_id: batch.id, row_no: rowNo, row_hash: rowHash, status: 'failed', message: msg, data: row }
        }).catch(() => {});
        continue;
      }

      // Validation 3: Deduplication by rollNumber in current session
      const existingStudent = await tenantDb.student.findFirst({
        where: {
          college_id: collegeId,
          session_id: currentSession.id,
          rollNumber
        }
      });

      if (existingStudent) {
        skippedCount++;
        const msg = `Admission number '${rollNumber}' already exists in this academic session.`;
        rowResults.push({ row_no: rowNo, name, rollNumber, status: 'skipped', message: msg });
        await prisma.importBatchRow.create({
          data: { batch_id: batch.id, row_no: rowNo, row_hash: rowHash, status: 'skipped', message: msg, data: row }
        }).catch(() => {});
        continue;
      }

      // Find or associate Section
      const matchedSection = existingSections.find(s =>
        s.class_id === matchedClass.id && (s.code === sectionCode || s.code.endsWith(`-${sectionCode}`))
      );

      // Create Student
      try {
        await tenantDb.student.create({
          data: {
            college_id: collegeId,
            session_id: currentSession.id,
            name,
            fatherName: fatherName || name,
            rollNumber,
            class: matchedClass.name,
            group: groupName || (matchedClass.groups?.[0] || 'General'),
            section: sectionCode,
            section_id: matchedSection?.id || null,
            gender: ['male', 'female', 'other'].includes(gender) ? gender : 'male',
            phone: phone || null,
            email: email || null,
            dateOfBirth: (dateOfBirth && !isNaN(dateOfBirth.getTime())) ? dateOfBirth : null,
            address: address || null,
            guardianName: guardianName || fatherName || null,
            guardianPhone: guardianPhone || phone || null,
            status: 'active'
          }
        });

        createdCount++;
        rowResults.push({ row_no: rowNo, name, rollNumber, status: 'created', message: 'Successfully imported' });
        await prisma.importBatchRow.create({
          data: { batch_id: batch.id, row_no: rowNo, row_hash: rowHash, status: 'created', message: 'Imported', data: row }
        }).catch(() => {});
      } catch (insertErr) {
        failedCount++;
        const msg = insertErr.message || 'Database error inserting record';
        rowResults.push({ row_no: rowNo, name, rollNumber, status: 'failed', message: msg });
        await prisma.importBatchRow.create({
          data: { batch_id: batch.id, row_no: rowNo, row_hash: rowHash, status: 'failed', message: msg, data: row }
        }).catch(() => {});
      }
    }

    // 5. Update Batch Status
    await prisma.importBatch.update({
      where: { id: batch.id },
      data: {
        total: students.length,
        created: createdCount,
        skipped: skippedCount,
        failed: failedCount,
        status: 'completed'
      }
    });

    // 6. Update College onboarding state if students imported
    if (createdCount > 0) {
      const college = await prisma.college.findUnique({ where: { id: collegeId } });
      const existingState = college?.onboarding_state || {};
      const updatedState = {
        ...existingState,
        steps: {
          ...(existingState.steps || {}),
          students: 'done'
        },
        updatedAt: new Date().toISOString()
      };
      await prisma.college.update({
        where: { id: collegeId },
        data: { onboarding_state: updatedState }
      });
    }

    // Activity Log
    logActivity({
      college_id: collegeId,
      actorUser: req.user,
      action: ACTIONS.STUDENT_ADMITTED || 'STUDENT_ADMITTED',
      category: CATEGORIES.STUDENT || 'Student',
      resourceType: 'Student',
      resourceId: batch.id,
      title: 'Bulk Student Import',
      description: `Bulk imported students: ${createdCount} created, ${skippedCount} skipped, ${failedCount} failed from ${filename}.`
    }).catch(e => console.error('Activity log error:', e.message));

    res.json({
      success: true,
      message: `Import completed: ${createdCount} created, ${skippedCount} skipped, ${failedCount} failed.`,
      batchId: batch.id,
      summary: {
        total: students.length,
        created: createdCount,
        skipped: skippedCount,
        failed: failedCount
      },
      data: {
        batchId: batch.id,
        total: students.length,
        created: createdCount,
        skipped: skippedCount,
        failed: failedCount,
        rows: rowResults
      }
    });
  } catch (error) {
    next(error);
  }
};

// ── GET /admin/onboarding/students/batches/:id/errors ───────────────────────
exports.downloadBatchErrors = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const collegeId = req.collegeId;
    const { id: batchId } = req.params;

    const batch = await prisma.importBatch.findFirst({
      where: { id: batchId, college_id: collegeId }
    });

    if (!batch) {
      return res.status(404).json({ success: false, message: 'Import batch not found.' });
    }

    const problemRows = await prisma.importBatchRow.findMany({
      where: {
        batch_id: batchId,
        status: { in: ['failed', 'skipped'] }
      },
      orderBy: { row_no: 'asc' }
    });

    const headers = ['Row Number', 'Status', 'Reason', 'Name', 'Admission Number', 'Class'];
    const rows = problemRows.map(r => {
      const data = r.data || {};
      const name = data.name || data.Name || '';
      const roll = data.rollNumber || data['Admission Number'] || '';
      const cls = data.class || data.Class || '';
      return [
        r.row_no,
        r.status.toUpperCase(),
        `"${(r.message || '').replace(/"/g, '""')}"`,
        `"${name.replace(/"/g, '""')}"`,
        `"${roll.replace(/"/g, '""')}"`,
        `"${cls.replace(/"/g, '""')}"`
      ].join(',');
    });

    const csvOutput = [headers.join(','), ...rows].join('\r\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="import_errors_${batch.filename || 'batch'}.csv"`);
    return res.send(csvOutput);
  } catch (error) {
    next(error);
  }
};

// ── GET /admin/onboarding/students/batches ──────────────────────────────────
exports.getImportBatches = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const collegeId = req.collegeId;

    const batches = await prisma.importBatch.findMany({
      where: { college_id: collegeId },
      orderBy: { createdAt: 'desc' },
      take: 10
    });

    res.json({ success: true, data: batches });
  } catch (error) {
    next(error);
  }
};
exports.getRecentBatches = exports.getImportBatches;
