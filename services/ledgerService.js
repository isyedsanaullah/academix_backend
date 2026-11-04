const { getSystemClient } = require('../config/prismaManager');
const { getMonthlyKey, PLAN_LIMITS } = require('../config/planConstants');
const { getEntitlements } = require('./entitlements');

class InsufficientCreditsError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'InsufficientCreditsError';
    this.code = 'INSUFFICIENT_CREDITS';
    this.details = details;
  }
}

/**
 * Ensures the monthly credit grant for the current month has been seeded for the college.
 */
async function ensureMonthlyGrant(collegeId, tx = null) {
  const prisma = tx || getSystemClient();
  const now = new Date();
  const currentPeriodKey = getMonthlyKey(now);

  const entitlements = await getEntitlements(collegeId, prisma);
  const limits = PLAN_LIMITS[entitlements.planId] || PLAN_LIMITS.starter;

  // 1. Message Credits Grant (if included in plan)
  if (limits.messageCreditsMonthly > 0) {
    const existingMsgGrant = await prisma.messageCreditLedgerEntry.findUnique({
      where: {
        college_id_bucket_periodKey: {
          college_id: collegeId,
          bucket: 'PLAN',
          periodKey: currentPeriodKey
        }
      }
    });

    if (!existingMsgGrant) {
      await prisma.messageCreditLedgerEntry.create({
        data: {
          college_id: collegeId,
          bucket: 'PLAN',
          periodKey: currentPeriodKey,
          delta: limits.messageCreditsMonthly,
          type: 'MONTHLY_GRANT',
          balanceAfter: limits.messageCreditsMonthly,
          referenceId: `GRANT_${currentPeriodKey}`
        }
      });
    }
  }

  // 2. AI Credits Grant (if included in plan)
  if (limits.aiCreditsMonthly > 0) {
    const existingAIGrant = await prisma.aICreditLedgerEntry.findUnique({
      where: {
        college_id_bucket_periodKey: {
          college_id: collegeId,
          bucket: 'PLAN',
          periodKey: currentPeriodKey
        }
      }
    });

    if (!existingAIGrant) {
      await prisma.aICreditLedgerEntry.create({
        data: {
          college_id: collegeId,
          bucket: 'PLAN',
          periodKey: currentPeriodKey,
          delta: limits.aiCreditsMonthly,
          type: 'MONTHLY_GRANT',
          balanceAfter: limits.aiCreditsMonthly,
          taskType: 'MONTHLY_GRANT'
        }
      });
    }
  }

  return currentPeriodKey;
}

/**
 * Gets real-time balance across PLAN and PURCHASED buckets for Message Credits (SMS / WhatsApp).
 */
async function getMessageCreditBalance(collegeId, tx = null) {
  const prisma = tx || getSystemClient();
  const currentPeriodKey = await ensureMonthlyGrant(collegeId, prisma);

  // Plan bucket for current month
  const planAgg = await prisma.messageCreditLedgerEntry.aggregate({
    where: {
      college_id: collegeId,
      bucket: 'PLAN',
      periodKey: currentPeriodKey
    },
    _sum: { delta: true }
  });
  const planBalance = Math.max(0, planAgg._sum.delta || 0);

  // Purchased bucket (rolls over indefinitely)
  const purchasedAgg = await prisma.messageCreditLedgerEntry.aggregate({
    where: {
      college_id: collegeId,
      bucket: 'PURCHASED'
    },
    _sum: { delta: true }
  });
  const purchasedBalance = Math.max(0, purchasedAgg._sum.delta || 0);

  return {
    planBalance,
    purchasedBalance,
    totalBalance: planBalance + purchasedBalance,
    periodKey: currentPeriodKey
  };
}

/**
 * Debits Message Credits following strict dual-bucket ordering:
 * 1. Debits available balance from PLAN bucket for current month.
 * 2. Debits remaining balance from PURCHASED bucket.
 * Throws InsufficientCreditsError if total balance is insufficient.
 */
async function debitMessageCredits(collegeId, amount, type = 'SMS_DEBIT', referenceId = null) {
  if (amount <= 0) return { debited: 0 };
  const prisma = getSystemClient();

  return await prisma.$transaction(async (tx) => {
    const balances = await getMessageCreditBalance(collegeId, tx);

    if (balances.totalBalance < amount) {
      throw new InsufficientCreditsError(
        `Insufficient message credits. Required: ${amount}, Available: ${balances.totalBalance} (Plan: ${balances.planBalance}, Purchased: ${balances.purchasedBalance}).`,
        {
          required: amount,
          available: balances.totalBalance,
          planBalance: balances.planBalance,
          purchasedBalance: balances.purchasedBalance
        }
      );
    }

    let remainingToDebit = amount;
    const currentPeriodKey = balances.periodKey;

    // 1. Debit from PLAN bucket first
    if (balances.planBalance > 0 && remainingToDebit > 0) {
      const planDebit = Math.min(balances.planBalance, remainingToDebit);
      const newPlanBal = balances.planBalance - planDebit;
      remainingToDebit -= planDebit;

      await tx.messageCreditLedgerEntry.create({
        data: {
          college_id: collegeId,
          bucket: 'PLAN',
          periodKey: currentPeriodKey,
          delta: -planDebit,
          type,
          balanceAfter: newPlanBal,
          referenceId
        }
      });
    }

    // 2. Debit from PURCHASED bucket second
    if (remainingToDebit > 0) {
      const purchasedDebit = remainingToDebit;
      const newPurchasedBal = balances.purchasedBalance - purchasedDebit;

      await tx.messageCreditLedgerEntry.create({
        data: {
          college_id: collegeId,
          bucket: 'PURCHASED',
          periodKey: null,
          delta: -purchasedDebit,
          type,
          balanceAfter: newPurchasedBal,
          referenceId
        }
      });
    }

    const updatedBalances = await getMessageCreditBalance(collegeId, tx);
    return {
      debited: amount,
      balances: updatedBalances
    };
  });
}

