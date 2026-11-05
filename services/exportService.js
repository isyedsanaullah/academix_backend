'use strict';

/**
 * exportService.js — Phase 9B (#N01)
 * Centralized Export Engine:
 * - Gated export types (N01: STUDENTS/ATTENDANCE/FEES, N02: GAZETTE, N04: LEDGER, N17: AUDIT_LOG)
 * - Safe sanitization against CSV/XLSX formula injection (CSV prefixing, XLSX string typing)
 * - Strict row caps per tier (1,000 / 10,000 / 100,000 / 1,000,000)
 * - 24-hour expiration window & atomic quota refund on failure
 */

const XLSX = require('xlsx');
const PDFDocument = require('pdfkit');
const { getSystemClient } = require('../config/prismaManager');
const { getEntitlements } = require('./entitlements');
const { checkQuota, recordUsage, refundQuota, resolvePeriodKey } = require('./quotaService');
const { getMonthlyKey } = require('../config/planConstants');
const { fetchBoardGazetteData } = require('./boardGazetteService');
const { fetchAccountantJournalData, validateAccountHeadMappings } = require('./accountantJournalService');

function getPrisma() {
  return getSystemClient();
}

const EXPORT_TYPE_GATES = {
  STUDENTS: 'export-center',           // N01
  ATTENDANCE: 'export-center',         // N01
  FEES: 'export-center',               // N01
  GAZETTE: 'board-format-excel-export',// N02
  LEDGER: 'accountant-csv-export',     // N04
  AUDIT_LOG: 'audit-log-export'        // N17
};

/**
 * Formula injection defense:
 * String cells starting with =, +, -, @, \t, \r are prefixed with a single quote.
 * Numbers and booleans are preserved.
 */
function sanitizeCsvCell(val) {
  if (val === null || val === undefined) return '';
  if (typeof val === 'number') return String(val);
  if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';

  let str = String(val);
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }

  if (/[",\n\r]/.test(str)) {
    str = `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Generate CSV string from 2D array of rows
 */
function generateCsv(headers, rows) {
  const headerLine = headers.map(sanitizeCsvCell).join(',');
  const rowLines = rows.map(r => r.map(sanitizeCsvCell).join(','));
  return [headerLine, ...rowLines].join('\n');
}

/**
 * Generate XLSX Buffer with explicit string typing ('s') to prevent formula execution
 */
function generateXlsx(headers, rows) {
  const aoa = [headers, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Enforce string type on all non-numeric cells to completely neutralize formula injection
  for (const cell in ws) {
    if (cell[0] === '!') continue;
    const c = ws[cell];
    if (typeof c.v === 'string') {
      c.t = 's';
      if (/^[=+\-@\t\r]/.test(c.v)) {
        c.v = `'${c.v}`;
      }
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Export');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

/**
 * Generate simple tabular PDF Buffer
 */
async function generatePdf(title, headers, rows) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 30, size: 'A4' });
      const buffers = [];
      doc.on('data', b => buffers.push(b));
      doc.on('end', () => resolve(Buffer.concat(buffers)));

      doc.fontSize(16).text(title, { align: 'center' });
      doc.moveDown();
      doc.fontSize(10);

      // Simple text layout
      doc.text(headers.join(' | '));
      doc.text('-'.repeat(80));

      for (const row of rows.slice(0, 500)) {
        doc.text(row.map(c => String(c ?? '')).join(' | '));
      }

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Fetch rows for the target export type
 */
