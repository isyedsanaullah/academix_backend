'use strict';

/**
 * customRole.routes.js — Phase 9C (#N10)
 * Routes for Custom Roles & Permission Builder
 */

const express = require('express');
const router = express.Router();
const customRoleController = require('../controllers/customRole.controller');
const { authMiddleware } = require('../middleware/auth');
const subscriptionGate = require('../middleware/subscriptionGate');

// All routes require authentication and N10 feature entitlement
router.use(authMiddleware);
router.use(subscriptionGate('custom-roles-permissions'));

router.get('/permissions', customRoleController.getPermissionCatalog);
router.get('/', customRoleController.listRoles);
router.post('/', customRoleController.createRole);
router.get('/:id', customRoleController.getRole);
router.put('/:id', customRoleController.updateRole);
router.delete('/:id', customRoleController.deleteRole);
router.post('/:id/assign', customRoleController.assignRole);
router.post('/:id/unassign', customRoleController.unassignRole);

module.exports = router;

