'use strict';

/**
 * classDiaryService.js — Phase 8B (#28)
 * Class Diary Entry Management
 * - Invariant 3: Unique key includes periodNumber:
 *   @@unique([college_id, section_id, subject_id, entryDate, periodNumber])
 * - Supports attachments with storageBytes quota attribution
 */

const { getSystemClient } = require('../config/prismaManager');

function getPrisma() {
  return getSystemClient();
}

function normalizeDate(d) {
  const dt = new Date(d);
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
}

/**
 * Create or update a daily class diary entry
 */
async function recordDiaryEntry({
  collegeId,
  campusId = null,
  sectionId,
  subjectId,
  teacherId,
  entryDate,
  periodNumber = 1,
  topicCovered,
  homework = null,
  remarks = null,
  attachments = []
}) {
  if (!sectionId || !subjectId || !teacherId || !topicCovered) {
    throw Object.assign(new Error('sectionId, subjectId, teacherId, and topicCovered are required'), { status: 400 });
  }

  const pNum = parseInt(periodNumber, 10);
  if (isNaN(pNum) || pNum < 1 || pNum > 12) {
    throw Object.assign(new Error('periodNumber must be an integer between 1 and 12'), { status: 400 });
  }

  const dateVal = normalizeDate(entryDate);
  const prisma = getPrisma();

  return await prisma.$transaction(async (tx) => {
    const entry = await tx.classDiaryEntry.upsert({
      where: {
        college_id_section_id_subject_id_entryDate_periodNumber: {
          college_id: collegeId,
          section_id: sectionId,
          subject_id: subjectId,
          entryDate: dateVal,
          periodNumber: pNum
        }
      },
      update: {
        topicCovered,
        homework: homework || null,
        remarks: remarks || null,
        teacher_id: teacherId,
        campus_id: campusId || null,
        updatedAt: new Date()
      },
      create: {
        college_id: collegeId,
        campus_id: campusId || null,
        section_id: sectionId,
        subject_id: subjectId,
        teacher_id: teacherId,
        entryDate: dateVal,
        periodNumber: pNum,
        topicCovered,
        homework: homework || null,
        remarks: remarks || null
      }
    });

    // Create attachments if provided
    if (Array.isArray(attachments) && attachments.length > 0) {
      for (const att of attachments) {
        await tx.classDiaryAttachment.create({
          data: {
            diary_entry_id: entry.id,
            college_id: collegeId,
            storedFileId: att.storedFileId || att.id || 'FILE_' + Date.now(),
            fileName: att.fileName || att.originalFilename || 'attachment',
            fileUrl: att.fileUrl || att.url || '',
            storageBytes: BigInt(att.storageBytes || att.declaredSizeBytes || 0)
          }
        });
      }
    }

    const completeEntry = await tx.classDiaryEntry.findUnique({
      where: { id: entry.id },
      include: { attachments: true }
    });

    return completeEntry;
  });
}

/**
 * Get diary entries for a student's or teacher's section
 */
async function getDiaryEntries({ collegeId, sectionId, date, startDate, endDate, teacherId, campusId }) {
  const prisma = getPrisma();
  const where = { college_id: collegeId };

  if (campusId) where.campus_id = campusId;
  if (sectionId) where.section_id = sectionId;
  if (teacherId) where.teacher_id = teacherId;

  if (date) {
    where.entryDate = normalizeDate(date);
  } else if (startDate && endDate) {
    where.entryDate = {
      gte: normalizeDate(startDate),
      lte: normalizeDate(endDate)
    };
  }

  const entries = await prisma.classDiaryEntry.findMany({
    where,
    include: { attachments: true },
    orderBy: [{ entryDate: 'desc' }, { periodNumber: 'asc' }]
  });

  return entries;
}

module.exports = {
  recordDiaryEntry,
  getDiaryEntries,
  normalizeDate
};
