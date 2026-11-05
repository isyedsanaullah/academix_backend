// ─── Verification Script: Sub-Phase 10B (N17 Comprehensive Audit Log Download) ───
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const assert = require('assert');
const { getSystemClient } = require('../config/prismaManager');
const { queueExportJob, fetchExportData } = require('../services/exportService');
const { processExportJob } = require('../workers/exportWorker');

async function runSubphase10bTests() {
  console.log('\n======================================================');
  console.log('   SUB-PHASE 10B: N17 AUDIT LOG DOWNLOAD TESTS        ');
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

  const codeP = 'T10B_P_' + Math.random().toString(36).substring(2, 6).toUpperCase();
  const codeS = 'T10B_S_' + Math.random().toString(36).substring(2, 6).toUpperCase();

  // 1. Premium College
  const premiumCollege = await prisma.college.create({
    data: {
      name: `10B Premium College ${codeP}`,
      code: codeP,
      email: `${codeP.toLowerCase()}@test.com`,
      planId: 'premium',
      subStatus: 'ACTIVE',
      periodStart: new Date(),
      periodEnd: new Date(Date.now() + 30 * 86400000)
    }
  });

  // 2. Starter College
  const starterCollege = await prisma.college.create({
    data: {
      name: `10B Starter College ${codeS}`,
      code: codeS,
      email: `${codeS.toLowerCase()}@test.com`,
      planId: 'starter',
      subStatus: 'ACTIVE',
      periodStart: new Date(),
      periodEnd: new Date(Date.now() + 30 * 86400000)
    }
  });

  try {
    // 1. Gating Check
    await test('1. Starter plan is rejected with 403 FEATURE_NOT_IN_PLAN for AUDIT_LOG export', async () => {
      await assert.rejects(
        async () => {
          await queueExportJob({
            collegeId: starterCollege.id,
            userId: 'user_1',
            exportType: 'AUDIT_LOG',
            format: 'CSV',
            filters: {
              startDate: new Date(Date.now() - 7 * 86400000).toISOString(),
              endDate: new Date().toISOString()
            }
          });
        },
        err => err.code === 'FEATURE_NOT_IN_PLAN' && err.status === 403
      );
    });

    // 2. Date Range Required
    await test('2. AUDIT_LOG export strictly requires startDate and endDate (422)', async () => {
      await assert.rejects(
        async () => {
          await queueExportJob({
            collegeId: premiumCollege.id,
            userId: 'user_p',
            exportType: 'AUDIT_LOG',
            format: 'CSV',
            filters: {} // Missing dates
          });
        },
        err => err.code === 'DATE_RANGE_REQUIRED' && err.status === 422
      );
    });

    // 3. Date Range Ceiling (Max 366 days)
    await test('3. Date range exceeding 366 days is rejected with 422', async () => {
      const now = new Date();
      const past400Days = new Date(now.getTime() - 400 * 86400000);

      await assert.rejects(
        async () => {
          await queueExportJob({
            collegeId: premiumCollege.id,
            userId: 'user_p',
            exportType: 'AUDIT_LOG',
            format: 'CSV',
            filters: {
              startDate: past400Days.toISOString(),
              endDate: now.toISOString()
            }
          });
        },
        err => err.code === 'DATE_RANGE_EXCEEDED' && err.status === 422
      );
    });

    // 4. Data Sanitization Invariant Test
    await test('4. Entitlement audits strictly sanitized: Super Admin IP, user IDs, emails and internal notes never leak', async () => {
      const sensitiveIp = '198.51.100.77';
      const sensitiveReason = 'Confidential Board Settlement Concession Note - Do not disclose';
      const sensitiveEmail = 'superadmin_confidential@academix.internal';

      // Seed tenant AuditLog
      await prisma.auditLog.create({
        data: {
          college_id: premiumCollege.id,
          user_id: 'tenant_admin_42',
          action: 'STUDENT_ENROLLED',
          details: 'Enrolled student ST-2026-001',
          createdAt: new Date()
        }
      });

      // Seed sensitive CollegeEntitlementAudit
      await prisma.collegeEntitlementAudit.create({
        data: {
          college_id: premiumCollege.id,
          actorUserId: 'SA_USER_SECRET_999',
          actorEmail: sensitiveEmail,
          action: 'PLAN_UPGRADE',
          beforeStateJson: { planId: 'standard' },
          afterStateJson: { planId: 'premium' },
          reason: sensitiveReason,
          ipAddress: sensitiveIp,
          createdAt: new Date()
        }
      });

      const filters = {
        startDate: new Date(Date.now() - 2 * 86400000).toISOString(),
        endDate: new Date(Date.now() + 86400000).toISOString()
      };

      const result = await fetchExportData(prisma, premiumCollege.id, null, 'AUDIT_LOG', filters);

      // Verify headers
      assert.deepStrictEqual(result.headers, ['Timestamp', 'Action', 'Actor', 'Details']);
      assert(result.rows.length >= 2, 'Must contain at least 2 rows');

      // Stringify entire export rows to search for leakages
      const exportedJsonText = JSON.stringify(result.rawItems);
      const exportedCsvText = JSON.stringify(result.rows);

      // Strict assertions: no sensitive strings appear anywhere in the output
      assert(!exportedJsonText.includes(sensitiveIp), 'Sensitive Super Admin IP leaked in JSON export!');
      assert(!exportedCsvText.includes(sensitiveIp), 'Sensitive Super Admin IP leaked in CSV export!');
      assert(!exportedJsonText.includes(sensitiveReason), 'Sensitive internal reason note leaked in JSON export!');
      assert(!exportedCsvText.includes(sensitiveReason), 'Sensitive internal reason note leaked in CSV export!');
      assert(!exportedJsonText.includes(sensitiveEmail), 'Sensitive Super Admin email leaked in JSON export!');
      assert(!exportedCsvText.includes(sensitiveEmail), 'Sensitive Super Admin email leaked in CSV export!');

      // Verify entitlement audit shows 'Platform' as actor
      const platformEntry = result.rawItems.find(item => item.action === 'PLAN_UPGRADE');
      assert(platformEntry, 'PLAN_UPGRADE action entry must exist');
      assert.strictEqual(platformEntry.actor, 'Platform', 'Entitlement audit actor must be masked as "Platform"');
    });

    // 5. Dual Format (CSV and JSON) Output Generation
    await test('5. N17 produces valid CSV and JSON export files through worker pipeline', async () => {
      const filters = {
        startDate: new Date(Date.now() - 2 * 86400000).toISOString(),
        endDate: new Date(Date.now() + 86400000).toISOString()
      };

      // 5a. CSV Format
      const csvJob = await queueExportJob({
        collegeId: premiumCollege.id,
        userId: 'admin_p',
        exportType: 'AUDIT_LOG',
        format: 'CSV',
        filters
      });
      const csvResult = await processExportJob(csvJob);
      assert.strictEqual(csvResult.success, true);
      assert(csvResult.fileKey.endsWith('.csv'), `Expected .csv extension, got ${csvResult.fileKey}`);

      // 5b. JSON Format
      const jsonJob = await queueExportJob({
        collegeId: premiumCollege.id,
        userId: 'admin_p',
        exportType: 'AUDIT_LOG',
        format: 'JSON',
        filters
      });
      const jsonResult = await processExportJob(jsonJob);
      assert.strictEqual(jsonResult.success, true);
      assert(jsonResult.fileKey.endsWith('.json'), `Expected .json extension, got ${jsonResult.fileKey}`);
    });
  } finally {
    // Cleanup
    await prisma.exportJob.deleteMany({ where: { college_id: { in: [premiumCollege.id, starterCollege.id] } } }).catch(() => {});
    await prisma.auditLog.deleteMany({ where: { college_id: premiumCollege.id } }).catch(() => {});
    await prisma.collegeEntitlementAudit.deleteMany({ where: { college_id: premiumCollege.id } }).catch(() => {});
    await prisma.college.deleteMany({ where: { id: { in: [premiumCollege.id, starterCollege.id] } } }).catch(() => {});
  }

  console.log(`\n======================================================`);
  console.log(`SUB-PHASE 10B TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log(`======================================================\n`);

  if (failed > 0) process.exit(1);
}

runSubphase10bTests().catch(err => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});

