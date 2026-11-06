'use strict';

const { getSystemClient } = require('../config/prismaManager');
const prisma = getSystemClient();

class AccountingService {
  /**
   * Seed standard Chart of Accounts for a college, incorporating any mappings from Phase 9 N04.
   */
  async seedChartOfAccounts(collegeId) {
    if (!collegeId) throw new Error('collegeId is required');

    // Baseline standard educational Chart of Accounts
    const standardHeads = [
      // Assets (1000)
      { code: '1010', name: 'Cash in Hand', accountType: 'ASSET', parentCode: '1000' },
      { code: '1020', name: 'Bank Accounts (Meezan/Habib)', accountType: 'ASSET', parentCode: '1000' },
      { code: '1030', name: 'Accounts Receivable (Student Dues)', accountType: 'ASSET', parentCode: '1000' },
      { code: '1040', name: 'Fixed Assets (Equipment & Buildings)', accountType: 'ASSET', parentCode: '1000' },

      // Liabilities (2000)
      { code: '2010', name: 'Accounts Payable (Vendors)', accountType: 'LIABILITY', parentCode: '2000' },
      { code: '2020', name: 'Security & Caution Deposits', accountType: 'LIABILITY', parentCode: '2000' },
      { code: '2030', name: 'Prepaid Student Fees', accountType: 'LIABILITY', parentCode: '2000' },

      // Equity (3000)
      { code: '3010', name: 'Institutional Capital Fund', accountType: 'EQUITY', parentCode: '3000' },
      { code: '3020', name: 'Retained Academic Surplus', accountType: 'EQUITY', parentCode: '3000' },

      // Revenue (4000)
      { code: '4010', name: 'Tuition Fee Revenue', accountType: 'REVENUE', parentCode: '4000' },
      { code: '4020', name: 'Admission & Registration Fees', accountType: 'REVENUE', parentCode: '4000' },
      { code: '4030', name: 'Transport Route Revenue', accountType: 'REVENUE', parentCode: '4000' },
      { code: '4040', name: 'Hostel Boarding Revenue', accountType: 'REVENUE', parentCode: '4000' },
      { code: '4050', name: 'Examination & Certification Fees', accountType: 'REVENUE', parentCode: '4000' },

      // Expenses (5000)
      { code: '5010', name: 'Faculty & Staff Salaries', accountType: 'EXPENSE', parentCode: '5000' },
      { code: '5020', name: 'Utilities & Diesel Generator Fuel', accountType: 'EXPENSE', parentCode: '5000' },
      { code: '5030', name: 'Laboratory & Science Consumables', accountType: 'EXPENSE', parentCode: '5000' },
      { code: '5040', name: 'Campus Building & Vehicle Maintenance', accountType: 'EXPENSE', parentCode: '5000' },
      { code: '5050', name: 'Software Subscriptions & EdTech Tools', accountType: 'EXPENSE', parentCode: '5000' },
    ];

    // Read Phase 9 N04 AccountHeadMapping rows if any exist
    const mappings = await prisma.accountHeadMapping.findMany({
      where: { college_id: collegeId },
    });

    for (const m of mappings) {
      if (m.accountCode && m.accountName) {
        let type = 'REVENUE';
        if (m.accountCode.startsWith('1')) type = 'ASSET';
        else if (m.accountCode.startsWith('2')) type = 'LIABILITY';
        else if (m.accountCode.startsWith('3')) type = 'EQUITY';
        else if (m.accountCode.startsWith('4')) type = 'REVENUE';
        else if (m.accountCode.startsWith('5')) type = 'EXPENSE';

        standardHeads.push({
          code: m.accountCode,
          name: m.accountName,
          accountType: type,
          parentCode: m.accountCode.substring(0, 1) + '000',
        });
      }
    }

    const created = [];
    for (const h of standardHeads) {
      const head = await prisma.accountHead.upsert({
        where: {
          college_id_code: {
            college_id: collegeId,
            code: h.code,
          },
        },
        create: {
          college_id: collegeId,
          code: h.code,
          name: h.name,
          accountType: h.accountType,
          parentCode: h.parentCode,
          isActive: true,
        },
        update: {
          name: h.name,
          accountType: h.accountType,
        },
      });
      created.push(head);
    }

    return {
      totalHeads: created.length,
      heads: created,
    };
  }

  /**
   * Create an account head manually.
   */
  async createAccountHead({ collegeId, code, name, accountType, parentCode = null }) {
    if (!collegeId || !code || !name || !accountType) {
      const err = new Error('collegeId, code, name, and accountType are required');
      err.code = 'VALIDATION_ERROR';
      throw err;
    }

    return await prisma.accountHead.create({
      data: {
        college_id: collegeId,
        code,
        name,
        accountType,
        parentCode,
      },
    });
  }

