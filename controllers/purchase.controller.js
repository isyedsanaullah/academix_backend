'use strict';

const purchaseOrderService = require('../services/purchaseOrderService');

exports.createVendor = async (req, res) => {
  try {
    const collegeId = req.collegeId || req.user.college_id;
    const result = await purchaseOrderService.createVendor({
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

exports.createOrder = async (req, res) => {
  try {
    const collegeId = req.collegeId || req.user.college_id;
    const campusId = req.body.campusId || req.user.campus_id || null;
    const createdById = req.user.id;

    const result = await purchaseOrderService.createPurchaseOrder({
      ...req.body,
      collegeId,
      campusId,
      createdById,
      creatorUser: req.user,
    });

    if (result.requiresApproval) {
      return res.status(202).json({
        success: true,
        message: 'Purchase order exceeds threshold; approval workflow initiated',
        requiresApproval: true,
        approvalRequestId: result.approvalRequestId,
        data: result.po,
      });
    }

    return res.status(201).json({ success: true, data: result.po });
  } catch (err) {
    const status = err.code === 'DEPARTMENT_BUDGET_EXCEEDED' ? 422 : 400;
    return res.status(status).json({
      success: false,
      code: err.code || 'ORDER_FAILED',
      message: err.message,
    });
  }
};

exports.listOrders = async (req, res) => {
  try {
    const collegeId = req.collegeId || req.user.college_id;
    const result = await purchaseOrderService.listPurchaseOrders({
      collegeId,
      status: req.query.status || null,
      vendorId: req.query.vendorId || null,
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

