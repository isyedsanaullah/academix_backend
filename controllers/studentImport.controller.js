'use strict';

const crypto = require('crypto');
const { getSystemClient } = require('../config/prismaManager');
const { logActivity } = require('../services/activityLog.service');
const { ACTIONS, CATEGORIES } = require('../config/activityConstants');
const { getCollegeLimit, consume } = require('../services/quota');

// ── GET /admin/onboarding/students/template ─────────────────────────────────
exports.getStudentTemplate = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient || getSystemClient();
    const collegeId = req.collegeId;

    // Fetch college info, all active classes, and sections
    const [college, classes, sections] = await Promise.all([
      tenantDb.college ? tenantDb.college.findUnique({ where: { id: collegeId }, select: { slug: true, name: true } }) : null,
      tenantDb.class.findMany({
        where: { college_id: collegeId, isActive: true },
        orderBy: { name: 'asc' }
      }),
      tenantDb.section.findMany({
        where: { college_id: collegeId, isActive: true }
      })
    ]);

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

    const dummyProfiles = [
      { name: 'Muhammad Ahmed', father: 'Tariq Mehmood', gender: 'male' },
      { name: 'Fatima Zahra', father: 'Rashid Ali', gender: 'female' },
      { name: 'Ali Raza', father: 'Ghulam Raza', gender: 'male' },
      { name: 'Ayesha Khan', father: 'Javed Iqbal', gender: 'female' },
      { name: 'Bilal Hassan', father: 'Hassan Akhtar', gender: 'male' },
      { name: 'Zainab Bibi', father: 'Shahid Mehmood', gender: 'female' },
      { name: 'Hamza Malik', father: 'Asif Malik', gender: 'male' },
      { name: 'Maryam Noor', father: 'Naveed Ahmed', gender: 'female' },
      { name: 'Usman Farooq', father: 'Farooq Azam', gender: 'male' },
      { name: 'Hira Siddiqui', father: 'Khalid Siddiqui', gender: 'female' },
      { name: 'Saad Sheikh', father: 'Faisal Sheikh', gender: 'male' },
      { name: 'Dua Javed', father: 'Javed Akhtar', gender: 'female' }
    ];

    const sampleRows = [];
    let counter = 1;

    if (classes && classes.length > 0) {
      for (const cls of classes) {
        const groups = (Array.isArray(cls.groups) && cls.groups.length > 0) ? cls.groups : ['General'];
        const classSections = sections.filter(s => s.class_id === cls.id);
        const sectionCodes = classSections.length > 0
          ? classSections.map(s => {
              const parts = s.code.split('-');
              return parts.length > 1 ? parts[parts.length - 1] : s.code;
            })
          : ['A', 'B'];

        for (const grp of groups) {
          const profile = dummyProfiles[(counter - 1) % dummyProfiles.length];
          const sec = sectionCodes[(counter - 1) % sectionCodes.length] || 'A';
          const admNo = `ADM-2026-${String(counter).padStart(3, '0')}`;

          sampleRows.push([
            profile.name,
            profile.father,
            admNo,
            cls.name,
            grp,
            sec,
            profile.gender,
            `0300-123456${counter % 10}`,
            `student${counter}@example.com`,
            `200${8 - (counter % 3)}-05-15`,
            'Main Campus Road, City',
            profile.father,
            `0301-765432${counter % 10}`
          ]);
          counter++;
        }
      }
    } else {
      // Fallback sample rows if no classes configured yet
      sampleRows.push(
        [
          'Muhammad Ahmed',
          'Tariq Mehmood',
          'ADM-2026-001',
          'FSc Pre-Medical (Part 1)',
          'Pre-Medical',
          'A',
          'male',
          '0300-1234567',
          'ahmed@example.com',
          '2008-05-15',
          'House 12, Street 4, Islamabad',
          'Tariq Mehmood',
          '0301-1234567'
        ],
        [
          'Fatima Zahra',
          'Rashid Ali',
          'ADM-2026-002',
          'ICS (Part 1)',
          'Computer Science',
          'A',
          'female',
          '0301-7654321',
          'fatima@example.com',
          '2008-09-20',
          'Sector F-7/2, Islamabad',
          'Rashid Ali',
          '0301-7654321'
        ]
      );
    }

    const fileSlug = (college?.slug || 'college').toLowerCase().replace(/[^a-z0-9]/g, '_');

    // Excel Format Requested
    if (req.query.format === 'xlsx' || req.query.format === 'excel') {
      const XLSX = require('xlsx');
      const ws = XLSX.utils.aoa_to_sheet([headers, ...sampleRows]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Student Template');
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="students_template_${fileSlug}.xlsx"`);
      return res.send(buf);
    }

    const csvContent = [
      headers.join(','),
      ...sampleRows.map(row => row.map(val => `"${String(val || '').replace(/"/g, '""')}"`).join(','))
    ].join('\r\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="students_template_${fileSlug}.csv"`);
    return res.send(csvContent);
  } catch (error) {
    next(error);
  }
};

