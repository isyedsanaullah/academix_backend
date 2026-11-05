'use strict';

/**
 * approvalService.js — Phase 9D (#N11)
 * Multi-Step Approval Workflows Engine:
 * - Configurable multi-step approval chains
 * - Request-time step snapshotting ensuring in-flight requests are immutable
 * - Multi-approver resolution: ROLE, USER, CUSTOM_ROLE
 * - Self-approval prevention
 * - Concurrency conflict prevention via conditional step updates (409)
 * - Atomic final execution & revalidation in single transaction (422 REVALIDATION_FAILED on error)
 * - Terminal states (APPROVED, REJECTED, CANCELLED) with full audit logging and outbox events
 */

const { getSystemClient } = require('../config/prismaManager');
const { workflowHandlers } = require('./workflowHandlers');

function getPrisma() {
  return getSystemClient();
}

/**
 * Create or replace approval chain configuration
 */
async function createOrUpdateChain({ collegeId, workflowType, steps = [], isActive = true }) {
  const cleanType = String(workflowType || '').trim().toUpperCase();
  const prisma = getPrisma();

  if (!steps || !Array.isArray(steps) || steps.length === 0) {
    throw Object.assign(new Error('At least one approval step is required.'), { status: 400, code: 'INVALID_STEPS' });
  }

  // Validate step sequence (must be 1..N without gaps)
  const sortedSteps = [...steps].sort((a, b) => a.stepNumber - b.stepNumber);
  for (let i = 0; i < sortedSteps.length; i++) {
    if (sortedSteps[i].stepNumber !== i + 1) {
      throw Object.assign(new Error(`Approval steps must be sequential starting from 1. Expected step ${i + 1}, found ${sortedSteps[i].stepNumber}.`), {
        status: 400,
        code: 'INVALID_STEP_SEQUENCE'
      });
    }

    const { approverType, approverRef } = sortedSteps[i];
    if (!['ROLE', 'USER', 'CUSTOM_ROLE'].includes(approverType)) {
      throw Object.assign(new Error(`Invalid approverType "${approverType}". Allowed: ROLE, USER, CUSTOM_ROLE.`), {
        status: 400,
        code: 'INVALID_APPROVER_TYPE'
      });
    }
    if (!approverRef || typeof approverRef !== 'string') {
      throw Object.assign(new Error(`Step ${i + 1} must specify a valid approverRef.`), {
        status: 400,
        code: 'INVALID_APPROVER_REF'
      });
    }
  }

  return prisma.$transaction(async (tx) => {
    // Upsert parent chain
    const chain = await tx.approvalChain.upsert({
      where: {
        college_id_workflowType: {
          college_id: collegeId,
          workflowType: cleanType
        }
      },
      update: {
        isActive: Boolean(isActive)
      },
      create: {
        college_id: collegeId,
        workflowType: cleanType,
        isActive: Boolean(isActive)
      }
    });

    // Replace steps
    await tx.approvalChainStep.deleteMany({
      where: { chainId: chain.id }
    });

    for (const step of sortedSteps) {
      await tx.approvalChainStep.create({
        data: {
          chainId: chain.id,
          stepNumber: step.stepNumber,
          approverType: step.approverType,
          approverRef: step.approverRef.trim()
        }
      });
    }

    return tx.approvalChain.findUnique({
      where: { id: chain.id },
      include: { steps: { orderBy: { stepNumber: 'asc' } } }
    });
  });
}

/**
 * Get active chain configuration
 */
async function getChain(collegeId, workflowType) {
  const cleanType = String(workflowType || '').trim().toUpperCase();
  const prisma = getPrisma();
  return prisma.approvalChain.findUnique({
    where: {
      college_id_workflowType: {
        college_id: collegeId,
        workflowType: cleanType
      }
    },
    include: { steps: { orderBy: { stepNumber: 'asc' } } }
  });
}

/**
 * List all configured chains for a college
 */
async function listChains(collegeId) {
  const prisma = getPrisma();
  return prisma.approvalChain.findMany({
    where: { college_id: collegeId },
    include: { steps: { orderBy: { stepNumber: 'asc' } } }
  });
}

/**
 * Check if an active chain exists; if so, create an ApprovalRequest with snapshotted steps
 */
