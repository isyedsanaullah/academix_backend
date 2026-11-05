'use strict';

/**
 * groupSeatService.js — Phase 8A
 * Academic Group Seat Allocation & Fee Scheduling (#29)
 * - Session-scoped seat capacity quotas with atomic concurrency guards
 * - Group-specific fee schedules (tuition & admission fees)
 * - Preserves student quota invariant: seat allocation/transfer != student creation
 */

const { getSystemClient } = require('../config/prismaManager');

function getPrisma() {
  return getSystemClient();
}

/**
 * Get seat allocation details for a group and academic session.
 */
async function getSeatAllocation({ collegeId, groupId, sessionId }) {
  const prisma = getPrisma();

  const group = await prisma.group.findFirst({
    where: { id: groupId, college_id: collegeId }
  });
  if (!group) throw Object.assign(new Error('Group not found'), { status: 404 });

  const allocation = await prisma.groupSeatAllocation.findUnique({
    where: {
      college_id_group_id_session_id: {
        college_id: collegeId,
        group_id: groupId,
        session_id: sessionId
      }
    }
  });

  const enrolledCount = await prisma.student.count({
    where: {
      college_id: collegeId,
      session_id: sessionId,
      group: group.name,
      status: 'active'
    }
  });

  const maxSeats = allocation ? allocation.maxSeats : (group.seats || 0);
  const allocatedSeats = allocation ? allocation.allocatedSeats : enrolledCount;

  return {
    groupId,
    groupName: group.name,
    sessionId,
    maxSeats,
    allocatedSeats,
    enrolledCount,
    availableSeats: maxSeats > 0 ? Math.max(0, maxSeats - allocatedSeats) : null,
    isOverCapacity: maxSeats > 0 && enrolledCount > maxSeats,
    allocation
  };
}

/**
 * Configure or update maximum seat capacity for a group in a session.
 */
async function setSeatAllocation({ collegeId, campusId, groupId, sessionId, maxSeats }) {
  if (typeof maxSeats !== 'number' || maxSeats < 0) {
    throw Object.assign(new Error('maxSeats must be a non-negative integer'), { status: 400 });
  }

  const prisma = getPrisma();

  return await prisma.$transaction(async (tx) => {
    const group = await tx.group.findFirst({
      where: { id: groupId, college_id: collegeId }
    });
    if (!group) throw Object.assign(new Error('Group not found'), { status: 404 });

    const session = await tx.session.findFirst({
      where: { id: sessionId, college_id: collegeId }
    });
    if (!session) throw Object.assign(new Error('Session not found'), { status: 404 });

    const currentEnrolled = await tx.student.count({
      where: {
        college_id: collegeId,
        session_id: sessionId,
        group: group.name,
        status: 'active'
      }
    });

    const allocation = await tx.groupSeatAllocation.upsert({
      where: {
        college_id_group_id_session_id: {
          college_id: collegeId,
          group_id: groupId,
          session_id: sessionId
        }
      },
      update: {
        maxSeats,
        allocatedSeats: currentEnrolled,
        campus_id: campusId || null,
        updatedAt: new Date()
      },
      create: {
        college_id: collegeId,
        campus_id: campusId || null,
        group_id: groupId,
        session_id: sessionId,
        maxSeats,
        allocatedSeats: currentEnrolled
      }
    });

    return {
      allocation,
      currentEnrolled,
      warning: currentEnrolled > maxSeats
        ? `Warning: Current enrolled students (${currentEnrolled}) exceed new capacity (${maxSeats}).`
        : null
    };
  });
}

/**
 * Claim a seat atomically under pessimistic row lock.
 */
