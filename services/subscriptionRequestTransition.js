'use strict';

const crypto = require('crypto');
const { getSystemClient } = require('../config/prismaManager');
const { logActivity } = require('./activityLog.service');

/**
 * Valid status transitions for Subscription Requests:
 * - new -> contacted | rejected
 * - contacted -> rejected | approved
 * - rejected -> contacted (re-open, requires note)
 * - approved: terminal
 */
const ALLOWED_TRANSITIONS = {
  new: ['contacted', 'rejected'],
  contacted: ['rejected', 'approved'],
  rejected: ['contacted'],
  approved: []
};

/**
 * Validate whether a transition is allowed.
 * @param {string} currentStatus
 * @param {string} targetStatus
 * @param {string} [note]
 * @returns {{ allowed: boolean, error?: string, status?: number }}
 */
function validateTransition(currentStatus, targetStatus, note) {
  const current = (currentStatus || 'new').toLowerCase();
  const target = (targetStatus || '').toLowerCase();

  if (current === target) {
    // Idempotent retry: same status is treated as already in that state
    return { allowed: true, idempotent: true };
  }

  const allowed = ALLOWED_TRANSITIONS[current] || [];
  if (!allowed.includes(target)) {
    return {
      allowed: false,
      status: 409,
      error: `Invalid status transition: Cannot move subscription request from '${current}' to '${target}'. Allowed transitions: [${allowed.join(', ') || 'none (terminal)'}].`
    };
  }

  // Specific rule: re-opening a rejected request requires a note
  if (current === 'rejected' && target === 'contacted') {
    if (!note || !note.trim()) {
      return {
        allowed: false,
        status: 400,
        error: 'Re-opening a rejected request to contacted status requires an explanatory note.'
      };
    }
  }

  return { allowed: true, idempotent: false };
}

/**
 * Execute a status transition inside a transaction.
 */
async function transitionRequestStatus({
  requestId,
  targetStatus,
  actorUser,
  note = null,
  rejectionReason = null
}) {
  const prisma = getSystemClient();

  return await prisma.$transaction(async (tx) => {
    const request = await tx.subscriptionRequest.findUnique({
      where: { id: requestId }
    });

    if (!request) {
      const err = new Error('Subscription request not found');
      err.statusCode = 404;
      throw err;
    }

    const currentStatus = request.status || 'new';

    // Check transition validity
    const check = validateTransition(currentStatus, targetStatus, note);
    if (!check.allowed) {
      const err = new Error(check.error);
      err.statusCode = check.status || 409;
      throw err;
    }

    // Double-click idempotency guard: if already in target state, return without duplicate events
    if (check.idempotent) {
      return { request, idempotent: true };
    }

    const now = new Date();
    const updateData = {
      status: targetStatus,
      updatedAt: now
    };

    if (targetStatus === 'contacted') {
      updateData.contacted_at = now;
      updateData.contacted_by = actorUser?.name || actorUser?.email || actorUser?.id || 'super-admin';
    } else if (targetStatus === 'rejected') {
      updateData.rejected_at = now;
      updateData.rejected_by = actorUser?.name || actorUser?.email || actorUser?.id || 'super-admin';
      updateData.rejection_reason = rejectionReason;
    }

    const updatedRequest = await tx.subscriptionRequest.update({
      where: { id: requestId },
      data: updateData
    });

    // Create event record in timeline
    const event = await tx.subscriptionRequestEvent.create({
      data: {
        id: crypto.randomUUID(),
        request_id: requestId,
        type: `status_${targetStatus}`,
        from_status: currentStatus,
        to_status: targetStatus,
        note: note ? note.trim() : (rejectionReason ? `Reason: ${rejectionReason}` : null),
        actor_id: actorUser?.id || null,
        actor_name: actorUser?.name || actorUser?.email || 'Super Admin',
        created_at: now
      }
    });

    // Activity log entry (non-blocking for tenant audit)
    try {
      await logActivity({
        actorUser,
        action: `SUBSCRIPTION_REQUEST_${targetStatus.toUpperCase()}`,
        category: 'SUPER_ADMIN',
        resourceType: 'SubscriptionRequest',
        resourceId: requestId,
        title: `Subscription request ${targetStatus}`,
        description: `Moved request for "${request.collegeName}" from ${currentStatus} to ${targetStatus}`,
        metadata: {
          fromStatus: currentStatus,
          toStatus: targetStatus,
          note: note || undefined,
          rejectionReason: rejectionReason || undefined
        }
      });
    } catch (logErr) {
      console.warn('[ActivityLog] Subscription request log failed:', logErr.message);
    }

    return { request: updatedRequest, event, idempotent: false };
  });
}

/**
 * Add a note to a subscription request without changing its status.
 */
async function addRequestNote({ requestId, note, actorUser }) {
  if (!note || !note.trim()) {
    const err = new Error('Note content cannot be empty');
    err.statusCode = 400;
    throw err;
  }

  const prisma = getSystemClient();

  return await prisma.$transaction(async (tx) => {
    const request = await tx.subscriptionRequest.findUnique({
      where: { id: requestId }
    });

    if (!request) {
      const err = new Error('Subscription request not found');
      err.statusCode = 404;
      throw err;
    }

    const now = new Date();
    const formattedNote = `[${now.toISOString().slice(0, 10)} ${actorUser?.name || 'SuperAdmin'}]: ${note.trim()}`;
    const newInternalNotes = request.internal_notes 
      ? `${request.internal_notes}\n\n${formattedNote}`
      : formattedNote;

    const updated = await tx.subscriptionRequest.update({
      where: { id: requestId },
      data: {
        internal_notes: newInternalNotes,
        updatedAt: now
      }
    });

    const event = await tx.subscriptionRequestEvent.create({
      data: {
        id: crypto.randomUUID(),
        request_id: requestId,
        type: 'note_added',
        from_status: request.status,
        to_status: request.status,
        note: note.trim(),
        actor_id: actorUser?.id || null,
        actor_name: actorUser?.name || actorUser?.email || 'Super Admin',
        created_at: now
      }
    });

    try {
      await logActivity({
        actorUser,
        action: 'SUBSCRIPTION_REQUEST_NOTE',
        category: 'SUPER_ADMIN',
        resourceType: 'SubscriptionRequest',
        resourceId: requestId,
        title: 'Subscription request note added',
        description: `Added note to request for "${request.collegeName}"`,
        metadata: { note: note.trim() }
      });
    } catch (logErr) {
      console.warn('[ActivityLog] Note activity log failed:', logErr.message);
    }

    return { request: updated, event };
  });
}

module.exports = {
  validateTransition,
  transitionRequestStatus,
  addRequestNote,
  ALLOWED_TRANSITIONS
};