// ── Background Worker for Student Batch Processing ────────────────────────
async function processStudentImportBatch({
  prisma,
  tenantDb,
  collegeId,
  batchId,
  currentSession,
  existingClasses,
  existingSections,
  studentLimit,
  initialStudentCount,
  students,
  user,
  filename
}) {
  const classMap = new Map();
  existingClasses.forEach(c => {
    classMap.set(c.name.trim().toLowerCase(), c);
  });

  const normalizeStr = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  let createdCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  const CHUNK_SIZE = 25;

  for (let i = 0; i < students.length; i++) {
    const rowNo = i + 1;
    const row = students[i];

    const name = (row.name || row.Name || row['Student Name'] || '').trim();
    const fatherName = (row.fatherName || row['Father Name'] || row.father_name || '').trim();
    const rollNumber = (row.rollNumber || row['Admission Number'] || row.admissionNumber || row.roll_number || row['Roll Number'] || '').trim();
    const className = (row.class || row.Class || row['Class Name'] || '').trim();
    const groupName = (row.group || row.Group || row['Group Name'] || 'General').trim();
    const sectionCode = (row.section || row.Section || row['Section Name'] || 'A').toUpperCase().trim();
    const gender = (row.gender || row.Gender || 'male').toLowerCase().trim();
    const phone = (row.phone || row.Phone || row['Phone Number'] || '').trim();
    const email = (row.email || row.Email || row['Email Address'] || '').trim().toLowerCase();
    const dateOfBirth = row.dateOfBirth || row['Date of Birth'] ? new Date(row.dateOfBirth || row['Date of Birth']) : null;
    const address = (row.address || row.Address || '').trim();
    const guardianName = (row.guardianName || row['Guardian Name'] || '').trim();
    const guardianPhone = (row.guardianPhone || row['Guardian Phone'] || '').trim();

    const rowHash = crypto.createHash('md5').update(`${collegeId}:${currentSession.id}:${rollNumber}:${name}`).digest('hex');

    // Validation 1: Required Fields
    if (!name || !rollNumber || !className) {
      failedCount++;
      const msg = 'Missing required field: Name, Admission Number, or Class is blank.';
      await prisma.importBatchRow.create({
        data: { batch_id: batchId, row_no: rowNo, row_hash: rowHash, status: 'failed', message: msg, data: row }
      }).catch(() => {});
      continue;
    }

    // Validation 2: Match Class
    let matchedClass = classMap.get(className.toLowerCase());

    if (!matchedClass) {
      const normTarget = normalizeStr(className);
      for (const [_, cls] of classMap.entries()) {
        if (normalizeStr(cls.name) === normTarget) {
          matchedClass = cls;
          break;
        }
      }
    }

    if (!matchedClass && groupName) {
      const isPart1 = /1st|part\s*1|xi\b|first/i.test(className);
      const isPart2 = /2nd|part\s*2|xii\b|second/i.test(className);
      const normGroup = normalizeStr(groupName);

      if (isPart1 || isPart2) {
        const targetPartNum = isPart1 ? '1' : '2';
        for (const [_, cls] of classMap.entries()) {
          const clsNorm = normalizeStr(cls.name);
          const hasPart = clsNorm.includes(`part${targetPartNum}`) || clsNorm.includes(`${targetPartNum}st`) || clsNorm.includes(`${targetPartNum}nd`);
          const hasGroup = clsNorm.includes(normGroup) || (cls.groups || []).some(g => normalizeStr(g).includes(normGroup) || normGroup.includes(normalizeStr(g)));

          if (hasPart && hasGroup) {
            matchedClass = cls;
            break;
          }
        }
      }
    }

    if (!matchedClass) {
      failedCount++;
      const availableClassNames = Array.from(new Set(existingClasses.map(c => `"${c.name}"`))).join(', ');
      const msg = `Unknown class '${className}'. Configured classes in your setup: ${availableClassNames || 'None'}. Please download the template or update Academic Setup.`;
      await prisma.importBatchRow.create({
        data: { batch_id: batchId, row_no: rowNo, row_hash: rowHash, status: 'failed', message: msg, data: row }
      }).catch(() => {});
      continue;
    }

    // Validation 3: Deduplication in current session
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
      await prisma.importBatchRow.create({
        data: { batch_id: batchId, row_no: rowNo, row_hash: rowHash, status: 'skipped', message: msg, data: row }
      }).catch(() => {});
      continue;
    }

    // Section matching
    const matchedSection = existingSections.find(s =>
      s.class_id === matchedClass.id && (s.code === sectionCode || s.code.endsWith(`-${sectionCode}`))
    );

    // Validation 4: Quota enforcement
    if (studentLimit !== null && studentLimit >= 0 && (initialStudentCount + createdCount) >= studentLimit) {
      failedCount++;
      const msg = `Student quota limit reached (${studentLimit} students max). College capacity is full.`;
      await prisma.importBatchRow.create({
        data: { batch_id: batchId, row_no: rowNo, row_hash: rowHash, status: 'failed', message: msg, data: row }
      }).catch(() => {});
      continue;
    }

    // Insert Student
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
      consume(prisma, collegeId, 'students', 1, studentLimit).catch(() => {});
      await prisma.importBatchRow.create({
        data: { batch_id: batchId, row_no: rowNo, row_hash: rowHash, status: 'created', message: 'Imported', data: row }
      }).catch(() => {});
    } catch (insertErr) {
      failedCount++;
      await prisma.importBatchRow.create({
        data: { batch_id: batchId, row_no: rowNo, row_hash: rowHash, status: 'failed', message: insertErr.message || 'Database error', data: row }
      }).catch(() => {});
    }

    // Yield control & update batch progress periodically
    if (rowNo % CHUNK_SIZE === 0 || rowNo === students.length) {
      await prisma.importBatch.update({
        where: { id: batchId },
        data: {
          created: createdCount,
          skipped: skippedCount,
          failed: failedCount
        }
      }).catch(() => {});
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }

  // Final Batch Update
  await prisma.importBatch.update({
    where: { id: batchId },
    data: {
      total: students.length,
      created: createdCount,
      skipped: skippedCount,
      failed: failedCount,
      status: 'completed'
    }
  }).catch(() => {});

  // Update College Onboarding state
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
    }).catch(() => {});
  }

  // Audit Log
  logActivity({
    college_id: collegeId,
    actorUser: user,
    action: ACTIONS.STUDENT_ADMITTED || 'STUDENT_ADMITTED',
    category: CATEGORIES.STUDENT || 'Student',
    resourceType: 'Student',
    resourceId: batchId,
    title: 'Bulk Student Import Completed',
    description: `Background import finished: ${createdCount} created, ${skippedCount} skipped, ${failedCount} failed from ${filename}.`
  }).catch(e => console.error('Activity log error:', e.message));
}

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

    // 1. Resolve current session
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

    // 2. Evaluate quota
    const [existingClasses, existingSections, studentLimit, initialStudentCount] = await Promise.all([
      tenantDb.class.findMany({ where: { college_id: collegeId } }),
      tenantDb.section.findMany({ where: { college_id: collegeId, session_id: currentSession.id } }),
      getCollegeLimit(prisma, collegeId, 'students'),
      tenantDb.student.count({ where: { college_id: collegeId } })
    ]);

    if (studentLimit !== null && studentLimit >= 0 && initialStudentCount >= studentLimit) {
      return res.status(403).json({
        success: false,
        code: 'QUOTA_EXCEEDED',
        message: `Student quota limit reached. Your college is currently at capacity (${initialStudentCount}/${studentLimit} students). Please upgrade your subscription plan or adjust your quota to enroll more students.`,
        quota: {
          limit: studentLimit,
          used: initialStudentCount,
          remaining: 0,
          isUnlimited: false
        }
      });
    }

    // 3. Create ImportBatch
    const batch = await prisma.importBatch.create({
      data: {
        college_id: collegeId,
        created_by: req.user?.id || null,
        filename,
        total: students.length,
        created: 0,
        skipped: 0,
        failed: 0,
        status: 'processing'
      }
    });

    // 4. Mark onboarding state as ready so user can proceed
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
    }).catch(() => {});

    // 5. Send FAST immediate response to client
    const quotaInfo = {
      limit: studentLimit,
      used: initialStudentCount,
      remaining: studentLimit !== null ? Math.max(0, studentLimit - initialStudentCount) : null,
      isUnlimited: studentLimit === null || studentLimit < 0
    };

    res.json({
      success: true,
      message: `File format verified (${students.length} student records). Background import job #${batch.id.slice(0, 8)} started. You can proceed to the next step.`,
      batchId: batch.id,
      status: 'processing',
      total: students.length,
      quota: quotaInfo,
      summary: {
        total: students.length,
        created: 0,
        skipped: 0,
        failed: 0,
        quota: quotaInfo
      }
    });

    // 6. Spawn Background Processor
    setImmediate(async () => {
      try {
        await processStudentImportBatch({
          prisma,
          tenantDb,
          collegeId,
          batchId: batch.id,
          currentSession,
          existingClasses,
          existingSections,
          studentLimit,
          initialStudentCount,
          students,
          user: req.user,
          filename
        });
      } catch (err) {
        console.error(`[Background student import fatal error on batch ${batch.id}]:`, err);
        await prisma.importBatch.update({
          where: { id: batch.id },
          data: { status: 'failed' }
        }).catch(() => {});
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

// ── GET /admin/onboarding/students/batches/:id/status ───────────────────────
exports.getBatchStatus = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const collegeId = req.collegeId;
    const { id: batchId } = req.params;

    const batch = await prisma.importBatch.findFirst({
      where: { id: batchId, college_id: collegeId }
    });

    if (!batch) {
      return res.status(404).json({ success: false, message: 'Batch not found.' });
    }

    const progress = batch.total > 0
      ? Math.round(((batch.created + batch.skipped + batch.failed) / batch.total) * 100)
      : 0;

    res.json({
      success: true,
      data: {
        id: batch.id,
        status: batch.status,
        total: batch.total,
        created: batch.created,
        skipped: batch.skipped,
        failed: batch.failed,
        progress,
        filename: batch.filename,
        createdAt: batch.createdAt,
        updatedAt: batch.updatedAt
      }
    });
  } catch (error) {
    next(error);
  }
};
