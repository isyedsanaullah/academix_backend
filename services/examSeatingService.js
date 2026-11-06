const { getSystemClient } = require('../config/prismaManager');
const prisma = getSystemClient();

/**
 * Exam Seating Plan & Invigilation Service (N25)
 */

/**
 * Configure an exam hall with grid layout
 */
async function createHall({ collegeId, campusId, name, rows, columns, capacity }) {
  const actualCapacity = capacity || (rows * columns);

  return await prisma.$transaction(async (tx) => {
    const hall = await tx.examHall.create({
      data: {
        college_id: collegeId,
        campus_id: campusId || null,
        name,
        rows: parseInt(rows, 10),
        columns: parseInt(columns, 10),
        capacity: parseInt(actualCapacity, 10),
        isActive: true,
      },
    });

    const desksData = [];
    for (let r = 1; r <= rows; r++) {
      for (let c = 1; c <= columns; c++) {
        desksData.push({
          hallId: hall.id,
          rowNum: r,
          colNum: c,
          deskCode: `${name.replace(/\s+/g, '')}-R${r}-C${c}`,
        });
      }
    }

    await tx.examHallDesk.createMany({
      data: desksData,
    });

    return await tx.examHall.findUnique({
      where: { id: hall.id },
      include: { desks: true },
    });
  });
}

/**
 * Get halls for a college
 */
async function getHalls(collegeId, campusId = null) {
  const where = { college_id: collegeId, isActive: true };
  if (campusId) where.campus_id = campusId;
  return await prisma.examHall.findMany({
    where,
    include: {
      desks: {
        orderBy: [{ rowNum: 'asc' }, { colNum: 'asc' }],
      },
    },
    orderBy: { name: 'asc' },
  });
}

/**
 * Generate Seating Plan with Solver
 * Constraint: Adjacent desks [r, c±1] and [r±1, c] must NOT host candidates of the same section/subject.
 */
async function generateSeatingPlan({
  collegeId,
  campusId = null,
  examId,
  name,
  examDate,
  sessionTime = 'MORNING',
  hallIds = [],
  candidates = [], // optional explicit student list [{ id, section_id, subject_id }]
}) {
  return await prisma.$transaction(async (tx) => {
    // 1. Fetch halls and ordered desks
    const halls = await tx.examHall.findMany({
      where: {
        college_id: collegeId,
        id: hallIds.length > 0 ? { in: hallIds } : undefined,
        isActive: true,
      },
      include: {
        desks: {
          orderBy: [{ rowNum: 'asc' }, { colNum: 'asc' }],
        },
      },
    });

    if (!halls.length) {
      throw { statusCode: 400, code: 'NO_HALLS_AVAILABLE', message: 'No active halls selected or available.' };
    }

    // 2. Fetch candidates if not provided
    let studentList = candidates;
    if (!studentList || studentList.length === 0) {
      const exam = await tx.exam.findUnique({ where: { id: examId } });
      if (!exam) {
        throw { statusCode: 404, code: 'EXAM_NOT_FOUND', message: 'Exam not found.' };
      }

      // Fetch active students for this exam
      const students = await tx.student.findMany({
        where: {
          college_id: collegeId,
          status: 'active',
          ...(exam.class ? { class: exam.class } : {}),
        },
        select: {
          id: true,
          name: true,
          rollNumber: true,
          section_id: true,
          section: true,
          group: true,
        },
        orderBy: [{ section_id: 'asc' }, { rollNumber: 'asc' }],
      });
      studentList = students.map((s) => ({
        id: s.id,
        section_id: s.section_id || s.section || 'default_sec',
        subject_id: s.group || 'default_grp',
      }));
    }

    // 3. Create or upsert Seating Plan record
    const seatingPlan = await tx.examSeatingPlan.create({
      data: {
        college_id: collegeId,
        campus_id: campusId,
        examId,
        name,
        status: 'DRAFT',
      },
    });

    // 4. Solve seating layout
    // Group candidates by section key
    const sectionBuckets = new Map();
    for (const c of studentList) {
      const key = c.section_id || 'UNKNOWN';
      if (!sectionBuckets.has(key)) sectionBuckets.set(key, []);
      sectionBuckets.get(key).push(c);
    }

    const assignedSeats = [];
    const dateObj = new Date(examDate);

    for (const hall of halls) {
      const deskGrid = new Map(); // key "r,c" -> student
      for (const desk of hall.desks) {
        deskGrid.set(`${desk.rowNum},${desk.colNum}`, null);
      }

      for (const desk of hall.desks) {
        const r = desk.rowNum;
        const c = desk.colNum;

        // Neighbor sections to avoid
        const leftNeighbor = deskGrid.get(`${r},${c - 1}`);
        const topNeighbor = deskGrid.get(`${r - 1},${c}`);
        const forbiddenSections = new Set();
        if (leftNeighbor) forbiddenSections.add(leftNeighbor.section_id);
        if (topNeighbor) forbiddenSections.add(topNeighbor.section_id);

        // Find candidate from bucket with different section
        let chosenCandidate = null;
        let chosenBucketKey = null;

        // Sort bucket keys by remaining candidates descending (greedy strategy)
        const sortedBucketKeys = Array.from(sectionBuckets.keys())
          .filter((k) => sectionBuckets.get(k).length > 0)
          .sort((a, b) => sectionBuckets.get(b).length - sectionBuckets.get(a).length);

        for (const bKey of sortedBucketKeys) {
          if (!forbiddenSections.has(bKey)) {
            chosenCandidate = sectionBuckets.get(bKey).shift();
            chosenBucketKey = bKey;
            break;
          }
        }

        // Fallback if strict alternating impossible with remaining students
        if (!chosenCandidate && sortedBucketKeys.length > 0) {
          chosenCandidate = sectionBuckets.get(sortedBucketKeys[0]).shift();
          chosenBucketKey = sortedBucketKeys[0];
        }

        if (chosenCandidate) {
          deskGrid.set(`${r},${c}`, chosenCandidate);
          assignedSeats.push({
            seatingPlanId: seatingPlan.id,
            deskId: desk.id,
            student_id: chosenCandidate.id,
            examDate: dateObj,
            sessionTime,
          });
        }
      }
    }

    if (assignedSeats.length > 0) {
      await tx.examAssignedSeat.createMany({
        data: assignedSeats,
      });
    }

    return await tx.examSeatingPlan.findUnique({
      where: { id: seatingPlan.id },
      include: {
        seats: true,
      },
    });
  });
}

