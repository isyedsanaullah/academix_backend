const { getSystemClient } = require('../config/prismaManager');
const prisma = getSystemClient();
const { checkAndCreateApprovalRequest } = require('./approvalService');

/**
 * Student Leave Service (N24)
 */

/**
 * Apply for student leave
 */
async function applyStudentLeave({
  collegeId,
  campusId = null,
  sessionId,
  studentId,
  userId,
  leaveDate,
  leaveDateEnd = null,
  reason,
  category = 'personal',
  isEmergency = false,
  medicalCertificate = null,
  appliedByRole = 'STUDENT',
}) {
  const startDate = new Date(leaveDate);
  const endDate = leaveDateEnd ? new Date(leaveDateEnd) : startDate;

  return await prisma.leaveApplication.create({
    data: {
      college_id: collegeId,
      campus_id: campusId,
      session_id: sessionId,
      student_id: studentId,
      user_id: userId,
      leaveDate: startDate,
      leaveDateEnd: endDate,
      reason,
      category,
      isEmergency: Boolean(isEmergency),
      medicalCertificate,
      appliedByRole,
      status: 'pending',
    },
  });
}

/**
 * Core atomic execution of leave approval and automated attendance marking
 */
async function executeLeaveApprovalCore(tx, leaveId, reviewerId, reviewRemarks) {
  const leave = await tx.leaveApplication.findUnique({
    where: { id: leaveId },
  });

  if (!leave) {
    throw { statusCode: 404, code: 'LEAVE_NOT_FOUND', message: 'Leave application not found.' };
  }

  // 1. Fetch student details for attendance record
  const student = await tx.student.findUnique({
    where: { id: leave.student_id },
    select: { class: true, section: true, section_id: true },
  });

  // 2. Iterate dates and upsert Attendance records as LEAVE
  const start = new Date(leave.leaveDate);
  const end = new Date(leave.leaveDateEnd || leave.leaveDate);

  // Normalize dates to midnight
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);

  const cur = new Date(start);
  while (cur <= end) {
    const attendanceDate = new Date(cur);

    // Check existing attendance
    const existing = await tx.attendance.findUnique({
      where: {
        college_id_session_id_student_id_date: {
          college_id: leave.college_id,
          session_id: leave.session_id,
          student_id: leave.student_id,
          date: attendanceDate,
        },
      },
    });

    if (existing) {
      await tx.attendance.update({
        where: { id: existing.id },
        data: {
          status: 'LEAVE',
          remarks: 'Approved Student Leave',
        },
      });
    } else {
      await tx.attendance.create({
        data: {
          college_id: leave.college_id,
          session_id: leave.session_id,
          student_id: leave.student_id,
          class: student?.class || null,
          section: student?.section || null,
          date: attendanceDate,
          status: 'LEAVE',
          method: 'SYSTEM_LEAVE',
          markedBy: reviewerId || 'system',
          remarks: 'Approved Student Leave',
        },
      });
    }

    cur.setDate(cur.getDate() + 1);
  }

  // 3. Update LeaveApplication
  return await tx.leaveApplication.update({
    where: { id: leaveId },
    data: {
      status: 'approved',
      reviewedBy: reviewerId,
      reviewedAt: new Date(),
      reviewRemarks: reviewRemarks || 'Approved',
      autoAttendanceDone: true,
    },
  });
}

/**
 * Review student leave application (with N11 approval chain support)
 */
async function reviewStudentLeave({
  collegeId,
  campusId = null,
  leaveId,
  reviewerUser,
  status, // approved | rejected
  reviewRemarks,
}) {
  const leave = await prisma.leaveApplication.findUnique({
    where: { id: leaveId },
  });

  if (!leave || leave.college_id !== collegeId) {
    throw { statusCode: 404, code: 'LEAVE_NOT_FOUND', message: 'Leave application not found.' };
  }

  if (status === 'approved') {
    // Check N11 Approval Chain for STUDENT_LEAVE
    const approvalCheck = await checkAndCreateApprovalRequest({
      collegeId,
      campusId: campusId || leave.campus_id,
      workflowType: 'STUDENT_LEAVE',
      requesterUser: reviewerUser,
      payload: {
        leaveId: leave.id,
        studentId: leave.student_id,
        reviewerId: reviewerUser.id,
        reviewRemarks,
      },
    });

    if (approvalCheck.requiresApproval) {
      await prisma.leaveApplication.update({
        where: { id: leaveId },
        data: {
          status: 'in_review',
          reviewRemarks: reviewRemarks || 'Routed for multi-step approval',
          reviewedBy: reviewerUser.id,
        },
      });

      return {
        requiresApproval: true,
        approvalRequestId: approvalCheck.request.id,
        status: 'in_review',
        message: 'Student leave requires multi-step approval before attendance register is updated.',
      };
    }

    // Direct approval execution inside transaction
    const updated = await prisma.$transaction(async (tx) => {
      return await executeLeaveApprovalCore(tx, leaveId, reviewerUser.id, reviewRemarks);
    });

    return {
      requiresApproval: false,
      leave: updated,
      message: 'Student leave approved and attendance synchronized.',
    };
  }

  // Reject leave
  const rejected = await prisma.leaveApplication.update({
    where: { id: leaveId },
    data: {
      status: 'rejected',
      reviewedBy: reviewerUser.id,
      reviewedAt: new Date(),
      reviewRemarks: reviewRemarks || 'Rejected',
    },
  });

  return {
    requiresApproval: false,
    leave: rejected,
    message: 'Student leave rejected.',
  };
}

/**
 * List student leave applications
 */
async function listStudentLeaves(collegeId, filters = {}) {
  const where = {
    college_id: collegeId,
    ...(filters.student_id ? { student_id: filters.student_id } : {}),
    ...(filters.status ? { status: filters.status } : {}),
  };

  return await prisma.leaveApplication.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  });
}

module.exports = {
  applyStudentLeave,
  executeLeaveApprovalCore,
  reviewStudentLeave,
  listStudentLeaves,
};