async function checkAndCreateApprovalRequest({
  collegeId,
  campusId = null,
  workflowType,
  requesterUser,
  payload
}) {
  const cleanType = String(workflowType || '').trim().toUpperCase();
  const prisma = getPrisma();

  const chain = await getChain(collegeId, cleanType);
  if (!chain || !chain.isActive || !chain.steps || chain.steps.length === 0) {
    return { requiresApproval: false };
  }

  // Pre-validate payload if handler exists
  const handler = workflowHandlers[cleanType];
  if (handler && typeof handler.validate === 'function') {
    await handler.validate(payload, prisma);
  }

  // Create request and snapshot steps
  const request = await prisma.$transaction(async (tx) => {
    const createdReq = await tx.approvalRequest.create({
      data: {
        college_id: collegeId,
        campus_id: campusId,
        workflowType: cleanType,
        requesterId: requesterUser.id,
        currentStep: 1,
        totalSteps: chain.steps.length,
        status: 'PENDING',
        payloadJson: payload
      }
    });

    for (const step of chain.steps) {
      await tx.approvalRequestStep.create({
        data: {
          requestId: createdReq.id,
          college_id: collegeId,
          campus_id: campusId,
          stepNumber: step.stepNumber,
          approverType: step.approverType,
          approverRef: step.approverRef
        }
      });
    }

    // Outbox notification to first approver
    const firstStep = chain.steps[0];
    await tx.outboxEvent.create({
      data: {
        college_id: collegeId,
        eventType: 'APPROVAL_PENDING',
        payload: {
          requestId: createdReq.id,
          workflowType: cleanType,
          stepNumber: 1,
          approverType: firstStep.approverType,
          approverRef: firstStep.approverRef
        }
      }
    });

    return createdReq;
  });

  return {
    requiresApproval: true,
    approvalRequestId: request.id,
    request
  };
}

/**
 * Check whether a user qualifies as the snapshot approver
 */
async function isUserMatchingApprover(actorUser, approverType, approverRef, collegeId, prisma) {
  const role = String(actorUser.role || '').toLowerCase();
  if (role === 'superadmin') return true;

  if (approverType === 'USER') {
    return actorUser.id === approverRef;
  }

  if (approverType === 'ROLE') {
    return role === String(approverRef).toLowerCase();
  }

  if (approverType === 'CUSTOM_ROLE') {
    const assignment = await prisma.userCustomRole.findUnique({
      where: {
        college_id_userId_roleId: {
          college_id: collegeId,
          userId: actorUser.id,
          roleId: approverRef
        }
      }
    });
    return Boolean(assignment);
  }

  return false;
}

/**
 * Approve current step in an approval request
 */
