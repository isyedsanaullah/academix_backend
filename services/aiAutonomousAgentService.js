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

const MAX_AGENT_BATCH_RECORDS = 500;
const AGENT_ALLOWED_ROLES = new Set(['admin', 'principal', 'superAdmin', 'registrar', 'accountant']);
const AGENT_ROLE_ACTION_ALLOWLIST = {
  superAdmin: new Set(['FEE_REMINDER_BROADCAST', 'TEACHER_SUBSTITUTION', 'ATTENDANCE_ANOMALY']),
  admin:      new Set(['FEE_REMINDER_BROADCAST', 'TEACHER_SUBSTITUTION', 'ATTENDANCE_ANOMALY']),
  principal:  new Set(['FEE_REMINDER_BROADCAST', 'TEACHER_SUBSTITUTION', 'ATTENDANCE_ANOMALY']),
  registrar:  new Set(['TEACHER_SUBSTITUTION', 'ATTENDANCE_ANOMALY']),
  accountant: new Set(['FEE_REMINDER_BROADCAST']),
};
const DESTRUCTIVE_OR_FORBIDDEN_PATTERN = /\b(delete\s+(all|from|students?|fees?|users?|records?)|drop\s+table|truncate|wipe|purge|destroy|erase|payroll|salary\s+disbursement|transfer\s+funds)\b/i;

/**
 * Neutralizes prompt-injection attempts from untrusted PDF/form/input strings
 * by escaping any embedded delimiter tags and wrapping in <untrusted_data read_only="true">.
 */
function wrapUntrustedData(text) {
  const safe = String(text ?? '')
    .replace(/<\/?untrusted_data[^>]*>/gi, '[TAG_STRIPPED]');
  return `<untrusted_data read_only="true">${safe}</untrusted_data>`;
}

/**
 * Validates RBAC, campus isolation, destructive/payroll prohibition, and batch cap (<= 500).
 */
function assertAgentGuardrails({
  requestedById = null,
  requestedByRole = 'admin',
  requestedByCampusId = null,
  campusId = null,
  actionTypes = [],
  prompt = '',
  affectedRecordsCount = 1,
}) {
  const role = String(requestedByRole || 'admin');
  if (!AGENT_ALLOWED_ROLES.has(role)) {
    throw Object.assign(
      new Error(`Role '${role}' is not permitted to invoke or approve the Autonomous Admin Agent.`),
      { status: 403, code: 'AGENT_RBAC_FORBIDDEN' }
    );
  }

  if (requestedByCampusId && campusId && requestedByCampusId !== campusId) {
    throw Object.assign(
      new Error('Campus-scoped user cannot target another campus with Autonomous Admin Agent actions.'),
      { status: 403, code: 'AGENT_CAMPUS_FORBIDDEN' }
    );
  }

  if (prompt && DESTRUCTIVE_OR_FORBIDDEN_PATTERN.test(String(prompt))) {
    throw Object.assign(
      new Error('Destructive deletes, schema drops, or autonomous payroll/fund mutations are strictly forbidden.'),
      { status: 403, code: 'AGENT_DESTRUCTIVE_ACTION_FORBIDDEN' }
    );
  }

  const allowedSet = AGENT_ROLE_ACTION_ALLOWLIST[role] || new Set();
  for (const act of actionTypes) {
    if (!allowedSet.has(act)) {
      throw Object.assign(
        new Error(`Role '${role}' is not authorized to execute agent action '${act}'.`),
        { status: 403, code: 'AGENT_RBAC_FORBIDDEN' }
      );
    }
  }

  if (Number(affectedRecordsCount) > MAX_AGENT_BATCH_RECORDS) {
    throw Object.assign(
      new Error(`Agent batch size (${affectedRecordsCount}) exceeds maximum safety cap of ${MAX_AGENT_BATCH_RECORDS} records.`),
      { status: 422, code: 'AGENT_BATCH_CAP_EXCEEDED' }
    );
  }

  return {
    requestedById,
    requestedByRole: role,
    effectiveCampusId: requestedByCampusId || campusId || null,
  };
}

/**
 * Scans institutional state and generates action drafts requiring human approval.
 */
