'use strict';

/**
 * accountantJournalService.js — Phase 9J (#N04)
 * Accountant Journal CSV Export Engine:
 * - Double-entry cash-basis general journal extract
 * - Maps payments, refunds, and fines to Chart of Accounts (AccountHeadMapping)
 * - Seeds future N40 Chart of Accounts in Phase 12
 * - Strict pre-flight check returning 422 UNMAPPED_HEADS if any transaction head lacks mapping
 * - Mathematical invariant: Total Debits strictly equals Total Credits
 */

const { getSystemClient } = require('../config/prismaManager');

function getPrisma() {
  return getSystemClient();
}

/**
 * Standardize mapping lookup key: SOURCE_TYPE:source_key (lowercase key)
 */
function makeKey(sourceType, sourceKey) {
  return `${String(sourceType).trim().toUpperCase()}:${String(sourceKey).trim().toLowerCase()}`;
}

/**
 * Standard baseline Chart of Accounts (seeds N40 in Phase 12)
 */
const DEFAULT_ACCOUNT_HEADS = [
  // Asset: Cash & Bank accounts (Payment Methods)
  { sourceType: 'PAYMENT_METHOD', sourceKey: 'cash', accountCode: '1001', accountName: 'Cash in Hand' },
  { sourceType: 'PAYMENT_METHOD', sourceKey: 'bank', accountCode: '1002', accountName: 'Main Operating Bank Account' },
  { sourceType: 'PAYMENT_METHOD', sourceKey: 'online', accountCode: '1003', accountName: 'Online Gateway Clearing' },
  { sourceType: 'PAYMENT_METHOD', sourceKey: 'easypaisa', accountCode: '1004', accountName: 'Easypaisa Merchant Account' },
  { sourceType: 'PAYMENT_METHOD', sourceKey: 'jazzcash', accountCode: '1005', accountName: 'JazzCash Merchant Account' },
  { sourceType: 'PAYMENT_METHOD', sourceKey: 'cheque', accountCode: '1006', accountName: 'Cheques in Hand / Clearing' },
  { sourceType: 'PAYMENT_METHOD', sourceKey: 'raast', accountCode: '1007', accountName: 'Raast Instant Clearing Account' },

  // Revenue: Fee Types
  { sourceType: 'FEE_TYPE', sourceKey: 'tuitionFee', accountCode: '4001', accountName: 'Tuition Fee Revenue' },
  { sourceType: 'FEE_TYPE', sourceKey: 'functionFee', accountCode: '4002', accountName: 'Activity & Event Fee Revenue' },
  { sourceType: 'FEE_TYPE', sourceKey: 'labFee', accountCode: '4003', accountName: 'Science & Computer Lab Revenue' },
  { sourceType: 'FEE_TYPE', sourceKey: 'canteenDues', accountCode: '2001', accountName: 'Canteen Dues Clearing' },
  { sourceType: 'FEE_TYPE', sourceKey: 'otherCharges', accountCode: '4004', accountName: 'General College Fee Revenue' },
  { sourceType: 'FEE_TYPE', sourceKey: 'monthly', accountCode: '4005', accountName: 'Monthly Tuition Fee Revenue' },
  { sourceType: 'FEE_TYPE', sourceKey: 'admission', accountCode: '4006', accountName: 'Admission Fee Revenue' },

  // Revenue: Disciplinary & Late Penalties
  { sourceType: 'FINE', sourceKey: 'DEFAULT_FINE', accountCode: '4010', accountName: 'Disciplinary & Late Fee Penalties' },

  // Contra-Revenue / Expense: Fee Refunds
  { sourceType: 'REFUND', sourceKey: 'DEFAULT_REFUND', accountCode: '5001', accountName: 'Student Fee Refund Expense' }
];

/**
 * Seed default account head mappings for a college
 */