  /**
   * Post a double-entry journal voucher.
   * Strictly enforces sum(debit) == sum(credit) > 0 and per-line debit/credit constraints.
   */
  async postJournalVoucher({
    collegeId,
    campusId = null,
    voucherNo,
    voucherType = 'JV',
    voucherDate = new Date(),
    narration,
    createdById,
    lines = [],
  }) {
    if (!collegeId || !voucherNo || !createdById || !lines || lines.length === 0) {
      const err = new Error('collegeId, voucherNo, createdById, and non-empty lines are required');
      err.code = 'VALIDATION_ERROR';
      throw err;
    }

    let totalDebit = 0;
    let totalCredit = 0;

    for (const line of lines) {
      const debit = Number(line.debitPkr) || 0;
      const credit = Number(line.creditPkr) || 0;

      // Line check: exactly one must be > 0 and the other 0
      if ((debit > 0 && credit > 0) || (debit === 0 && credit === 0) || debit < 0 || credit < 0) {
        const err = new Error(`Invalid journal line for account ${line.accountCode}: must have either debit > 0 OR credit > 0`);
        err.code = 'INVALID_JOURNAL_LINE';
        throw err;
      }

      totalDebit += debit;
      totalCredit += credit;
    }

    // Double-entry balancing invariant
    if (totalDebit !== totalCredit || totalDebit <= 0) {
      const err = new Error(`UNBALANCED_JOURNAL_VOUCHER: Total Debits (PKR ${totalDebit}) must equal Total Credits (PKR ${totalCredit}) and be greater than 0`);
      err.code = 'UNBALANCED_JOURNAL_VOUCHER';
      throw err;
    }

    // Verify all account codes exist for this college
    for (const line of lines) {
      const exists = await prisma.accountHead.findUnique({
        where: {
          college_id_code: {
            college_id: collegeId,
            code: line.accountCode,
          },
        },
      });
      if (!exists) {
        const err = new Error(`Account head code ${line.accountCode} does not exist in Chart of Accounts`);
        err.code = 'ACCOUNT_NOT_FOUND';
        throw err;
      }
    }

    return await prisma.$transaction(async (tx) => {
      const voucher = await tx.journalVoucher.create({
        data: {
          college_id: collegeId,
          campus_id: campusId,
          voucherNo,
          voucherType,
          voucherDate: new Date(voucherDate),
          narration: narration || 'Journal Voucher Entry',
          createdById,
          status: 'POSTED',
        },
      });

      for (const line of lines) {
        await tx.journalLineItem.create({
          data: {
            voucherId: voucher.id,
            college_id: collegeId,
            accountCode: line.accountCode,
            debitPkr: Number(line.debitPkr) || 0,
            creditPkr: Number(line.creditPkr) || 0,
            narration: line.narration || null,
          },
        });
      }

      return await tx.journalVoucher.findUnique({
        where: { id: voucher.id },
        include: {
          lines: {
            include: { account: true },
          },
        },
      });
    });
  }

  /**
   * Calculate Trial Balance across all accounts.
   */
  async getTrialBalance({ collegeId, asOfDate = new Date() }) {
    const heads = await prisma.accountHead.findMany({
      where: { college_id: collegeId, isActive: true },
      orderBy: { code: 'asc' },
    });

    const targetDate = new Date(asOfDate);

    const balances = [];
    let totalDebitSum = 0;
    let totalCreditSum = 0;

    for (const h of heads) {
      const aggregates = await prisma.journalLineItem.aggregate({
        where: {
          college_id: collegeId,
          accountCode: h.code,
          voucher: {
            voucherDate: { lte: targetDate },
            status: 'POSTED',
          },
        },
        _sum: {
          debitPkr: true,
          creditPkr: true,
        },
      });

      const totalDebit = aggregates._sum.debitPkr || 0;
      const totalCredit = aggregates._sum.creditPkr || 0;

      totalDebitSum += totalDebit;
      totalCreditSum += totalCredit;

      // Net balance
      let netDebit = 0;
      let netCredit = 0;

      if (['ASSET', 'EXPENSE'].includes(h.accountType)) {
        if (totalDebit >= totalCredit) {
          netDebit = totalDebit - totalCredit;
        } else {
          netCredit = totalCredit - totalDebit;
        }
      } else {
        // LIABILITY, EQUITY, REVENUE
        if (totalCredit >= totalDebit) {
          netCredit = totalCredit - totalDebit;
        } else {
          netDebit = totalDebit - totalCredit;
        }
      }

      balances.push({
        code: h.code,
        name: h.name,
        accountType: h.accountType,
        totalDebit,
        totalCredit,
        netDebit,
        netCredit,
      });
    }

    return {
      asOfDate: targetDate.toISOString().split('T')[0],
      isBalanced: totalDebitSum === totalCreditSum,
      totalDebitSum,
      totalCreditSum,
      accounts: balances,
    };
  }

  /**
   * Income Statement (Profit & Loss / Surplus Report)
   */
  async getIncomeStatement({ collegeId, startDate, endDate }) {
    const sDate = new Date(startDate || '2000-01-01');
    const eDate = new Date(endDate || '2099-12-31');

    const lines = await prisma.journalLineItem.findMany({
      where: {
        college_id: collegeId,
        voucher: {
          voucherDate: { gte: sDate, lte: eDate },
          status: 'POSTED',
        },
        account: {
          accountType: { in: ['REVENUE', 'EXPENSE'] },
        },
      },
      include: { account: true },
    });

    let totalRevenue = 0;
    let totalExpense = 0;

    const revenues = {};
    const expenses = {};

    for (const l of lines) {
      if (l.account.accountType === 'REVENUE') {
        const amt = (l.creditPkr || 0) - (l.debitPkr || 0);
        totalRevenue += amt;
        revenues[l.accountCode] = (revenues[l.accountCode] || 0) + amt;
      } else if (l.account.accountType === 'EXPENSE') {
        const amt = (l.debitPkr || 0) - (l.creditPkr || 0);
        totalExpense += amt;
        expenses[l.accountCode] = (expenses[l.accountCode] || 0) + amt;
      }
    }

    return {
      period: { startDate: sDate.toISOString().split('T')[0], endDate: eDate.toISOString().split('T')[0] },
      totalRevenuePkr: totalRevenue,
      totalExpensePkr: totalExpense,
      netSurplusPkr: totalRevenue - totalExpense,
      revenues,
      expenses,
    };
  }
}

module.exports = new AccountingService();

