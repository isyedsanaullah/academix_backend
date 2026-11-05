'use strict';

const { getSystemClient } = require('../config/prismaManager');
const { validateImportCap, undoImportJob } = require('../workers/bulkImportWorker');

function getPrisma() {
  return getSystemClient();
}

/**
 * POST /api/bulk-import/submit
 * Submits a new bulk import job
 */
async function submitImport(req, res) {
  try {
    const { importType, rows, campusId } = req.body;
    const collegeId = req.collegeId;
    const userId = req.user?.id || 'admin';

    if (!importType || !Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ success: false, error: 'importType and non-empty rows array are required' });
    }

    if (!['students', 'staff', 'fees', 'marks'].includes(importType)) {
      return res.status(400).json({ success: false, error: `Invalid importType: ${importType}` });
    }

    const prisma = getPrisma();

    // 1. Check row caps by tier (OD-21)
    await validateImportCap(collegeId, rows.length);

    // 2. Concurrency check: Single active job per college
    const activeJob = await prisma.bulkImportJob.findFirst({
      where: {
        college_id: collegeId,
        status: { in: ['PENDING', 'PROCESSING'] }
      }
    });

    if (activeJob) {
      return res.status(409).json({
        success: false,
        code: 'CONCURRENT_IMPORT_ACTIVE',
        message: `An active import job (${activeJob.id}, status: ${activeJob.status}) is already running for this college. Please wait for it to complete.`
      });
    }

    // 3. Create BulkImportJob and BulkImportRows inside a transaction
    const job = await prisma.$transaction(async (tx) => {
      const createdJob = await tx.bulkImportJob.create({
        data: {
          college_id: collegeId,
          campus_id: campusId || req.campusId || null,
          importType,
          status: 'PENDING',
          totalRows: rows.length,
          createdById: userId
        }
      });

      const rowRecords = rows.map((r, idx) => ({
        job_id: createdJob.id,
        rowNumber: idx + 1,
        payloadJson: r,
        status: 'PENDING'
      }));

      await tx.bulkImportRow.createMany({
        data: rowRecords
      });

      return createdJob;
    });

    return res.status(202).json({
      success: true,
      message: 'Bulk import job queued successfully',
      jobId: job.id,
      totalRows: rows.length,
      status: job.status
    });
  } catch (err) {
    return res.status(err.status || 500).json({
      success: false,
      code: err.code || 'IMPORT_SUBMIT_FAILED',
      error: err.message
    });
  }
}

/**
 * GET /api/bulk-import/jobs
 * List recent bulk import jobs for the college
 */
async function getImportJobs(req, res) {
  try {
    const prisma = getPrisma();
    const jobs = await prisma.bulkImportJob.findMany({
      where: { college_id: req.collegeId },
      orderBy: { createdAt: 'desc' },
      take: 20
    });
    return res.json({ success: true, count: jobs.length, jobs });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, error: err.message });
  }
}

/**
 * GET /api/bulk-import/jobs/:id
 * Get single job status and progress
 */
async function getImportJob(req, res) {
  try {
    const prisma = getPrisma();
    const job = await prisma.bulkImportJob.findFirst({
      where: { id: req.params.id, college_id: req.collegeId },
      include: {
        _count: {
          select: { rows: true }
        }
      }
    });
    if (!job) return res.status(404).json({ success: false, error: 'Job not found' });
    return res.json({ success: true, job });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, error: err.message });
  }
}

/**
 * POST /api/bulk-import/jobs/:id/undo
 * Reverts the import job
 */
async function undoImport(req, res) {
  try {
    const result = await undoImportJob(req.params.id, req.collegeId);
    return res.json({
      success: true,
      message: `Successfully reverted import job, deleted ${result.deletedCount} imported records.`,
      ...result
    });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, error: err.message });
  }
}

module.exports = {
  submitImport,
  getImportJobs,
  getImportJob,
  undoImport
};

