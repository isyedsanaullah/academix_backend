'use strict';

/**
 * approvalWorkflow.controller.js — Phase 9D (#N11)
 * Controller for Multi-Step Approval Workflows
 */

const approvalService = require('../services/approvalService');

async function listChains(req, res) {
  try {
    const collegeId = req.user.college_id || req.headers['x-college-id'];
    const chains = await approvalService.listChains(collegeId);
    return res.json({ success: true, data: chains });
  } catch (err) {
    console.error('[approvalWorkflow.controller] listChains error:', err);
    return res.status(err.status || 500).json({ success: false, code: err.code || 'INTERNAL_ERROR', message: err.message });
  }
}

async function configureChain(req, res) {
  try {
    const collegeId = req.user.college_id || req.headers['x-college-id'];
    const { workflowType, steps, isActive } = req.body;

    const chain = await approvalService.createOrUpdateChain({
      collegeId,
      workflowType,
      steps,
      isActive
    });

    return res.status(200).json({ success: true, data: chain });
  } catch (err) {
    console.error('[approvalWorkflow.controller] configureChain error:', err);
    return res.status(err.status || 500).json({ success: false, code: err.code || 'INTERNAL_ERROR', message: err.message });
  }
}

async function listRequests(req, res) {
  try {
    const collegeId = req.user.college_id || req.headers['x-college-id'];
    const { status, workflowType, myRequests } = req.query;

    const filters = {};
    if (status) filters.status = status;
    if (workflowType) filters.workflowType = workflowType;
    if (myRequests === 'true') filters.requesterId = req.user.id;

    const requests = await approvalService.listRequests(collegeId, filters);
    return res.json({ success: true, data: requests });
  } catch (err) {
    console.error('[approvalWorkflow.controller] listRequests error:', err);
    return res.status(err.status || 500).json({ success: false, code: err.code || 'INTERNAL_ERROR', message: err.message });
  }
}

async function getRequest(req, res) {
  try {
    const collegeId = req.user.college_id || req.headers['x-college-id'];
    const { id } = req.params;
    const request = await approvalService.getRequestDetails(collegeId, id);
    if (!request || request.college_id !== collegeId) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Approval request not found.' });
    }
    return res.json({ success: true, data: request });
  } catch (err) {
    console.error('[approvalWorkflow.controller] getRequest error:', err);
    return res.status(err.status || 500).json({ success: false, code: err.code || 'INTERNAL_ERROR', message: err.message });
  }
}

async function approve(req, res) {
  try {
    const collegeId = req.user.college_id || req.headers['x-college-id'];
    const { id } = req.params;
    const { note } = req.body;

    const result = await approvalService.approveStep({
      collegeId,
      requestId: id,
      actorUser: req.user,
      note
    });

    return res.json({ success: true, data: result });
  } catch (err) {
    console.error('[approvalWorkflow.controller] approve error:', err);
    return res.status(err.status || 500).json({ success: false, code: err.code || 'INTERNAL_ERROR', message: err.message });
  }
}

async function reject(req, res) {
  try {
    const collegeId = req.user.college_id || req.headers['x-college-id'];
    const { id } = req.params;
    const { note } = req.body;

    const result = await approvalService.rejectStep({
      collegeId,
      requestId: id,
      actorUser: req.user,
      note
    });

    return res.json({ success: true, data: result });
  } catch (err) {
    console.error('[approvalWorkflow.controller] reject error:', err);
    return res.status(err.status || 500).json({ success: false, code: err.code || 'INTERNAL_ERROR', message: err.message });
  }
}

async function cancel(req, res) {
  try {
    const collegeId = req.user.college_id || req.headers['x-college-id'];
    const { id } = req.params;
    const { note } = req.body;

    const result = await approvalService.cancelRequest({
      collegeId,
      requestId: id,
      actorUser: req.user,
      note
    });

    return res.json({ success: true, data: result });
  } catch (err) {
    console.error('[approvalWorkflow.controller] cancel error:', err);
    return res.status(err.status || 500).json({ success: false, code: err.code || 'INTERNAL_ERROR', message: err.message });
  }
}

module.exports = {
  listChains,
  configureChain,
  listRequests,
  getRequest,
  approve,
  reject,
  cancel
};

