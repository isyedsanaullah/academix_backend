'use strict';

const overviewService = require('./services/overview.service');
const paymentsHistoryService = require('./services/paymentsHistory.service');
const exportService = require('./services/exportService');
const collegeBillingService = require('./services/collegeBilling.service');
const planChangeService = require('./services/planChange.service');
const accountantsService = require('./services/accountants.service');
const {
  validateOverviewQuery,
  validatePaymentsQuery,
  validatePlanChange,
  validateApproval,
  validateRejection,
  parseBoolean
} = require('./validators/finance.schemas');

/**
 * GET /api/super-admin/finance/nav-counts
 * Lightweight endpoint to provide live sidebar counter badges.
 */
async function getNavCounts(req, res) {
  try {
    const includeTest = parseBoolean(req.query.includeTest, false);
    const counts = await overviewService.getNavCounts(includeTest);
    return res.json({ success: true, data: counts });
  } catch (err) {
    console.error('[FinanceController.getNavCounts] Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to retrieve navigation counts' });
  }
}

/**
 * GET /api/super-admin/finance/overview
 * Stat cards and multi-chart datasets for Accounting Overview.
 */
async function getOverview(req, res) {
  try {
    const filters = validateOverviewQuery(req.query);
    const data = await overviewService.getAccountingOverview(filters);
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[FinanceController.getOverview] Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to retrieve accounting overview' });
  }
}

/**
 * GET /api/super-admin/finance/payments
 * Paginated list of payments with filtering and sorting.
 */
async function getPayments(req, res) {
  try {
    const filters = validatePaymentsQuery(req.query);
    const data = await paymentsHistoryService.getPaymentsList(filters);
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[FinanceController.getPayments] Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to retrieve payments history' });
  }
}

/**
 * GET /api/super-admin/finance/payments/:id
 * Detailed payment view including timeline and proof.
 */
async function getPaymentById(req, res) {
  try {
    const payment = await paymentsHistoryService.getPaymentDetail(req.params.id);
    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment not found' });
    }
    return res.json({ success: true, data: payment });
  } catch (err) {
    console.error('[FinanceController.getPaymentById] Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to retrieve payment details' });
  }
}

/**
 * GET /api/super-admin/finance/payments/export
 * Streams CSV export of payments with audit logging.
 */
async function exportPayments(req, res) {
  try {
    const filters = validatePaymentsQuery(req.query);
    await exportService.exportPaymentsStream(filters, res, req.user);
  } catch (err) {
    console.error('[FinanceController.exportPayments] Error:', err);
    if (!res.headersSent) {
      return res.status(500).json({ success: false, message: 'Failed to export payments' });
    }
  }
}

/**
 * POST /api/super-admin/finance/payments/:id/approve
 * Approves a payment proof and settles revenue.
 */
async function approvePayment(req, res) {
  try {
    const validation = validateApproval(req.body);
    if (!validation.isValid) {
      return res.status(400).json({ success: false, errors: validation.errors });
    }
    const result = await paymentsHistoryService.approvePayment(req.params.id, validation.data, req.user);
    return res.json({ success: true, message: 'Payment approved successfully', data: result });
  } catch (err) {
    console.error('[FinanceController.approvePayment] Error:', err);
    const status = err.statusCode || 500;
    return res.status(status).json({ success: false, message: err.message || 'Failed to approve payment' });
  }
}

/**
 * POST /api/super-admin/finance/payments/:id/reject
 * Rejects a payment proof with reason.
 */
async function rejectPayment(req, res) {
  try {
    const validation = validateRejection(req.body);
    if (!validation.isValid) {
      return res.status(400).json({ success: false, errors: validation.errors });
    }
    const result = await paymentsHistoryService.rejectPayment(req.params.id, validation.data, req.user);
    return res.json({ success: true, message: 'Payment rejected', data: result });
  } catch (err) {
    console.error('[FinanceController.rejectPayment] Error:', err);
    const status = err.statusCode || 500;
    return res.status(status).json({ success: false, message: err.message || 'Failed to reject payment' });
  }
}

/**
 * GET /api/super-admin/finance/colleges
 * Per-college billing setups and summaries.
 */
async function getColleges(req, res) {
  try {
    const filters = {
      page: req.query.page,
      limit: req.query.limit,
      q: req.query.q,
      planId: req.query.planId,
      subStatus: req.query.subStatus,
      includeTest: parseBoolean(req.query.includeTest, false)
    };
    const data = await collegeBillingService.getCollegeBillingList(filters);
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[FinanceController.getColleges] Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to retrieve college billing setups' });
  }
}

/**
 * GET /api/super-admin/finance/colleges/:id
 * College billing details, ledger, and recent payments.
 */
async function getCollegeById(req, res) {
  try {
    const college = await collegeBillingService.getCollegeBillingDetail(req.params.id);
    if (!college) {
      return res.status(404).json({ success: false, message: 'College not found' });
    }
    return res.json({ success: true, data: college });
  } catch (err) {
    console.error('[FinanceController.getCollegeById] Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to retrieve college billing details' });
  }
}

/**
 * POST /api/super-admin/finance/colleges/:id/change-plan
 * Superadmin plan change on college request.
 */
async function changePlan(req, res) {
  try {
    const validation = validatePlanChange(req.body);
    if (!validation.isValid) {
      return res.status(400).json({ success: false, errors: validation.errors });
    }
    const result = await planChangeService.changeCollegePlan(
      req.params.id,
      validation.data.targetPlanId,
      validation.data.reason,
      req.user
    );
    return res.json({ success: true, message: 'Plan updated successfully', data: result });
  } catch (err) {
    console.error('[FinanceController.changePlan] Error:', err);
    const status = err.statusCode || 500;
    return res.status(status).json({
      success: false,
      code: err.code || 'PLAN_CHANGE_ERROR',
      message: err.message || 'Failed to change plan',
      details: err.details || null
    });
  }
}

/**
 * GET /api/super-admin/finance/accountants
 * Accountant accounts list with assignment coverage metrics.
 */
async function getAccountants(req, res) {
  try {
    const filters = {
      page: req.query.page,
      limit: req.query.limit,
      q: req.query.q,
      collegeId: req.query.collegeId,
      status: req.query.status,
      includeTest: parseBoolean(req.query.includeTest, false)
    };
    const data = await accountantsService.getAccountantsList(filters);
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[FinanceController.getAccountants] Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to retrieve accountants' });
  }
}

module.exports = {
  getNavCounts,
  getOverview,
  getPayments,
  getPaymentById,
  exportPayments,
  approvePayment,
  rejectPayment,
  getColleges,
  getCollegeById,
  changePlan,
  getAccountants
};