async function fetchExportData(tx, collegeId, campusId, exportType, filters = {}) {
  const whereCol = { college_id: collegeId };
  if (campusId) whereCol.campus_id = campusId;

  if (exportType === 'STUDENTS') {
    const students = await tx.student.findMany({
      where: whereCol,
      orderBy: { rollNumber: 'asc' }
    });

    const headers = ['Roll No', 'Name', 'Father Name', 'Class', 'Group', 'Gender', 'Phone', 'Status'];
    const rows = students.map(s => [
      s.rollNumber || '',
      s.name,
      s.fatherName || '',
      s.class || '',
      s.group || '',
      s.gender || '',
      s.phone || '',
      s.status || 'active'
    ]);

    return { headers, rows, rawItems: students };
  }

  if (exportType === 'ATTENDANCE') {
    // Attendance in monthly matrix form: one row per student (per OD-21)
    const students = await tx.student.findMany({
      where: whereCol,
      orderBy: { rollNumber: 'asc' }
    });

    const headers = ['Roll No', 'Name', 'Class', 'Total Marked', 'Present', 'Absent', 'Attendance %'];
    const rows = [];

    for (const s of students) {
      const records = await tx.attendance.findMany({
        where: { college_id: collegeId, student_id: s.id }
      });
      const total = records.length;
      const present = records.filter(r => r.status === 'present').length;
      const absent = records.filter(r => r.status === 'absent').length;
      const pct = total > 0 ? ((present / total) * 100).toFixed(1) : '100.0';

      rows.push([s.rollNumber || '', s.name, s.class || '', total, present, absent, `${pct}%`]);
    }

    return { headers, rows, rawItems: rows };
  }

  if (exportType === 'FEES') {
    const fees = await tx.fee.findMany({
      where: whereCol,
      include: { student: true },
      orderBy: { createdAt: 'desc' }
    });

    const headers = ['Challan No', 'Student Name', 'Roll No', 'Total PKR', 'Paid PKR', 'Status', 'Due Date'];
    const rows = fees.map(f => [
      f.challanNumber || f.receiptNumber || f.id.slice(0, 8),
      f.student?.name || 'N/A',
      f.student?.rollNumber || '',
      f.totalAmount || 0,
      f.paidAmount || 0,
      f.status || 'pending',
      f.dueDate ? new Date(f.dueDate).toISOString().split('T')[0] : ''
    ]);

    return { headers, rows, rawItems: fees };
  }

  if (exportType === 'AUDIT_LOG') {
    const { startDate, endDate } = filters || {};
    const dateFilter = {};
    if (startDate) dateFilter.gte = new Date(startDate);
    if (endDate) dateFilter.lte = new Date(endDate);

    const logWhere = { college_id: collegeId };
    if (Object.keys(dateFilter).length > 0) {
      logWhere.createdAt = dateFilter;
    }

    const [logs, entitlementAudits] = await Promise.all([
      tx.auditLog.findMany({
        where: logWhere,
        orderBy: { createdAt: 'desc' }
      }),
      tx.collegeEntitlementAudit.findMany({
        where: logWhere,
        orderBy: { createdAt: 'desc' }
      })
    ]);

    // Format and sanitize entitlement audits: strictly omit internal notes, reasons, and Super Admin IPs
    const sanitizedEntitlements = entitlementAudits.map(ea => {
      let planSummary = '';
      if (ea.beforeStateJson?.planId || ea.afterStateJson?.planId) {
        planSummary = `Plan Transition: ${ea.beforeStateJson?.planId || 'N/A'} -> ${ea.afterStateJson?.planId || 'N/A'}`;
      } else if (ea.afterStateJson?.subStatus) {
        planSummary = `Subscription Status: ${ea.afterStateJson?.subStatus}`;
      } else {
        planSummary = ea.action;
      }
      return {
        timestamp: ea.createdAt.toISOString(),
        action: ea.action,
        actor: 'Platform', // Strictly hide Super Admin ID, email and IP
        details: planSummary,
        createdAt: ea.createdAt
      };
    });

    const tenantLogs = logs.map(l => ({
      timestamp: l.createdAt.toISOString(),
      action: l.action,
      actor: l.user_id || 'System',
      details: typeof l.details === 'string' ? l.details : JSON.stringify(l.details || {}),
      createdAt: l.createdAt
    }));

    // Merge and sort chronologically descending
    const combined = [...tenantLogs, ...sanitizedEntitlements].sort((a, b) => b.createdAt - a.createdAt);

    const headers = ['Timestamp', 'Action', 'Actor', 'Details'];
    const rows = combined.map(item => [item.timestamp, item.action, item.actor, item.details]);
    const rawItems = combined.map(item => ({
      timestamp: item.timestamp,
      action: item.action,
      actor: item.actor,
      details: item.details
    }));

    return { headers, rows, rawItems };
  }

  if (exportType === 'GAZETTE') {
    return await fetchBoardGazetteData(tx, collegeId, campusId, filters);
  }

  if (exportType === 'LEDGER') {
    return await fetchAccountantJournalData(tx, collegeId, campusId, filters);
  }

  throw new Error(`Unsupported export type: ${exportType}`);
}

/**
 * Queue a new export job under monthly quota & row cap enforcement
 */