async function approveStep({ collegeId, requestId, actorUser, note = null }) {
  const prisma = getPrisma();

  return prisma.$transaction(async (tx) => {
    // 1. Load request with snapshotted steps
    const request = await tx.approvalRequest.findUnique({
      where: { id: requestId },
      include: {
        steps: { orderBy: { stepNumber: 'asc' } }
      }
    });

    if (!request || request.college_id !== collegeId) {
      throw Object.assign(new Error(`Approval request "${requestId}" not found.`), { status: 404, code: 'NOT_FOUND' });
    }

    if (request.status !== 'PENDING') {
      throw Object.assign(new Error(`Request cannot be approved in "${request.status}" state.`), {
        status: 400,
        code: 'REQUEST_NOT_PENDING'
      });
    }

    // 2. Self-approval guard: requester cannot approve their own request
    if (actorUser.id === request.requesterId && String(actorUser.role || '').toLowerCase() !== 'superadmin') {
      throw Object.assign(new Error('Requester cannot approve their own request.'), {
        status: 403,
        code: 'SELF_APPROVAL_NOT_ALLOWED'
      });
    }

    // 3. Approver validation against snapshotted step
    const currentStepSnapshot = request.steps.find(s => s.stepNumber === request.currentStep);
    if (!currentStepSnapshot) {
      throw Object.assign(new Error(`Step ${request.currentStep} snapshot missing.`), { status: 500, code: 'SNAPSHOT_MISSING' });
    }

    const isMatch = await isUserMatchingApprover(
      actorUser,
      currentStepSnapshot.approverType,
      currentStepSnapshot.approverRef,
      collegeId,
      tx
    );

    if (!isMatch) {
      throw Object.assign(new Error('You are not authorized to approve this step.'), {
        status: 403,
        code: 'NOT_AN_APPROVER'
      });
    }

    const isLastStep = request.currentStep >= request.totalSteps;
    const nextStep = isLastStep ? request.currentStep : request.currentStep + 1;
    const nextStatus = isLastStep ? 'APPROVED' : 'PENDING';

    // 4. Conditional advance: optimistic lock prevents concurrent step advance races
    const updateCount = await tx.approvalRequest.updateMany({
      where: {
        id: requestId,
        status: 'PENDING',
        currentStep: request.currentStep
      },
      data: {
        currentStep: nextStep,
        status: nextStatus
      }
    });

    if (updateCount.count === 0) {
      throw Object.assign(new Error('Approval step conflict: request was already advanced or modified.'), {
        status: 409,
        code: 'APPROVAL_STEP_CONFLICT'
      });
    }

    // 5. Insert ApprovalAction
    await tx.approvalAction.create({
      data: {
        requestId,
        college_id: collegeId,
        campus_id: request.campus_id,
        stepNumber: request.currentStep,
        actorId: actorUser.id,
        action: 'APPROVED',
        note: note ? String(note).trim() : null
      }
    });

    // 6. If final step: Revalidate & execute domain handler in the same transaction
    if (isLastStep) {
      const handler = workflowHandlers[request.workflowType];
      if (!handler) {
        throw Object.assign(new Error(`No domain execution handler registered for workflow "${request.workflowType}".`), {
          status: 500,
          code: 'HANDLER_NOT_FOUND'
        });
      }

      try {
        if (typeof handler.validate === 'function') {
          await handler.validate(request.payloadJson, tx);
        }
        await handler.execute(tx, request.payloadJson);
      } catch (err) {
        // Entire transaction rolls back!
        throw Object.assign(new Error(`Revalidation failed: ${err.message}`), {
          status: 422,
          code: 'REVALIDATION_FAILED'
        });
      }

      // Notify requester of final approval
      await tx.outboxEvent.create({
        data: {
          college_id: collegeId,
          eventType: 'APPROVAL_DECIDED',
          payload: {
            requestId,
            workflowType: request.workflowType,
            status: 'APPROVED',
            requesterId: request.requesterId
          }
        }
      });
    } else {
      // Notify next approver
      const nextStepSnapshot = request.steps.find(s => s.stepNumber === nextStep);
      await tx.outboxEvent.create({
        data: {
          college_id: collegeId,
          eventType: 'APPROVAL_PENDING',
          payload: {
            requestId,
            workflowType: request.workflowType,
            stepNumber: nextStep,
            approverType: nextStepSnapshot?.approverType,
            approverRef: nextStepSnapshot?.approverRef
          }
        }
      });
    }

    return {
      success: true,
      requestId,
      status: nextStatus,
      currentStep: nextStep,
      isFinalStep: isLastStep
    };
  });
}

/**
 * Reject current step in an approval request
 */
async function rejectStep({ collegeId, requestId, actorUser, note = null }) {
  const prisma = getPrisma();

  return prisma.$transaction(async (tx) => {
    const request = await tx.approvalRequest.findUnique({
      where: { id: requestId },
      include: { steps: { orderBy: { stepNumber: 'asc' } } }
    });

    if (!request || request.college_id !== collegeId) {
      throw Object.assign(new Error(`Approval request "${requestId}" not found.`), { status: 404, code: 'NOT_FOUND' });
    }

    if (request.status !== 'PENDING') {
      throw Object.assign(new Error(`Request cannot be rejected in "${request.status}" state.`), {
        status: 400,
        code: 'REQUEST_NOT_PENDING'
      });
    }

    if (actorUser.id === request.requesterId && String(actorUser.role || '').toLowerCase() !== 'superadmin') {
      throw Object.assign(new Error('Requester cannot reject their own request; use cancel instead.'), {
        status: 403,
        code: 'FORBIDDEN'
      });
    }

    const currentStepSnapshot = request.steps.find(s => s.stepNumber === request.currentStep);
    const isMatch = await isUserMatchingApprover(
      actorUser,
      currentStepSnapshot.approverType,
      currentStepSnapshot.approverRef,
      collegeId,
      tx
    );

    if (!isMatch) {
      throw Object.assign(new Error('You are not authorized to act on this step.'), {
        status: 403,
        code: 'NOT_AN_APPROVER'
      });
    }

    const updateCount = await tx.approvalRequest.updateMany({
      where: { id: requestId, status: 'PENDING' },
      data: { status: 'REJECTED' }
    });

    if (updateCount.count === 0) {
      throw Object.assign(new Error('Approval step conflict: request was already updated.'), {
        status: 409,
        code: 'APPROVAL_STEP_CONFLICT'
      });
    }

    await tx.approvalAction.create({
      data: {
        requestId,
        college_id: collegeId,
        campus_id: request.campus_id,
        stepNumber: request.currentStep,
        actorId: actorUser.id,
        action: 'REJECTED',
        note: note ? String(note).trim() : null
      }
    });

    await tx.outboxEvent.create({
      data: {
        college_id: collegeId,
        eventType: 'APPROVAL_DECIDED',
        payload: {
          requestId,
          workflowType: request.workflowType,
          status: 'REJECTED',
          requesterId: request.requesterId,
          note
        }
      }
    });

    return { success: true, requestId, status: 'REJECTED' };
  });
}

