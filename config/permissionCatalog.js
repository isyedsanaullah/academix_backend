'use strict';

/**
 * permissionCatalog.js — Phase 9C (#N10)
 * Concrete Permission Catalog for Custom Roles & Permission Builder.
 * Maps only permissions for routes migrated to requirePermission.
 * Super-admin capabilities are strictly excluded and never cataloged.
 */

const PERMISSION_CATALOG = [
  {
    key: 'students:read',
    module: 'Students',
    name: 'View Student Records',
    description: 'Allows reading student profiles, enrollment status, and parent details.'
  },
  {
    key: 'students:write',
    module: 'Students',
    name: 'Manage Student Records',
    description: 'Allows enrolling, editing, updating, and transferring students.'
  },
  {
    key: 'fees:read',
    module: 'Fees & Treasury',
    name: 'View Fee Records',
    description: 'Allows viewing student fee invoices, challans, balances, and payment histories.'
  },
  {
    key: 'fees:collect',
    module: 'Fees & Treasury',
    name: 'Collect Fees & Issue Receipts',
    description: 'Allows recording fee payments, issuing receipts, and adjusting vouchers.'
  },
  {
    key: 'attendance:read',
    module: 'Attendance',
    name: 'View Attendance Records',
    description: 'Allows viewing daily and period-wise student attendance reports.'
  },
  {
    key: 'attendance:mark',
    module: 'Attendance',
    name: 'Mark Attendance',
    description: 'Allows recording and updating student attendance marks.'
  },
  {
    key: 'timetable:read',
    module: 'Timetable',
    name: 'View Timetables',
    description: 'Allows viewing class, section, and teacher schedules.'
  },
  {
    key: 'timetable:edit',
    module: 'Timetable',
    name: 'Edit Timetables',
    description: 'Allows creating, modifying, and assigning timetable slots and rooms.'
  },
  {
    key: 'announcements:publish',
    module: 'Communications',
    name: 'Publish Announcements',
    description: 'Allows drafting and publishing institution-wide circulars and SMS alerts.'
  },
  {
    key: 'reports:read',
    module: 'Reports',
    name: 'View System Reports',
    description: 'Allows viewing academic, financial, and operational reports.'
  },
  {
    key: 'exports:create',
    module: 'Export Center',
    name: 'Generate Data Exports',
    description: 'Allows queueing and downloading CSV, Excel, and PDF exports.'
  },
  {
    key: 'kpi:view',
    module: 'Executive Governance',
    name: 'View Executive KPIs',
    description: 'Allows viewing high-level executive dashboard summaries and metrics.'
  },
  {
    key: 'approvals:act',
    module: 'Workflow Approvals',
    name: 'Act on Approval Requests',
    description: 'Allows approving, rejecting, or returning workflow approval requests.'
  },
  {
    key: 'canteen:cashier',
    module: 'Canteen POS',
    name: 'Canteen Cashier POS',
    description: 'Allows processing student meal charges at canteen checkout points.'
  }
];

const PERMISSION_KEYS = PERMISSION_CATALOG.map(p => p.key);
const PERMISSION_SET = new Set(PERMISSION_KEYS);

function isValidPermission(permissionKey) {
  return PERMISSION_SET.has(permissionKey);
}

function validatePermissions(permissions) {
  if (!Array.isArray(permissions)) {
    return { valid: false, invalidPermissions: ['Not an array'] };
  }
  const invalid = permissions.filter(p => !PERMISSION_SET.has(p));
  return {
    valid: invalid.length === 0,
    invalidPermissions: invalid
  };
}

module.exports = {
  PERMISSION_CATALOG,
  PERMISSION_KEYS,
  isValidPermission,
  validatePermissions
};