async function queueExportJob({ collegeId, campusId = null, userId, exportType, format, filters = {} }) {
  const cleanType = String(exportType || '').trim().toUpperCase();
  const cleanFormat = String(format || '').trim().toUpperCase();

  const requiredFeatureKey = EXPORT_TYPE_GATES[cleanType];
  if (!requiredFeatureKey) {
    throw Object.assign(new Error(`Invalid export type "${exportType}". Allowed: ${Object.keys(EXPORT_TYPE_GATES).join(', ')}`), { status: 400 });
  }

  const validFormats = ['CSV', 'XLSX', 'PDF'];
  if (cleanType === 'AUDIT_LOG') validFormats.push('JSON');
  if (!validFormats.includes(cleanFormat)) {
    throw Object.assign(new Error(`Format "${cleanFormat}" not supported for ${cleanType}. Allowed: ${validFormats.join(', ')}`), { status: 400 });
  }

  const prisma = getPrisma();

  // 1. Check feature entitlement
  const entitlements = await getEntitlements(collegeId, prisma);
  if (entitlements.subStatus === 'SUSPENDED' || !entitlements.features.includes(requiredFeatureKey)) {
    throw Object.assign(new Error(`Feature "${requiredFeatureKey}" is not included in your current plan.`), {
      status: 403,
      code: 'FEATURE_NOT_IN_PLAN'
    });
  }

  // 2. Validate export-specific parameters
  if (cleanType === 'AUDIT_LOG') {
    const { startDate, endDate } = filters || {};
    if (!startDate || !endDate) {
      throw Object.assign(
        new Error('Date range (startDate and endDate) is strictly required for audit log exports.'),
        { status: 422, code: 'DATE_RANGE_REQUIRED' }
      );
    }
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
      throw Object.assign(
        new Error('Invalid date range specified.'),
        { status: 422, code: 'INVALID_DATE_RANGE' }
      );
    }
    const diffDays = (end - start) / (1000 * 60 * 60 * 24);
    if (diffDays > 366) {
      throw Object.assign(
        new Error('Audit log export date range cannot exceed 366 days.'),
        { status: 422, code: 'DATE_RANGE_EXCEEDED' }
      );
    }
  }

  // 3. Resolve quota metric & period key
  const quotaMetric = cleanFormat === 'PDF' ? 'exportsPdfMonthly' : 'exportsCsvMonthly';
  const periodKey = getMonthlyKey(new Date());

  // 4. Atomically check and consume quota
  const quotaCheck = await checkQuota(collegeId, quotaMetric, 1);
  if (!quotaCheck.allowed) {
    throw Object.assign(new Error(`Monthly export limit exceeded for format ${cleanFormat}.`), {
      status: 429,
      code: 'QUOTA_EXCEEDED',
      details: quotaCheck
    });
  }

  // Deduct quota atomically
  await recordUsage(collegeId, quotaMetric, 1);

  // 5. Estimate row count and enforce exportMaxRows cap
  const maxRowsCap = entitlements.effectiveLimits.exportMaxRows || 1000;

  let rowCount = 0;
  if (cleanType === 'STUDENTS' || cleanType === 'ATTENDANCE') {
    rowCount = await prisma.student.count({ where: { college_id: collegeId } });
  } else if (cleanType === 'FEES') {
    rowCount = await prisma.fee.count({ where: { college_id: collegeId } });
  } else if (cleanType === 'AUDIT_LOG') {
    const auditWhere = {
      college_id: collegeId,
      createdAt: {
        gte: new Date(filters.startDate),
        lte: new Date(filters.endDate)
      }
    };
    const [logCount, entCount] = await Promise.all([
      prisma.auditLog.count({ where: auditWhere }),
      prisma.collegeEntitlementAudit.count({ where: auditWhere })
    ]);
    rowCount = logCount + entCount;
  } else if (cleanType === 'GAZETTE') {
    const brCount = await prisma.boardResult.count({ where: { college_id: collegeId } });
    rowCount = brCount > 0 ? brCount : await prisma.student.count({ where: { college_id: collegeId } });
  } else if (cleanType === 'LEDGER') {
    const preflight = await validateAccountHeadMappings(prisma, collegeId, campusId, filters);
    if (!preflight.valid) {
      await refundQuota(collegeId, quotaMetric, periodKey, 1);
      throw Object.assign(
        new Error('One or more fee types or payment methods lack account head mappings.'),
        {
          status: 422,
          code: 'UNMAPPED_HEADS',
          details: {
            unmapped: preflight.unmapped,
            hint: 'Configure account head mappings before generating accountant journal exports.'
          }
        }
      );
    }
    rowCount = (preflight.payments.length * 2) + (preflight.refunds.length * 2);
  }

  if (maxRowsCap > 0 && rowCount > maxRowsCap) {
    // Immediate refund of consumed quota
    await refundQuota(collegeId, quotaMetric, periodKey, 1);
    throw Object.assign(
      new Error(`Export result (${rowCount} rows) exceeds your tier's maximum limit of ${maxRowsCap} rows.`),
      {
        status: 422,
        code: 'EXPORT_ROW_CAP_EXCEEDED',
        details: { count: rowCount, limit: maxRowsCap, hint: 'Narrow your date filters or scope.' }
      }
    );
  }

  // 5. Create ExportJob record
  const job = await prisma.exportJob.create({
    data: {
      college_id: collegeId,
      campus_id: campusId || null,
      userId,
      exportType: cleanType,
      format: cleanFormat,
      filtersJson: filters,
      periodKey,
      status: 'QUEUED',
      rowCount,
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000) // 24-hour expiration window
    }
  });

  // Write audit log
  await prisma.auditLog.create({
    data: {
      college_id: collegeId,
      user_id: userId,
      action: 'EXPORT_QUEUED',
      details: JSON.stringify({ jobId: job.id, exportType: cleanType, format: cleanFormat, periodKey })
    }
  });

  return job;
}

module.exports = {
  EXPORT_TYPE_GATES,
  sanitizeCsvCell,
  generateCsv,
  generateXlsx,
  generatePdf,
  fetchExportData,
  queueExportJob
};
