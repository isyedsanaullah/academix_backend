'use strict';

const budgetService = require('../services/budgetService');

exports.allocateBudget = async (req, res) => {
  try {
    const collegeId = req.collegeId || req.user.college_id;
    const campusId = req.body.campusId || req.user.campus_id || null;

    const result = await budgetService.allocateBudget({
      ...req.body,
      collegeId,
      campusId,
    });
    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    return res.status(err.code === 'VALIDATION_ERROR' ? 422 : 500).json({
      success: false,
      code: err.code || 'ALLOCATION_FAILED',
      message: err.message,
    });
  }
};

exports.getSummary = async (req, res) => {
  try {
    const collegeId = req.collegeId || req.user.college_id;
    const result = await budgetService.getDepartmentBudgetSummary({
      collegeId,
      fiscalYear: req.query.fiscalYear,
      campusId: req.query.campusId || null,
    });
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return res.status(500).json({
      success: false,
      code: 'SUMMARY_FAILED',
      message: err.message,
    });
  }
};

