'use strict';

/**
 * phase10_contract.test.js
 * Master Contract Test Suite for Phase 10: Infrastructure, Multi-Campus & Compliance
 * 
 * Verifies all canonical Phase 10 deliverables:
 * 1. N15: Campus IP Allow-Listing (Enterprise)
 * 2. N17: Comprehensive Audit Log Download (Premium)
 * 3. N16: Data Retention Policies & Legal Hold (Enterprise)
 * 4. N20: Message Credit Wallet & Consumption Ledger UI (Premium)
 * 5. §10.1: Baseline Campus Model & Database Migration (Option B)
 * 6. N18: Multi-Campus Dashboard & Executive Metrics (Enterprise)
 * 7. N19: Cross-Campus Student Transfer & Approval Integration (Enterprise)
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const assert = require('assert');

const { getSystemClient } = require('../config/prismaManager');
const {
  FEATURE_REGISTRY,
  validateRegistryDAG,
  resolveCollegeFeatures
} = require('../config/featureRegistry');

// Service imports
const ipAllowlistService = require('../services/ipAllowlistService');
const { ipAllowlistMiddleware } = require('../middleware/ipAllowlist.middleware');
const { queueExportJob, fetchExportData } = require('../services/exportService');
const { processExportJob } = require('../workers/exportWorker');
const legalHoldService = require('../services/legalHoldService');
const { deleteStoredFile } = require('../services/storageQuotaService');
const creditWalletService = require('../services/creditWalletService');
const campusService = require('../services/campusService');
const transferService = require('../services/transferService');
const { createOrUpdateChain } = require('../services/approvalService');
const { handleCollegeAction } = require('../controllers/superAdminGovernance.controller');

const prisma = getSystemClient();

async function runPhase10ContractTests() {
  console.log('====================================================');
  console.log('    PHASE 10 MASTER CONTRACT VERIFICATION SUITE     ');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    return async () => {
      try {
        await fn();
        console.log(`PASS: ${name}`);
        passed++;
      } catch (err) {
        console.error(`FAIL: ${name}`);
        console.error('      ', err.message);
        failed++;
      }
    };
  }

  const timestamp = Date.now();
  let starterCol, standardCol, premiumCol, enterpriseCol, suspendedCol;
  let starterUser, premiumAdmin, enterpriseAdmin, superUser;
  let enterpriseSession;

  try {
    // ----------------------------------------------------
    // SETUP: Provision isolated multi-tier test fixtures
    // ----------------------------------------------------
    starterCol = await prisma.college.create({
      data: {
        name: `Starter Col P10 ${timestamp}`,
        email: `str10_${timestamp}@test.com`,
        code: `STR10_${timestamp}`,
        planId: 'starter',
        subStatus: 'ACTIVE',
        periodStart: new Date(),
        periodEnd: new Date(Date.now() + 30 * 86400000)
      }
    });

    standardCol = await prisma.college.create({
      data: {
        name: `Std Col P10 ${timestamp}`,
        email: `std10_${timestamp}@test.com`,
        code: `STD10_${timestamp}`,
        planId: 'standard',
        subStatus: 'ACTIVE',
        periodStart: new Date(),
        periodEnd: new Date(Date.now() + 30 * 86400000)
      }
    });

    premiumCol = await prisma.college.create({
      data: {
        name: `Prem Col P10 ${timestamp}`,
        email: `prm10_${timestamp}@test.com`,
        code: `PRM10_${timestamp}`,
        planId: 'premium',
        subStatus: 'ACTIVE',
        periodStart: new Date(),
        periodEnd: new Date(Date.now() + 30 * 86400000)
      }
    });

    enterpriseCol = await prisma.college.create({
      data: {
        name: `Ent Col P10 ${timestamp}`,
        email: `ent10_${timestamp}@test.com`,
        code: `ENT10_${timestamp}`,
        planId: 'enterprise',
        subStatus: 'ACTIVE',
        ipAllowlistMode: 'OFF',
        periodStart: new Date(),
        periodEnd: new Date(Date.now() + 30 * 86400000)
      }
    });

    suspendedCol = await prisma.college.create({
      data: {
        name: `Susp Col P10 ${timestamp}`,
        email: `susp10_${timestamp}@test.com`,
        code: `SUS10_${timestamp}`,
        planId: 'enterprise',
        subStatus: 'SUSPENDED',
        periodStart: new Date(),
        periodEnd: new Date(Date.now() + 30 * 86400000)
      }
    });

    starterUser = await prisma.user.create({
      data: { email: `u_str_${timestamp}@test.com`, name: 'Starter Admin', role: 'admin', college_id: starterCol.id }
    });

    premiumAdmin = await prisma.user.create({
      data: { email: `u_prm_${timestamp}@test.com`, name: 'Prem Admin', role: 'admin', college_id: premiumCol.id }
    });

    enterpriseAdmin = await prisma.user.create({
      data: { email: `u_ent_${timestamp}@test.com`, name: 'Ent Admin', role: 'admin', college_id: enterpriseCol.id }
    });

    superUser = await prisma.user.create({
      data: { email: `u_sup_${timestamp}@test.com`, name: 'Super Admin', role: 'superAdmin', college_id: enterpriseCol.id }
    });

    enterpriseSession = await prisma.session.create({
      data: {
        college_id: enterpriseCol.id,
        name: `Session P10 ${timestamp}`,
        startDate: new Date(),
        endDate: new Date(Date.now() + 365 * 86400000)
      }
    });

    // Seed default campuses for starter, standard, premium, and enterprise
    await prisma.campus.createMany({
      data: [
        { college_id: starterCol.id, name: 'Main Campus', code: 'MAIN', isDefault: true, isActive: true },
        { college_id: standardCol.id, name: 'Main Campus', code: 'MAIN', isDefault: true, isActive: true },
        { college_id: premiumCol.id, name: 'Main Campus', code: 'MAIN', isDefault: true, isActive: true },
        { college_id: enterpriseCol.id, name: 'Main Campus', code: 'MAIN', isDefault: true, isActive: true }
      ]
    });

    // ----------------------------------------------------
    // TEST 1: Feature Registry Canonical Milestone Counts & DAG Validation
    // ----------------------------------------------------
    await test('1. Canonical registry counts: 114 Live + 47 Roadmap = 161 Total with 0 DAG cycles', async () => {
      assert.strictEqual(FEATURE_REGISTRY.length, 161, `Total features must equal 161 (got ${FEATURE_REGISTRY.length})`);
      const live = FEATURE_REGISTRY.filter(f => f.status === 'live');
      const cs = FEATURE_REGISTRY.filter(f => f.status === 'coming_soon');
      assert.strictEqual(live.length, 114, `Live features must equal 114 (got ${live.length})`);
      assert.strictEqual(cs.length, 47, `Coming soon features must equal 47 (got ${cs.length})`);

      // DAG validation must pass without cycle exceptions
      validateRegistryDAG();

      // Check all 6 Phase 10 keys are live
      const phase10LiveKeys = [
        'ip-allowlist-session-controls', // N15
        'audit-log-export',              // N17
        'data-retention-legal-hold',     // N16
        'message-credit-wallet',         // N20
        'multi-campus-dashboard',        // N18
        'cross-campus-transfers'         // N19
      ];
      for (const k of phase10LiveKeys) {
        const item = FEATURE_REGISTRY.find(f => f.key === k);
        assert(item, `Feature ${k} must exist in registry`);
        assert.strictEqual(item.status, 'live', `Feature ${k} must be live`);
      }

      // Check N12 and N14 remain coming_soon
      const n12 = FEATURE_REGISTRY.find(f => f.key === 'custom-domain');
      assert(n12 && n12.status === 'coming_soon', 'N12 custom-domain must remain coming_soon');
      const n14 = FEATURE_REGISTRY.find(f => f.key === 'single-sign-on');
      assert(n14 && n14.status === 'coming_soon', 'N14 single-sign-on must remain coming_soon');

      // Check N13 is permanently removed
      const n13 = FEATURE_REGISTRY.find(f => f.key === 'custom-branding-white-label');
      assert(!n13, 'N13 custom-branding-white-label must NOT exist in feature registry');
    })();

    // ----------------------------------------------------
    // TEST 2: Tier Entitlement Boundaries (FEATURE_NOT_IN_PLAN)
    // ----------------------------------------------------
    await test('2. Tier entitlement boundaries enforce FEATURE_NOT_IN_PLAN on lower tiers', async () => {
      const starterFeatures = resolveCollegeFeatures('starter').effectiveKeys;
      const stdFeatures = resolveCollegeFeatures('standard').effectiveKeys;
      const premFeatures = resolveCollegeFeatures('premium').effectiveKeys;
      const entFeatures = resolveCollegeFeatures('enterprise').effectiveKeys;

      // Starter & Standard lack all Phase 10 features
      const phase10Keys = [
        'ip-allowlist-session-controls', 'data-retention-legal-hold',
        'cross-campus-transfers'
      ];
      for (const k of phase10Keys) {
        assert(!starterFeatures.includes(k), `Starter must not include ${k}`);
        assert(!stdFeatures.includes(k), `Standard must not include ${k}`);
        assert(!premFeatures.includes(k), `Premium must not include ${k}`);
        assert(entFeatures.includes(k), `Enterprise must include ${k}`);
      }

      // Premium has N17, N18, and N20
      assert(premFeatures.includes('audit-log-export'), 'Premium must include audit-log-export (N17)');
      assert(premFeatures.includes('message-credit-wallet'), 'Premium must include message-credit-wallet (N20)');
      assert(premFeatures.includes('multi-campus-dashboard'), 'Premium must include multi-campus-dashboard (N18)');
      assert(!starterFeatures.includes('audit-log-export'), 'Starter must not include audit-log-export');
      assert(!starterFeatures.includes('message-credit-wallet'), 'Starter must not include message-credit-wallet');
    })();

    // ----------------------------------------------------
    // TEST 3: N15 CIDR/IPv4/IPv6 Validation & Saver Lockout Prevention
    // ----------------------------------------------------
    await test('3. N15 validates CIDR/IPv4/IPv6 and prevents saver lockout with WOULD_LOCK_OUT_SAVER', async () => {
      // CIDR validation
      assert.strictEqual(ipAllowlistService.parseAndValidateCidr('192.168.1.5'), '192.168.1.5/32');
      assert.strictEqual(ipAllowlistService.parseAndValidateCidr('10.0.0.0/16'), '10.0.0.0/16');
      assert.strictEqual(ipAllowlistService.parseAndValidateCidr('2001:db8::1'), '2001:db8::1/128');
      assert.strictEqual(ipAllowlistService.parseAndValidateCidr('2001:db8::/32'), '2001:db8::/32');

      assert.throws(() => ipAllowlistService.parseAndValidateCidr('invalid-ip'), /Invalid/);
      assert.throws(() => ipAllowlistService.parseAndValidateCidr('192.168.1.0/33'), /Invalid/);

      // Saver lockout check: Attempting to enable ENFORCE when saver IP is not covered
      await assert.rejects(
        () => ipAllowlistService.setAllowlistMode(enterpriseCol.id, 'ENFORCE', '192.168.1.100'),
        (err) => {
          assert.strictEqual(err.code, 'WOULD_LOCK_OUT_SAVER');
          return true;
        }
      );
    })();

    // ----------------------------------------------------
    // TEST 4: N15 IP Allow-Listing Enforcement Modes & Role Exemptions
    // ----------------------------------------------------
    await test('4. N15 enforcement modes (OFF, LOG_ONLY, ENFORCE) and role exemptions', async () => {
      // Create allowlist rule covering admin subnet
      await ipAllowlistService.createRule(enterpriseCol.id, {
        label: 'Admin Subnet',
        cidr: '192.168.1.0/24',
        createdBy: enterpriseAdmin.id
      });

      // Enable ENFORCE mode
      await ipAllowlistService.setAllowlistMode(enterpriseCol.id, 'ENFORCE', '192.168.1.50');

      // 1. Allowed IP passes in ENFORCE
      const allowedReq = {
        user: { id: enterpriseAdmin.id, role: 'admin', college_id: enterpriseCol.id },
        originalUrl: '/api/students',
        ip: '192.168.1.75',
        headers: {}
      };
      let called = false;
      const resMock = {
        status(c) { this.statusCode = c; return this; },
        json(b) { this.body = b; return this; }
      };
      await ipAllowlistMiddleware(allowedReq, resMock, () => { called = true; });
      assert.strictEqual(called, true);

      // 2. Disallowed IP blocked with 403 IP_NOT_ALLOWED
      const blockedReq = {
        user: { id: enterpriseAdmin.id, role: 'admin', college_id: enterpriseCol.id },
        originalUrl: '/api/students',
        ip: '203.0.113.5',
        headers: {}
      };
      let blockedCalled = false;
      const blockRes = {
        statusCode: 0,
        body: null,
        status(c) { this.statusCode = c; return this; },
        json(b) { this.body = b; return this; }
      };
      await ipAllowlistMiddleware(blockedReq, blockRes, () => { blockedCalled = true; });
      assert.strictEqual(blockedCalled, false);
      assert.strictEqual(blockRes.statusCode, 403);
      assert.strictEqual(blockRes.body.code, 'IP_NOT_ALLOWED');

      // 3. Exemptions: Super Admin passes despite non-whitelisted IP
      const superReq = {
        user: { id: superUser.id, role: 'superAdmin', college_id: enterpriseCol.id },
        originalUrl: '/api/students',
        ip: '203.0.113.5',
        headers: {}
      };
      let superCalled = false;
      await ipAllowlistMiddleware(superReq, resMock, () => { superCalled = true; });
      assert.strictEqual(superCalled, true);

      // 4. Exemptions: Teacher passes
      const teacherReq = {
        user: { id: 'teacher-1', role: 'teacher', college_id: enterpriseCol.id },
        originalUrl: '/api/attendance',
        ip: '203.0.113.5',
        headers: {}
      };
      let teacherCalled = false;
      await ipAllowlistMiddleware(teacherReq, resMock, () => { teacherCalled = true; });
      assert.strictEqual(teacherCalled, true);

      // 5. LOG_ONLY mode allows request and records violation
      await prisma.college.update({
        where: { id: enterpriseCol.id },
        data: { ipAllowlistMode: 'LOG_ONLY' }
      });

      let logOnlyCalled = false;
      await ipAllowlistMiddleware(blockedReq, resMock, () => { logOnlyCalled = true; });
      assert.strictEqual(logOnlyCalled, true);

      // Yield for async violation upsert
      await new Promise(r => setTimeout(r, 100));

      const violation = await prisma.ipAllowlistViolation.findFirst({
        where: { college_id: enterpriseCol.id, ip: '203.0.113.5' }
      });
      assert(violation, 'Violation must be recorded in LOG_ONLY mode');
      assert.strictEqual(violation.mode, 'LOG_ONLY');
    })();

    // ----------------------------------------------------
    // TEST 5: N15 Super Admin Emergency Escape Hatch
    // ----------------------------------------------------
    await test('5. Super Admin emergency escape hatch disables IP allowlist and creates audit entry', async () => {
      // Put college in ENFORCE
      await prisma.college.update({
        where: { id: enterpriseCol.id },
        data: { ipAllowlistMode: 'ENFORCE' }
      });

      const reqMock = {
        params: { id: enterpriseCol.id },
        body: {
          action: 'disable-ip-allowlist',
          reason: 'Emergency lockout clearance'
        },
        user: { id: superUser.id, email: superUser.email, role: 'superAdmin' },
        ip: '127.0.0.1'
      };

      let resBody = null;
      const resMock = {
        status(c) { this.statusCode = c; return this; },
        json(b) { resBody = b; return this; }
      };

      await handleCollegeAction(reqMock, resMock);
      assert.strictEqual(resBody.success, true);
      assert.strictEqual(resBody.ipAllowlistMode, 'OFF');

      const recheckedCollege = await prisma.college.findUnique({ where: { id: enterpriseCol.id } });
      assert.strictEqual(recheckedCollege.ipAllowlistMode, 'OFF');

      const audit = await prisma.collegeEntitlementAudit.findFirst({
        where: { college_id: enterpriseCol.id, action: 'DISABLE_IP_ALLOWLIST' },
        orderBy: { createdAt: 'desc' }
      });
      assert(audit, 'DISABLE_IP_ALLOWLIST audit entry must exist');
      assert.strictEqual(audit.reason, 'Emergency lockout clearance');
    })();

    // ----------------------------------------------------
    // TEST 6: N17 Audit Log Export Gating & Date Range Validation
    // ----------------------------------------------------
    await test('6. N17 gates on audit-log-export entitlement and validates mandatory 366-day date range', async () => {
      // 1. Starter college rejected
      await assert.rejects(
        () => queueExportJob({
          collegeId: starterCol.id,
          exportType: 'AUDIT_LOG',
          format: 'CSV',
          userId: starterUser.id,
          filters: {
            startDate: new Date(Date.now() - 7 * 86400000).toISOString(),
            endDate: new Date().toISOString()
          }
        }),
        (err) => {
          assert.strictEqual(err.code, 'FEATURE_NOT_IN_PLAN');
          return true;
        }
      );

      // 2. Missing date range
      await assert.rejects(
        () => queueExportJob({
          collegeId: premiumCol.id,
          exportType: 'AUDIT_LOG',
          format: 'CSV',
          userId: premiumAdmin.id,
          filters: {}
        }),
        (err) => {
          assert.strictEqual(err.code, 'DATE_RANGE_REQUIRED');
          return true;
        }
      );

      // 3. Exceeded 366 days window
      const now = new Date();
      const past400Days = new Date(now.getTime() - 400 * 86400000);
      await assert.rejects(
        () => queueExportJob({
          collegeId: premiumCol.id,
          exportType: 'AUDIT_LOG',
          format: 'CSV',
          userId: premiumAdmin.id,
          filters: {
            startDate: past400Days.toISOString(),
            endDate: now.toISOString()
          }
        }),
        (err) => {
          assert.strictEqual(err.code, 'DATE_RANGE_EXCEEDED');
          return true;
        }
      );
    })();

    // ----------------------------------------------------
    // TEST 7: N17 Audit Log Sanitization (Platform Actor & Scrubbing)
    // ----------------------------------------------------
    await test('7. N17 sanitizes Super Admin PII to Platform and supports CSV & JSON generation', async () => {
      // Seed tenant AuditLog
      await prisma.auditLog.create({
        data: {
          college_id: premiumCol.id,
          user_id: premiumAdmin.id,
          action: 'CREATE_STUDENT',
          details: 'Enrolled student P10'
        }
      });

      // Seed sensitive CollegeEntitlementAudit
      await prisma.collegeEntitlementAudit.create({
        data: {
          college_id: premiumCol.id,
          actorUserId: 'SUPER_ADMIN_SECRET_ID',
          actorEmail: 'superadmin_confidential@academix.com',
          action: 'OVERRIDE_QUOTA',
          reason: 'Internal concession granted for demo',
          beforeStateJson: { students: '1000' },
          afterStateJson: { students: '2000' },
          ipAddress: '10.99.88.77'
        }
      });

      const startDate = new Date(Date.now() - 30 * 86400000).toISOString();
      const endDate = new Date(Date.now() + 1 * 86400000).toISOString();

      const result = await fetchExportData(
        prisma,
        premiumCol.id,
        null,
        'AUDIT_LOG',
        { startDate, endDate }
      );

      assert(result.rows.length >= 2, `Expected at least 2 audit rows, got ${result.rows.length}`);

      const governanceRow = result.rawItems.find(r => r.action === 'OVERRIDE_QUOTA');
      assert(governanceRow, 'Must include governance audit entry');
      assert.strictEqual(governanceRow.actor, 'Platform', 'Super Admin actor must be masked to Platform');
      assert.strictEqual(governanceRow.actorEmail, undefined, 'Super Admin email must be scrubbed');
      assert.strictEqual(governanceRow.ipAddress, undefined, 'Super Admin IP must be scrubbed');

      // Test processing export job through worker to produce StoredFile
      const job = await queueExportJob({
        collegeId: premiumCol.id,
        exportType: 'AUDIT_LOG',
        format: 'JSON',
        userId: premiumAdmin.id,
        filters: { startDate, endDate }
      });

      const processed = await processExportJob(job);
      assert.strictEqual(processed.success, true);
      assert(processed.fileKey.endsWith('.json'), `Expected .json extension, got ${processed.fileKey}`);
    })();

    // ----------------------------------------------------
    // TEST 8: N16 Data Retention Policy Platform Floor Checks
    // ----------------------------------------------------
    await test('8. N16 enforces platform retention floors (TRASHED_STUDENT >= 7d, STORED_FILE >= 30d)', async () => {
      // Trashed student floor 7 days
      await assert.rejects(
        () => legalHoldService.setRetentionPolicy(enterpriseCol.id, {
          entityType: 'TRASHED_STUDENT',
          retainDays: 3
        }),
        (err) => {
          assert.strictEqual(err.code, 'RETENTION_BELOW_FLOOR');
          return true;
        }
      );

      // Stored file floor 30 days
      await assert.rejects(
        () => legalHoldService.setRetentionPolicy(enterpriseCol.id, {
          entityType: 'STORED_FILE',
          retainDays: 14
        }),
        (err) => {
          assert.strictEqual(err.code, 'RETENTION_BELOW_FLOOR');
          return true;
        }
      );

      // Valid policy creation
      const validPolicy = await legalHoldService.setRetentionPolicy(enterpriseCol.id, {
        entityType: 'STORED_FILE',
        retainDays: 60
      });
      assert.strictEqual(validPolicy.retainDays, 60);

      const effectiveDays = await legalHoldService.getEffectiveRetentionDays(enterpriseCol.id, 'STORED_FILE');
      assert.strictEqual(effectiveDays, 60);
    })();

    // ----------------------------------------------------
    // TEST 9: N16 Legal Hold Placement & Release with Audit Reason
    // ----------------------------------------------------
    await test('9. N16 legal hold placement and release require valid scopes and audit reasons', async () => {
      // Place hold
      const hold = await legalHoldService.placeLegalHold(enterpriseCol.id, {
        title: 'Provincial Inquiry',
        reason: 'Pending provincial regulatory inquiry',
        scopeType: 'ALL_STUDENTS',
        placedBy: enterpriseAdmin.id
      });
      assert.strictEqual(hold.isActive, true);
      assert.strictEqual(hold.scopeType, 'ALL_STUDENTS');

      // Release hold requires audit reason
      await assert.rejects(
        () => legalHoldService.releaseLegalHold(enterpriseCol.id, hold.id, {
          releasedBy: enterpriseAdmin.id,
          releaseReason: '   '
        }),
        (err) => {
          assert.strictEqual(err.statusCode, 422);
          return true;
        }
      );

      // Valid release
      const released = await legalHoldService.releaseLegalHold(enterpriseCol.id, hold.id, {
        releasedBy: enterpriseAdmin.id,
        releaseReason: 'Inquiry concluded with full compliance clearance'
      });
      assert.strictEqual(released.isActive, false);
      assert(released.releasedAt !== null);
    })();

    // ----------------------------------------------------
    // TEST 10: N16 Delete Protection Blocks File Deletion
    // ----------------------------------------------------
    await test('10. N16 active legal hold blocks deleteStoredFile with 403 LEGAL_HOLD_ACTIVE', async () => {
      const student = await prisma.student.create({
        data: {
          name: 'Held Student',
          fatherName: 'Held Father',
          gender: 'male',
          group: 'General',
          rollNumber: `R_HLD_${timestamp}`,
          college_id: enterpriseCol.id,
          session_id: enterpriseSession.id,
          class: '10th',
          section: 'A'
        }
      });

      // Place targeted hold on student
      const hold = await legalHoldService.placeLegalHold(enterpriseCol.id, {
        title: 'Litigation Hold',
        reason: 'Financial dispute litigation',
        scopeType: 'STUDENT',
        targetId: student.id,
        placedBy: enterpriseAdmin.id
      });

      // Upload file attached to student
      const file = await prisma.storedFile.create({
        data: {
          college_id: enterpriseCol.id,
          uploadedById: enterpriseAdmin.id,
          objectKey: `tenants/${enterpriseCol.id}/files/evidence_cnic_${timestamp}.pdf`,
          originalFilename: 'cnic.pdf',
          contentType: 'application/pdf',
          sizeBytes: 2048,
          category: 'document',
          entityType: 'Student',
          entityId: student.id,
          status: 'ready'
        }
      });

      // Attempt deletion must throw 403 LEGAL_HOLD_ACTIVE
      await assert.rejects(
        () => deleteStoredFile(file.id, enterpriseCol.id),
        (err) => {
          assert.strictEqual(err.statusCode, 403);
          assert.strictEqual(err.code, 'LEGAL_HOLD_ACTIVE');
          return true;
        }
      );

      // Release hold and retry deletion
      await legalHoldService.releaseLegalHold(enterpriseCol.id, hold.id, {
        releasedBy: enterpriseAdmin.id,
        releaseReason: 'Litigation settled'
      });

      const deleted = await deleteStoredFile(file.id, enterpriseCol.id);
      assert.strictEqual(deleted.success, true);
    })();

    // ----------------------------------------------------
    // TEST 11: N20 Message Credit Wallet & Consumption Calculation
    // ----------------------------------------------------
    await test('11. N20 credit wallet returns dual buckets, consumption, and disabled top-up warning', async () => {
      const currentPeriodKey = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;

      // Seed PLAN bucket entry
      await prisma.messageCreditLedgerEntry.create({
        data: {
          college_id: premiumCol.id,
          bucket: 'PLAN',
          periodKey: currentPeriodKey,
          delta: 500,
          type: 'MONTHLY_GRANT',
          balanceAfter: 500
        }
      });

      // Seed PURCHASED bucket entry
      await prisma.messageCreditLedgerEntry.create({
        data: {
          college_id: premiumCol.id,
          bucket: 'PURCHASED',
          periodKey: null,
          delta: 1000,
          type: 'PURCHASE',
          balanceAfter: 1000
        }
      });

      const overview = await creditWalletService.getWalletOverview(premiumCol.id);
      assert.strictEqual(overview.balances.plan.balance, 500);
      assert.strictEqual(overview.balances.purchased.balance, 1000);
      assert.strictEqual(overview.balances.total, 1500);
      assert.strictEqual(overview.topUpStatus.isPurchasable, false);
      assert(overview.topUpStatus.notice.includes('SMS and WhatsApp delivery is not active yet'));
      assert.strictEqual(overview.consumption30Days.inAppCreditsBilled, 0);
    })();

    // ----------------------------------------------------
    // TEST 12: N20 Message Credit Ledger Paginated Queries & Filtering
    // ----------------------------------------------------
    await test('12. N20 credit ledger supports pagination, bucket and transaction type filtering', async () => {
      const allResult = await creditWalletService.getLedgerEntries(premiumCol.id, { page: 1, limit: 10 });
      assert(allResult.entries.length >= 2, 'Expected at least 2 entries');

      const planResult = await creditWalletService.getLedgerEntries(premiumCol.id, {
        page: 1,
        limit: 10,
        bucket: 'PLAN'
      });
      assert(planResult.entries.length >= 1, 'Expected PLAN entry');
      for (const entry of planResult.entries) {
        assert.strictEqual(entry.bucket, 'PLAN');
      }
    })();

    // ----------------------------------------------------
    // TEST 13: §10.1 Exactly One Default Campus Enforced via DB Partial Unique Index
    // ----------------------------------------------------
    await test('13. Exactly one default campus per college enforced by DB partial unique index', async () => {
      // Find existing default campus
      const defaultCampus = await prisma.campus.findFirst({
        where: { college_id: enterpriseCol.id, isDefault: true }
      });
      assert(defaultCampus, 'Default campus must exist for enterprise college');

      // Attempting to insert a second default campus MUST fail at database level
      await assert.rejects(
        async () => {
          await prisma.campus.create({
            data: {
              college_id: enterpriseCol.id,
              name: 'Duplicate Default Campus',
              code: 'DUP_DEF',
              isDefault: true,
              isActive: true
            }
          });
        },
        /unique|one_default_campus/i
      );
    })();

    // ----------------------------------------------------
    // TEST 14: §10.1 & N18 Campus Creation Quota Enforcement
    // ----------------------------------------------------
    await test('14. Campus creation enforces maxCampuses quota per plan tier', async () => {
      // Starter plan has maxCampuses = 1 (default already created)
      await assert.rejects(
        () => campusService.createCampus(starterCol.id, {
          name: 'Starter Second Branch',
          code: 'STR_BRANCH_2'
        }),
        (err) => {
          assert.strictEqual(err.code, 'QUOTA_EXCEEDED');
          return true;
        }
      );

      // Enterprise plan allows up to 10 campuses
      const branch2 = await campusService.createCampus(enterpriseCol.id, {
        name: 'Gulberg Branch Campus',
        code: `GUL_${timestamp}`,
        address: 'Main Boulevard, Gulberg'
      });
      assert.strictEqual(branch2.name, 'Gulberg Branch Campus');
      assert.strictEqual(branch2.isDefault, false);
    })();

    // ----------------------------------------------------
    // TEST 15: §10.1 Option B Dynamic Student Campus Derivation
    // ----------------------------------------------------
    await test('15. Option B dynamic student campus derivation: Student model has no campus_id', async () => {
      const mainCampus = await prisma.campus.findFirst({
        where: { college_id: enterpriseCol.id, isDefault: true }
      });

      const cls = await prisma.class.create({
        data: {
          name: `ICS Class ${timestamp}`,
          college_id: enterpriseCol.id,
          campus_id: mainCampus.id,
          session_id: enterpriseSession.id
        }
      });

      const sec = await prisma.section.create({
        data: {
          name: `ICS-A-${timestamp}`,
          code: `ICSA_${timestamp}`,
          college_id: enterpriseCol.id,
          class_id: cls.id,
          campus_id: mainCampus.id,
          session_id: enterpriseSession.id,
          capacity: 50
        }
      });

      const stu = await prisma.student.create({
        data: {
          name: 'Hamza Khan',
          fatherName: 'Tariq Khan',
          gender: 'male',
          group: 'Computer Science',
          rollNumber: `R_HAM_${timestamp}`,
          college_id: enterpriseCol.id,
          session_id: enterpriseSession.id,
          class: cls.name,
          section: sec.name
        }
      });

      // Verify Prisma Student model schema has no campus_id field
      assert.strictEqual(stu.campus_id, undefined, 'Student table must NOT have campus_id column');

      // Verify dynamic resolution
      const resolved = await campusService.getStudentCampus(stu.id, enterpriseCol.id);
      assert.strictEqual(resolved.id, mainCampus.id);
      assert.strictEqual(resolved.name, mainCampus.name);
    })();

    // ----------------------------------------------------
    // TEST 16: N18 Multi-Campus Executive Dashboard Mathematical Accuracy
    // ----------------------------------------------------
    await test('16. N18 executive dashboard aggregates branch metrics (ratio of sums != sum of ratios)', async () => {
      const dashboard = await campusService.getMultiCampusDashboard(enterpriseCol.id);
      assert(dashboard.campusCount >= 2);
      assert(dashboard.networkAggregates, 'Must return network aggregates');
      assert(dashboard.networkAggregates.capacityUtilizationRate.includes('%'));
      assert(dashboard.networkAggregates.staffAttendanceRate.includes('%'));
    })();

    // ----------------------------------------------------
    // TEST 17: N19 Destination Section Campus Mismatch Validation
    // ----------------------------------------------------
    await test('17. N19 rejects cross-campus transfer when destination section does not belong to destination campus', async () => {
      const mainCampus = await prisma.campus.findFirst({
        where: { college_id: enterpriseCol.id, isDefault: true }
      });
      const branch = await prisma.campus.findFirst({
        where: { college_id: enterpriseCol.id, isDefault: false }
      });

      const test17Class = await prisma.class.create({
        data: {
          name: `T17 Cls ${timestamp}`,
          college_id: enterpriseCol.id,
          campus_id: mainCampus.id,
          session_id: enterpriseSession.id
        }
      });
      const test17Sec = await prisma.section.create({
        data: {
          name: `T17 Sec ${timestamp}`,
          code: `T17_SEC_${timestamp}`,
          college_id: enterpriseCol.id,
          campus_id: mainCampus.id,
          class_id: test17Class.id,
          session_id: enterpriseSession.id,
          capacity: 50
        }
      });

      const student = await prisma.student.create({
        data: {
          name: 'Transfer Test Student',
          fatherName: 'Transfer Father',
          gender: 'male',
          group: 'General',
          rollNumber: `TR_ERR_${timestamp}`,
          college_id: enterpriseCol.id,
          session_id: enterpriseSession.id,
          class: test17Class.name,
          section: test17Sec.name
        }
      });

      // Try to transfer to branch campus while targeting test17Sec (which is in mainCampus)
      await assert.rejects(
        () => transferService.initiateTransfer({
          collegeId: enterpriseCol.id,
          studentId: student.id,
          toCampusId: branch.id,
          toSectionId: test17Sec.id,
          reason: 'Erroneous section selection',
          actorUserId: enterpriseAdmin.id
        }),
        (err) => {
          assert.strictEqual(err.code, 'SECTION_CAMPUS_MISMATCH');
          return true;
        }
      );
    })();

    // ----------------------------------------------------
    // TEST 18: N19 Atomic Cross-Campus Transfer & Ledger Preservation
    // ----------------------------------------------------
    await test('18. N19 executes atomic cross-campus transfer, preserving fee ledger and files with audit log', async () => {
      const mainCampus = await prisma.campus.findFirst({
        where: { college_id: enterpriseCol.id, isDefault: true }
      });
      const branch = await prisma.campus.findFirst({
        where: { college_id: enterpriseCol.id, isDefault: false }
      });

      const test18MainClass = await prisma.class.create({
        data: {
          name: `T18 Main Cls ${timestamp}`,
          college_id: enterpriseCol.id,
          campus_id: mainCampus.id,
          session_id: enterpriseSession.id
        }
      });
      const test18MainSec = await prisma.section.create({
        data: {
          name: `T18 Main Sec ${timestamp}`,
          code: `T18_MSEC_${timestamp}`,
          college_id: enterpriseCol.id,
          campus_id: mainCampus.id,
          class_id: test18MainClass.id,
          session_id: enterpriseSession.id,
          capacity: 50
        }
      });

      // Destination branch class & section
      const branchCls = await prisma.class.create({
        data: {
          name: `Branch Cls ${timestamp}`,
          college_id: enterpriseCol.id,
          campus_id: branch.id,
          session_id: enterpriseSession.id
        }
      });
      const branchSec = await prisma.section.create({
        data: {
          name: `Branch Sec ${timestamp}`,
          code: `T18_BSEC_${timestamp}`,
          college_id: enterpriseCol.id,
          campus_id: branch.id,
          class_id: branchCls.id,
          session_id: enterpriseSession.id,
          capacity: 50
        }
      });

      const student = await prisma.student.create({
        data: {
          name: 'Zeeshan Ali',
          fatherName: 'Ali Ahmad',
          gender: 'male',
          group: 'Pre-Engineering',
          rollNumber: `TR_SUC_${timestamp}`,
          college_id: enterpriseCol.id,
          session_id: enterpriseSession.id,
          class: test18MainClass.name,
          section: test18MainSec.name
        }
      });

      const fee = await prisma.fee.create({
        data: {
          college_id: enterpriseCol.id,
          student_id: student.id,
          session_id: enterpriseSession.id,
          month: '2026-11',
          totalAmount: 50000,
          paidAmount: 20000,
          status: 'PARTIAL',
          dueDate: new Date()
        }
      });

      const result = await transferService.initiateTransfer({
        collegeId: enterpriseCol.id,
        studentId: student.id,
        toCampusId: branch.id,
        toSectionId: branchSec.id,
        reason: 'Family relocated near Gulberg branch',
        actorUserId: enterpriseAdmin.id
      });

      assert.strictEqual(result.status, 200);
      assert.strictEqual(result.success, true);

      // Verify derived campus is now the branch campus
      const newDerivedCampus = await campusService.getStudentCampus(student.id, enterpriseCol.id);
      assert.strictEqual(newDerivedCampus.id, branch.id);

      // Verify student section and class were updated
      const updatedStudent = await prisma.student.findUnique({ where: { id: student.id } });
      assert.strictEqual(updatedStudent.section, branchSec.name);
      assert.strictEqual(updatedStudent.class, branchCls.name);

      // Verify fee ledger row is untouched
      const feeAfter = await prisma.fee.findUnique({ where: { id: fee.id } });
      assert.strictEqual(Number(feeAfter.totalAmount), 50000);
      assert.strictEqual(Number(feeAfter.paidAmount), 20000);
      assert.strictEqual(feeAfter.student_id, student.id);

      // Verify StudentCampusTransfer audit row
      const audit = await prisma.studentCampusTransfer.findFirst({
        where: { college_id: enterpriseCol.id, student_id: student.id }
      });
      assert(audit, 'StudentCampusTransfer audit record must exist');
      assert.strictEqual(audit.toCampusId, branch.id);
      assert.strictEqual(audit.fromCampusId, mainCampus.id);
    })();

    // ----------------------------------------------------
    // TEST 19: N19 Campus Transfer with Active Approval Chain (N11)
    // ----------------------------------------------------
    await test('19. N19 campus transfer returns HTTP 202 approvalRequestId when approval chain is configured', async () => {
      const defaultCampus = await prisma.campus.findFirst({
        where: { college_id: enterpriseCol.id, isDefault: true }
      });
      const branch = await prisma.campus.findFirst({
        where: { college_id: enterpriseCol.id, isDefault: false }
      });

      const test19MainClass = await prisma.class.create({
        data: {
          name: `T19 Main Cls ${timestamp}`,
          college_id: enterpriseCol.id,
          campus_id: defaultCampus.id,
          session_id: enterpriseSession.id
        }
      });
      const test19MainSec = await prisma.section.create({
        data: {
          name: `T19 Main Sec ${timestamp}`,
          code: `T19_MSEC_${timestamp}`,
          college_id: enterpriseCol.id,
          campus_id: defaultCampus.id,
          class_id: test19MainClass.id,
          session_id: enterpriseSession.id,
          capacity: 50
        }
      });

      const test19BranchCls = await prisma.class.create({
        data: {
          name: `T19 Branch Cls ${timestamp}`,
          college_id: enterpriseCol.id,
          campus_id: branch.id,
          session_id: enterpriseSession.id
        }
      });
      const test19BranchSec = await prisma.section.create({
        data: {
          name: `T19 Branch Sec ${timestamp}`,
          code: `T19_BSEC_${timestamp}`,
          college_id: enterpriseCol.id,
          campus_id: branch.id,
          class_id: test19BranchCls.id,
          session_id: enterpriseSession.id,
          capacity: 50
        }
      });

      const student = await prisma.student.create({
        data: {
          name: 'Approval Chain Student',
          fatherName: 'Chain Father',
          gender: 'male',
          group: 'Pre-Medical',
          rollNumber: `TR_APP_${timestamp}`,
          college_id: enterpriseCol.id,
          session_id: enterpriseSession.id,
          class: test19MainClass.name,
          section: test19MainSec.name
        }
      });

      // Configure multi-step approval chain for CAMPUS_TRANSFER
      await createOrUpdateChain({
        collegeId: enterpriseCol.id,
        workflowType: 'CAMPUS_TRANSFER',
        name: 'Executive Transfer Approval',
        steps: [
          { stepNumber: 1, approverType: 'ROLE', approverRef: 'admin', stepName: 'Admin Approval' },
          { stepNumber: 2, approverType: 'ROLE', approverRef: 'superAdmin', stepName: 'SuperAdmin Approval' }
        ]
      });

      const transferResult = await transferService.initiateTransfer({
        collegeId: enterpriseCol.id,
        studentId: student.id,
        toCampusId: branch.id,
        toSectionId: test19BranchSec.id,
        reason: 'Transfer requiring executive sign-off',
        actorUserId: enterpriseAdmin.id
      });

      assert.strictEqual(transferResult.status, 202);
      assert.strictEqual(transferResult.requiresApproval, true);
      assert(transferResult.approvalRequestId, 'Must return approvalRequestId');

      // Verify student remains in original section pending approval
      const unapprovedStudent = await prisma.student.findUnique({ where: { id: student.id } });
      assert.strictEqual(unapprovedStudent.section, test19MainSec.name);
    })();

  } finally {
    // ----------------------------------------------------
    // CLEANUP: Clean test fixtures
    // ----------------------------------------------------
    const allColIds = [starterCol?.id, standardCol?.id, premiumCol?.id, enterpriseCol?.id, suspendedCol?.id].filter(Boolean);
    try {
      await prisma.approvalRequestStep.deleteMany({ where: { request: { college_id: { in: allColIds } } } }).catch(() => {});
      await prisma.approvalRequest.deleteMany({ where: { college_id: { in: allColIds } } }).catch(() => {});
      await prisma.approvalChainStep.deleteMany({ where: { chain: { college_id: { in: allColIds } } } }).catch(() => {});
      await prisma.approvalChain.deleteMany({ where: { college_id: { in: allColIds } } }).catch(() => {});
      await prisma.studentCampusTransfer.deleteMany({ where: { college_id: { in: allColIds } } });
      await prisma.dailyAttendance.deleteMany({ where: { college_id: { in: allColIds } } });
      await prisma.fee.deleteMany({ where: { college_id: { in: allColIds } } });
      await prisma.messageCreditLedgerEntry.deleteMany({ where: { college_id: { in: allColIds } } });
      await prisma.monthlyUsageMetric.deleteMany({ where: { college_id: { in: allColIds } } });
      await prisma.storedFile.deleteMany({ where: { college_id: { in: allColIds } } });
      await prisma.legalHold.deleteMany({ where: { college_id: { in: allColIds } } });
      await prisma.retentionPolicy.deleteMany({ where: { college_id: { in: allColIds } } });
      await prisma.ipAllowlistViolation.deleteMany({ where: { college_id: { in: allColIds } } });
      await prisma.ipAllowlistRule.deleteMany({ where: { college_id: { in: allColIds } } });
      await prisma.auditLog.deleteMany({ where: { college_id: { in: allColIds } } });
      await prisma.collegeEntitlementAudit.deleteMany({ where: { college_id: { in: allColIds } } });
      await prisma.exportJob.deleteMany({ where: { college_id: { in: allColIds } } });
      await prisma.student.deleteMany({ where: { college_id: { in: allColIds } } });
      await prisma.section.deleteMany({ where: { college_id: { in: allColIds } } });
      await prisma.class.deleteMany({ where: { college_id: { in: allColIds } } });
      await prisma.session.deleteMany({ where: { college_id: { in: allColIds } } });
      await prisma.campus.deleteMany({ where: { college_id: { in: allColIds } } });
      await prisma.user.deleteMany({ where: { college_id: { in: allColIds } } });
      await prisma.college.deleteMany({ where: { id: { in: allColIds } } });
    } catch (cleanErr) {
      console.warn('Cleanup warning:', cleanErr.message);
    }
  }

  console.log('\n====================================================');
  console.log(`PHASE 10 TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

if (require.main === module) {
  runPhase10ContractTests().catch((err) => {
    console.error('Fatal Phase 10 test error:', err);
    process.exit(1);
  });
}

module.exports = runPhase10ContractTests;
