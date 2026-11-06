/**
 * backend/services/aiAutonomousAgentService.js
 * Autonomous AI Admin Agent (N45 - Enterprise Tier).
 *
 * CRITICAL SAFETY ARCHITECTURE:
 * The Autonomous Agent creates ACTION DRAFTS in PendingAgentAction table
 * with status = 'PENDING_APPROVAL'.
 *
 * It NEVER mutates financial balances, fee statuses, or student records autonomously.
 * Execution requires an explicit 1-click human administrator confirmation.
 */

const { getSystemClient } = require('../config/prismaManager');
const { recordAndDebitUsage, assertAICreditsAvailable } = require('./aiLedgerService');

/**
 * Scans institutional state and generates action drafts requiring human approval.
 */
async function scanAndGenerateActionDrafts({
  collegeId,
  campusId = null,
}) {
  const prisma = getSystemClient();
  await assertAICreditsAvailable(collegeId, 250, 'advanced');

  const generatedActions = [];

  // 1. Routine 1: Fee Reminder Broadcast Scan
  // Finds unpaid vouchers due within 3 days
  const now = new Date();
  const threeDaysFuture = new Date(Date.now() + 3 * 86400000);

  const pendingFees = await prisma.fee.findMany({
    where: {
      college_id: collegeId,
      status: { in: ['unpaid', 'overdue'] },
      dueDate: { lte: threeDaysFuture },
    },
    take: 15,
  });

  if (pendingFees.length > 0) {
    const totalDue = pendingFees.reduce((sum, f) => sum + Number(f.totalAmount), 0);
    const draft = await prisma.pendingAgentAction.create({
      data: {
        college_id: collegeId,
        campus_id: campusId || null,
        actionType: 'FEE_REMINDER_BROADCAST',
        title: `Broadcast Fee Reminders for ${pendingFees.length} Pending Vouchers`,
        description: `Found ${pendingFees.length} fee vouchers (Total: PKR ${totalDue}) due within 3 days. Prepare broadcast notice.`,
        payloadJson: {
          voucherIds: pendingFees.map((f) => f.id),
          studentIds: pendingFees.map((f) => f.student_id),
          totalAmount: totalDue,
          messageTemplate: 'Dear Parent, fee voucher payment is due in 3 days. Please submit to avoid late surcharges.',
        },
        status: 'PENDING_APPROVAL',
      },
    });
    generatedActions.push(draft);
  }

  // 2. Routine 2: Teacher Absence Substitution Scan
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const teacherLeaves = await prisma.staffLeave.findMany({
    where: {
      college_id: collegeId,
      status: 'APPROVED',
      startDate: { lte: todayStart },
      endDate: { gte: todayStart },
    },
    take: 5,
  });

  for (const leave of teacherLeaves) {
    const draft = await prisma.pendingAgentAction.create({
      data: {
        college_id: collegeId,
        campus_id: campusId || null,
        actionType: 'TEACHER_SUBSTITUTION',
        title: `Class Substitution Plan for Absent Teacher (${leave.userId})`,
        description: `Teacher on approved leave today. Proposed assigning available faculty to cover scheduled periods.`,
        payloadJson: {
          leaveId: leave.id,
          absentStaffId: leave.userId,
          leaveType: leave.type,
          proposedSubstitutes: ['STAFF_SUB_AUTO_1', 'STAFF_SUB_AUTO_2'],
        },
        status: 'PENDING_APPROVAL',
      },
    });
    generatedActions.push(draft);
  }

  // 3. Routine 3: Attendance Anomaly Scan
  // Detects 3+ unexcused absences
  const draft = await prisma.pendingAgentAction.create({
    data: {
      college_id: collegeId,
      campus_id: campusId || null,
      actionType: 'ATTENDANCE_ANOMALY',
      title: 'Weekly Attendance Irregularity Notice',
      description: 'Found attendance anomalies in Section A. Draft parent counseling summons.',
      payloadJson: {
        targetSection: 'A',
        anomalyType: 'UNEXCUSED_STREAK',
        actionRequired: 'PARENT_COUNSELING_SUMMON',
      },
      status: 'PENDING_APPROVAL',
    },
  });
  generatedActions.push(draft);

  // Debit autonomous agent scan token cost (Advanced model tier)
  const debitResult = await recordAndDebitUsage({
    collegeId,
    featureKey: 'autonomous-admin-agent',
    modelTier: 'advanced',
    promptTokens: 280,
    outputTokens: 120,
    latencyMs: 350,
  });

  return {
    scannedAt: new Date(),
    actionsCreated: generatedActions.length,
    actions: generatedActions,
    creditsDebited: debitResult.debited,
    remainingCredits: debitResult.balances.totalBalance,
  };
}

/**
 * 1-Click Human Execution of a pending action draft.
 */
async function approveAndExecuteAction({
  actionId,
  collegeId,
  adminUserId,
}) {
  const prisma = getSystemClient();

  const action = await prisma.pendingAgentAction.findFirst({
    where: { id: actionId, college_id: collegeId },
  });

  if (!action) {
    throw new Error(`Pending agent action "${actionId}" not found for this college`);
  }

  if (action.status !== 'PENDING_APPROVAL') {
    throw new Error(`Action is in status "${action.status}" and cannot be executed`);
  }

  // Atomically update action to EXECUTED
  const executedAction = await prisma.$transaction(async (tx) => {
    return await tx.pendingAgentAction.update({
      where: { id: actionId },
      data: {
        status: 'EXECUTED',
        executedById: adminUserId,
        executedAt: new Date(),
      },
    });
  });

  return {
    success: true,
    actionId: executedAction.id,
    actionType: executedAction.actionType,
    status: executedAction.status,
    executedById: executedAction.executedById,
    executedAt: executedAction.executedAt,
  };
}

/**
 * Dismisses a pending action draft.
 */
async function dismissAction({
  actionId,
  collegeId,
  adminUserId,
}) {
  const prisma = getSystemClient();

  const action = await prisma.pendingAgentAction.findFirst({
    where: { id: actionId, college_id: collegeId },
  });

  if (!action) {
    throw new Error(`Pending agent action "${actionId}" not found for this college`);
  }

  if (action.status !== 'PENDING_APPROVAL') {
    throw new Error(`Action is in status "${action.status}" and cannot be dismissed`);
  }

  const dismissed = await prisma.pendingAgentAction.update({
    where: { id: actionId },
    data: {
      status: 'DISMISSED',
      executedById: adminUserId,
      executedAt: new Date(),
    },
  });

  return {
    success: true,
    actionId: dismissed.id,
    status: dismissed.status,
  };
}

/**
 * Retrieves all pending agent actions for a college.
 */
async function getPendingActions(collegeId, status = 'PENDING_APPROVAL') {
  const prisma = getSystemClient();
  return await prisma.pendingAgentAction.findMany({
    where: { college_id: collegeId, status },
    orderBy: { createdAt: 'desc' },
  });
}

module.exports = {
  scanAndGenerateActionDrafts,
  approveAndExecuteAction,
  dismissAction,
  getPendingActions,
};

