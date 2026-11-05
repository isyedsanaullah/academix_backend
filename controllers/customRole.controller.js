'use strict';

/**
 * customRole.controller.js — Phase 9C (#N10)
 * Controller for Custom Roles & Permission Builder
 */

const customRoleService = require('../services/customRoleService');
const { PERMISSION_CATALOG } = require('../config/permissionCatalog');

async function getPermissionCatalog(req, res) {
  return res.json({
    success: true,
    data: PERMISSION_CATALOG
  });
}

async function listRoles(req, res) {
  try {
    const collegeId = req.user.college_id || req.headers['x-college-id'];
    const roles = await customRoleService.listCustomRoles(collegeId);
    return res.json({
      success: true,
      data: roles
    });
  } catch (err) {
    console.error('[customRole.controller] listRoles error:', err);
    return res.status(err.status || 500).json({
      success: false,
      code: err.code || 'INTERNAL_ERROR',
      message: err.message
    });
  }
}

async function getRole(req, res) {
  try {
    const collegeId = req.user.college_id || req.headers['x-college-id'];
    const { id } = req.params;
    const role = await customRoleService.getCustomRole(collegeId, id);
    if (!role) {
      return res.status(404).json({
        success: false,
        code: 'NOT_FOUND',
        message: `Role with ID "${id}" not found.`
      });
    }
    return res.json({
      success: true,
      data: role
    });
  } catch (err) {
    console.error('[customRole.controller] getRole error:', err);
    return res.status(err.status || 500).json({
      success: false,
      code: err.code || 'INTERNAL_ERROR',
      message: err.message
    });
  }
}

async function createRole(req, res) {
  try {
    const collegeId = req.user.college_id || req.headers['x-college-id'];
    const { name, description, permissions, isAdminClass, campus_id } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_NAME',
        message: 'Role name is required'
      });
    }

    const role = await customRoleService.createCustomRole({
      collegeId,
      campusId: campus_id || req.user.campus_id || null,
      grantorUser: req.user,
      name,
      description,
      permissions: permissions || [],
      isAdminClass: Boolean(isAdminClass)
    });

    return res.status(201).json({
      success: true,
      data: role
    });
  } catch (err) {
    console.error('[customRole.controller] createRole error:', err);
    return res.status(err.status || 500).json({
      success: false,
      code: err.code || 'INTERNAL_ERROR',
      message: err.message,
      details: err.details
    });
  }
}

async function updateRole(req, res) {
  try {
    const collegeId = req.user.college_id || req.headers['x-college-id'];
    const { id } = req.params;
    const { name, description, permissions, isAdminClass } = req.body;

    const role = await customRoleService.updateCustomRole({
      collegeId,
      roleId: id,
      grantorUser: req.user,
      updates: { name, description, permissions, isAdminClass }
    });

    return res.json({
      success: true,
      data: role
    });
  } catch (err) {
    console.error('[customRole.controller] updateRole error:', err);
    return res.status(err.status || 500).json({
      success: false,
      code: err.code || 'INTERNAL_ERROR',
      message: err.message,
      details: err.details
    });
  }
}

async function deleteRole(req, res) {
  try {
    const collegeId = req.user.college_id || req.headers['x-college-id'];
    const { id } = req.params;

    const result = await customRoleService.deleteCustomRole({
      collegeId,
      roleId: id,
      grantorUser: req.user
    });

    return res.json({
      success: true,
      data: result
    });
  } catch (err) {
    console.error('[customRole.controller] deleteRole error:', err);
    return res.status(err.status || 500).json({
      success: false,
      code: err.code || 'INTERNAL_ERROR',
      message: err.message
    });
  }
}

async function assignRole(req, res) {
  try {
    const collegeId = req.user.college_id || req.headers['x-college-id'];
    const { id } = req.params;
    const { userId, campus_id } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        code: 'USER_REQUIRED',
        message: 'userId is required for role assignment'
      });
    }

    const assignment = await customRoleService.assignCustomRole({
      collegeId,
      campusId: campus_id || req.user.campus_id || null,
      roleId: id,
      targetUserId: userId,
      grantorUser: req.user
    });

    return res.status(201).json({
      success: true,
      data: assignment
    });
  } catch (err) {
    console.error('[customRole.controller] assignRole error:', err);
    return res.status(err.status || 500).json({
      success: false,
      code: err.code || 'INTERNAL_ERROR',
      message: err.message,
      details: err.details
    });
  }
}

async function unassignRole(req, res) {
  try {
    const collegeId = req.user.college_id || req.headers['x-college-id'];
    const { id } = req.params;
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        code: 'USER_REQUIRED',
        message: 'userId is required for role unassignment'
      });
    }

    const result = await customRoleService.unassignCustomRole({
      collegeId,
      roleId: id,
      targetUserId: userId,
      grantorUser: req.user
    });

    return res.json({
      success: true,
      data: result
    });
  } catch (err) {
    console.error('[customRole.controller] unassignRole error:', err);
    return res.status(err.status || 500).json({
      success: false,
      code: err.code || 'INTERNAL_ERROR',
      message: err.message
    });
  }
}

module.exports = {
  getPermissionCatalog,
  listRoles,
  getRole,
  createRole,
  updateRole,
  deleteRole,
  assignRole,
  unassignRole
};

