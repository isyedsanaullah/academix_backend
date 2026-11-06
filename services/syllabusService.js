const { getSystemClient } = require('../config/prismaManager');
const prisma = getSystemClient();

/**
 * Syllabus Breakdown & Coverage Tracker Service (N23)
 */

async function createBreakdown({
  collegeId,
  campusId = null,
  sessionId,
  className,
  subjectId,
  boardName = 'BISE Lahore',
  totalHours = 60,
  units = [], // [{ unitNumber, title, subTopics, targetWeek, expectedHours }]
}) {
  return await prisma.$transaction(async (tx) => {
    const breakdown = await tx.syllabusBreakdown.create({
      data: {
        college_id: collegeId,
        campus_id: campusId,
        session_id: sessionId,
        class: className,
        subject_id: subjectId,
        boardName,
        totalUnits: units.length,
        totalHours: parseInt(totalHours, 10),
        isActive: true,
      },
    });

    if (units.length > 0) {
      await tx.syllabusUnit.createMany({
        data: units.map((u, idx) => ({
          breakdownId: breakdown.id,
          unitNumber: u.unitNumber || idx + 1,
          title: u.title,
          subTopics: Array.isArray(u.subTopics) ? u.subTopics : [],
          targetWeek: parseInt(u.targetWeek || idx + 1, 10),
          expectedHours: parseInt(u.expectedHours || 4, 10),
        })),
      });
    }

    return await tx.syllabusBreakdown.findUnique({
      where: { id: breakdown.id },
      include: {
        units: { orderBy: { unitNumber: 'asc' } },
      },
    });
  });
}

async function updateProgress({
  collegeId,
  campusId = null,
  unitId,
  sectionId,
  teacherId,
  status = 'COMPLETED', // NOT_STARTED | IN_PROGRESS | COMPLETED
  actualHours = 0,
  notes = null,
}) {
  return await prisma.teacherSyllabusProgress.upsert({
    where: {
      college_id_unitId_section_id: {
        college_id: collegeId,
        unitId,
        section_id: sectionId,
      },
    },
    create: {
      college_id: collegeId,
      campus_id: campusId,
      unitId,
      section_id: sectionId,
      teacher_id: teacherId,
      status,
      completedAt: status === 'COMPLETED' ? new Date() : null,
      actualHours: parseInt(actualHours, 10),
      notes,
    },
    update: {
      status,
      completedAt: status === 'COMPLETED' ? new Date() : null,
      actualHours: parseInt(actualHours, 10),
      notes,
    },
  });
}

async function getCoverageSummary({
  collegeId,
  sessionId,
  className,
  subjectId,
  sectionId = null,
  currentWeek = 12,
}) {
  const breakdown = await prisma.syllabusBreakdown.findFirst({
    where: {
      college_id: collegeId,
      ...(sessionId ? { session_id: sessionId } : {}),
      ...(className ? { class: className } : {}),
      ...(subjectId ? { subject_id: subjectId } : {}),
      isActive: true,
    },
    include: {
      units: {
        include: {
          progress: sectionId ? { where: { section_id: sectionId } } : true,
        },
        orderBy: { unitNumber: 'asc' },
      },
    },
  });

  if (!breakdown) {
    return {
      hasBreakdown: false,
      coverageRate: 0,
      totalUnits: 0,
      targetUnits: 0,
      completedUnits: 0,
      isBehindSchedule: false,
      lagWeeks: 0,
    };
  }

  const allUnits = breakdown.units;
  const targetUnits = allUnits.filter((u) => u.targetWeek <= currentWeek);

  let completedUnitsCount = 0;
  for (const unit of allUnits) {
    const isCompleted = unit.progress.some((p) => p.status === 'COMPLETED');
    if (isCompleted) completedUnitsCount++;
  }

  const targetCount = targetUnits.length;
  const coverageRate = targetCount > 0
    ? Math.min(100, Math.round((completedUnitsCount / targetCount) * 100))
    : (allUnits.length > 0 ? Math.round((completedUnitsCount / allUnits.length) * 100) : 100);

  const lagWeeks = Math.max(0, targetCount - completedUnitsCount);
  const isBehindSchedule = lagWeeks >= 2;

  return {
    hasBreakdown: true,
    breakdownId: breakdown.id,
    subjectId: breakdown.subject_id,
    class: breakdown.class,
    totalUnits: allUnits.length,
    targetUnitsToWeek: targetCount,
    completedUnits: completedUnitsCount,
    coverageRate,
    isBehindSchedule,
    lagWeeks,
  };
}

module.exports = {
  createBreakdown,
  updateProgress,
  getCoverageSummary,
};
