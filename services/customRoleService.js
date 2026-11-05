'use strict';

/**
 * customRoleService.js — Phase 9C (#N10)
 * Service for Custom Roles & Permission Builder:
 * - Admin quota accounting via countAdminClassUsers
 * - Free role creation; quota-gated admin-class assignment & toggling
 * - Strict privilege escalation guards (grantor must hold granted permissions)
 * - Self-edit / self-assignment guards
 * - Composite foreign-key cross-tenant isolation
 * - Full audit logging
 */

const { getSystemClient } = require('../config/prismaManager');
const { getEntitlements } = require('./entitlements');
const { checkQuota, recordUsage, refundQuota, resolvePeriodKey } = require('./quotaService');
const { validatePermissions, isValidPermission } = require('../config/permissionCatalog');
const { getFixedRolePermissions } = require('../config/rolePermissions');

function getPrisma() {
  return getSystemClient();
}

/**
 * Count unique admin-class users for a college.
 * A user is admin-class if:
 * 1. Their base role is 'admin' (or 'superadmin'), OR
 * 2. They hold an assigned CustomRole with isAdminClass: true (and college has custom-roles-permissions)
 */
async function countAdminClassUsers(collegeId, dbClient = null) {
  const prisma = dbClient || getPrisma();

  // 1. Base admins
  const baseAdmins = await prisma.user.findMany({
    where: {
      college_id: collegeId,
      role: { in: ['admin', 'ADMIN'] }
    },
    select: { id: true }
  });

  const adminSet = new Set(baseAdmins.map(u => u.id));

  // 2. Custom role admin-class holders (only if feature is active)
  const entitlements = await getEntitlements(collegeId, prisma);
  if (entitlements.features.includes('custom-roles-permissions')) {
    const customAdminHolders = await prisma.userCustomRole.findMany({
      where: {
        college_id: collegeId,
        role: {
          isAdminClass: true
        }
      },
      select: { userId: true }
    });

    for (const h of customAdminHolders) {
      adminSet.add(h.userId);
    }
  }

  return adminSet.size;
}

/**
 * Check if a specific user is currently considered admin-class
 */
async function isUserAdminClass(collegeId, userId, dbClient = null) {
  const prisma = dbClient || getPrisma();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, college_id: true }
  });
  if (!user || user.college_id !== collegeId) return false;

  const baseRole = String(user.role || '').toLowerCase();
  if (baseRole === 'admin' || baseRole === 'superadmin') return true;

  const entitlements = await getEntitlements(collegeId, prisma);
  if (!entitlements.features.includes('custom-roles-permissions')) return false;

  const hasAdminRole = await prisma.userCustomRole.findFirst({
    where: {
      college_id: collegeId,
      userId,
      role: { isAdminClass: true }
    }
  });

  return Boolean(hasAdminRole);
}

/**
 * Get all effective permissions for a user (base role + active custom roles)
 */
async function getUserPermissions(collegeId, user, dbClient = null) {
  const prisma = dbClient || getPrisma();
  const baseRole = String(user.role || '').toLowerCase();

  // Super Admin implicitly holds everything
  if (baseRole === 'superadmin') {
    const { PERMISSION_KEYS } = require('../config/permissionCatalog');
    return [...PERMISSION_KEYS];
  }

  const permissions = new Set(getFixedRolePermissions(baseRole));

  // If user is base admin, they already hold all catalog permissions
  if (baseRole === 'admin') {
    return Array.from(permissions);
  }

  // Check if institution has custom-roles-permissions feature active
  const entitlements = await getEntitlements(collegeId, prisma);
  if (entitlements.features.includes('custom-roles-permissions')) {
    const assignments = await prisma.userCustomRole.findMany({
      where: {
        college_id: collegeId,
        userId: user.id
      },
      include: {
        role: true
      }
    });

    for (const assignment of assignments) {
      if (assignment.role && Array.isArray(assignment.role.permissions)) {
        for (const p of assignment.role.permissions) {
          permissions.add(p);
        }
      }
    }
  }

  return Array.from(permissions);
}

/**
 * Create a new custom role
 * Quota rule: Creating a role consumes NO quota.
 */
