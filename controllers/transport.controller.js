'use strict';

const transportService = require('../services/transportService');

exports.createRoute = async (req, res) => {
  try {
    const collegeId = req.collegeId || req.user.college_id;
    const campusId = req.body.campusId || req.user.campus_id || null;
    const result = await transportService.createRoute({
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

exports.addStop = async (req, res) => {
  try {
    const result = await transportService.addStop(req.body);
    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    return res.status(422).json({
      success: false,
      code: 'ADD_STOP_FAILED',
      message: err.message,
    });
  }
};

exports.addVehicle = async (req, res) => {
  try {
    const collegeId = req.collegeId || req.user.college_id;
    const campusId = req.body.campusId || req.user.campus_id || null;
    const result = await transportService.addVehicle({
      ...req.body,
      collegeId,
      campusId,
    });
    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    return res.status(422).json({
      success: false,
      code: 'ADD_VEHICLE_FAILED',
      message: err.message,
    });
  }
};

exports.allocateStudent = async (req, res) => {
  try {
    const collegeId = req.collegeId || req.user.college_id;
    const campusId = req.body.campusId || req.user.campus_id || null;
    const result = await transportService.allocateStudent({
      ...req.body,
      collegeId,
      campusId,
    });
    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    const status = err.code === 'ROUTE_CAPACITY_EXCEEDED' ? 422 : 400;
    return res.status(status).json({
      success: false,
      code: err.code || 'ALLOCATION_FAILED',
      message: err.message,
    });
  }
};

exports.deallocateStudent = async (req, res) => {
  try {
    const collegeId = req.collegeId || req.user.college_id;
    const result = await transportService.deallocateStudent({
      collegeId,
      allocationId: req.params.id,
    });
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return res.status(500).json({
      success: false,
      code: 'DEALLOCATION_FAILED',
      message: err.message,
    });
  }
};

exports.generateFees = async (req, res) => {
  try {
    const collegeId = req.collegeId || req.user.college_id;
    const result = await transportService.applyTransportFeesToVoucher({
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

