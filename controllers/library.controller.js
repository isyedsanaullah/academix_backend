'use strict';

const libraryService = require('../services/libraryService');

exports.createTitle = async (req, res) => {
  try {
    const collegeId = req.collegeId || req.user.college_id;
    const campusId = req.body.campusId || req.user.campus_id || null;
    const result = await libraryService.createTitle({
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

exports.addCopy = async (req, res) => {
  try {
    const collegeId = req.collegeId || req.user.college_id;
    const result = await libraryService.addCopy({
      ...req.body,
      collegeId,
    });
    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    return res.status(err.code === 'NOT_FOUND' ? 404 : 422).json({
      success: false,
      code: err.code || 'SERVER_ERROR',
      message: err.message,
    });
  }
};

exports.getTitle = async (req, res) => {
  try {
    const collegeId = req.collegeId || req.user.college_id;
    const result = await libraryService.getTitleWithAvailability({
      collegeId,
      titleId: req.params.id,
    });
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return res.status(err.code === 'NOT_FOUND' ? 404 : 500).json({
      success: false,
      code: err.code || 'SERVER_ERROR',
      message: err.message,
    });
  }
};

exports.issueBook = async (req, res) => {
  try {
    const collegeId = req.collegeId || req.user.college_id;
    const campusId = req.body.campusId || req.user.campus_id || null;
    const issuedById = req.user.id;

    const result = await libraryService.issueBook({
      ...req.body,
      collegeId,
      campusId,
      issuedById,
    });
    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    const status = err.code === 'MAX_LOANS_EXCEEDED' || err.code === 'COPY_NOT_AVAILABLE' ? 422 : 400;
    return res.status(status).json({
      success: false,
      code: err.code || 'ISSUE_FAILED',
      message: err.message,
    });
  }
};

exports.returnBook = async (req, res) => {
  try {
    const collegeId = req.collegeId || req.user.college_id;
    const result = await libraryService.returnBook({
      collegeId,
      issueRecordId: req.body.issueRecordId,
      returnDate: req.body.returnDate,
    });
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    const status = err.code === 'NOT_FOUND' ? 404 : 422;
    return res.status(status).json({
      success: false,
      code: err.code || 'RETURN_FAILED',
      message: err.message,
    });
  }
};

exports.listLoans = async (req, res) => {
  try {
    const collegeId = req.collegeId || req.user.college_id;
    const result = await libraryService.listActiveLoans({
      collegeId,
      studentId: req.query.studentId || null,
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