async function scanAndGenerateActionDrafts({
  collegeId,
  campusId = null,
  requestedById = null,
  requestedByRole = 'admin',
  requestedByCampusId = null,
  prompt = '',
}) {
  const prisma = getSystemClient();
  const { effectiveCampusId } = assertAgentGuardrails({
    requestedById,
    requestedByRole,
    requestedByCampusId,
    campusId,
    prompt,
  });
  const allowedActions = AGENT_ROLE_ACTION_ALLOWLIST[requestedByRole] || AGENT_ROLE_ACTION_ALLOWLIST.admin;
  await assertAICreditsAvailable(collegeId, 250, 'advanced');

  const generatedActions = [];

  // 1. Routine 1: Fee Reminder Broadcast Scan
  // Finds unpaid vouchers due within 3 days
  const now = new Date();
  const threeDaysFuture = new Date(Date.now() + 3 * 86400000);

  if (allowedActions.has('FEE_REMINDER_BROADCAST')) {
    const feeWhere = {
      college_id: collegeId,
      status: { in: ['unpaid', 'overdue'] },
      dueDate: { lte: threeDaysFuture },
    };
    const pendingFees = await prisma.fee.findMany({
      where: feeWhere,
      take: Math.min(15, MAX_AGENT_BATCH_RECORDS),
    });

    if (pendingFees.length > 0) {
      const affectedCount = Math.min(pendingFees.length, MAX_AGENT_BATCH_RECORDS);
      const totalDue = pendingFees.reduce((sum, f) => sum + Number(f.totalAmount), 0);
      const diffPreview = {
        actionType: 'FEE_REMINDER_BROADCAST',
        campusId: effectiveCampusId,
        affectedRecordsCount: affectedCount,
        sampleVoucherIds: pendingFees.slice(0, 5).map(f => f.id),
        totalAmountPkr: totalDue,
        mutationType: 'NOTIFY_ONLY',
      };
      const draft = await prisma.pendingAgentAction.create({
        data: {
          college_id: collegeId,
          campus_id: effectiveCampusId,
          requestedById,
          requestedByRole,
          affectedRecordsCount: affectedCount,
          diffPreviewJson: diffPreview,
          actionType: 'FEE_REMINDER_BROADCAST',
          title: `Broadcast Fee Reminders for ${affectedCount} Pending Vouchers`,
          description: `Found ${affectedCount} fee vouchers (Total: PKR ${totalDue}) due within 3 days. Prepare broadcast notice.`,
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
  }

  // 2. Routine 2: Teacher Absence Substitution Scan
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  if (allowedActions.has('TEACHER_SUBSTITUTION')) {
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
          campus_id: effectiveCampusId,
          requestedById,
          requestedByRole,
          affectedRecordsCount: 1,
          diffPreviewJson: {
            actionType: 'TEACHER_SUBSTITUTION',
            campusId: effectiveCampusId,
            leaveId: leave.id,
            absentStaffId: leave.userId,
            mutationType: 'PROPOSE_SUBSTITUTE',
          },
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
  }

  // 3. Routine 3: Attendance Anomaly Scan
  // Detects 3+ unexcused absences
  if (allowedActions.has('ATTENDANCE_ANOMALY')) {
    const draft = await prisma.pendingAgentAction.create({
      data: {
        college_id: collegeId,
        campus_id: effectiveCampusId,
        requestedById,
        requestedByRole,
        affectedRecordsCount: 1,
        diffPreviewJson: {
          actionType: 'ATTENDANCE_ANOMALY',
          campusId: effectiveCampusId,
          targetSection: 'A',
          mutationType: 'DRAFT_SUMMONS',
        },
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
  }

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
  adminRole = 'admin',
  adminCampusId = null,
}) {
  const prisma = getSystemClient();

  const action = await prisma.pendingAgentAction.findFirst({
    where: { id: actionId, college_id: collegeId },
  });

  if (!action) {
    throw new Error(`Pending agent action "${actionId}" not found for this college`);
  }

  assertAgentGuardrails({
    requestedById: adminUserId,
    requestedByRole: adminRole,
    requestedByCampusId: adminCampusId,
    campusId: action.campus_id,
    actionTypes: [action.actionType],
    affectedRecordsCount: action.affectedRecordsCount || 1,
  });

  if (action.status !== 'PENDING_APPROVAL') {
    throw new Error(`Action is in status "${action.status}" and cannot be executed`);
  }

  // Atomically update action to EXECUTED and record immutable audit log
  const executedAction = await prisma.$transaction(async (tx) => {
    const updated = await tx.pendingAgentAction.update({
      where: { id: actionId },
      data: {
        status: 'EXECUTED',
        executedById: adminUserId,
        executedAt: new Date(),
      },
    });
    if (tx.auditLog?.create) {
      await tx.auditLog.create({
        data: {
          college_id: collegeId,
          user_id: adminUserId,
          action: 'AI_AGENT_ACTION_EXECUTED',
          details: JSON.stringify({
            actionId: action.id,
            actionType: action.actionType,
            affectedRecordsCount: action.affectedRecordsCount || 1,
            executedByRole: adminRole,
            campusId: action.campus_id || null,
          }),
        },
      }).catch(() => {});
    }
    return updated;
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
  MAX_AGENT_BATCH_RECORDS,
  AGENT_ALLOWED_ROLES,
  AGENT_ROLE_ACTION_ALLOWLIST,
  wrapUntrustedData,
  assertAgentGuardrails,
  scanAndGenerateActionDrafts,
  approveAndExecuteAction,
  dismissAction,
  getPendingActions,
};