async function createCustomRole({
  collegeId,
  campusId = null,
  grantorUser,
  name,
  description = null,
  permissions = [],
  isAdminClass = false
}) {
  const prisma = getPrisma();

  // 1. Validate permissions against concrete catalog
  const { valid, invalidPermissions } = validatePermissions(permissions);
  if (!valid) {
    throw Object.assign(new Error(`Invalid permissions: ${invalidPermissions.join(', ')}`), {
      status: 400,
      code: 'INVALID_PERMISSIONS'
    });
  }

  // 2. Privilege escalation checks
  const grantorRole = String(grantorUser.role || '').toLowerCase();
  const isSuperOrAdmin = grantorRole === 'superadmin' || grantorRole === 'admin';

  if (!isSuperOrAdmin) {
    // Grantor cannot grant permissions they do not possess
    const grantorPerms = new Set(await getUserPermissions(collegeId, grantorUser, prisma));
    const missing = permissions.filter(p => !grantorPerms.has(p));
    if (missing.length > 0) {
      throw Object.assign(new Error(`Privilege escalation: cannot grant permissions you do not possess (${missing.join(', ')})`), {
        status: 403,
        code: 'PRIVILEGE_ESCALATION'
      });
    }

    // Only fixed-role admin can create admin-class roles
    if (isAdminClass) {
      throw Object.assign(new Error('Only an institution admin can create admin-class roles.'), {
        status: 403,
        code: 'FORBIDDEN'
      });
    }
  }

  // 3. Check duplicate name within tenant
  const existing = await prisma.customRole.findUnique({
    where: {
      college_id_name: {
        college_id: collegeId,
        name: name.trim()
      }
    }
  });
  if (existing) {
    throw Object.assign(new Error(`Role with name "${name}" already exists in this institution.`), {
      status: 409,
      code: 'ROLE_NAME_EXISTS'
    });
  }

  // 4. Create role (zero quota consumed)
  const role = await prisma.customRole.create({
    data: {
      college_id: collegeId,
      campus_id: campusId,
      name: name.trim(),
      description: description ? description.trim() : null,
      permissions,
      isAdminClass: Boolean(isAdminClass),
      createdBy: grantorUser.id
    }
  });

  // 5. Audit Log
  await prisma.auditLog.create({
    data: {
      college_id: collegeId,
      user_id: grantorUser.id,
      action: 'CUSTOM_ROLE_CREATED',
      details: JSON.stringify({
        roleId: role.id,
        name: role.name,
        permissions: role.permissions,
        isAdminClass: role.isAdminClass
      })
    }
  });

  return role;
}

/**
 * Update an existing custom role
 * Checks self-edit, privilege escalation, and quota if isAdminClass toggled to true.
 */
