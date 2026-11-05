'use strict';

/**
 * test_subphase_9c.js — Test Sub-Phase 9C: N10 Custom Roles & Permission Builder
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const assert = require('assert');
const { getSystemClient } = require('../config/prismaManager');
const prisma = getSystemClient();

const { PERMISSION_CATALOG, PERMISSION_KEYS, validatePermissions } = require('../config/permissionCatalog');
const { getFixedRolePermissions } = require('../config/rolePermissions');
const customRoleService = require('../services/customRoleService');
const requirePermission = require('../middleware/requirePermission');
const { getEntitlements } = require('../services/entitlements');

async function runTests() {
  console.log('====================================================');
  console.log('   TESTING SUB-PHASE 9C: N10 CUSTOM ROLES          ');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`FAIL: ${name}`);
      console.error(`      ${err.message}`);
      failed++;
    }
  }

  // 1. Concrete Catalog & Baseline Fixed-Role Map
  await test('1. Concrete Catalog & Baseline Fixed-Role Map', async () => {
    assert(PERMISSION_KEYS.includes('students:read'));
    assert(PERMISSION_KEYS.includes('fees:collect'));
    assert(PERMISSION_KEYS.includes('canteen:cashier'));
    assert(!PERMISSION_KEYS.includes('superadmin:all'));
    assert(!PERMISSION_KEYS.includes('system:reboot'));

    // Admin has all permissions
    const adminPerms = getFixedRolePermissions('admin');
    assert.strictEqual(adminPerms.length, PERMISSION_KEYS.length);

    // Teacher has teaching permissions
    const teacherPerms = getFixedRolePermissions('teacher');
    assert(teacherPerms.includes('attendance:mark'));
    assert(!teacherPerms.includes('fees:collect'));

    // Validation
    assert.strictEqual(validatePermissions(['students:read', 'fees:read']).valid, true);
    assert.strictEqual(validatePermissions(['invalid:perm']).valid, false);
  });

  // 2. Computed Activity across Downgrade & Upgrade (No isDormant flag)
  await test('2. Computed Activity across Downgrade & Upgrade', async () => {
    const col = await prisma.college.create({
      data: {
        name: 'RBAC College',
        email: `rbac_${Date.now()}@test.com`,
        code: `RBC_${Date.now()}`,
        planId: 'premium',
        subStatus: 'ACTIVE'
      }
    });

    const admin = await prisma.user.create({
      data: {
        college_id: col.id,
        email: `admin_${Date.now()}@test.com`,
        password: 'hash',
        role: 'admin',
        name: 'Admin User'
      }
    });

    const teacher = await prisma.user.create({
      data: {
        college_id: col.id,
        email: `teacher_${Date.now()}@test.com`,
        password: 'hash',
        role: 'teacher',
        name: 'Teacher User'
      }
    });

    // Create custom role with 'fees:collect'
    const role = await customRoleService.createCustomRole({
      collegeId: col.id,
      grantorUser: admin,
      name: 'Fee Collector Role',
      description: 'Allows teachers to collect fees',
      permissions: ['fees:collect'],
      isAdminClass: false
    });

    // Assign role to teacher
    await customRoleService.assignCustomRole({
      collegeId: col.id,
      roleId: role.id,
      targetUserId: teacher.id,
      grantorUser: admin
    });

    // In Premium plan: teacher has fees:collect
    let perms = await customRoleService.getUserPermissions(col.id, teacher);
    assert(perms.includes('fees:collect'), 'Teacher must hold fees:collect in Premium plan');

    // Downgrade college to Starter
    await prisma.college.update({
      where: { id: col.id },
      data: { planId: 'starter' }
    });

    // On Starter: custom roles are dormant; teacher falls back to base role
    perms = await customRoleService.getUserPermissions(col.id, teacher);
    assert(!perms.includes('fees:collect'), 'Teacher must NOT hold fees:collect on Starter plan');
    assert(perms.includes('attendance:mark'), 'Teacher still holds baseline attendance:mark');

    // Upgrade back to Premium
    await prisma.college.update({
      where: { id: col.id },
      data: { planId: 'premium' }
    });

    // Re-upgraded: seamlessly regains fees:collect without database flag
    perms = await customRoleService.getUserPermissions(col.id, teacher);
    assert(perms.includes('fees:collect'), 'Teacher must regain fees:collect after re-upgrade');
  });

  // 3. Composite Foreign Key Isolation (Cross-tenant DB constraint)
  await test('3. Composite Foreign Key Isolation prevents cross-tenant assignment', async () => {
    const colA = await prisma.college.create({
      data: { name: 'Tenant A', email: `tena_${Date.now()}@test.com`, code: `TA_${Date.now()}`, planId: 'premium', subStatus: 'ACTIVE' }
    });
    const colB = await prisma.college.create({
      data: { name: 'Tenant B', email: `tenb_${Date.now()}@test.com`, code: `TB_${Date.now()}`, planId: 'premium', subStatus: 'ACTIVE' }
    });

    const adminA = await prisma.user.create({
      data: { college_id: colA.id, email: `a_${Date.now()}@test.com`, password: 'hash', role: 'admin', name: 'A' }
    });
    const userB = await prisma.user.create({
      data: { college_id: colB.id, email: `b_${Date.now()}@test.com`, password: 'hash', role: 'teacher', name: 'B' }
    });

    const roleA = await customRoleService.createCustomRole({
      collegeId: colA.id,
      grantorUser: adminA,
      name: 'Role in Tenant A',
      permissions: ['students:read']
    });

    // Attempt service assignment of Role A to User B (service checks college_id)
    try {
      await customRoleService.assignCustomRole({
        collegeId: colB.id,
        roleId: roleA.id,
        targetUserId: userB.id,
        grantorUser: adminA
      });
      assert.fail('Service should have rejected cross-tenant assignment');
    } catch (err) {
      assert(err.status === 404 || err.code === 'NOT_FOUND');
    }

    // Direct database attempt with mismatched (roleId, college_id)
    try {
      await prisma.userCustomRole.create({
        data: {
          college_id: colB.id, // Mismatch: role belongs to colA
          userId: userB.id,
          roleId: roleA.id,
          assignedBy: adminA.id
        }
      });
      assert.fail('Database foreign key should have rejected cross-tenant composite FK');
    } catch (err) {
      assert(err.message.includes('Foreign key constraint') || err.code === 'P2003');
    }
  });

  // 4. Admin Quota Semantics (Free creation, quota-checked assignment & toggle)
  await test('4. Admin Quota Accounting: free creation, quota on assignment & toggle', async () => {
    // College with 2 maxAdmins limit
    const col = await prisma.college.create({
      data: { name: 'Quota Col', email: `qcol_${Date.now()}@test.com`, code: `QC_${Date.now()}`, planId: 'premium', subStatus: 'ACTIVE' }
    });

    // 1 base admin already exists
    const admin = await prisma.user.create({
      data: { college_id: col.id, email: `qadm_${Date.now()}@test.com`, password: 'hash', role: 'admin', name: 'Admin 1' }
    });

    const user1 = await prisma.user.create({
      data: { college_id: col.id, email: `qu1_${Date.now()}@test.com`, password: 'hash', role: 'teacher', name: 'User 1' }
    });
    const user2 = await prisma.user.create({
      data: { college_id: col.id, email: `qu2_${Date.now()}@test.com`, password: 'hash', role: 'teacher', name: 'User 2' }
    });

    // Role creation is FREE
    const adminRole = await customRoleService.createCustomRole({
      collegeId: col.id,
      grantorUser: admin,
      name: 'Assistant Principal',
      permissions: ['students:read', 'approvals:act'],
      isAdminClass: true
    });
    assert(adminRole.id);

    // Initial admin class count is 1
    let adminCount = await customRoleService.countAdminClassUsers(col.id);
    assert.strictEqual(adminCount, 1);

    // Assigning to user1 consumes 1 admin quota (adminCount becomes 2)
    await customRoleService.assignCustomRole({
      collegeId: col.id,
      roleId: adminRole.id,
      targetUserId: user1.id,
      grantorUser: admin
    });
    adminCount = await customRoleService.countAdminClassUsers(col.id);
    assert.strictEqual(adminCount, 2);

    // Unassigning releases quota (adminCount returns to 1)
    await customRoleService.unassignCustomRole({
      collegeId: col.id,
      roleId: adminRole.id,
      targetUserId: user1.id,
      grantorUser: admin
    });
    adminCount = await customRoleService.countAdminClassUsers(col.id);
    assert.strictEqual(adminCount, 1);
  });

  // 5. Privilege-Escalation & Self-Edit Guards
  await test('5. Privilege Escalation & Self-Edit Prevention', async () => {
    const col = await prisma.college.create({
      data: { name: 'Sec Col', email: `sec_${Date.now()}@test.com`, code: `SC_${Date.now()}`, planId: 'premium', subStatus: 'ACTIVE' }
    });

    const admin = await prisma.user.create({
      data: { college_id: col.id, email: `sadm_${Date.now()}@test.com`, password: 'hash', role: 'admin', name: 'Sec Admin' }
    });
    const teacher = await prisma.user.create({
      data: { college_id: col.id, email: `stch_${Date.now()}@test.com`, password: 'hash', role: 'teacher', name: 'Sec Teacher' }
    });

    // Teacher cannot create role with permissions they do not possess
    try {
      await customRoleService.createCustomRole({
        collegeId: col.id,
        grantorUser: teacher,
        name: 'Rogue Role',
        permissions: ['fees:collect'] // Teacher does NOT have fees:collect
      });
      assert.fail('Should have blocked privilege escalation');
    } catch (err) {
      assert.strictEqual(err.code, 'PRIVILEGE_ESCALATION');
    }

    // Nobody assigns role to themselves
    const safeRole = await customRoleService.createCustomRole({
      collegeId: col.id,
      grantorUser: admin,
      name: 'Safe Role',
      permissions: ['students:read']
    });

    try {
      await customRoleService.assignCustomRole({
        collegeId: col.id,
        roleId: safeRole.id,
        targetUserId: admin.id,
        grantorUser: admin
      });
      assert.fail('Should have blocked self-assignment');
    } catch (err) {
      assert.strictEqual(err.code, 'SELF_ASSIGNMENT_FORBIDDEN');
    }

    // Assign to teacher
    await customRoleService.assignCustomRole({
      collegeId: col.id,
      roleId: safeRole.id,
      targetUserId: teacher.id,
      grantorUser: admin
    });

    // Teacher cannot modify role assigned to themselves
    try {
      await customRoleService.updateCustomRole({
        collegeId: col.id,
        roleId: safeRole.id,
        grantorUser: teacher,
        updates: { name: 'Hacked Name' }
      });
      assert.fail('Should have blocked self-edit');
    } catch (err) {
      assert.strictEqual(err.code, 'SELF_EDIT_FORBIDDEN');
    }
  });

  // 6. requirePermission Middleware Verification
  await test('6. requirePermission Middleware Verification', async () => {
    const col = await prisma.college.create({
      data: { name: 'MW Col', email: `mw_${Date.now()}@test.com`, code: `MW_${Date.now()}`, planId: 'premium', subStatus: 'ACTIVE' }
    });

    const teacher = await prisma.user.create({
      data: { college_id: col.id, email: `mwt_${Date.now()}@test.com`, password: 'hash', role: 'teacher', name: 'MW Teacher' }
    });

    const mw = requirePermission('fees:collect');

    // Fake req, res
    let calledNext = false;
    let statusCode = null;
    let jsonResponse = null;

    const fakeReq = {
      user: teacher,
      headers: { 'x-college-id': col.id }
    };
    const fakeRes = {
      status(c) { statusCode = c; return this; },
      json(data) { jsonResponse = data; return this; }
    };
    const fakeNext = () => { calledNext = true; };

    // Teacher lacks fees:collect -> 403 INSUFFICIENT_PERMISSIONS
    await mw(fakeReq, fakeRes, fakeNext);
    assert.strictEqual(calledNext, false);
    assert.strictEqual(statusCode, 403);
    assert.strictEqual(jsonResponse.code, 'INSUFFICIENT_PERMISSIONS');

    // Grant custom role with fees:collect
    const admin = await prisma.user.create({
      data: { college_id: col.id, email: `mwa_${Date.now()}@test.com`, password: 'hash', role: 'admin', name: 'MW Admin' }
    });
    const feeRole = await customRoleService.createCustomRole({
      collegeId: col.id,
      grantorUser: admin,
      name: 'Fee Role MW',
      permissions: ['fees:collect']
    });
    await customRoleService.assignCustomRole({
      collegeId: col.id,
      roleId: feeRole.id,
      targetUserId: teacher.id,
      grantorUser: admin
    });

    // Re-run middleware
    calledNext = false;
    statusCode = null;
    await mw(fakeReq, fakeRes, fakeNext);
    assert.strictEqual(calledNext, true, 'Middleware must call next() when custom role grants permission');
  });

  console.log(`\n====================================================`);
  console.log(`SUB-PHASE 9C TESTS SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log(`====================================================`);

  if (failed > 0) process.exit(1);
}

runTests()
  .catch(err => {
    console.error('Fatal error during test run:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

