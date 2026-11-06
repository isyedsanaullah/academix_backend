'use strict';

const accountingService = require('../services/accountingService');

exports.seedChart = async (req, res) => {
  try {
    const collegeId = req.collegeId || req.user.college_id;
    const result = await accountingService.seedChartOfAccounts(collegeId);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return res.status(500).json({
      success: false,
      code: 'SEED_FAILED',
      message: err.message,
    });
  }
};

exports.createAccountHead = async (req, res) => {
  try {
    const collegeId = req.collegeId || req.user.college_id;
    const result = await accountingService.createAccountHead({
      ...req.body,
      collegeId,
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

exports.postVoucher = async (req, res) => {
  try {
    const collegeId = req.collegeId || req.user.college_id;
    const campusId = req.body.campusId || req.user.campus_id || null;
    const createdById = req.user.id;

    const result = await accountingService.postJournalVoucher({
      ...req.body,
      collegeId,
      campusId,
      createdById,
    });
    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    const status = err.code === 'UNBALANCED_JOURNAL_VOUCHER' || err.code === 'INVALID_JOURNAL_LINE' ? 422 : 400;
    return res.status(status).json({
      success: false,
      code: err.code || 'POSTING_FAILED',
      message: err.message,
    });
  }
};

exports.getTrialBalance = async (req, res) => {
  try {
    const collegeId = req.collegeId || req.user.college_id;
    const result = await accountingService.getTrialBalance({
      collegeId,
      asOfDate: req.query.asOfDate || new Date(),
    });
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return res.status(500).json({
      success: false,
      code: 'TRIAL_BALANCE_FAILED',
      message: err.message,
    });
  }
};

exports.getIncomeStatement = async (req, res) => {
  try {
    const collegeId = req.collegeId || req.user.college_id;
    const result = await accountingService.getIncomeStatement({
      collegeId,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
    });
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return res.status(500).json({
      success: false,
      code: 'INCOME_STATEMENT_FAILED',
      message: err.message,
    });
  }
};

