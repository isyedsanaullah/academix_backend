'use strict';

const assetService = require('../services/assetService');

exports.registerAsset = async (req, res) => {
  try {
    const collegeId = req.collegeId || req.user.college_id;
    const campusId = req.body.campusId || req.user.campus_id || null;
    const result = await assetService.registerAsset({
      ...req.body,
      collegeId,
      campusId,
    });
    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    return res.status(err.code === 'VALIDATION_ERROR' ? 422 : 500).json({
      success: false,
      code: err.code || 'SERVER_ERROR',
      message: err.message,
    });
  }
};

exports.listAssets = async (req, res) => {
  try {
    const collegeId = req.collegeId || req.user.college_id;
    const result = await assetService.listAssets({
      collegeId,
      category: req.query.category || null,
      status: req.query.status || null,
    });
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return res.status(500).json({
      success: false,
      code: 'SERVER_ERROR',
      message: err.message,
    });
  }
};

exports.applyDepreciation = async (req, res) => {
  try {
    const collegeId = req.collegeId || req.user.college_id;
    const result = await assetService.applyDepreciation({
      collegeId,
      assetId: req.params.id,
      asOfDate: req.body.asOfDate || new Date(),
    });
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return res.status(err.code === 'NOT_FOUND' ? 404 : 500).json({
      success: false,
      code: err.code || 'DEPRECIATION_FAILED',
      message: err.message,
    });
  }
};

exports.logMaintenance = async (req, res) => {
  try {
    const collegeId = req.collegeId || req.user.college_id;
    const result = await assetService.logMaintenance({
      ...req.body,
      collegeId,
    });
    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    return res.status(err.code === 'VALIDATION_ERROR' ? 422 : 500).json({
      success: false,
      code: err.code || 'LOG_MAINTENANCE_FAILED',
      message: err.message,
    });
  }
};

