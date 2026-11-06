'use strict';

/**
 * workflowHandlers.js — Phase 9D (#N11)
 * Registry of domain action handlers executed upon final step approval.
 * Handlers run inside the atomic approval transaction.
 * If a handler throws, the entire approval transaction rolls back.
 */

const workflowHandlers = {
  FEE_CONCESSION: {
    async validate(payload, tx) {
      if (!payload || !payload.feeId || !payload.discountAmount) {
        throw new Error('FEE_CONCESSION requires feeId and discountAmount');
      }
      const fee = await tx.fee.findUnique({ where: { id: payload.feeId } });
      if (!fee) throw new Error(`Fee with ID ${payload.feeId} not found`);
      if (Number(payload.discountAmount) <= 0) {
        throw new Error('Discount amount must be greater than 0');
      }
      return true;
    },
    async execute(tx, payload) {
      const discount = Number(payload.discountAmount);
      const fee = await tx.fee.findUnique({ where: { id: payload.feeId } });
      const currentTotal = Number(fee.totalAmount || 0);
      const newTotal = Math.max(0, currentTotal - discount);

      return tx.fee.update({
        where: { id: payload.feeId },
        data: {
          totalAmount: newTotal,
          scholarshipDeduction: Number(fee.scholarshipDeduction || 0) + discount
        }
      });
    }
  },

  FEE_REFUND: {
    async validate(payload, tx) {
      if (!payload || !payload.feeId || !payload.refundAmount) {
        throw new Error('FEE_REFUND requires feeId and refundAmount');
      }
      const fee = await tx.fee.findUnique({ where: { id: payload.feeId } });
      if (!fee) throw new Error(`Fee with ID ${payload.feeId} not found`);
      if (Number(payload.refundAmount) > (fee.paidAmount || 0)) {
        throw new Error('Refund amount cannot exceed paid amount');
      }
      return true;
    },
    async execute(tx, payload) {
      const refund = Number(payload.refundAmount);
      const fee = await tx.fee.findUnique({ where: { id: payload.feeId } });
      const newPaid = Math.max(0, (fee.paidAmount || 0) - refund);

      return tx.fee.update({
        where: { id: payload.feeId },
        data: {
          paidAmount: newPaid,
          status: newPaid <= 0 ? 'REFUNDED' : 'PARTIAL'
        }
      });
    }
  },

  STAFF_LEAVE: {
    async validate(payload, tx) {
      if (!payload || !payload.leaveId) {
        throw new Error('STAFF_LEAVE requires leaveId');
      }
      const leave = await tx.staffLeave.findUnique({ where: { id: payload.leaveId } });
      if (!leave) throw new Error(`Staff leave with ID ${payload.leaveId} not found`);
      return true;
    },
    async execute(tx, payload) {
      return tx.staffLeave.update({
        where: { id: payload.leaveId },
        data: {
          status: 'APPROVED',
          approvedAt: new Date(),
          approvalNote: payload.note || 'Approved via multi-step workflow'
        }
      });
    }
  },

  STUDENT_LEAVE: {
    async validate(payload, tx) {
      if (!payload || !payload.leaveId) {
        throw new Error('STUDENT_LEAVE requires leaveId');
      }
      const leave = await tx.leaveApplication.findUnique({ where: { id: payload.leaveId } });
      if (!leave) throw new Error(`Student leave with ID ${payload.leaveId} not found`);
      return true;
    },
    async execute(tx, payload) {
      const { executeLeaveApprovalCore } = require('./studentLeaveService');
      return await executeLeaveApprovalCore(tx, payload.leaveId, payload.reviewerId, payload.reviewRemarks);
    }
  },

  MARKS_EDIT: {
    async validate(payload, tx) {
      if (!payload || (!payload.studentId && !payload.resultId)) {
        throw new Error('MARKS_EDIT requires studentId or resultId');
      }
      return true;
    },
    async execute(tx, payload) {
      if (payload.resultId && payload.revisedMarks !== undefined) {
        const result = await tx.result.findUnique({ where: { id: payload.resultId } });
        if (result) {
          let updatedMarks = typeof result.marks === 'object' && result.marks !== null ? { ...result.marks } : {};
          const subjectKey = payload.subjectId || payload.subject || 'score';
          updatedMarks[subjectKey] = Number(payload.revisedMarks);

          let totalObtained = 0;
          let count = 0;
          for (const v of Object.values(updatedMarks)) {
            const num = Number(v);
            if (!isNaN(num)) {
              totalObtained += num;
              count++;
            }
          }
          const totalMarks = result.totalMarks || (count * 100);
          const percentage = totalMarks > 0 ? (totalObtained / totalMarks) * 100 : 0;

          await tx.result.update({
            where: { id: payload.resultId },
            data: {
              marks: updatedMarks,
              totalObtained,
              percentage,
            }
          });
        }
        if (payload.recheckRequestId) {
          await tx.resultRecheckRequest.update({
            where: { id: payload.recheckRequestId },
            data: {
              status: 'RESOLVED_CHANGED',
              revisedMarks: payload.revisedMarks,
              resolvedAt: new Date(),
            }
          });
        }
      }
      return { success: true, marksUpdated: payload.revisedMarks || payload.marksObtained };
    }
  },

  PURCHASE_ORDER: {
    async validate(payload, tx) {
      if (!payload || (!payload.amount && !payload.poId)) {
        throw new Error('PURCHASE_ORDER requires amount or poId');
      }
      return true;
    },
    async execute(tx, payload) {
      if (payload.poId) {
        await tx.purchaseOrder.update({
          where: { id: payload.poId },
          data: {
            status: 'APPROVED',
            approvedById: payload.approverId || null,
          },
        });
      }
      return { success: true, poApproved: true, amount: payload.amount };
    }
  },

  CAMPUS_TRANSFER: {
    async validate(payload, tx) {
      const { executeTransferCore } = require('./transferService');
      await executeTransferCore(tx, payload, { dryRun: true });
      return true;
    },
    async execute(tx, payload) {
      const { executeTransferCore } = require('./transferService');
      return await executeTransferCore(tx, payload, { dryRun: false });
    }
  }
};

module.exports = {
  workflowHandlers
};
