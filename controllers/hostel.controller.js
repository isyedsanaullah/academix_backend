'use strict';

const hostelService = require('../services/hostelService');

exports.createBuilding = async (req, res) => {
  try {
    const collegeId = req.collegeId || req.user.college_id;
    const campusId = req.body.campusId || req.user.campus_id || null;
    const result = await hostelService.createBuilding({
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

exports.addRoom = async (req, res) => {
  try {
    const result = await hostelService.addRoom(req.body);
    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    return res.status(422).json({
      success: false,
      code: 'ADD_ROOM_FAILED',
      message: err.message,
    });
  }
};

exports.allotBed = async (req, res) => {
  try {
    const collegeId = req.collegeId || req.user.college_id;
    const campusId = req.body.campusId || req.user.campus_id || null;
    const result = await hostelService.allotBed({
      ...req.body,
      collegeId,
      campusId,
    });
    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    const status = err.code === 'BED_ALREADY_OCCUPIED' || err.code === 'INVALID_BED_NUMBER' ? 422 : 400;
    return res.status(status).json({
      success: false,
      code: err.code || 'ALLOTMENT_FAILED',
      message: err.message,
    });
  }
};

exports.vacateBed = async (req, res) => {
  try {
    const collegeId = req.collegeId || req.user.college_id;
    const result = await hostelService.vacateBed({
      collegeId,
      allotmentId: req.params.id,
    });
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return res.status(500).json({
      success: false,
      code: 'VACATE_FAILED',
      message: err.message,
    });
  }
};

exports.markNightAttendance = async (req, res) => {
  try {
    const collegeId = req.collegeId || req.user.college_id;
    const markedById = req.user.id;
    const result = await hostelService.markNightAttendance({
      ...req.body,
      collegeId,
      markedById,
    });
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return res.status(err.code === 'VALIDATION_ERROR' ? 422 : 500).json({
      success: false,
      code: err.code || 'ATTENDANCE_FAILED',
      message: err.message,
    });
  }
};

exports.generateFees = async (req, res) => {
  try {
    const collegeId = req.collegeId || req.user.college_id;
    const result = await hostelService.applyHostelFeesToVoucher({
      collegeId,
      sessionId: req.body.sessionId,
      month: req.body.month,
      studentId: req.body.studentId || null,
    });
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return res.status(500).json({
      success: false,
      code: 'GENERATE_FEES_FAILED',
      message: err.message,
    });
  }
};