async function updateCustomRole({
  collegeId,
  roleId,
  grantorUser,
  updates
}) {
  const prisma = getPrisma();

  const role = await prisma.customRole.findUnique({
    where: {
      id_college_id: {
        id: roleId,
        college_id: collegeId
      }
    }
  });

  if (!role) {
    throw Object.assign(new Error(`Role with ID "${roleId}" not found.`), { status: 404, code: 'NOT_FOUND' });
  }

  // Self-edit guard: nobody edits their own role
  const selfAssignment = await prisma.userCustomRole.findUnique({
    where: {
      college_id_userId_roleId: {
        college_id: collegeId,
        userId: grantorUser.id,
        roleId
      }
    }
  });
  if (selfAssignment) {
    throw Object.assign(new Error('Cannot modify a role assigned to yourself.'), {
      status: 403,
      code: 'SELF_EDIT_FORBIDDEN'
    });
  }

  const grantorRole = String(grantorUser.role || '').toLowerCase();
  const isSuperOrAdmin = grantorRole === 'superadmin' || grantorRole === 'admin';

  const dataToUpdate = {};

  if (updates.name && updates.name.trim() !== role.name) {
    const existing = await prisma.customRole.findUnique({
      where: {
        college_id_name: {
          college_id: collegeId,
          name: updates.name.trim()
        }
      }
    });
    if (existing && existing.id !== roleId) {
      throw Object.assign(new Error(`Role with name "${updates.name}" already exists.`), { status: 409, code: 'ROLE_NAME_EXISTS' });
    }
    dataToUpdate.name = updates.name.trim();
  }

  if (updates.description !== undefined) {
    dataToUpdate.description = updates.description ? updates.description.trim() : null;
  }

  if (updates.permissions !== undefined) {
    const { valid, invalidPermissions } = validatePermissions(updates.permissions);
    if (!valid) {
      throw Object.assign(new Error(`Invalid permissions: ${invalidPermissions.join(', ')}`), {
        status: 400,
        code: 'INVALID_PERMISSIONS'
      });
    }

    if (!isSuperOrAdmin) {
      const grantorPerms = new Set(await getUserPermissions(collegeId, grantorUser, prisma));
      const missing = updates.permissions.filter(p => !grantorPerms.has(p));
      if (missing.length > 0) {
        throw Object.assign(new Error(`Privilege escalation: cannot grant permissions you do not possess (${missing.join(', ')})`), {
          status: 403,
          code: 'PRIVILEGE_ESCALATION'
        });
      }
    }
    dataToUpdate.permissions = updates.permissions;
  }

  // Admin class toggle checks
  if (updates.isAdminClass !== undefined && updates.isAdminClass !== role.isAdminClass) {
    if (!isSuperOrAdmin) {
      throw Object.assign(new Error('Only an institution admin can change admin-class status.'), {
        status: 403,
        code: 'FORBIDDEN'
      });
    }

    if (updates.isAdminClass === true) {
      // Toggling isAdminClass from false to true re-checks quota for holders who would become newly admin-class
      const assignedUsers = await prisma.userCustomRole.findMany({
        where: { college_id: collegeId, roleId },
        select: { userId: true }
      });

      let newlyAdminCount = 0;
      for (const a of assignedUsers) {
        const u = await prisma.user.findUnique({ where: { id: a.userId }, select: { role: true } });
        if (String(u?.role || '').toLowerCase() === 'admin') continue;

        const otherAdminRole = await prisma.userCustomRole.findFirst({
          where: {
            college_id: collegeId,
            userId: a.userId,
            roleId: { not: roleId },
            role: { isAdminClass: true }
          }
        });
        if (!otherAdminRole) {
          newlyAdminCount++;
        }
      }

      if (newlyAdminCount > 0) {
        const quotaCheck = await checkQuota(collegeId, 'admins', newlyAdminCount);
        if (!quotaCheck.allowed) {
          throw Object.assign(new Error(`Cannot toggle isAdminClass: would exceed admin quota by ${newlyAdminCount} users.`), {
            status: 422,
            code: 'QUOTA_EXCEEDED',
            details: { newlyAdminCount, limit: quotaCheck.limit, current: quotaCheck.current }
          });
        }
        await recordUsage(collegeId, 'admins', newlyAdminCount);
      }
    } else {
      // Toggling from true to false: release quota for users losing admin status
      const assignedUsers = await prisma.userCustomRole.findMany({
        where: { college_id: collegeId, roleId },
        select: { userId: true }
      });

      let releasedCount = 0;
      for (const a of assignedUsers) {
        const u = await prisma.user.findUnique({ where: { id: a.userId }, select: { role: true } });
        if (String(u?.role || '').toLowerCase() === 'admin') continue;

        const otherAdminRole = await prisma.userCustomRole.findFirst({
          where: {
            college_id: collegeId,
            userId: a.userId,
            roleId: { not: roleId },
            role: { isAdminClass: true }
          }
        });
        if (!otherAdminRole) {
          releasedCount++;
        }
      }

      if (releasedCount > 0) {
        const periodKey = resolvePeriodKey('admins', new Date());
        await refundQuota(collegeId, 'admins', periodKey, releasedCount);
      }
    }

    dataToUpdate.isAdminClass = Boolean(updates.isAdminClass);
  }

  const updatedRole = await prisma.customRole.update({
    where: { id: roleId },
    data: dataToUpdate
  });

  // Audit
  await prisma.auditLog.create({
    data: {
      college_id: collegeId,
      user_id: grantorUser.id,
      action: 'CUSTOM_ROLE_UPDATED',
      details: JSON.stringify({
        roleId,
        before: { name: role.name, permissions: role.permissions, isAdminClass: role.isAdminClass },
        after: { name: updatedRole.name, permissions: updatedRole.permissions, isAdminClass: updatedRole.isAdminClass }
      })
    }
  });

  return updatedRole;
}

