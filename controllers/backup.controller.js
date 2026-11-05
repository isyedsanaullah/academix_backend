'use strict';

/**
 * backup.controller.js — Phase 9F (#N05)
 * Controller for Institutional Data Backup (Enterprise-Only)
 */

const backupService = require('../services/backupService');

async function listBackups(req, res) {
  try {
    const collegeId = req.user.college_id || req.headers['x-college-id'];
    const backups = await backupService.listBackups(collegeId);
    return res.json({ success: true, data: backups });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, code: err.code || 'INTERNAL_ERROR', message: err.message });
  }
}

async function requestBackup(req, res) {
  try {
    const collegeId = req.user.college_id || req.headers['x-college-id'];
    const { passphrase, campus_id } = req.body;

    const result = await backupService.requestBackup({
      collegeId,
      campusId: campus_id || req.user.campus_id || null,
      userId: req.user.id,
      passphrase
    });

    return res.status(202).json({ success: true, data: result });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, code: err.code || 'INTERNAL_ERROR', message: err.message, details: err.details });
  }
}

async function refreshLinks(req, res) {
  try {
    const collegeId = req.user.college_id || req.headers['x-college-id'];
    const { id } = req.params;

    const result = await backupService.refreshBackupLinks(collegeId, id);
    return res.json({ success: true, data: result });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, code: err.code || 'INTERNAL_ERROR', message: err.message });
  }
}

module.exports = {
  listBackups,
  requestBackup,
  refreshLinks
};