/**
 * Assign Teacher Invigilation Duty with Leave Clash & Weekly Cap verification
 */
async function assignInvigilator({
  collegeId,
  seatingPlanId,
  teacherId,
  hallId,
  dutyDate,
  sessionTime = 'MORNING',
}) {
  const dateObj = new Date(dutyDate);

  // 1. Verify seating plan
  const plan = await prisma.examSeatingPlan.findUnique({
    where: { id: seatingPlanId },
  });
  if (!plan || plan.college_id !== collegeId) {
    throw { statusCode: 404, code: 'SEATING_PLAN_NOT_FOUND', message: 'Seating plan not found.' };
  }

  // 2. Check for staff leave clash on dutyDate
  // Check StaffAttendance with status LEAVE
  const leaveAttendance = await prisma.staffAttendance.findFirst({
    where: {
      college_id: collegeId,
      userId: teacherId,
      date: dateObj,
      status: 'LEAVE',
    },
  });

  // Check LeaveApplication if approved
  const approvedLeave = await prisma.leaveApplication.findFirst({
    where: {
      college_id: collegeId,
      user_id: teacherId,
      status: 'approved',
      leaveDate: { lte: dateObj },
      OR: [
        { leaveDateEnd: null, leaveDate: dateObj },
        { leaveDateEnd: { gte: dateObj } },
      ],
    },
  });

  if (leaveAttendance || approvedLeave) {
    throw {
      statusCode: 422,
      code: 'TEACHER_ON_LEAVE',
      message: 'Teacher has approved leave on this date and cannot be assigned invigilation duty.',
    };
  }

  // 3. Check weekly duty cap
  // Get college setting maxInvigilationsPerWeek (default 5) from college.settings JSON
  const collegeRec = await prisma.college.findUnique({
    where: { id: collegeId },
    select: { settings: true },
  });
  let maxWeeklyCap = 5;
  if (collegeRec && collegeRec.settings && typeof collegeRec.settings === 'object') {
    if (collegeRec.settings.maxInvigilationsPerWeek !== undefined) {
      maxWeeklyCap = parseInt(collegeRec.settings.maxInvigilationsPerWeek, 10);
    }
  }

  // Determine week range (Monday to Sunday)
  const day = dateObj.getDay();
  const diffToMonday = dateObj.getDate() - day + (day === 0 ? -6 : 1);
  const weekStart = new Date(dateObj);
  weekStart.setDate(diffToMonday);
  weekStart.setHours(0, 0, 0, 0);

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);

  const dutiesThisWeek = await prisma.examInvigilationDuty.count({
    where: {
      teacher_id: teacherId,
      dutyDate: { gte: weekStart, lte: weekEnd },
      status: { not: 'SUBSTITUTED' },
    },
  });

  if (dutiesThisWeek >= maxWeeklyCap) {
    throw {
      statusCode: 422,
      code: 'WEEKLY_INVIGILATION_CAP_EXCEEDED',
      message: `Teacher has reached the weekly invigilation limit of ${maxWeeklyCap} duties.`,
      currentDuties: dutiesThisWeek,
      cap: maxWeeklyCap,
    };
  }

  // 4. Create or update duty
  return await prisma.examInvigilationDuty.upsert({
    where: {
      seatingPlanId_teacher_id_dutyDate_sessionTime: {
        seatingPlanId,
        teacher_id: teacherId,
        dutyDate: dateObj,
        sessionTime,
      },
    },
    create: {
      seatingPlanId,
      teacher_id: teacherId,
      hallId,
      dutyDate: dateObj,
      sessionTime,
      status: 'ASSIGNED',
    },
    update: {
      hallId,
      status: 'ASSIGNED',
    },
  });
}

/**
 * Get invigilation roster
 */
async function getInvigilationRoster(collegeId, filters = {}) {
  const where = {
    seatingPlan: { college_id: collegeId },
    ...(filters.teacherId ? { teacher_id: filters.teacherId } : {}),
    ...(filters.seatingPlanId ? { seatingPlanId: filters.seatingPlanId } : {}),
  };

  return await prisma.examInvigilationDuty.findMany({
    where,
    include: {
      seatingPlan: {
        select: { id: true, name: true, examId: true, status: true },
      },
    },
    orderBy: [{ dutyDate: 'asc' }, { sessionTime: 'asc' }],
  });
}

module.exports = {
  createHall,
  getHalls,
  generateSeatingPlan,
  assignInvigilator,
  getInvigilationRoster,
};
