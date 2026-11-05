// ─── Verification Script: Sub-Phase 10A (N15 Campus IP Allow-Listing) ───
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const assert = require('assert');
const { getSystemClient } = require('../config/prismaManager');
const ipAllowlistService = require('../services/ipAllowlistService');
const { ipAllowlistMiddleware } = require('../middleware/ipAllowlist.middleware');

async function runSubphase10aTests() {
  console.log('\n======================================================');
  console.log('   SUB-PHASE 10A: N15 CAMPUS IP ALLOW-LISTING TESTS   ');
  console.log('======================================================\n');

  const prisma = getSystemClient();
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

  // Create test college on Enterprise plan
  const collegeCode = 'T10A_' + Math.random().toString(36).substring(2, 7).toUpperCase();
  const college = await prisma.college.create({
    data: {
      name: `10A IP Allowlist College ${collegeCode}`,
      code: collegeCode,
      email: `${collegeCode.toLowerCase()}@test.com`,
      planId: 'enterprise',
      subStatus: 'ACTIVE',
      ipAllowlistMode: 'OFF',
      periodStart: new Date(),
      periodEnd: new Date(Date.now() + 30 * 86400000)
    }
  });

  try {
    // 1. CIDR / IP Parsing & Validation
    await test('1. CIDR/IPv4/IPv6 parser normalizes valid inputs and rejects malformed values', async () => {
      // Valid IPv4 single
      assert.strictEqual(ipAllowlistService.parseAndValidateCidr('192.168.1.5'), '192.168.1.5/32');
      // Valid IPv4 CIDR
      assert.strictEqual(ipAllowlistService.parseAndValidateCidr('10.0.0.0/16'), '10.0.0.0/16');
      // Valid IPv6 single
      assert.strictEqual(ipAllowlistService.parseAndValidateCidr('2001:db8::1'), '2001:db8::1/128');
      // Valid IPv6 CIDR
      assert.strictEqual(ipAllowlistService.parseAndValidateCidr('2001:db8::/32'), '2001:db8::/32');

      // Invalid
      assert.throws(() => ipAllowlistService.parseAndValidateCidr('not-an-ip'), /Invalid/);
      assert.throws(() => ipAllowlistService.parseAndValidateCidr('999.999.999.999'), /Invalid/);
      assert.throws(() => ipAllowlistService.parseAndValidateCidr('192.168.1.0/33'), /Invalid/);
    });

    // 2. Saver Lockout Prevention (409 WOULD_LOCK_OUT_SAVER)
    await test('2. Saver lockout prevention blocks enabling ENFORCE mode if saver IP is excluded', async () => {
      // Attempting to set ENFORCE with zero rules
      await assert.rejects(
        async () => {
          await ipAllowlistService.setAllowlistMode(college.id, 'ENFORCE', '192.168.1.100');
        },
        err => err.code === 'WOULD_LOCK_OUT_SAVER'
      );

      // Add a rule that does NOT include saver IP 192.168.1.100
      await ipAllowlistService.createRule(college.id, {
        label: 'Server Room',
        cidr: '10.50.0.0/24',
        createdBy: 'admin_test'
      });

      // Still blocks ENFORCE because 192.168.1.100 not in 10.50.0.0/24
      await assert.rejects(
        async () => {
          await ipAllowlistService.setAllowlistMode(college.id, 'ENFORCE', '192.168.1.100');
        },
        err => err.code === 'WOULD_LOCK_OUT_SAVER'
      );

      // Now add rule covering saver IP
      await ipAllowlistService.createRule(college.id, {
        label: 'Admin Desk',
        cidr: '192.168.1.0/24',
        createdBy: 'admin_test'
      });

      // Now ENFORCE mode succeeds because 192.168.1.100 is allowed
      const updated = await ipAllowlistService.setAllowlistMode(college.id, 'ENFORCE', '192.168.1.100');
      assert.strictEqual(updated.ipAllowlistMode, 'ENFORCE');
    });

    // 3. LOG_ONLY Mode Records Violation without Blocking
    await test('3. LOG_ONLY mode records violation asynchronously without blocking request', async () => {
      // Set mode to LOG_ONLY
      await prisma.college.update({
        where: { id: college.id },
        data: { ipAllowlistMode: 'LOG_ONLY' }
      });

      const mockReq = {
        user: { id: 'admin_user_1', role: 'admin', college_id: college.id },
        ip: '203.0.113.42', // external IP not in allowlist
        originalUrl: '/api/students/bulk-export'
      };

      let nextCalled = false;
      let blockedCode = null;
      const mockRes = {
        status: code => {
          blockedCode = code;
          return { json: () => {} };
        }
      };

      await ipAllowlistMiddleware(mockReq, mockRes, () => {
        nextCalled = true;
      });

      await new Promise(r => setTimeout(r, 100));

      assert.strictEqual(nextCalled, true, 'LOG_ONLY mode must not block request');
      assert.strictEqual(blockedCode, null, 'No HTTP 403 returned in LOG_ONLY');

      // Verify violation record was staged
      const violations = await prisma.ipAllowlistViolation.findMany({
        where: { college_id: college.id, ip: '203.0.113.42' }
      });
      assert(violations.length >= 1, 'Expected at least 1 violation record');
      assert.strictEqual(violations[0].mode, 'LOG_ONLY');
    });

    // 4. ENFORCE Mode Blocks Unauthorized Admin and Allows Exempt Roles
    await test('4. ENFORCE mode returns 403 IP_NOT_ALLOWED for admins, but exempts teachers, API keys, and Super Admin', async () => {
      await prisma.college.update({
        where: { id: college.id },
        data: { ipAllowlistMode: 'ENFORCE' }
      });

      // 4a: Admin from unlisted IP -> BLOCKED (403)
      let blockedCode = null;
      let jsonPayload = null;
      const adminReq = {
        user: { id: 'admin_user_2', role: 'admin', college_id: college.id },
        ip: '203.0.113.99',
        originalUrl: '/api/financials/ledger'
      };
      const adminRes = {
        status: code => {
          blockedCode = code;
          return {
            json: payload => {
              jsonPayload = payload;
            }
          };
        }
      };

      let adminNext = false;
      await ipAllowlistMiddleware(adminReq, adminRes, () => {
        adminNext = true;
      });

      assert.strictEqual(blockedCode, 403, 'ENFORCE mode must return 403 for unlisted IP');
      assert.strictEqual(jsonPayload?.code, 'IP_NOT_ALLOWED');
      assert.strictEqual(adminNext, false, 'Next must not be called when blocked');

      // 4b: Teacher from unlisted IP -> EXEMPT (Allowed)
      let teacherNext = false;
      const teacherReq = {
        user: { id: 'teacher_1', role: 'teacher', college_id: college.id },
        ip: '203.0.113.99',
        originalUrl: '/api/attendance'
      };
      await ipAllowlistMiddleware(teacherReq, {}, () => {
        teacherNext = true;
      });
      assert.strictEqual(teacherNext, true, 'Teachers must be exempt from IP allowlist');

      // 4c: API Key request -> EXEMPT (Allowed)
      let apiKeyNext = false;
      const apiKeyReq = {
        apiKey: { id: 'key_123', college_id: college.id },
        ip: '203.0.113.99',
        originalUrl: '/api/v1/students'
      };
      await ipAllowlistMiddleware(apiKeyReq, {}, () => {
        apiKeyNext = true;
      });
      assert.strictEqual(apiKeyNext, true, 'N06 API keys must be exempt from IP allowlist');

      // 4d: Super Admin -> EXEMPT (Allowed)
      let saNext = false;
      const saReq = {
        user: { id: 'sa_1', role: 'super_admin', isSuperAdmin: true },
        ip: '203.0.113.99',
        originalUrl: '/api/super-admin/colleges'
      };
      await ipAllowlistMiddleware(saReq, {}, () => {
        saNext = true;
      });
      assert.strictEqual(saNext, true, 'Super Admin must be exempt from IP allowlist');
    });

    // 5. Super Admin Escape Hatch (disable-ip-allowlist)
    await test('5. Super Admin escape hatch disables IP allow-list and logs audited record', async () => {
      // Simulate Super Admin calling handleCollegeAction
      const { handleCollegeAction } = require('../controllers/superAdminGovernance.controller');

      let responsePayload = null;
      const mockReq = {
        params: { id: college.id },
        body: {
          action: 'disable-ip-allowlist',
          reason: 'Emergency college admin recovery after ISP IP subnet change'
        },
        user: { id: 'super_admin_esc', email: 'sa@academix.internal' },
        ip: '127.0.0.1'
      };
      const mockRes = {
        status: () => mockRes,
        json: data => {
          responsePayload = data;
        }
      };

      await handleCollegeAction(mockReq, mockRes);
      assert.strictEqual(responsePayload?.success, true);
      assert.strictEqual(responsePayload?.ipAllowlistMode, 'OFF');

      // Verify in DB
      const updatedCollege = await prisma.college.findUnique({
        where: { id: college.id },
        select: { ipAllowlistMode: true }
      });
      assert.strictEqual(updatedCollege.ipAllowlistMode, 'OFF');

      // Verify audit trail
      const audit = await prisma.collegeEntitlementAudit.findFirst({
        where: { college_id: college.id, action: 'DISABLE_IP_ALLOWLIST' }
      });
      assert(audit, 'Audit record for DISABLE_IP_ALLOWLIST must exist');
      assert.strictEqual(audit.reason, 'Emergency college admin recovery after ISP IP subnet change');
    });
  } finally {
    // Cleanup
    await prisma.ipAllowlistViolation.deleteMany({ where: { college_id: college.id } }).catch(() => {});
    await prisma.ipAllowlistRule.deleteMany({ where: { college_id: college.id } }).catch(() => {});
    await prisma.collegeEntitlementAudit.deleteMany({ where: { college_id: college.id } }).catch(() => {});
    await prisma.college.delete({ where: { id: college.id } }).catch(() => {});
  }

  console.log(`\n======================================================`);
  console.log(`SUB-PHASE 10A TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log(`======================================================\n`);

  if (failed > 0) process.exit(1);
}

runSubphase10aTests().catch(err => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
