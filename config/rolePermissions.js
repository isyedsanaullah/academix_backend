'use strict';

/**
 * rolePermissions.js — Phase 9C (#N10)
 * Baseline Fixed-Role Permissions Map.
 * Maps fixed institutional roles to their implicit catalog permissions.
 * Super Admin bypasses all checks globally.
 */

const { PERMISSION_KEYS } = require('./permissionCatalog');

const FIXED_ROLE_PERMISSIONS = {
  // Super Admin implicitly holds everything
  superadmin: [...PERMISSION_KEYS],

  // Institution Admin holds all tenant-level permissions
  admin: [...PERMISSION_KEYS],

  // Principal / Vice Principal / Dean
  principal: [
    'students:read',
    'attendance:read',
    'timetable:read',
    'reports:read',
    'kpi:view',
    'approvals:act',
    'announcements:publish',
    'exports:create'
  ],

  // Registrar / Admissions Officer
  registrar: [
    'students:read',
    'students:write',
    'attendance:read',
    'timetable:read',
    'reports:read'
  ],

  // Accountant / Bursar / Finance
  accountant: [
    'fees:read',
    'fees:collect',
    'reports:read',
    'students:read',
    'exports:create'
  ],

  // Teacher / Instructor / Faculty
  teacher: [
    'students:read',
    'attendance:read',
    'attendance:mark',
    'timetable:read'
  ],

  // General Staff / Employee
  employee: [
    'timetable:read'
  ],

  // Non-administrative portal users hold no catalog permissions
  student: [],
  parent: []
};

/**
 * Get permissions implicitly held by a base role
 * @param {string} role
 * @returns {string[]}
 */
function getFixedRolePermissions(role) {
  if (!role) return [];
  const normalized = String(role).toLowerCase().trim();
  return FIXED_ROLE_PERMISSIONS[normalized] || [];
}

module.exports = {
  FIXED_ROLE_PERMISSIONS,
  getFixedRolePermissions
};

