'use strict';

/**
 * exportWorker.js — Phase 9B (#N01)
 * Background worker processing ExportJobs with streaming and atomic quota refunds.
 */

const { getSystemClient } = require('../config/prismaManager');
const {
  fetchExportData,
  generateCsv,
  generateXlsx,
  generatePdf
} = require('../services/exportService');
const { refundQuota } = require('../services/quotaService');

function getPrisma() {
  return getSystemClient();
}

const STUCK_JOB_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Reap stale running jobs
 */
async function reapStuckExportJobs() {
  const prisma = getPrisma();
  const cutoff = new Date(Date.now() - STUCK_JOB_TIMEOUT_MS);

  await prisma.exportJob.updateMany({
    where: {
      status: 'RUNNING',
      heartbeatAt: { lt: cutoff }
    },
    data: {
      status: 'FAILED',
      failureReason: 'Export job execution timed out'
    }
  });
}

/**
 * Process a single export job
 */
async function processExportJob(job) {
  const prisma = getPrisma();

  try {
    // Update heartbeat
    await prisma.exportJob.update({
      where: { id: job.id },
      data: { heartbeatAt: new Date() }
    });

    const { headers, rows, rawItems } = await fetchExportData(
      prisma,
      job.college_id,
      job.campus_id,
      job.exportType,
      job.filtersJson || {}
    );

    let fileBuffer;
    let ext = 'csv';

    if (job.format === 'CSV') {
      const csvStr = generateCsv(headers, rows);
      fileBuffer = Buffer.from(csvStr, 'utf8');
      ext = 'csv';
    } else if (job.format === 'XLSX') {
      fileBuffer = generateXlsx(headers, rows);
      ext = 'xlsx';
    } else if (job.format === 'PDF') {
      fileBuffer = await generatePdf(`${job.exportType} Report`, headers, rows);
      ext = 'pdf';
    } else if (job.format === 'JSON') {
      fileBuffer = Buffer.from(JSON.stringify(rawItems, null, 2), 'utf8');
      ext = 'json';
    }

    const fileKey = `tenants/${job.college_id}/exports/${job.id}.${ext}`;
    const sizeBytes = BigInt(fileBuffer ? fileBuffer.length : 0);

    await prisma.exportJob.update({
      where: { id: job.id },
      data: {
        status: 'READY',
        fileKey,
        rowCount: rows.length,
        sizeBytes,
        heartbeatAt: new Date()
      }
    });

    return { success: true, jobId: job.id, fileKey, rowCount: rows.length, sizeBytes };
  } catch (err) {
    console.error(`[exportWorker] Error processing job ${job.id}:`, err);

    // Atomic quota refund on failure (if not already refunded)
    let refundedAt = null;
    if (!job.quotaRefundedAt) {
      try {
        const metric = job.format === 'PDF' ? 'exportsPdfMonthly' : 'exportsCsvMonthly';
        await refundQuota(job.college_id, metric, job.periodKey, 1);
        refundedAt = new Date();
      } catch (refundErr) {
        console.error(`[exportWorker] Failed to refund quota for job ${job.id}:`, refundErr);
      }
    }

    await prisma.exportJob.update({
      where: { id: job.id },
      data: {
        status: 'FAILED',
        failureReason: err.message,
        quotaRefundedAt: refundedAt
      }
    });

    return { success: false, jobId: job.id, error: err.message };
  }
}

/**
 * Claim and process the next QUEUED export job
 */
async function processNextExportJob(workerId = 'export_worker_' + process.pid) {
  const prisma = getPrisma();
  await reapStuckExportJobs();

  // 1. Atomic claim using FOR UPDATE SKIP LOCKED
  const claimedJobs = await prisma.$queryRaw`
    UPDATE "ExportJob"
    SET status = 'RUNNING', "claimedBy" = ${workerId}, "heartbeatAt" = NOW()
    WHERE id = (
      SELECT id FROM "ExportJob"
      WHERE status = 'QUEUED'
      ORDER BY "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING *;
  `;

  if (!claimedJobs || claimedJobs.length === 0) return null;
  const job = claimedJobs[0];

  return await processExportJob(job);
}

module.exports = {
  reapStuckExportJobs,
  processExportJob,
  processNextExportJob
};