/**
 * Gets real-time balance across PLAN and PURCHASED buckets for AI Credits.
 */
async function getAICreditBalance(collegeId, tx = null) {
  const prisma = tx || getSystemClient();
  const currentPeriodKey = await ensureMonthlyGrant(collegeId, prisma);

  // Plan bucket for current month
  const planAgg = await prisma.aICreditLedgerEntry.aggregate({
    where: {
      college_id: collegeId,
      bucket: 'PLAN',
      periodKey: currentPeriodKey
    },
    _sum: { delta: true }
  });
  const planBalance = Math.max(0, planAgg._sum.delta || 0);

  // Purchased bucket (rolls over indefinitely)
  const purchasedAgg = await prisma.aICreditLedgerEntry.aggregate({
    where: {
      college_id: collegeId,
      bucket: 'PURCHASED'
    },
    _sum: { delta: true }
  });
  const purchasedBalance = Math.max(0, purchasedAgg._sum.delta || 0);

  return {
    planBalance,
    purchasedBalance,
    totalBalance: planBalance + purchasedBalance,
    periodKey: currentPeriodKey
  };
}

/**
 * Debits AI Credits following strict dual-bucket ordering:
 * Model tier multiplier:
 * - 'lite': 1 credit = 1 token
 * - 'advanced' / 'standard': 20 credits = 1 token
 */
async function debitAICredits(collegeId, rawTokens, modelTier = 'lite', taskType = 'AI_TASK') {
  const multiplier = modelTier === 'advanced' ? 20 : 1;
  const creditsRequired = rawTokens * multiplier;
  if (creditsRequired <= 0) return { debited: 0 };

  const prisma = getSystemClient();

  return await prisma.$transaction(async (tx) => {
    const balances = await getAICreditBalance(collegeId, tx);

    if (balances.totalBalance < creditsRequired) {
      throw new InsufficientCreditsError(
        `Insufficient AI credits. Required: ${creditsRequired} (${rawTokens} tokens x ${multiplier}), Available: ${balances.totalBalance}.`,
        {
          rawTokens,
          modelTier,
          multiplier,
          required: creditsRequired,
          available: balances.totalBalance,
          planBalance: balances.planBalance,
          purchasedBalance: balances.purchasedBalance
        }
      );
    }

    let remainingToDebit = creditsRequired;
    const currentPeriodKey = balances.periodKey;

    // 1. Debit from PLAN bucket first
    if (balances.planBalance > 0 && remainingToDebit > 0) {
      const planDebit = Math.min(balances.planBalance, remainingToDebit);
      const newPlanBal = balances.planBalance - planDebit;
      remainingToDebit -= planDebit;

      await tx.aICreditLedgerEntry.create({
        data: {
          college_id: collegeId,
          bucket: 'PLAN',
          periodKey: currentPeriodKey,
          delta: -planDebit,
          type: 'TASK_DEBIT',
          balanceAfter: newPlanBal,
          taskType
        }
      });
    }

    // 2. Debit from PURCHASED bucket second
    if (remainingToDebit > 0) {
      const purchasedDebit = remainingToDebit;
      const newPurchasedBal = balances.purchasedBalance - purchasedDebit;

      await tx.aICreditLedgerEntry.create({
        data: {
          college_id: collegeId,
          bucket: 'PURCHASED',
          periodKey: null,
          delta: -purchasedDebit,
          type: 'TASK_DEBIT',
          balanceAfter: newPurchasedBal,
          taskType
        }
      });
    }

    const updatedBalances = await getAICreditBalance(collegeId, tx);
    return {
      debited: creditsRequired,
      rawTokens,
      modelTier,
      balances: updatedBalances
    };
  });
}

/**
 * Grants purchased credits (e.g. following Super Admin payment verification).
 */
async function grantPurchasedCredits(collegeId, type, amount, referenceId = null) {
  const prisma = getSystemClient();

  if (type === 'MESSAGE_CREDITS') {
    const current = await getMessageCreditBalance(collegeId);
    return await prisma.messageCreditLedgerEntry.create({
      data: {
        college_id: collegeId,
        bucket: 'PURCHASED',
        periodKey: null,
        delta: amount,
        type: 'PURCHASE',
        balanceAfter: current.purchasedBalance + amount,
        referenceId
      }
    });
  } else if (type === 'AI_CREDITS') {
    const current = await getAICreditBalance(collegeId);
    return await prisma.aICreditLedgerEntry.create({
      data: {
        college_id: collegeId,
        bucket: 'PURCHASED',
        periodKey: null,
        delta: amount,
        type: 'PURCHASE',
        balanceAfter: current.purchasedBalance + amount,
        taskType: 'PURCHASE_TOPUP'
      }
    });
  }
}

module.exports = {
  InsufficientCreditsError,
  ensureMonthlyGrant,
  getMessageCreditBalance,
  debitMessageCredits,
  getAICreditBalance,
  debitAICredits,
  grantPurchasedCredits
};