/**
 * Delete a custom role
 */
async function deleteCustomRole({ collegeId, roleId, grantorUser }) {
  const prisma = getPrisma();

  const role = await prisma.customRole.findUnique({
    where: {
      id_college_id: {
        id: roleId,
        college_id: collegeId
      }
    }
  });

  if (!role) {
    throw Object.assign(new Error(`Role with ID "${roleId}" not found.`), { status: 404, code: 'NOT_FOUND' });
  }

  // Self-edit guard
  const selfAssignment = await prisma.userCustomRole.findUnique({
    where: {
      college_id_userId_roleId: {
        college_id: collegeId,
        userId: grantorUser.id,
        roleId
      }
    }
  });
  if (selfAssignment) {
    throw Object.assign(new Error('Cannot delete a role assigned to yourself.'), {
      status: 403,
      code: 'SELF_EDIT_FORBIDDEN'
    });
  }

  // If role was admin-class, refund quota for users losing admin status
  if (role.isAdminClass) {
    const assignedUsers = await prisma.userCustomRole.findMany({
      where: { college_id: collegeId, roleId },
      select: { userId: true }
    });

    let releasedCount = 0;
    for (const a of assignedUsers) {
      const u = await prisma.user.findUnique({ where: { id: a.userId }, select: { role: true } });
      if (String(u?.role || '').toLowerCase() === 'admin') continue;

      const otherAdminRole = await prisma.userCustomRole.findFirst({
        where: {
          college_id: collegeId,
          userId: a.userId,
          roleId: { not: roleId },
          role: { isAdminClass: true }
        }
      });
      if (!otherAdminRole) releasedCount++;
    }

    if (releasedCount > 0) {
      const periodKey = resolvePeriodKey('admins', new Date());
      await refundQuota(collegeId, 'admins', periodKey, releasedCount);
    }
  }

  await prisma.customRole.delete({
    where: { id: roleId }
  });

  await prisma.auditLog.create({
    data: {
      college_id: collegeId,
      user_id: grantorUser.id,
      action: 'CUSTOM_ROLE_DELETED',
      details: JSON.stringify({ roleId, name: role.name })
    }
  });

  return { success: true };
}

/**
 * Assign a custom role to a user
 */
async function assignCustomRole({
  collegeId,
  campusId = null,
  roleId,
  targetUserId,
  grantorUser
}) {
  const prisma = getPrisma();

  // Self-assignment guard: nobody assigns roles to themselves
  if (targetUserId === grantorUser.id) {
    throw Object.assign(new Error('Cannot assign a role to yourself.'), {
      status: 403,
      code: 'SELF_ASSIGNMENT_FORBIDDEN'
    });
  }

  const role = await prisma.customRole.findUnique({
    where: {
      id_college_id: {
        id: roleId,
        college_id: collegeId
      }
    }
  });

  if (!role) {
    throw Object.assign(new Error(`Role with ID "${roleId}" not found in this institution.`), {
      status: 404,
      code: 'NOT_FOUND'
    });
  }

  // Verify target user belongs to same college
  const targetUser = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, college_id: true, role: true }
  });

  if (!targetUser || targetUser.college_id !== collegeId) {
    throw Object.assign(new Error('Target user does not belong to this institution.'), {
      status: 400,
      code: 'INVALID_USER'
    });
  }

  // Privilege guard: admin-class roles assignable only by fixed-role admin
  const grantorRole = String(grantorUser.role || '').toLowerCase();
  const isGrantorAdmin = grantorRole === 'admin' || grantorRole === 'superadmin';

  if (role.isAdminClass && !isGrantorAdmin) {
    throw Object.assign(new Error('Admin-class roles are assignable only by an institution admin.'), {
      status: 403,
      code: 'FORBIDDEN'
    });
  }

  // Check if already assigned
  const existing = await prisma.userCustomRole.findUnique({
    where: {
      college_id_userId_roleId: {
        college_id: collegeId,
        userId: targetUserId,
        roleId
      }
    }
  });
  if (existing) {
    throw Object.assign(new Error('Role is already assigned to this user.'), {
      status: 409,
      code: 'ALREADY_ASSIGNED'
    });
  }

  // Admin quota enforcement if role is admin-class
  if (role.isAdminClass) {
    const isAlreadyAdmin = await isUserAdminClass(collegeId, targetUserId, prisma);
    if (!isAlreadyAdmin) {
      const quotaCheck = await checkQuota(collegeId, 'admins', 1);
      if (!quotaCheck.allowed) {
        throw Object.assign(new Error('Admin user limit reached for your subscription plan.'), {
          status: 422,
          code: 'QUOTA_EXCEEDED',
          details: { limit: quotaCheck.limit, current: quotaCheck.current }
        });
      }
      await recordUsage(collegeId, 'admins', 1);
    }
  }

  const assignment = await prisma.userCustomRole.create({
    data: {
      college_id: collegeId,
      campus_id: campusId,
      userId: targetUserId,
      roleId,
      assignedBy: grantorUser.id
    }
  });

  await prisma.auditLog.create({
    data: {
      college_id: collegeId,
      user_id: grantorUser.id,
      action: 'CUSTOM_ROLE_ASSIGNED',
      details: JSON.stringify({
        roleId,
        roleName: role.name,
        targetUserId
      })
    }
  });

  return assignment;
}