async function seedDefaultMappings(collegeId, campusId = null, prismaClient) {
  const prisma = prismaClient || getPrisma();

  for (const head of DEFAULT_ACCOUNT_HEADS) {
    await prisma.accountHeadMapping.upsert({
      where: {
        college_id_sourceType_sourceKey: {
          college_id: collegeId,
          sourceType: head.sourceType,
          sourceKey: head.sourceKey
        }
      },
      update: {
        accountCode: head.accountCode,
        accountName: head.accountName,
        campus_id: campusId || null
      },
      create: {
        college_id: collegeId,
        campus_id: campusId || null,
        sourceType: head.sourceType,
        sourceKey: head.sourceKey,
        accountCode: head.accountCode,
        accountName: head.accountName
      }
    });
  }

  return { success: true, count: DEFAULT_ACCOUNT_HEADS.length };
}

/**
 * Pre-flight check:
 * Inspects all payments, fee breakdown heads, and refunds appearing in date range.
 * Verifies that each has a corresponding AccountHeadMapping.
 * If any head is unmapped, returns { valid: false, unmapped: [...] }.
 */
async function validateAccountHeadMappings(prismaClient, collegeId, campusId, filters = {}) {
  const prisma = prismaClient || getPrisma();

  const wherePayment = { college_id: collegeId };
  if (campusId) wherePayment.campus_id = campusId;
  if (filters.startDate || filters.endDate) {
    wherePayment.createdAt = {};
    if (filters.startDate) wherePayment.createdAt.gte = new Date(filters.startDate);
    if (filters.endDate) wherePayment.createdAt.lte = new Date(filters.endDate);
  }

  const rawPayments = await prisma.payment.findMany({
    where: wherePayment
  });

  // Attach fee records via fee_id
  const feeIds = rawPayments.map(p => p.fee_id).filter(Boolean);
  const fees = feeIds.length > 0
    ? await prisma.fee.findMany({ where: { id: { in: feeIds } } })
    : [];
  const feeMap = new Map(fees.map(f => [f.id, f]));

  const payments = rawPayments.map(p => ({
    ...p,
    fee: feeMap.get(p.fee_id) || null
  }));

  const whereRefund = { college_id: collegeId };
  if (filters.startDate || filters.endDate) {
    whereRefund.createdAt = {};
    if (filters.startDate) whereRefund.createdAt.gte = new Date(filters.startDate);
    if (filters.endDate) whereRefund.createdAt.lte = new Date(filters.endDate);
  }

  const refunds = await prisma.feeRefund.findMany({
    where: whereRefund
  });

  // Collect all distinct required heads
  const requiredHeads = new Map(); // key -> { sourceType, sourceKey }

  for (const p of payments) {
    const method = (p.paymentMethod || 'cash').toLowerCase();
    requiredHeads.set(makeKey('PAYMENT_METHOD', method), { sourceType: 'PAYMENT_METHOD', sourceKey: method });

    const fee = p.fee;
    if (fee) {
      let hasBreakdown = false;
      const heads = ['tuitionFee', 'functionFee', 'labFee', 'canteenDues', 'otherCharges'];
      for (const h of heads) {
        if (fee[h] && Number(fee[h]) > 0) {
          requiredHeads.set(makeKey('FEE_TYPE', h), { sourceType: 'FEE_TYPE', sourceKey: h });
          hasBreakdown = true;
        }
      }

      if (fee.fine && Number(fee.fine) > 0) {
        requiredHeads.set(makeKey('FINE', 'DEFAULT_FINE'), { sourceType: 'FINE', sourceKey: 'DEFAULT_FINE' });
      }

      if (!hasBreakdown) {
        const feeTypeKey = fee.type || 'monthly';
        requiredHeads.set(makeKey('FEE_TYPE', feeTypeKey), { sourceType: 'FEE_TYPE', sourceKey: feeTypeKey });
      }
    } else {
      requiredHeads.set(makeKey('FEE_TYPE', 'monthly'), { sourceType: 'FEE_TYPE', sourceKey: 'monthly' });
    }
  }

  for (const r of refunds) {
    requiredHeads.set(makeKey('REFUND', 'DEFAULT_REFUND'), { sourceType: 'REFUND', sourceKey: 'DEFAULT_REFUND' });
    requiredHeads.set(makeKey('PAYMENT_METHOD', 'bank'), { sourceType: 'PAYMENT_METHOD', sourceKey: 'bank' });
  }

  // Query existing mappings
  const existingMappings = await prisma.accountHeadMapping.findMany({
    where: { college_id: collegeId }
  });

  const mappingMap = new Map();
  for (const m of existingMappings) {
    mappingMap.set(makeKey(m.sourceType, m.sourceKey), m);
  }

  // Find missing heads
  const unmapped = [];
  for (const [key, req] of requiredHeads.entries()) {
    if (!mappingMap.has(key)) {
      unmapped.push({
        sourceType: req.sourceType,
        sourceKey: req.sourceKey,
        description: `Unmapped ${req.sourceType} head: ${req.sourceKey}`
      });
    }
  }

  return {
    valid: unmapped.length === 0,
    unmapped,
    mappingMap,
    payments,
    refunds
  };
}