/**
 * Cancel an open approval request (Requester only)
 */
async function cancelRequest({ collegeId, requestId, actorUser, note = null }) {
  const prisma = getPrisma();

  return prisma.$transaction(async (tx) => {
    const request = await tx.approvalRequest.findUnique({
      where: { id: requestId }
    });

    if (!request || request.college_id !== collegeId) {
      throw Object.assign(new Error(`Approval request "${requestId}" not found.`), { status: 404, code: 'NOT_FOUND' });
    }

    if (request.status !== 'PENDING') {
      throw Object.assign(new Error(`Request cannot be cancelled in "${request.status}" state.`), {
        status: 400,
        code: 'REQUEST_NOT_PENDING'
      });
    }

    const isRequester = actorUser.id === request.requesterId;
    const isSuperAdmin = String(actorUser.role || '').toLowerCase() === 'superadmin';
    if (!isRequester && !isSuperAdmin) {
      throw Object.assign(new Error('Only the original requester can cancel an approval request.'), {
        status: 403,
        code: 'CANCEL_FORBIDDEN'
      });
    }

    const updateCount = await tx.approvalRequest.updateMany({
      where: { id: requestId, status: 'PENDING' },
      data: { status: 'CANCELLED' }
    });

    if (updateCount.count === 0) {
      throw Object.assign(new Error('Approval step conflict: request was already updated.'), {
        status: 409,
        code: 'APPROVAL_STEP_CONFLICT'
      });
    }

    await tx.approvalAction.create({
      data: {
        requestId,
        college_id: collegeId,
        campus_id: request.campus_id,
        stepNumber: request.currentStep,
        actorId: actorUser.id,
        action: 'CANCELLED',
        note: note ? String(note).trim() : null
      }
    });

    await tx.outboxEvent.create({
      data: {
        college_id: collegeId,
        eventType: 'APPROVAL_DECIDED',
        payload: {
          requestId,
          workflowType: request.workflowType,
          status: 'CANCELLED',
          requesterId: request.requesterId
        }
      }
    });

    return { success: true, requestId, status: 'CANCELLED' };
  });
}

/**
 * Get request details including snapshotted steps and action history
 */
async function getRequestDetails(collegeId, requestId) {
  const prisma = getPrisma();
  return prisma.approvalRequest.findUnique({
    where: { id: requestId },
    include: {
      steps: { orderBy: { stepNumber: 'asc' } },
      actions: { orderBy: { actedAt: 'asc' } }
    }
  });
}

/**
 * List requests with optional filters
 */
async function listRequests(collegeId, filters = {}) {
  const prisma = getPrisma();
  const where = { college_id: collegeId };

  if (filters.workflowType) where.workflowType = String(filters.workflowType).toUpperCase();
  if (filters.status) where.status = String(filters.status).toUpperCase();
  if (filters.requesterId) where.requesterId = filters.requesterId;

  return prisma.approvalRequest.findMany({
    where,
    include: {
      steps: { orderBy: { stepNumber: 'asc' } },
      actions: { orderBy: { actedAt: 'desc' }, take: 1 }
    },
    orderBy: { createdAt: 'desc' }
  });
}

module.exports = {
  createOrUpdateChain,
  getChain,
  listChains,
  checkAndCreateApprovalRequest,
  isUserMatchingApprover,
  approveStep,
  rejectStep,
  cancelRequest,
  getRequestDetails,
  listRequests
};

