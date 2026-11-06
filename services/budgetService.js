'use strict';

const { getSystemClient } = require('../config/prismaManager');
const prisma = getSystemClient();

class BudgetService {
  /**
   * Allocate or update a department budget for a fiscal year.
   * Isolates budgets per campus if campusId is provided.
   */
  async allocateBudget({ collegeId, campusId = null, fiscalYear, department, allocatedPkr }) {
    if (!collegeId || !fiscalYear || !department || allocatedPkr === undefined) {
      const err = new Error('collegeId, fiscalYear, department, and allocatedPkr are required');
      err.code = 'VALIDATION_ERROR';
      throw err;
    }

    const allocAmt = Number(allocatedPkr);
    if (allocAmt <= 0) {
      const err = new Error('allocatedPkr must be greater than 0');
      err.code = 'VALIDATION_ERROR';
      throw err;
    }

    // Check if budget exists for this fiscalYear, department, and campusId
    const existing = await prisma.departmentBudget.findFirst({
      where: {
        college_id: collegeId,
        fiscalYear,
        department,
        campus_id: campusId,
      },
    });

    if (existing) {
      return await prisma.departmentBudget.update({
        where: { id: existing.id },
        data: { allocatedPkr: allocAmt },
      });
    }

    return await prisma.departmentBudget.create({
      data: {
        college_id: collegeId,
        campus_id: campusId,
        fiscalYear,
        department,
        allocatedPkr: allocAmt,
        consumedPkr: 0,
        blockedPkr: 0,
      },
    });
  }

  /**
   * Check budget availability and atomically block funds for a purchase order.
   * Invariant: consumedPkr + blockedPkr + amountPkr <= allocatedPkr
   */
  async checkAndCommitBudget({ collegeId, budgetId, amountPkr, referenceType = 'PURCHASE_ORDER', referenceId }) {
    const amt = Number(amountPkr);
    if (amt <= 0) return null;

    return await prisma.$transaction(async (tx) => {
      const budget = await tx.departmentBudget.findFirst({
        where: { id: budgetId, college_id: collegeId },
      });

      if (!budget) {
        const err = new Error('Department budget not found');
        err.code = 'NOT_FOUND';
        throw err;
      }

      const totalProjected = budget.consumedPkr + budget.blockedPkr + amt;
      if (totalProjected > budget.allocatedPkr) {
        const remaining = Math.max(0, budget.allocatedPkr - (budget.consumedPkr + budget.blockedPkr));
        const err = new Error(
          `DEPARTMENT_BUDGET_EXCEEDED: Transaction amount (PKR ${amt}) exceeds remaining department budget (PKR ${remaining} of PKR ${budget.allocatedPkr})`
        );
        err.code = 'DEPARTMENT_BUDGET_EXCEEDED';
        throw err;
      }

      // Block the funds
      await tx.departmentBudget.update({
        where: { id: budget.id },
        data: { blockedPkr: budget.blockedPkr + amt },
      });

      // Record commitment
      return await tx.budgetExpenseCommitment.create({
        data: {
          budgetId: budget.id,
          referenceType,
          referenceId,
          amountPkr: amt,
          status: 'COMMITTED',
        },
      });
    });
  }

  /**
   * Settle a commitment when goods are received or billed.
   */
  async settleCommitment({ commitmentId }) {
    return await prisma.$transaction(async (tx) => {
      const commitment = await tx.budgetExpenseCommitment.findUnique({
        where: { id: commitmentId },
        include: { budget: true },
      });

      if (!commitment || commitment.status !== 'COMMITTED') {
        const err = new Error('Commitment not found or already settled/released');
        err.code = 'INVALID_COMMITMENT_STATE';
        throw err;
      }

      const amt = commitment.amountPkr;
      await tx.departmentBudget.update({
        where: { id: commitment.budgetId },
        data: {
          blockedPkr: Math.max(0, commitment.budget.blockedPkr - amt),
          consumedPkr: commitment.budget.consumedPkr + amt,
        },
      });

      return await tx.budgetExpenseCommitment.update({
        where: { id: commitmentId },
        data: { status: 'SETTLED' },
      });
    });
  }

  /**
   * Get department budget summaries with utilization percentages.
   */
  async getDepartmentBudgetSummary({ collegeId, fiscalYear, campusId = null }) {
    const where = { college_id: collegeId };
    if (fiscalYear) where.fiscalYear = fiscalYear;
    if (campusId) where.campus_id = campusId;

    const budgets = await prisma.departmentBudget.findMany({
      where,
      include: {
        allocations: true,
      },
      orderBy: { department: 'asc' },
    });

    return budgets.map((b) => {
      const remainingPkr = Math.max(0, b.allocatedPkr - (b.consumedPkr + b.blockedPkr));
      const utilizationRate = b.allocatedPkr > 0 ? ((b.consumedPkr + b.blockedPkr) / b.allocatedPkr) * 100 : 0;

      return {
        id: b.id,
        fiscalYear: b.fiscalYear,
        department: b.department,
        campusId: b.campus_id,
        allocatedPkr: b.allocatedPkr,
        consumedPkr: b.consumedPkr,
        blockedPkr: b.blockedPkr,
        remainingPkr,
        utilizationRate: parseFloat(utilizationRate.toFixed(2)),
      };
    });
  }
}

module.exports = new BudgetService();

