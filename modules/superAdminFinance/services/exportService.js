'use strict';

const { getSystemClient } = require('../../../config/prismaManager');
const { buildPaymentWhere } = require('../utils/buildPaymentWhere');
const { formatPKT, toPKTDateString } = require('../../../utils/pkt');

function escapeCsv(val) {
  if (val === null || val === undefined) return '""';
  const str = String(val).replace(/"/g, '""');
  return `"${str}"`;
}

/**
 * Streams payments as CSV with cursor-based pagination and UTF-8 BOM.
 * 
 * @param {Object} filters 
 * @param {import('express').Response} res 
 * @param {Object} adminUser 
 */
async function exportPaymentsStream(filters = {}, res, adminUser = {}) {
  const prisma = getSystemClient();
  const where = buildPaymentWhere(filters);

  const filename = `payments_export_${toPKTDateString(new Date())}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  // Write UTF-8 BOM for Microsoft Excel compatibility
  res.write('\uFEFF');

  // Headers
  const headers = [
    'Receipt Number',
    'College Code',
    'College Name',
    'Plan',
    'Billing Cycle',
    'Type',
    'Payment Method',
    'Transaction ID',
    'Expected Amount (PKR)',
    'Amount Paid (PKR)',
    'Verified Amount (PKR)',
    'Status',
    'Submitted By',
    'Reviewed By',
    'Submission Date (PKT)',
    'Review Date (PKT)',
    'Admin Notes'
  ];
  res.write(headers.map(escapeCsv).join(',') + '\r\n');

  const CHUNK_SIZE = 100;
  let cursorId = null;
  let exportedCount = 0;

  while (true) {
    const queryOpts = {
      where,
      select: {
        id: true,
        receiptNumber: true,
        type: true,
        planId: true,
        billingCycle: true,
        expectedAmount: true,
        amountPaid: true,
        verifiedAmount: true,
        paymentMethod: true,
        transactionId: true,
        status: true,
        overrideNote: true,
        submittedBy: true,
        reviewedBy: true,
        createdAt: true,
        reviewedAt: true,
        college: {
          select: {
            code: true,
            name: true
          }
        }
      },
      orderBy: { id: 'asc' },
      take: CHUNK_SIZE
    };

    if (cursorId) {
      queryOpts.cursor = { id: cursorId };
      queryOpts.skip = 1;
    }

    const chunk = await prisma.collegeSubscriptionPayment.findMany(queryOpts);

    if (chunk.length === 0) break;

    for (const p of chunk) {
      const row = [
        p.receiptNumber || '—',
        p.college ? p.college.code : '—',
        p.college ? p.college.name : '—',
        p.planId || 'starter',
        p.billingCycle || 'MONTHLY',
        p.type || 'RENEWAL',
        p.paymentMethod || '—',
        p.transactionId || '—',
        p.expectedAmount != null ? p.expectedAmount : 0,
        p.amountPaid != null ? p.amountPaid : 0,
        p.verifiedAmount != null ? p.verifiedAmount : '—',
        p.status,
        p.submittedBy || '—',
        p.reviewedBy || '—',
        formatPKT(p.createdAt),
        formatPKT(p.reviewedAt),
        p.overrideNote || '—'
      ];

      res.write(row.map(escapeCsv).join(',') + '\r\n');
      exportedCount++;
    }

    cursorId = chunk[chunk.length - 1].id;
    if (chunk.length < CHUNK_SIZE) break;
  }

  console.log(`[FinanceExport] Exported ${exportedCount} payments to CSV by user: ${adminUser.email || adminUser.id || 'superAdmin'}`);
  res.end();
}

module.exports = {
  exportPaymentsStream
};