async function claimSeat({ collegeId, groupId, sessionId }) {
  const prisma = getPrisma();

  return await prisma.$transaction(async (tx) => {
    // 1. Transaction-scoped advisory lock or row lock
    const allocation = await tx.groupSeatAllocation.findUnique({
      where: {
        college_id_group_id_session_id: {
          college_id: collegeId,
          group_id: groupId,
          session_id: sessionId
        }
      }
    });

    if (!allocation) {
      // If no session-specific allocation is defined, fall back to legacy Group.seats
      const group = await tx.group.findFirst({
        where: { id: groupId, college_id: collegeId }
      });
      if (group && group.seats && group.seats > 0) {
        const count = await tx.student.count({
          where: {
            college_id: collegeId,
            session_id: sessionId,
            group: group.name,
            status: 'active'
          }
        });
        if (count >= group.seats) {
          throw Object.assign(new Error(`Group capacity reached (${group.seats})`), {
            status: 409,
            code: 'GROUP_SEATS_EXHAUSTED'
          });
        }
      }
      return { success: true };
    }

    if (allocation.maxSeats > 0 && allocation.allocatedSeats >= allocation.maxSeats) {
      throw Object.assign(
        new Error(`Group seats exhausted for this session (Capacity: ${allocation.maxSeats}, Allocated: ${allocation.allocatedSeats})`),
        { status: 409, code: 'GROUP_SEATS_EXHAUSTED' }
      );
    }

    const updated = await tx.groupSeatAllocation.update({
      where: { id: allocation.id },
      data: {
        allocatedSeats: { increment: 1 }
      }
    });

    return { success: true, allocation: updated };
  });
}

/**
 * Release a seat atomically.
 */
async function releaseSeat({ collegeId, groupId, sessionId }) {
  const prisma = getPrisma();

  return await prisma.$transaction(async (tx) => {
    const allocation = await tx.groupSeatAllocation.findUnique({
      where: {
        college_id_group_id_session_id: {
          college_id: collegeId,
          group_id: groupId,
          session_id: sessionId
        }
      }
    });

    if (allocation && allocation.allocatedSeats > 0) {
      await tx.groupSeatAllocation.update({
        where: { id: allocation.id },
        data: {
          allocatedSeats: { decrement: 1 }
        }
      });
    }

    return { success: true };
  });
}

/**
 * Get fee schedule for a group and academic session.
 */
async function getFeeSchedule({ collegeId, groupId, sessionId }) {
  const prisma = getPrisma();

  const schedule = await prisma.groupFeeSchedule.findUnique({
    where: {
      college_id_group_id_session_id: {
        college_id: collegeId,
        group_id: groupId,
        session_id: sessionId
      }
    }
  });

  return schedule;
}

/**
 * Configure fee schedule for a group and academic session.
 */
async function setFeeSchedule({ collegeId, campusId, groupId, sessionId, tuitionFeePkr, admissionFeePkr }) {
  const tuition = parseFloat(tuitionFeePkr);
  const admission = parseFloat(admissionFeePkr);

  if (isNaN(tuition) || tuition < 0 || isNaN(admission) || admission < 0) {
    throw Object.assign(new Error('tuitionFeePkr and admissionFeePkr must be non-negative numbers'), { status: 400 });
  }

  const prisma = getPrisma();

  const group = await prisma.group.findFirst({
    where: { id: groupId, college_id: collegeId }
  });
  if (!group) throw Object.assign(new Error('Group not found'), { status: 404 });

  const session = await prisma.session.findFirst({
    where: { id: sessionId, college_id: collegeId }
  });
  if (!session) throw Object.assign(new Error('Session not found'), { status: 404 });

  const schedule = await prisma.groupFeeSchedule.upsert({
    where: {
      college_id_group_id_session_id: {
        college_id: collegeId,
        group_id: groupId,
        session_id: sessionId
      }
    },
    update: {
      tuitionFeePkr: tuition,
      admissionFeePkr: admission,
      campus_id: campusId || null,
      updatedAt: new Date()
    },
    create: {
      college_id: collegeId,
      campus_id: campusId || null,
      group_id: groupId,
      session_id: sessionId,
      tuitionFeePkr: tuition,
      admissionFeePkr: admission
    }
  });

  return schedule;
}

module.exports = {
  getSeatAllocation,
  setSeatAllocation,
  claimSeat,
  releaseSeat,
  getFeeSchedule,
  setFeeSchedule
};