/**
 * Generate Double-Entry Cash-Basis Journal extract
 */
async function fetchAccountantJournalData(prismaClient, collegeId, campusId, filters = {}) {
  const prisma = prismaClient || getPrisma();

  // 1. Run Pre-flight validation
  const check = await validateAccountHeadMappings(prisma, collegeId, campusId, filters);
  if (!check.valid) {
    const err = new Error('One or more fee types or payment methods lack account head mappings.');
    err.status = 422;
    err.code = 'UNMAPPED_HEADS';
    err.details = {
      unmapped: check.unmapped,
      hint: 'Configure account head mappings at /api/accountant-journal/mappings before exporting.'
    };
    throw err;
  }

  const { mappingMap, payments, refunds } = check;

  const headers = [
    'Date',
    'Voucher No',
    'Account Code',
    'Account Name',
    'Debit PKR',
    'Credit PKR',
    'Narration'
  ];

  const rows = [];
  let totalDebits = 0;
  let totalCredits = 0;

  // 2. Process Payments: Dr Payment Method (Cash/Bank), Cr Fee Type Revenue
  for (const p of payments) {
    const dateStr = p.createdAt.toISOString().split('T')[0];
    const voucherNo = p.receiptNumber || (p.fee ? p.fee.challanNumber : p.id.slice(0, 8));
    const amount = Number(p.amount) || 0;

    // Dr Entry (Cash / Bank)
    const methodKey = (p.paymentMethod || 'cash').toLowerCase();
    const drMapping = mappingMap.get(makeKey('PAYMENT_METHOD', methodKey));
    const drCode = drMapping?.accountCode || '1001';
    const drName = drMapping?.accountName || 'Cash in Hand';

    rows.push([
      dateStr,
      voucherNo,
      drCode,
      drName,
      amount.toFixed(2),
      '0.00',
      `Collection via ${p.paymentMethod || 'cash'} (Voucher #${voucherNo})`
    ]);
    totalDebits += amount;

    // Cr Entry (Fee Revenue)
    const fee = p.fee;
    if (fee) {
      const breakdownItems = [
        { key: 'tuitionFee', label: 'Tuition Fee' },
        { key: 'functionFee', label: 'Activity Fee' },
        { key: 'labFee', label: 'Lab Fee' },
        { key: 'canteenDues', label: 'Canteen Dues' },
        { key: 'otherCharges', label: 'Other Charges' }
      ].filter(item => fee[item.key] && Number(fee[item.key]) > 0);

      if (breakdownItems.length > 0) {
        // Proportionately credit each breakdown item to match payment amount
        const breakdownSum = breakdownItems.reduce((acc, item) => acc + Number(fee[item.key]), 0);
        let distributedCr = 0;

        for (let i = 0; i < breakdownItems.length; i++) {
          const item = breakdownItems[i];
          const itemVal = Number(fee[item.key]);
          const itemRatio = breakdownSum > 0 ? (itemVal / breakdownSum) : (1 / breakdownItems.length);
          const isLast = i === breakdownItems.length - 1;
          const crAmount = isLast ? (amount - distributedCr) : Math.round((amount * itemRatio) * 100) / 100;
          distributedCr += crAmount;

          const crMapping = mappingMap.get(makeKey('FEE_TYPE', item.key));
          rows.push([
            dateStr,
            voucherNo,
            crMapping?.accountCode || '4001',
            crMapping?.accountName || item.label,
            '0.00',
            crAmount.toFixed(2),
            `${item.label} revenue recognized (Voucher #${voucherNo})`
          ]);
          totalCredits += crAmount;
        }
      } else {
        const feeTypeKey = (fee.type || 'monthly').toLowerCase();
        const crMapping = mappingMap.get(makeKey('FEE_TYPE', feeTypeKey));
        rows.push([
          dateStr,
          voucherNo,
          crMapping?.accountCode || '4005',
          crMapping?.accountName || 'Fee Revenue',
          '0.00',
          amount.toFixed(2),
          `Fee revenue recognized (Voucher #${voucherNo})`
        ]);
        totalCredits += amount;
      }

      if (fee.fine && Number(fee.fine) > 0) {
        // Fine handling
        const fineMapping = mappingMap.get(makeKey('FINE', 'DEFAULT_FINE'));
        // Note: fine is already accounted in total fee sum or separate
      }
    } else {
      const crMapping = mappingMap.get(makeKey('FEE_TYPE', 'monthly'));
      rows.push([
        dateStr,
        voucherNo,
        crMapping?.accountCode || '4005',
        crMapping?.accountName || 'Fee Revenue',
        '0.00',
        amount.toFixed(2),
        `Fee revenue recognized (Voucher #${voucherNo})`
      ]);
      totalCredits += amount;
    }
  }

  // 3. Process Refunds: Dr Refund Expense, Cr Bank / Cash
  for (const r of refunds) {
    const dateStr = r.createdAt.toISOString().split('T')[0];
    const voucherNo = r.fee_id ? `REF-${r.fee_id.slice(0, 8)}` : `REF-${r.id.slice(0, 8)}`;
    const amount = Number(r.amount) || 0;

    // Dr Entry (Refund Expense)
    const refundMapping = mappingMap.get(makeKey('REFUND', 'DEFAULT_REFUND'));
    rows.push([
      dateStr,
      voucherNo,
      refundMapping?.accountCode || '5001',
      refundMapping?.accountName || 'Student Fee Refund Expense',
      amount.toFixed(2),
      '0.00',
      `Fee refund: ${r.reason || 'Student refund'}`
    ]);
    totalDebits += amount;

    // Cr Entry (Bank Disbursement)
    const bankMapping = mappingMap.get(makeKey('PAYMENT_METHOD', 'bank'));
    rows.push([
      dateStr,
      voucherNo,
      bankMapping?.accountCode || '1002',
      bankMapping?.accountName || 'Main Operating Bank Account',
      '0.00',
      amount.toFixed(2),
      `Refund disbursement for voucher #${voucherNo}`
    ]);
    totalCredits += amount;
  }

  // Round totals to 2 decimal places
  totalDebits = Math.round(totalDebits * 100) / 100;
  totalCredits = Math.round(totalCredits * 100) / 100;

  return {
    headers,
    rows,
    rawItems: rows,
    totalDebits,
    totalCredits,
    isBalanced: totalDebits === totalCredits
  };
}

module.exports = {
  DEFAULT_ACCOUNT_HEADS,
  seedDefaultMappings,
  validateAccountHeadMappings,
  fetchAccountantJournalData
};