/**
 * Unassign a custom role from a user
 */
async function unassignCustomRole({ collegeId, roleId, targetUserId, grantorUser }) {
  const prisma = getPrisma();

  // Self-unassign guard
  if (targetUserId === grantorUser.id) {
    throw Object.assign(new Error('Cannot unassign a role from yourself.'), {
      status: 403,
      code: 'SELF_UNASSIGNMENT_FORBIDDEN'
    });
  }

  const assignment = await prisma.userCustomRole.findUnique({
    where: {
      college_id_userId_roleId: {
        college_id: collegeId,
        userId: targetUserId,
        roleId
      }
    },
    include: {
      role: true
    }
  });

  if (!assignment) {
    throw Object.assign(new Error('Role is not assigned to this user.'), {
      status: 404,
      code: 'NOT_FOUND'
    });
  }

  const grantorRole = String(grantorUser.role || '').toLowerCase();
  const isGrantorAdmin = grantorRole === 'admin' || grantorRole === 'superadmin';

  if (assignment.role.isAdminClass && !isGrantorAdmin) {
    throw Object.assign(new Error('Only an institution admin can unassign admin-class roles.'), {
      status: 403,
      code: 'FORBIDDEN'
    });
  }

  // Delete assignment
  await prisma.userCustomRole.delete({
    where: {
      college_id_userId_roleId: {
        college_id: collegeId,
        userId: targetUserId,
        roleId
      }
    }
  });

  // Admin quota release if user is losing their last admin-class status
  if (assignment.role.isAdminClass) {
    const isStillAdmin = await isUserAdminClass(collegeId, targetUserId, prisma);
    if (!isStillAdmin) {
      const periodKey = resolvePeriodKey('admins', new Date());
      await refundQuota(collegeId, 'admins', periodKey, 1);
    }
  }

  await prisma.auditLog.create({
    data: {
      college_id: collegeId,
      user_id: grantorUser.id,
      action: 'CUSTOM_ROLE_UNASSIGNED',
      details: JSON.stringify({
        roleId,
        roleName: assignment.role.name,
        targetUserId
      })
    }
  });

  return { success: true };
}

/**
 * List all custom roles for a college
 */
async function listCustomRoles(collegeId) {
  const prisma = getPrisma();
  return prisma.customRole.findMany({
    where: { college_id: collegeId },
    include: {
      _count: {
        select: { assignments: true }
      }
    },
    orderBy: { createdAt: 'desc' }
  });
}

/**
 * Get role details by ID
 */
async function getCustomRole(collegeId, roleId) {
  const prisma = getPrisma();
  return prisma.customRole.findUnique({
    where: {
      id_college_id: {
        id: roleId,
        college_id: collegeId
      }
    },
    include: {
      assignments: {
        select: {
          id: true,
          userId: true,
          assignedBy: true,
          assignedAt: true
        }
      }
    }
  });
}

module.exports = {
  countAdminClassUsers,
  isUserAdminClass,
  getUserPermissions,
  createCustomRole,
  updateCustomRole,
  deleteCustomRole,
  assignCustomRole,
  unassignCustomRole,
  listCustomRoles,
  getCustomRole
};
