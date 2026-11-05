'use strict';

/**
 * export.controller.js — Phase 9B (#N01)
 * Centralized Export Center API Controller
 */

const { getSystemClient } = require('../config/prismaManager');
const { queueExportJob } = require('../services/exportService');

function getPrisma() {
  return getSystemClient();
}

/**
 * Safe serialization of BigInt sizeBytes
 */
function serializeJob(job) {
  if (!job) return null;
  return {
    ...job,
    sizeBytes: typeof job.sizeBytes === 'bigint' ? job.sizeBytes.toString() : job.sizeBytes
  };
}

/**
 * POST /api/exports
 * Queue a new export job
 */
async function requestExport(req, res) {
  try {
    const collegeId = req.collegeId || req.user?.college_id;
    const campusId = req.campusId || null;
    const userId = req.user?.id || req.user?._id;

    if (!collegeId) {
      return res.status(400).json({ success: false, message: 'College ID is required' });
    }

    // Role check: admin, principal, registrar, accountant
    const allowedRoles = ['admin', 'principal', 'registrar', 'accountant', 'superAdmin'];
    if (!allowedRoles.includes(req.user?.role)) {
      return res.status(403).json({ success: false, message: 'Unauthorized: insufficient export privileges' });
    }

    const { exportType, format, filters } = req.body;

    const job = await queueExportJob({
      collegeId,
      campusId,
      userId,
      exportType,
      format,
      filters
    });

    return res.status(202).json({
      success: true,
      message: 'Export job queued successfully',
      job: serializeJob(job)
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({
        success: false,
        code: err.code || 'EXPORT_ERROR',
        message: err.message,
        details: err.details
      });
    }
    console.error('[requestExport] Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to queue export job', error: err.message });
  }
}

/**
 * GET /api/exports
 * List export jobs for college
 */
async function listExports(req, res) {
  try {
    const collegeId = req.collegeId || req.user?.college_id;
    const prisma = getPrisma();

    const jobs = await prisma.exportJob.findMany({
      where: { college_id: collegeId },
      orderBy: { createdAt: 'desc' },
      take: 50
    });

    return res.json({
      success: true,
      jobs: jobs.map(serializeJob)
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to list export jobs', error: err.message });
  }
}

/**
 * GET /api/exports/:id
 */
async function getExportDetails(req, res) {
  try {
    const { id } = req.params;
    const collegeId = req.collegeId || req.user?.college_id;
    const prisma = getPrisma();

    const job = await prisma.exportJob.findFirst({
      where: { id, college_id: collegeId }
    });

    if (!job) {
      return res.status(404).json({ success: false, message: 'Export job not found' });
    }

    return res.json({
      success: true,
      job: serializeJob(job)
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to retrieve export job', error: err.message });
  }
}

/**
 * GET /api/exports/board-profiles
 * List configured BISE board export profiles (Phase 9I #N02)
 */
async function listBoardExportProfiles(req, res) {
  try {
    const { listBoardProfiles } = require('../services/boardGazetteService');
    const profiles = await listBoardProfiles();
    return res.json({ success: true, profiles });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to list board profiles', error: err.message });
  }
}

module.exports = {
  requestExport,
  listExports,
  getExportDetails,
  listBoardExportProfiles
};
