// ─── Credit Wallet Service (Phase 10: N20 Message Credit Wallet) ─────────
const { getSystemClient } = require('../config/prismaManager');
const { getMonthlyKey } = require('../config/planConstants');

/**
 * Retrieves wallet balances, active buckets, and consumption breakdown
 */
async function getWalletOverview(collegeId) {
  const prisma = getSystemClient();
  const currentPeriodKey = getMonthlyKey(new Date());

  // 1. Fetch current PLAN bucket balance
  const planEntry = await prisma.messageCreditLedgerEntry.findFirst({
    where: {
      college_id: collegeId,
      bucket: 'PLAN',
      periodKey: currentPeriodKey
    },
    orderBy: { createdAt: 'desc' }
  });
  const planBalance = planEntry ? planEntry.balanceAfter : 0;

  // 2. Fetch current PURCHASED bucket balance
  const purchasedEntry = await prisma.messageCreditLedgerEntry.findFirst({
    where: {
      college_id: collegeId,
      bucket: 'PURCHASED'
    },
    orderBy: { createdAt: 'desc' }
  });
  const purchasedBalance = purchasedEntry ? purchasedEntry.balanceAfter : 0;

  // 3. Aggregate 30-day consumption by channel
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
  const consumptionEntries = await prisma.messageCreditLedgerEntry.findMany({
    where: {
      college_id: collegeId,
      delta: { lt: 0 },
      createdAt: { gte: thirtyDaysAgo }
    }
  });

  let smsConsumed = 0;
  let whatsappConsumed = 0;
  for (const entry of consumptionEntries) {
    const creditsUsed = Math.abs(entry.delta);
    if (entry.type === 'SMS_DEBIT') smsConsumed += creditsUsed;
    else if (entry.type === 'WHATSAPP_DEBIT') whatsappConsumed += creditsUsed;
  }

  // 4. In-App notifications are 0 credits (OD-11 / 8F invariant)
  const inAppNotificationsCount = await prisma.guardianNotification.count({
    where: {
      student: { college_id: collegeId },
      createdAt: { gte: thirtyDaysAgo }
    }
  }).catch(() => 0);

  return {
    balances: {
      total: planBalance + purchasedBalance,
      plan: {
        balance: planBalance,
        periodKey: currentPeriodKey
      },
      purchased: {
        balance: purchasedBalance,
        neverExpires: true
      }
    },
    consumption30Days: {
      smsCredits: smsConsumed,
      whatsappCredits: whatsappConsumed,
      inAppDispatches: inAppNotificationsCount,
      inAppCreditsBilled: 0 // In-app always costs 0 credits
    },
    topUpStatus: {
      isPurchasable: false,
      notice: 'SMS and WhatsApp delivery is not active yet. In-app notifications are free of credit charges.'
    }
  };
}

/**
 * Paged ledger of all credit balance changes
 */
async function getLedgerEntries(collegeId, { page = 1, limit = 50, bucket, type, startDate, endDate } = {}) {
  const prisma = getSystemClient();
  const take = Math.min(Math.max(1, parseInt(limit, 10) || 50), 100);
  const skip = (Math.max(1, parseInt(page, 10) || 1) - 1) * take;

  const where = { college_id: collegeId };
  if (bucket) where.bucket = bucket.toUpperCase();
  if (type) where.type = type.toUpperCase();

  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = new Date(startDate);
    if (endDate) where.createdAt.lte = new Date(endDate);
  }

  const [entries, total] = await Promise.all([
    prisma.messageCreditLedgerEntry.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take
    }),
    prisma.messageCreditLedgerEntry.count({ where })
  ]);

  return {
    entries,
    pagination: {
      total,
      page: Math.max(1, parseInt(page, 10) || 1),
      limit: take,
      totalPages: Math.ceil(total / take)
    }
  };
}

module.exports = {
  getWalletOverview,
  getLedgerEntries
};

